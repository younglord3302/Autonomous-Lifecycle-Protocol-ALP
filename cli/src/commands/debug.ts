import * as fs from 'fs';
import * as path from 'path';
import { EventStore } from '@alp/parser';
import { SnapshotStore, DebugSession, EngineSnapshot } from '@alp/parser';

export function debugCommand(runId: string, opts: { step?: number; toStage?: string; diff?: [string, string] }) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const snapStore = new SnapshotStore(alpDir);
  const snaps = snapStore.loadForRun(runId);
  const session = new DebugSession(snaps);

  if (opts.diff) {
    const [aId, bId] = opts.diff;
    const a = snaps.find((s) => s.id === aId);
    const b = snaps.find((s) => s.id === bId);
    if (!a || !b) {
      console.error(`Error: snapshot ids "${aId}" / "${bId}" not found.`);
      process.exit(1);
    }
    const diff = session.diffSnapshots(a, b);
    console.log(`\n🔍 Diff: ${aId} → ${bId}`);
    console.log('==============================');
    console.log(`  Added keys:   ${Object.keys(diff.added).join(', ') || 'none'}`);
    console.log(`  Removed keys: ${Object.keys(diff.removed).join(', ') || 'none'}`);
    console.log(`  Changed keys: ${diff.changed.length}`);
    for (const c of diff.changed) {
      console.log(`    - ${c.key}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
    }
    console.log('');
    return;
  }

  if (opts.toStage) {
    const snap = session.toStage(opts.toStage);
    if (!snap) {
      console.error(`Error: no snapshot found at stage "${opts.toStage}".`);
      process.exit(1);
    }
    printSnapshot(snap);
    return;
  }

  const n = opts.step ?? 1;
  const absN = Math.abs(n);
  let target: EngineSnapshot | null = null;
  if (n > 0) {
    for (let i = 0; i < absN; i++) target = session.stepForward();
  } else {
    for (let i = 0; i < absN; i++) target = session.stepBackward();
  }
  if (!target) {
    console.error('Error: no snapshots available for this run.');
    process.exit(1);
  }
  printSnapshot(target);
}

function printSnapshot(snap: EngineSnapshot) {
  console.log(`\n🪲 Debug Snapshot: ${snap.id}`);
  console.log('==============================');
  console.log(`  Run:    ${snap.run_id}`);
  console.log(`  Stage:  ${snap.stage}`);
  console.log(`  Time:   ${snap.timestamp}`);
  console.log(`  State:`);
  for (const [k, v] of Object.entries(snap.state)) {
    console.log(`    ${k}: ${JSON.stringify(v)}`);
  }
  console.log('');
}
