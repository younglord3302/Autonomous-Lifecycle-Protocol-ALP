import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject, TimelineEngine } from '@alp/parser';

interface ScheduleOptions {
  next?: boolean;
  enable?: string;
  disable?: string;
  at?: string;
}

/**
 * `alp schedule` — Timeline & Scheduling (v8.2.0).
 *
 * Lists @timeline objects, filters to those due at `now`, and supports
 * enabling/disabling timelines by id. Use `--at <iso>` to evaluate
 * against a fixed time (useful for testing).
 */
export function scheduleCommand(options?: ScheduleOptions) {
  const cwd = process.cwd();
  const alpDir = path.resolve(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const parser = new AlpParser();
  const objects: AlpObject[] = [];
  loadDir(alpDir, parser, objects);

  const engine = new TimelineEngine(objects);

  // ── Enable / Disable mode ──────────────────────────────────────
  if (options?.enable || options?.disable) {
    const targetId = (options.enable || options.disable)!;
    const enable = !!options.enable;
    const found = objects.find((o) => o._type === 'timeline' && o.id === targetId);
    if (!found) {
      console.error(`Error: @timeline '${targetId}' not found.`);
      process.exit(1);
    }
    // Persist the change back to the source file.
    persistEnabled(alpDir, targetId, enable);
    console.log(`✅ @timeline '${targetId}' ${enable ? 'enabled' : 'disabled'}.`);
    return;
  }

  // ── Evaluate mode ──────────────────────────────────────────────
  const now = options?.at ? new Date(options.at) : new Date();
  const due = engine.evaluate(now);

  if (options?.next) {
    if (due.length === 0) {
      console.log('No timelines are due.\n');
      return;
    }
    console.log(`\n⏰  Due timelines (${due.length})\n`);
    for (const r of due) {
      console.log(`  • ${r.timeline.id}  →  ${r.task}  (${r.reason})`);
    }
    console.log('');
    return;
  }

  // List mode
  const all = engine.list();
  if (all.length === 0) {
    console.log('No @timeline objects defined in this workspace.\n');
    return;
  }
  console.log(`\n⏰  Timelines (${all.length})\n`);
  for (const t of all) {
    const schedule = t.cron ? `cron: ${t.cron}` : `at: ${t.at}`;
    const status = t.enabled ? 'enabled' : 'disabled';
    console.log(`  • ${t.id}  [${status}]  ${schedule}  →  ${t.task}`);
  }
  console.log('');
}

function loadDir(dir: string, parser: AlpParser, out: AlpObject[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.runtime' || entry.name === '.cache') continue;
      loadDir(full, parser, out);
    } else if (entry.name.endsWith('.alp')) {
      try {
        out.push(...parser.parse(fs.readFileSync(full, 'utf-8')));
      } catch {
        // skip unparseable files
      }
    }
  }
}

function persistEnabled(alpDir: string, timelineId: string, enabled: boolean): void {
  for (const entry of fs.readdirSync(alpDir, { withFileTypes: true })) {
    const full = path.join(alpDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.alp')) {
      let content = fs.readFileSync(full, 'utf-8');
      const pattern = new RegExp(`(@timeline\\n(?:[ \\t]+.*\\n)*?[ \\t]+id: ${timelineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\n)`);
      // Fallback: simple line-based toggle on `enabled:`.
      const lines = content.split('\n');
      let inTarget = false;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('@timeline')) inTarget = true;
        if (inTarget && trimmed.startsWith('id:') && trimmed.includes(timelineId)) {
          // scan forward for `enabled:` in this block
          for (let j = i + 1; j < lines.length; j++) {
            const t2 = lines[j].trim();
            if (t2.startsWith('enabled:')) {
              lines[j] = lines[j].replace(/enabled:\s*.*/, `enabled: ${enabled}`);
              content = lines.join('\n');
              fs.writeFileSync(full, content, 'utf-8');
              return;
            }
            if (t2.startsWith('@') || (lines[j].length > 0 && !lines[j].startsWith(' ') && !lines[j].startsWith('\t'))) break;
          }
          // No `enabled:` yet — insert one after the `id:` line.
          lines.splice(i + 1, 0, `  enabled: ${enabled}`);
          content = lines.join('\n');
          fs.writeFileSync(full, content, 'utf-8');
          return;
        }
        if (inTarget && trimmed.startsWith('@') && !trimmed.startsWith('@timeline')) inTarget = false;
      }
    }
  }
}
