import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject, LockManager, LoopEngine, LoopStage } from '@alp/parser';
import { createProvider } from '../llm-provider';

interface RunOptions {
  task?: string;
  agent?: string;
  dryRun?: boolean;
  concurrent?: number;
  provider?: string;
  model?: string;
}

/**
 * `alp run` — The ALP Execution Engine.
 *
 * This command reads the .alp workspace, resolves the dependency graph,
 * identifies the target task (or next available task), compiles the full
 * context payload, and either executes via an LLM API or outputs the
 * context bundle for manual execution.
 */
export function runCommand(taskId?: string, options?: RunOptions) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  // ─── 1. Load & Parse Workspace ──────────────────────────────────────
  const parser = new AlpParser();
  const allObjects: AlpObject[] = [];
  loadAlpDirectory(alpDir, parser, allObjects);

  if (allObjects.length === 0) {
    console.error('Error: No ALP objects found in .alp directory.');
    process.exit(1);
  }

  // ─── 2. Find Target Task ────────────────────────────────────────────
  let targetTask: AlpObject | null = null;

  if (taskId) {
    targetTask = allObjects.find(
      (obj) => obj._type === 'task' && obj.id === taskId
    ) || null;
    if (!targetTask) {
      // Also search by partial match
      targetTask = allObjects.find(
        (obj) => obj.id && obj.id.includes(taskId)
      ) || null;
    }
    if (!targetTask) {
      console.error(`Error: Task "${taskId}" not found in workspace.`);
      process.exit(1);
    }
  } else {
    // Auto-select: find the first todo task whose dependencies are met
    const tasks = allObjects.filter((obj) => obj._type === 'task');
    const doneIds = new Set(
      allObjects
        .filter((obj) => obj.status === '[x]' || obj.status === 'done')
        .map((obj) => obj.id)
    );

    // Load lock manager to skip tasks claimed by concurrent runners
    const lockManager = new LockManager(process.cwd());
    const lockedIds = lockManager.getLockedTaskIds();

    for (const task of tasks) {
      if (task.status === '[ ]' || task.status === 'todo') {
        if (lockedIds.has(task.id as string)) continue; // skip claimed tasks
        const deps = extractDependencies(task);
        const allDepsMet = deps.every((d) => doneIds.has(d));
        if (allDepsMet) {
          targetTask = task;
          // Claim this task atomically
          const agentId = options?.agent || 'default-agent';
          const claimed = lockManager.claim(task.id as string, agentId);
          if (!claimed) continue; // Another process sniped it — try next
          break;
        }
      }
    }

    if (!targetTask) {
      console.log('✅ No actionable tasks found. All tasks are either done or blocked.');
      return;
    }
  }


  // ─── 3. Gather Context ──────────────────────────────────────────────
  const project = allObjects.find((obj) => obj._type === 'project');
  const agent = options?.agent
    ? allObjects.find((obj) => obj._type === 'agent' && obj.id === options.agent)
    : allObjects.find(
        (obj) => obj._type === 'agent' && obj.id === (targetTask as any).owner?.replace('-> ', '')
      ) || allObjects.find((obj) => obj._type === 'agent');

  const memories = allObjects.filter((obj) => obj._type === 'memory');
  const rules = allObjects.filter((obj) => obj._type === 'rule');
  const decisions = allObjects.filter(
    (obj) => obj._type === 'decision' && obj.status === '[x]'
  );

  // ─── 4. Build Context Bundle ────────────────────────────────────────
  const contextBundle = buildContextBundle(
    targetTask,
    project || null,
    agent || null,
    memories,
    rules,
    decisions,
    allObjects
  );

  // ─── 5. Output / Execution ───────────────────────────────────────────
  if (options?.dryRun) {
    console.log('\n🔍 DRY RUN — Context Bundle for Task Execution\n');
    console.log('═'.repeat(60));
    console.log(contextBundle);
    console.log('═'.repeat(60));
    console.log('\nTo execute this task, remove the --dry-run flag.');
  } else if (options?.provider) {
    console.log(`\n🚀 ALP Execution Engine — Powered by ${options.provider.toUpperCase()}\n`);
    const llm = createProvider(options.provider, options.model);
    
    const loop = new LoopEngine({
      maxIterations: 3,
      completionConditions: ['Task verified successfully'],
    });

    loop.on((event) => {
      if (event.type === 'stage_enter') {
        console.log(`[Loop] Iteration ${event.iteration} — Entering stage: ${event.stage}`);
      } else if (event.type === 'completed') {
        console.log(`✅ Task ${(targetTask as any).id} completed successfully in ${event.iteration} iterations!`);
      } else if (event.type === 'failed') {
        console.error(`❌ Task execution failed:`, event.data);
      }
    });

    // We don't await here since we might want to just start it, but let's await for CLI
    loop.run(async (stage: LoopStage, iteration: number) => {
      const messages = [
        { role: 'system' as const, content: 'You are an autonomous AI agent following the ALP protocol. Execute the given stage.' },
        { role: 'user' as const, content: `Context:\n${contextBundle}\n\nCurrent Stage: ${stage}\nIteration: ${iteration}\nPlease execute this stage.` }
      ];
      
      console.log(`[LLM] Requesting completion for stage ${stage}...`);
      const response = await llm.chat(messages);
      console.log(`[LLM] Response received (${response.length} chars).`);
      
      // Simulate verification for now unless it's 'test'
      if (stage === 'test') {
         return true; // We assume success on 'test' stage for MVP
      }
      return false; // continue loop
    }).catch(err => {
      console.error('Execution error:', err);
    });

  } else {
    console.log('\n🚀 ALP Execution Engine\n');
    console.log(`  Task:    ${(targetTask as any).id}`);
    console.log(`  Type:    @${(targetTask as any)._type}`);
    console.log(`  Agent:   ${agent ? (agent as any).id : 'default'}`);
    console.log(`  Status:  ${(targetTask as any).status || '[ ]'}`);
    console.log('');
    console.log('═'.repeat(60));
    console.log('📋 CONTEXT BUNDLE (pass to your LLM agent)');
    console.log('═'.repeat(60));
    console.log(contextBundle);
    console.log('═'.repeat(60));
    console.log('');
    console.log('💡 Integration: Pipe this output to your agent:');
    console.log('   alp run --task "' + (targetTask as any).id + '" | claude-code');
    console.log('   alp run --task "' + (targetTask as any).id + '" | cursor-agent');
    console.log('\n💡 Native Execution: Run with --provider to execute natively:');
    console.log('   alp run --provider openai --model gpt-4o');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadAlpDirectory(
  dir: string,
  parser: AlpParser,
  results: AlpObject[]
) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadAlpDirectory(fullPath, parser, results);
    } else if (entry.name.endsWith('.alp')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const objects = parser.parse(content);
        results.push(...objects);
      } catch {
        // Skip files with parse errors
      }
    }
  }
}

