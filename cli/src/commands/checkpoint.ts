import * as fs from 'fs';
import * as path from 'path';
import { logEvent } from '../runtime';

const VALID_STATUSES: Record<string, string> = {
  'done': '[x]',
  'blocked': '[!]',
  'in-progress': '[~]',
  'review': '[?]',
  'todo': '[ ]',
};

export function checkpointCommand(
  taskId: string,
  status?: string,
  message?: string,
  options?: { askHuman?: boolean },
) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');

  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found.');
    process.exit(1);
  }

  // `--ask-human` marks the task as awaiting review ([ ?]) and is the
  // Human-in-the-Loop handoff: the agent pauses for a human decision.
  const effectiveStatus = options?.askHuman ? 'review' : status;

  const newStatus = VALID_STATUSES[(effectiveStatus ?? '').toLowerCase()];
  if (!newStatus) {
    console.error(`Error: Invalid status "${effectiveStatus}". Use: done, blocked, in-progress, review, todo`);
    process.exit(1);
  }

  let found = false;

  const scanDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.runtime') scanDir(fullPath);
      } else if (entry.name.endsWith('.alp')) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        // Find the block that has `id: taskId`
        let inTargetBlock = false;
        let newLines: string[] = [];
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (line.startsWith('@')) {
            inTargetBlock = false;
          }

          if (inTargetBlock && /^\s+id:\s+/.test(line) && line.trim() === `id: ${taskId}`) {
            inTargetBlock = true;
          }

          if (/^\s+id:\s+/.test(line) && line.trim() === `id: ${taskId}`) {
            inTargetBlock = true;
          }

          if (inTargetBlock && /^\s+status:/.test(line)) {
            newLines.push(line.replace(/status:\s+.*/, `status: "${newStatus}"`));
            modified = true;
            found = true;
          } else {
            newLines.push(line);
          }
        }

        if (modified) {
          fs.writeFileSync(fullPath, newLines.join('\n'), 'utf-8');
          const relPath = path.relative(cwd, fullPath);
          console.log(`✅ Updated task '${taskId}' → status: ${newStatus}`);

          // Emit a structured runtime event for the `alp serve` dashboard.
          logEvent(alpDir, options?.askHuman ? 'human_handoff' : 'checkpoint', {
            task_id: taskId,
            status: newStatus,
            message,
          });

          if (message) {
            console.log(`📝 Logged message: ${message}`);
          }
          console.log(`📄 Modified: ${relPath}`);
        }
      }
    }
  };

  scanDir(alpDir);

  if (!found) {
    console.error(`Error: Task '${taskId}' not found in workspace.`);
    process.exit(1);
  }
}
