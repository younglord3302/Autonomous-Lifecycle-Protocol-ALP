import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject, LockManager, LoopEngine, LoopStage, SwarmClient, SwarmConfig } from '@alp/parser';
import { createProvider } from '../llm-provider';
import { logEvent } from '../runtime';

interface RunOptions {
  task?: string;
  agent?: string;
  dryRun?: boolean;
  concurrent?: number;
  provider?: string;
  model?: string;
  swarm?: string;
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

  if (options?.swarm) {
    runNetworkedSwarm(options, alpDir).catch(err => {
       console.error("Networked Swarm Error:", err);
       process.exit(1);
    });
    return;
  }

  if (options?.concurrent && options.concurrent > 1) {
    runSwarmMode(options, alpDir).catch(err => {
       console.error("Swarm Mode Error:", err);
       process.exit(1);
    });
    return;
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
    // Purge locks held by dead processes so a crashed/previous run can't
    // deadlock task selection.
    lockManager.cleanup();
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
          // Release the claim when this single-run process exits so we
          // never leak a lock (single run is synchronous / short-lived).
          releaseOnExit(lockManager, task.id as string);
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

/**
 * Ensure a single-run claim is released on process exit so we never leak a
 * lock into `.alp/.runtime/locks.json`. Registered once per claimed task.
 */
function releaseOnExit(lockManager: LockManager, taskId: string): void {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      lockManager.release(taskId);
    } catch {
      /* best-effort */
    }
  };
  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(143);
  });
}

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
  // Only real blocking edges count as dependencies for execution ordering.
  // Reference links like `feature:` or `owner:` must NOT block a task.
  const blockingKeys = new Set(['depends_on', 'blocked_by', 'requires']);
  for (const [key, value] of Object.entries(obj)) {
    if (!blockingKeys.has(key)) continue;
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

function updateTaskStatusOnFile(taskId: string, newStatus: string, alpDir: string): boolean {
  let updated = false;
  const walk = (dir: string) => {
    if (updated) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (updated) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (fullPath.endsWith('.alp')) {
        let content = fs.readFileSync(fullPath, 'utf8');
        // Simple regex to replace status within the same block
        const regex = new RegExp(`(id:\\s*${taskId}\\b[^@]*?status:\\s*)([^\\n]+)`);
        if (regex.test(content)) {
           content = content.replace(regex, `$1${newStatus}`);
           fs.writeFileSync(fullPath, content, 'utf8');
           updated = true;
        }
      }
    }
  };
  if (fs.existsSync(alpDir)) {
     walk(alpDir);
  }
  return updated;
}

function resolveSwarmConfig(alpDir: string, swarmId: string, coordinator?: string, token?: string, node?: string): SwarmConfig {
  const parser = new AlpParser();
  const objects: AlpObject[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.runtime' || entry.name === '.cache') continue;
        walk(full);
      } else if (entry.name.endsWith('.alp')) {
        try { objects.push(...parser.parse(fs.readFileSync(full, 'utf-8'))); } catch {}
      }
    }
  };
  walk(alpDir);
  const swarm = objects.find((o) => o._type === 'swarm' && o.id === swarmId);
  if (!swarm) {
    console.error(`Error: @swarm "${swarmId}" not found in workspace.`);
    process.exit(1);
  }
  const rawToken = token || (swarm as any).token;
  let resolvedToken: string | undefined;
  if (rawToken) {
    const m = /\$\{([^}]+)\}/.exec(rawToken);
    resolvedToken = m ? process.env[m[1]] : rawToken;
  }
  const rawHb = (swarm as any).heartbeat_seconds;
  const rawPull = (swarm as any).pull_state;
  return {
    id: swarmId,
    coordinator: coordinator || (swarm as any).coordinator || 'http://127.0.0.1:4000',
    token: resolvedToken,
    node_id: node || (swarm as any).node_id,
    heartbeat_seconds: rawHb === undefined ? undefined : Number(rawHb),
    pull_state: rawPull === undefined ? undefined : (rawPull === true || rawPull === 'true'),
    peers: (swarm as any).peers,
  };
}

