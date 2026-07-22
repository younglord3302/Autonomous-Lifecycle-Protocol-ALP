import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');

function makeWorkspace(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-new-cmd-'));
  fs.mkdirSync(path.join(tmp, '.alp'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.alp', 'test.alp'), '!alp-version: 3.1.0\n\n@task\n  id: t1\n  description: "test"\n');
  return tmp;
}

function run(cwd: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf-8', timeout: 30000 });
    return { code: 0, out: String(out) };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('alp domain-trust (v18.4.0)', () => {
  it('creates a domain', () => {
    const tmp = makeWorkspace();
    try {
      const { out } = run(tmp, ['domain-trust', 'create-domain', 'local', 'key1']);
      expect(out).toContain("Domain 'local' created");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('links and lists domains', () => {
    const tmp = makeWorkspace();
    try {
      run(tmp, ['domain-trust', 'create-domain', 'local', 'key1']);
      const { out: linkOut } = run(tmp, ['domain-trust', 'link', 'local', 'remote']);
      expect(linkOut).toContain('Link created');
      const { out: listOut } = run(tmp, ['domain-trust', 'list', 'local']);
      expect(listOut).toContain('local <-> remote');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts a link', () => {
    const tmp = makeWorkspace();
    try {
      run(tmp, ['domain-trust', 'create-domain', 'local', 'key1']);
      const { out: linkOut } = run(tmp, ['domain-trust', 'link', 'local', 'remote']);
      const linkId = linkOut.match(/Link created: (\S+)/)?.[1] ?? '';
      const { out } = run(tmp, ['domain-trust', 'accept', 'local', linkId]);
      expect(out).toContain('accepted');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('revokes a link', () => {
    const tmp = makeWorkspace();
    try {
      run(tmp, ['domain-trust', 'create-domain', 'local', 'key1']);
      const { out: linkOut } = run(tmp, ['domain-trust', 'link', 'local', 'remote']);
      const linkId = linkOut.match(/Link created: (\S+)/)?.[1] ?? '';
      const { out } = run(tmp, ['domain-trust', 'revoke', 'local', linkId]);
      expect(out).toContain('revoked');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('alp governance (v18.3.0)', () => {
  it('proposes a ballot', () => {
    const tmp = makeWorkspace();
    try {
      const { out } = run(tmp, ['governance', 'propose', 'desc', 'policy-1']);
      expect(out).toContain('Ballot opened');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('votes and lists', () => {
    const tmp = makeWorkspace();
    try {
      const { out: proposeOut } = run(tmp, ['governance', 'propose', 'desc', 'policy-1']);
      const ballotId = proposeOut.match(/Ballot opened: (\S+)/)?.[1] ?? '';
      run(tmp, ['governance', 'vote', ballotId, 'did1', 'approve', 'good']);
      const { out } = run(tmp, ['governance', 'list']);
      expect(out).toContain(ballotId);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('closes and tallies', () => {
    const tmp = makeWorkspace();
    try {
      const { out: proposeOut } = run(tmp, ['governance', 'propose', 'desc', 'policy-1']);
      const ballotId = proposeOut.match(/Ballot opened: (\S+)/)?.[1] ?? '';
      run(tmp, ['governance', 'vote', ballotId, 'did1', 'approve', 'good']);
      const { out } = run(tmp, ['governance', 'close', ballotId]);
      expect(out).toContain('closed');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('alp tenant (v18.2.0)', () => {
  it('creates and lists tenants', () => {
    const tmp = makeWorkspace();
    try {
      run(tmp, ['tenant', 'create', 't1']);
      const { out } = run(tmp, ['tenant', 'list']);
      expect(out).toContain('t1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('manages vault secrets', () => {
    const tmp = makeWorkspace();
    try {
      run(tmp, ['tenant', 'create', 't1']);
      const { out: sealOut } = run(tmp, ['tenant', 'vault', 't1', 'seal', 's1', 'v1']);
      expect(sealOut).toContain('Sealed');
      const { out: listOut } = run(tmp, ['tenant', 'vault', 't1', 'list']);
      expect(listOut).toContain('s1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('deletes a tenant', () => {
    const tmp = makeWorkspace();
    try {
      run(tmp, ['tenant', 'create', 't1']);
      const { out } = run(tmp, ['tenant', 'delete', 't1']);
      expect(out).toContain('deleted');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('alp healing (v16.1.0)', () => {
  it('reports no history for empty workspace', () => {
    const tmp = makeWorkspace();
    try {
      const { out } = run(tmp, ['healing', 'history']);
      expect(out).toContain('No healing actions');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports missing workflow', () => {
    const tmp = makeWorkspace();
    try {
      const { code, out } = run(tmp, ['healing', 'report', 'missing']);
      expect(code).toBe(1);
      expect(out).toContain("No healing report");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('alp resilience (v16.3.0)', () => {
  it('reports no active agents', () => {
    const tmp = makeWorkspace();
    try {
      const { out } = run(tmp, ['resilience', 'agents']);
      expect(out).toContain('No active agents');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports missing swarm', () => {
    const tmp = makeWorkspace();
    try {
      const { code, out } = run(tmp, ['resilience', 'report', 'missing']);
      expect(code).toBe(1);
      expect(out).toContain("No resilience report");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