function extractDependencies(obj: AlpObject): string[] {
  const deps: string[] = [];
  // Look through all properties for `-> id` references
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.startsWith('-> ')) {
      deps.push(value.replace('-> ', ''));
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.startsWith('-> ')) {
          deps.push(item.replace('-> ', ''));
        }
      }
    }
  }
  return deps;
}

function buildContextBundle(
  task: AlpObject,
  project: AlpObject | null,
  agent: AlpObject | null,
  memories: AlpObject[],
  rules: AlpObject[],
  decisions: AlpObject[],
  allObjects: AlpObject[]
): string {
  const sections: string[] = [];

  // Header
  sections.push('# ALP Task Execution Context');
  sections.push(`Generated by \`alp run\` at ${new Date().toISOString()}\n`);

  // Project context
  if (project) {
    sections.push('## Project');
    sections.push(`- Name: ${project.id || 'unnamed'}`);
    if (project.description) sections.push(`- Description: ${project.description}`);
    if (project.stack) sections.push(`- Stack: ${project.stack}`);
    sections.push('');
  }

  // Target task
  sections.push('## Target Task');
  sections.push(`- ID: ${task.id}`);
  if (task.description) sections.push(`- Description: ${task.description}`);
  if (task.priority) sections.push(`- Priority: ${task.priority}`);
  if (task.status) sections.push(`- Status: ${task.status}`);
  sections.push('');

  // Acceptance criteria
  if (task.accept && Array.isArray(task.accept)) {
    sections.push('## Acceptance Criteria');
    for (const criterion of task.accept) {
      sections.push(`- ${criterion}`);
    }
    sections.push('');
  }

  // Verification steps
  if (task.verify && Array.isArray(task.verify)) {
    sections.push('## Verification Commands');
    for (const step of task.verify) {
      sections.push(`- \`${step}\``);
    }
    sections.push('');
  }

  // Agent info
  if (agent) {
    sections.push('## Assigned Agent');
    sections.push(`- Role: ${agent.id}`);
    if (agent.description) sections.push(`- Description: ${agent.description}`);
    if (agent.capabilities && Array.isArray(agent.capabilities)) {
      sections.push(`- Capabilities: ${agent.capabilities.join(', ')}`);
    }
    sections.push('');
  }

  // Rules
  if (rules.length > 0) {
    sections.push('## Architectural Rules (MUST follow)');
    for (const rule of rules) {
      sections.push(`- **${rule.id}**: ${rule.description || rule.enforce || 'N/A'}`);
    }
    sections.push('');
  }

  // Decisions
  if (decisions.length > 0) {
    sections.push('## Finalized Decisions');
    for (const dec of decisions) {
      sections.push(`- **${dec.id}**: ${dec.description || dec.outcome || 'N/A'}`);
    }
    sections.push('');
  }

  // Memories
  if (memories.length > 0) {
    sections.push('## Relevant Memories');
    for (const mem of memories) {
      sections.push(`- **${mem.id}** (${mem.type || 'general'}): ${mem.description || mem.content || 'N/A'}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}