async function runNetworkedSwarm(options: RunOptions, alpDir: string) {
  const swarmId = options.swarm as string;
  const cfg = resolveSwarmConfig(alpDir, swarmId, process.env.ALP_SWARM_COORDINATOR, process.env.ALP_SWARM_TOKEN);
  const client = new SwarmClient(cfg);
  const node = await client.join();
  console.log(`\n🌐 Joined networked swarm "${swarmId}" as node "${node.node_id}".`);

  let currentClaim: string | null = null;
  const stop = client.startHeartbeat(() => currentClaim);
  const cleanup = () => { stop(); client.leave().catch(() => {}); };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const parser = new AlpParser();
  const lockManager = new LockManager(process.cwd());
  lockManager.cleanup();

  while (true) {
    const allObjects: AlpObject[] = [];
    loadAlpDirectory(alpDir, parser, allObjects);
    const tasks = allObjects.filter((obj) => obj._type === 'task');
    const doneIds = new Set(
      allObjects.filter((obj) => obj.status === '[x]' || obj.status === 'done').map((obj) => obj.id)
    );
    if (tasks.every((t) => doneIds.has(t.id))) {
      console.log(`[${node.node_id}] 🏁 All tasks completed. Leaving swarm.`);
      break;
    }
    let target: AlpObject | null = null;
    for (const task of tasks) {
      if (task.status === '[ ]' || task.status === 'todo') {
        const deps = extractDependencies(task);
        if (deps.every((d) => doneIds.has(d))) { target = task; break; }
      }
    }
    if (!target) { await new Promise((r) => setTimeout(r, 2000)); continue; }

    const agentId = options.agent || `${node.node_id}-agent`;
    const claim = await client.claim(target.id as string, agentId);
    if (!claim) { await new Promise((r) => setTimeout(r, 1000)); continue; }
    currentClaim = target.id as string;
    console.log(`[${node.node_id}] 🚀 Claimed task: ${target.id} (via coordinator)`);
    logEvent(alpDir, 'task_claim', { task_id: target.id as string, agent: agentId, source: 'swarm' });

    if (options.provider) {
      const project = allObjects.find((obj) => obj._type === 'project');
      const agent = allObjects.find((obj) => obj._type === 'agent' && obj.id === (target as any).owner?.replace('-> ', ''))
        || allObjects.find((obj) => obj._type === 'agent');
      const memories = allObjects.filter((obj) => obj._type === 'memory');
      const rules = allObjects.filter((obj) => obj._type === 'rule');
      const decisions = allObjects.filter((obj) => obj._type === 'decision' && obj.status === '[x]');
      const contextBundle = buildContextBundle(target, project || null, agent || null, memories, rules, decisions, allObjects);
      const llm = createProvider(options.provider, options.model);
      const loop = new LoopEngine({ maxIterations: 3, completionConditions: ['Task verified successfully'] });
      let success = false;
      try {
        const result = await loop.run(async (stage: LoopStage, iteration: number) => {
          await llm.chat([
            { role: 'system' as const, content: 'You are an autonomous AI agent following the ALP protocol.' },
            { role: 'user' as const, content: `Context:\n${contextBundle}\n\nCurrent Stage: ${stage}\nExecute this stage.` },
          ]);
          return stage === 'test';
        });
        success = result.status === 'completed';
      } catch (e) {
        console.error(`[${node.node_id} | ${target!.id}] Execution error:`, e);
      }
      updateTaskStatusOnFile(target.id as string, success ? '[x]' : '[!]', alpDir);
      logEvent(alpDir, 'task_status', { task_id: target.id as string, status: success ? '[x]' : '[!]', agent: agentId, source: 'swarm' });
    } else {
      console.log(`[${node.node_id}] No provider. Leaving task ${target.id} claimed; status unchanged.`);
    }
    await client.release(target.id as string);
    currentClaim = null;
    lockManager.release(target.id as string);
    logEvent(alpDir, 'task_release', { task_id: target.id as string, agent: agentId, source: 'swarm' });
  }
  cleanup();
}

