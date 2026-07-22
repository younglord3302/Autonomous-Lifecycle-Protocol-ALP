import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject } from '@alp/parser';
import { readEvents } from '../runtime';

/**
 * `alp tui` — Interactive Terminal UI Dashboard.
 * Renders real-time workspace metrics, task DAG status, live runtime events,
 * and active swarm node locks directly in the terminal using ANSI escapes.
 */
export function tuiCommand() {
  const cwd = process.cwd();
  const alpDir = path.resolve(cwd, '.alp');

  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  // Hide cursor and clear screen
  process.stdout.write('\x1b[?25l');
  process.stdout.write('\x1b[2J\x1b[H');

  let isRunning = true;

  function render() {
    if (!isRunning) return;

    // Move to top left
    process.stdout.write('\x1b[H');

    const width = Math.min(process.stdout.columns || 80, 100);
    const borderLine = '─'.repeat(width - 2);

    // Read objects
    const parser = new AlpParser();
    const objects: AlpObject[] = [];
    loadAllObjects(alpDir, parser, objects);

    const project = objects.find((o) => o._type === 'project')?.id ?? 'default';
    const tasks = objects.filter((o) => o._type === 'task');

    let done = 0, inProgress = 0, blocked = 0, review = 0, todo = 0;
    tasks.forEach((t) => {
      const s = String(t.status || '[ ]');
      if (s === '[x]') done++;
      else if (s === '[~]') inProgress++;
      else if (s === '[!]') blocked++;
      else if (s === '[?]') review++;
      else todo++;
    });

    const total = tasks.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    // Build Progress Bar
    const barWidth = Math.max(10, width - 35);
    const filledWidth = Math.round((pct / 100) * barWidth);
    const progressBar = '\x1b[42m' + ' '.repeat(filledWidth) + '\x1b[47m' + ' '.repeat(barWidth - filledWidth) + '\x1b[0m';

    // Header
    console.log(`\x1b[1;36m┌${borderLine}┐\x1b[0m`);
    console.log(`\x1b[1;36m│\x1b[0m \x1b[1;33m⚡ ALP TERMINAL DASHBOARD\x1b[0m \x1b[90m(v16.0.0)\x1b[0m  \x1b[90mWorkspace:\x1b[0m \x1b[1;37m${project}\x1b[0m`.padEnd(width + 25) + `\x1b[1;36m│\x1b[0m`);
    console.log(`\x1b[1;36m├${borderLine}┤\x1b[0m`);

    // Task Completion Bar
    console.log(`\x1b[1;36m│\x1b[0m \x1b[1mCompletion:\x1b[0m [${progressBar}] \x1b[1;32m${pct}%\x1b[0m (${done}/${total})`.padEnd(width + 30) + `\x1b[1;36m│\x1b[0m`);
    console.log(`\x1b[1;36m├${borderLine}┤\x1b[0m`);

    // Status Summary Table
    console.log(`\x1b[1;36m│\x1b[0m \x1b[32m[x] Done: ${done}\x1b[0m   \x1b[36m[~] Progress: ${inProgress}\x1b[0m   \x1b[31m[!] Blocked: ${blocked}\x1b[0m   \x1b[35m[?] Review: ${review}\x1b[0m   \x1b[90m[ ] Todo: ${todo}\x1b[0m`.padEnd(width + 45) + `\x1b[1;36m│\x1b[0m`);
    console.log(`\x1b[1;36m├${borderLine}┤\x1b[0m`);

    // Live Events Log (last 6)
    console.log(`\x1b[1;36m│\x1b[0m \x1b[1;34mRECENT RUNTIME LOG EVENTS\x1b[0m`.padEnd(width + 15) + `\x1b[1;36m│\x1b[0m`);
    const events = readEvents(alpDir).slice(-6);
    if (events.length === 0) {
      console.log(`\x1b[1;36m│\x1b[0m \x1b[90m(No events recorded yet in .alp/.runtime/log.jsonl)\x1b[0m`.padEnd(width + 10) + `\x1b[1;36m│\x1b[0m`);
    } else {
      events.forEach((evt: any) => {
        const time = (evt.timestamp || '').slice(11, 19);
        const type = (evt.type || 'event').toUpperCase().padEnd(12);
        const tid = evt.task_id ? `[${evt.task_id}]` : '';
        const msg = (evt.message || '').slice(0, width - 40);
        const line = ` \x1b[90m${time}\x1b[0m \x1b[35m${type}\x1b[0m \x1b[36m${tid}\x1b[0m ${msg}`;
        console.log(`\x1b[1;36m│\x1b[0m${line}`.padEnd(width + 30) + `\x1b[1;36m│\x1b[0m`);
      });
    }

    console.log(`\x1b[1;36m├${borderLine}┤\x1b[0m`);
    console.log(`\x1b[1;36m│\x1b[0m \x1b[90mPress \x1b[1;37mq\x1b[0m\x1b[90m to exit | \x1b[1;37mr\x1b[0m\x1b[90m to refresh | \x1b[1;37mctrl+c\x1b[0m\x1b[90m to terminate\x1b[0m`.padEnd(width + 45) + `\x1b[1;36m│\x1b[0m`);
    console.log(`\x1b[1;36m└${borderLine}┘\x1b[0m`);
  }

  // Initial render
  render();

  // Refresh interval
  const interval = setInterval(render, 1000);

  // Setup raw stdin for keyboard listener
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key: string) => {
      if (key === 'q' || key === '\u0003') {
        cleanup();
      } else if (key === 'r') {
        render();
      }
    });
  }

  function cleanup() {
    isRunning = false;
    clearInterval(interval);
    process.stdout.write('\x1b[?25h'); // show cursor
    process.stdout.write('\x1b[2J\x1b[H'); // clear screen
    console.log('👋 Left ALP Terminal UI Dashboard.');
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function loadAllObjects(dir: string, parser: AlpParser, out: AlpObject[]) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.runtime' || entry.name === '.cache') continue;
        loadAllObjects(full, parser, out);
      } else if (entry.name.endsWith('.alp')) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          out.push(...parser.parse(content));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}
