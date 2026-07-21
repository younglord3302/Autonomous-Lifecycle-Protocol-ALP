import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  AlpParser,
  AlpObject,
  PolicyEngine,
  PolicyModelChecker,
  ContractInvariant,
  updateObjectStatus,
} from '@alp/parser';

export interface VerifyOptions {
  formal?: string;
}

export function verifyCommand(taskId: string, options?: VerifyOptions) {
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

  if (options?.formal) {
    runFormalVerification(options.formal, allObjects);
    return;
  }

  if (!targetObj.verify || !Array.isArray(targetObj.verify) || targetObj.verify.length === 0) {
    console.log(`✅ Task '${taskId}' has no verification gates defined. Considering it verified.`);
    writeTaskStatus(targetFile, taskId, '[x]');
    return;
  }

  console.log(`\n🔍 Verifying Task: ${taskId}`);
  console.log(`   Running ${targetObj.verify.length} quality gate(s)...\n`);

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
      break;
    }
  }

  if (allPassed) {
    console.log(`🎉 All verification gates passed for '${taskId}'. Marking as done [x].`);
    writeTaskStatus(targetFile, taskId, '[x]');
  } else {
    console.log(`🚨 Verification failed for '${taskId}'. Marking as blocked [!].`);
    writeTaskStatus(targetFile, taskId, '[!]');
    process.exit(1);
  }
}

function runFormalVerification(policyId: string, objects: AlpObject[]) {
  const checker = new PolicyModelChecker(objects);
  const proof = checker.verify(policyId);

  console.log(`\n🔬 Formal Verification: ${policyId}`);
  console.log(`   Passed: ${proof.passed}`);
  console.log(`   Checked at: ${proof.checkedAt}\n`);

  for (const prop of proof.properties) {
    const icon = prop.passed ? '✅' : '❌';
    console.log(`   ${icon} ${prop.name}: ${prop.message}`);
  }

  if (proof.counterexample) {
    console.log(`\n   Counterexample trace:`);
    for (const line of proof.counterexample.trace) {
      console.log(`      - ${line}`);
    }
    process.exit(1);
  }

  console.log('\n🎉 All formal invariants passed.');
}

/**
 * Update a task's `status:` line using the shared, quote-aware status writer
 * from `@alp/parser` (preserves `[?]` and `[x]` markers correctly).
 */
function writeTaskStatus(filePath: string, taskId: string, newStatus: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { content: next, changed } = updateObjectStatus(content, taskId, newStatus);
  if (changed) {
    fs.writeFileSync(filePath, next, 'utf-8');
  } else {
    console.log(`   (Note: Could not auto-update status in file. Please update manually to ${newStatus})`);
  }
}