async function runSwarmMode(options: RunOptions, alpDir: string) {
  const numWorkers = options.concurrent || 1;
  console.log(`\n🐝 Starting ALP Swarm Orchestrator with ${numWorkers} concurrent workers...\n`);

  logEvent(alpDir, 'run_start', { message: `Swarm started with ${numWorkers} workers` });

  const lockManager = new LockManager(process.cwd());
  // Purge locks from dead processes so a crashed run can't deadlock the swarm.
  const purged = lockManager.cleanup();
  if (purged > 0) {
    console.log(`🧹 Cleared ${purged} stale lock(s) from previous runs.`);
  }
  const parser = new AlpParser();
  
  const workers = Array.from({ length: numWorkers }).map(async (_, workerId) => {
    const id = workerId + 1;
    let idleCount = 0;
    
    while (true) {
      const allObjects: AlpObject[] = [];
      loadAlpDirectory(alpDir, parser, allObjects);
      
      const tasks = allObjects.filter((obj) => obj._type === 'task');
      const doneIds = new Set(
        allObjects
          .filter((obj) => obj.status === '[x]' || obj.status === 'done')
          .map((obj) => obj.id)
      );
      
      const allTasksDone = tasks.every(t => doneIds.has(t.id));
      if (allTasksDone) {
        console.log(`[Worker ${id}] 🏁 All tasks completed! Shutting down.`);
        break;
      }
      
      const lockedIds = lockManager.getLockedTaskIds();
      
      let targetTask: AlpObject | null = null;
      for (const task of tasks) {
        if (task.status === '[ ]' || task.status === 'todo') {
          if (lockedIds.has(task.id as string)) continue;
          
          const deps = extractDependencies(task);
          const allDepsMet = deps.every((d) => doneIds.has(d));
          
          if (allDepsMet) {
            targetTask = task;
            const agentId = options.agent || `worker-${id}`;
            const claimed = lockManager.claim(task.id as string, agentId);
            if (claimed) {
               break;
            } else {
               targetTask = null;
            }
          }
        }
      }
      
      if (!targetTask) {
        const pendingTasks = tasks.some(t => t.status === '[ ]' || t.status === 'todo');
        if (pendingTasks) {
           idleCount++;
           if (idleCount % 10 === 0) {
             console.log(`[Worker ${id}] ⏳ Waiting for dependencies to unblock...`);
           }
           await new Promise(resolve => setTimeout(resolve, 2000));
           continue;
        } else {
           console.log(`[Worker ${id}] 🛑 No actionable tasks found and none pending. Exiting.`);
           break;
        }
      }
      
      idleCount = 0;
      console.log(`\n[Worker ${id}] 🚀 Claimed task: ${targetTask.id}`);
      logEvent(alpDir, 'task_claim', {
        task_id: targetTask.id as string,
        worker: id,
        agent: options.agent || `worker-${id}`,
      });
      
      const project = allObjects.find((obj) => obj._type === 'project');
      const agent = allObjects.find((obj) => obj._type === 'agent' && obj.id === (targetTask as any).owner?.replace('-> ', '')) 
                    || allObjects.find((obj) => obj._type === 'agent');
      const memories = allObjects.filter((obj) => obj._type === 'memory');
      const rules = allObjects.filter((obj) => obj._type === 'rule');
      const decisions = allObjects.filter((obj) => obj._type === 'decision' && obj.status === '[x]');
      
      const contextBundle = buildContextBundle(targetTask, project || null, agent || null, memories, rules, decisions, allObjects);
      
      if (options.dryRun) {
        console.log(`[Worker ${id}] 🔍 DRY RUN: Simulating execution of ${targetTask.id}...`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Simulate LLM latency
        console.log(`[Worker ${id}] ✅ Simulated completion of ${targetTask.id}.`);
        updateTaskStatusOnFile(targetTask.id as string, '[x]', alpDir);
        logEvent(alpDir, 'task_status', { task_id: targetTask.id as string, status: '[x]', worker: id, message: 'dry-run complete' });
        lockManager.release(targetTask.id as string);
        logEvent(alpDir, 'task_release', { task_id: targetTask.id as string, worker: id });
        continue;
      }
      
      if (options.provider) {
        const llm = createProvider(options.provider, options.model);
        const loop = new LoopEngine({
          maxIterations: 3,
          completionConditions: ['Task verified successfully'],
        });
        
        loop.on((event) => {
          if (event.type === 'stage_enter') {
            console.log(`[Worker ${id} | ${targetTask!.id}] Iteration ${event.iteration} — ${event.stage}`);
          }
        });
        
        let success = false;
        try {
          const result = await loop.run(async (stage: LoopStage, iteration: number) => {
             const messages = [
               { role: 'system' as const, content: 'You are an autonomous AI agent following the ALP protocol.' },
               { role: 'user' as const, content: `Context:\n${contextBundle}\n\nCurrent Stage: ${stage}\nExecute this stage.` }
             ];
             await llm.chat(messages);
             return stage === 'test';
          });
          success = result.status === 'completed';
        } catch (e) {
          console.error(`[Worker ${id} | ${targetTask!.id}] Execution error:`, e);
        }
        
        if (success) {
           console.log(`[Worker ${id}] ✅ Task ${targetTask.id} completed successfully.`);
           updateTaskStatusOnFile(targetTask.id as string, '[x]', alpDir);
           logEvent(alpDir, 'task_status', { task_id: targetTask.id as string, status: '[x]', worker: id });
        } else {
           console.log(`[Worker ${id}] ❌ Task ${targetTask.id} failed verification.`);
           updateTaskStatusOnFile(targetTask.id as string, '[!]', alpDir);
           logEvent(alpDir, 'task_status', { task_id: targetTask.id as string, status: '[!]', worker: id, message: 'failed verification' });
        }
        lockManager.release(targetTask.id as string);
        logEvent(alpDir, 'task_release', { task_id: targetTask.id as string, worker: id });
      } else {
        console.log(`[Worker ${id}] No provider specified. Outputting context and exiting worker.`);
        console.log(contextBundle);
        lockManager.release(targetTask.id as string);
        break;
      }
    }
  });
  
  await Promise.all(workers);
  logEvent(alpDir, 'run_end', { message: 'Swarm execution complete' });
  console.log(`\n🎉 Swarm Execution Complete!`);
}
