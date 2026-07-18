import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { AlpParser } from '@alp/parser';

interface HarnessResult {
  file: string;
  kind: 'valid' | 'invalid';
  passed: boolean;
  detail?: string;
}

function listFixtures(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.alp'))
    .sort();
}

/**
 * Run a single fixture through an external parser executable.
 *
 * Contract (spec/16 §5): the executable receives the fixture path as its sole
 * argument, prints the AST as JSON to stdout on success, and exits non-zero
 * (writing the error to stderr) on failure.
 */
function runExternal(executable: string, fixturePath: string): { ok: boolean; detail?: string } {
  // Compose a single shell command so the OS resolves script executables
  // (.bat/.cmd/.sh) and respects their shebangs / extension handlers. Both
  // the executable and the fixture path are quoted to guard against spaces.
  const command = `"${executable}" "${fixturePath.replace(/"/g, '\\"')}"`;
  try {
    execFileSync(command, { stdio: 'pipe', shell: true });
    return { ok: true };
  } catch (err: any) {
    const detail = (err.stderr?.toString() || err.stdout?.toString() || err.message || '')
      .toString()
      .trim();
    return { ok: false, detail };
  }
}

function runBundled(fixturePath: string): { ok: boolean; detail?: string } {
  const parser = new AlpParser();
  try {
    parser.parseAndValidate(fs.readFileSync(fixturePath, 'utf-8'));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, detail: err?.message || String(err) };
  }
}

export function testHarnessCommand(opts: { executable?: string; suite?: string }) {
  const suiteDir =
    opts.suite || path.join(process.cwd(), 'tests', 'compliance');

  const validDir = path.join(suiteDir, 'valid');
  const invalidDir = path.join(suiteDir, 'invalid');

  if (!fs.existsSync(validDir) && !fs.existsSync(invalidDir)) {
    console.error(`Error: compliance suite not found at '${suiteDir}'.`);
    console.error(`Provide one with --suite <dir> or run from a repo that ships tests/compliance.`);
    process.exit(1);
  }

  const runner = opts.executable
    ? (p: string) => runExternal(opts.executable as string, p)
    : (p: string) => runBundled(p);

  const results: HarnessResult[] = [];
  for (const f of listFixtures(validDir)) {
    const p = path.join(validDir, f);
    const r = runner(p);
    results.push({ file: f, kind: 'valid', passed: r.ok, detail: r.detail });
  }
  for (const f of listFixtures(invalidDir)) {
    const p = path.join(invalidDir, f);
    const r = runner(p);
    // invalid fixtures MUST fail to parse.
    results.push({ file: f, kind: 'invalid', passed: !r.ok, detail: r.ok ? 'parser accepted an invalid fixture' : r.detail });
  }

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    if (r.passed) passed++;
    else failed++;
    let line = `${icon} [${r.kind}] ${r.file}`;
    if (!r.passed && r.detail) {
      line += ` — ${r.detail.split('\n')[0]}`;
    }
    console.log(line);
  }

  console.log('');
  console.log(`Compliance suite: ${passed} passed, ${failed} failed (${results.length} fixtures)`);
  if (opts.executable) {
    console.log(`Parser under test: ${opts.executable}`);
  }

  if (failed > 0) {
    process.exit(1);
  }
}
