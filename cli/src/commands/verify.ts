import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { AlpParser, AlpObject, PolicyEngine } from '@alp/parser';

export function verifyCommand(taskId: string) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const parser = new AlpParser();
  let targetObj: any = null;
  let targetFile = '';
  const allObjects: AlpObject[] = [];

  const readDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        readDir(fullPath);
      } else if (entry.name.endsWith('.alp')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parsed = parser.parse(content);
          for (const obj of parsed) {
            allObjects.push(obj);
            if (obj.id === taskId) {
              targetObj = obj;
              targetFile = fullPath;
            }
          }
        } catch (e) {
          // ignore parsing errors here
        }
      }
    }
  };

  readDir(alpDir);

  if (!targetObj) {
    console.error(`Error: Object '${taskId}' not found.`);
    process.exit(1);
  }

  if (targetObj._type !== 'task') {
    console.error(`Error: Object '${taskId}' is a ${targetObj._type}, not a task. Only tasks can be verified.`);
    process.exit(1);
  }

  if (!targetObj.verify || !Array.isArray(targetObj.verify) || targetObj.verify.length === 0) {
    console.log(`✅ Task '${taskId}' has no verification gates defined. Considering it verified.`);
    updateTaskStatus(targetFile, taskId, '[x]');
    return;
  }

  console.log(`\n🔍 Verifying Task: ${taskId}`);
  console.log(`   Running ${targetObj.verify.length} quality gate(s)...\n`);

  // Policy governance: verify commands run shell code, so they must comply
  // with any @policy guardrails before execution.
  const policyEngine = new PolicyEngine(allObjects);
  const owner = typeof targetObj.owner === 'string'
    ? targetObj.owner.replace(/^->\s*/, '').trim()
    : undefined;

  let allPassed = true;

  for (let i = 0; i < targetObj.verify.length; i++) {
    const cmd = targetObj.verify[i];
    console.log(`▶️  Gate ${i + 1}/${targetObj.verify.length}: \`${cmd}\``);

    if (policyEngine.count > 0) {
      const decision = policyEngine.evaluate({ kind: 'command', value: String(cmd), agent: owner });
      if (!decision.allowed) {
        for (const reason of decision.reasons) {
          console.error(`   ${decision.blocked ? '⛔' : '⚠️ '} ${reason}`);
        }
        if (decision.blocked) {
          console.error(`   ❌ Blocked by policy — not executed.\n`);
          allPassed = false;
          break;
        }
      }
    }

    try {
      execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
      console.log(`   ✅ Passed\n`);
    } catch (err) {
      console.error(`   ❌ Failed\n`);
      allPassed = false;
      break; // Stop at first failure
    }
  }

  if (allPassed) {
    console.log(`🎉 All verification gates passed for '${taskId}'. Marking as done [x].`);
    updateTaskStatus(targetFile, taskId, '[x]');
  } else {
    console.log(`🚨 Verification failed for '${taskId}'. Marking as blocked [!].`);
    updateTaskStatus(targetFile, taskId, '[!]');
    process.exit(1);
  }
}

function updateTaskStatus(filePath: string, taskId: string, newStatus: string) {
  let content = fs.readFileSync(filePath, 'utf-8');
  // Simple regex to replace the status of the specific task
  // Since ALP syntax is:
  // @task
  // id: task-id
  // status: "[ ]"
  
  // This is a naive regex replacement. In a robust system, we would stringify the parsed object.
  // But for the V2 scaffold, we can just replace the specific status line.
  
  const regex = new RegExp(`(id:\\s*${taskId}[\\s\\S]*?status:\\s*)["']?\\[.*?\\]["']?`, 'g');
  if (regex.test(content)) {
    content = content.replace(regex, `$1"${newStatus}"`);
    fs.writeFileSync(filePath, content, 'utf-8');
  } else {
    // If status didn't exist, we might have to insert it. For simplicity, we just log.
    console.log(`   (Note: Could not auto-update status in file. Please update manually to ${newStatus})`);
  }
}
