import * as fs from 'fs';
import * as path from 'path';

export type AlpStatus = '[ ]' | '[~]' | '[x]' | '[!]' | '[?]' | '[ ]';

/**
 * Replace the `status:` line of the `@task` block whose `id` matches `taskId`
 * within a single `.alp` file's content.
 *
 * ALP permits the status value either unquoted (`status: [~]`) or quoted
 * (`status: "[x]"`). This updates the value while preserving the existing
 * quoting style, so markers such as the Human-in-the-Loop `[?]` survive
 * rewrites (the previous naive regex dropped everything after the first `]`).
 *
 * Returns the (possibly unchanged) content and whether a replacement occurred.
 */
export function updateObjectStatus(
  content: string,
  taskId: string,
  newStatus: string,
): { content: string; changed: boolean } {
  const lines = content.split('\n');
  let inTarget = false;
  let blockIndent = -1;
  let changed = false;

  const idPattern = new RegExp(`^(\\s*)id:\\s*${escapeRegex(taskId)}\\s*$`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track which top-level (@indent 0) block we're in.
    if (/^@\w+$/.test(line.trim()) && leadingSpaces(line) === 0) {
      inTarget = false;
      blockIndent = -1;
    }

    if (!inTarget) {
      const idMatch = line.match(idPattern);
      if (idMatch) {
        inTarget = true;
        blockIndent = leadingSpaces(line);
      }
      continue;
    }

    // Once inside the target block, look for its `status:` property at the
    // correct indent. Stop if we exit into another block.
    const indent = leadingSpaces(line);
    if (indent <= blockIndent && line.trim().length > 0 && line.trim().startsWith('@')) {
      // Entered a nested/sibling block; status would have been before this.
      break;
    }

    const statusMatch = line.match(/^(\s*)status:\s*(.*?)\s*$/);
    if (statusMatch && indent === blockIndent) {
      const indentStr = statusMatch[1];
      const existing = statusMatch[2];
      const quoted = existing.startsWith('"') && existing.endsWith('"');
      const next = quoted ? `"${newStatus}"` : newStatus;
      if (existing !== next) {
        lines[i] = `${indentStr}status: ${next}`;
        changed = true;
      }
      // A block has at most one status; we can keep scanning but no need.
      break;
    }
  }

  return { content: lines.join('\n'), changed };
}

/**
 * Walk a workspace's `.alp` directory, updating the status of the task with
 * the given id in the file that declares it. Returns the path of the file
 * that was modified, or null if no matching task/status was found.
 */
export function updateTaskStatusInWorkspace(
  rootDir: string,
  taskId: string,
  newStatus: string,
): string | null {
  const alpDir = path.join(rootDir, '.alp');
  if (!fs.existsSync(alpDir)) return null;

  let updatedFile: string | null = null;

  const walk = (dir: string) => {
    if (updatedFile) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (updatedFile) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.alp')) {
        let content: string;
        try {
          content = fs.readFileSync(full, 'utf-8');
        } catch {
          return;
        }
        const { content: next, changed } = updateObjectStatus(content, taskId, newStatus);
        if (changed) {
          fs.writeFileSync(full, next, 'utf-8');
          updatedFile = full;
        }
      }
    }
  };

  walk(alpDir);
  return updatedFile;
}

function leadingSpaces(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else break;
  }
  return n;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
