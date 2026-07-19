import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { PluginResolver } from '../src/plugin';
import { RemoteFetcher } from '../src/remote';

let tmpDir: string | null = null;

function makeWorkspace(files: Record<string, string>): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-remote-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return tmpDir;
}

const PLUGIN = `
@plugin
  id: plugin-scrum
  name: "ALP Scrum Extension"
  version: 1.0.0
  types:
    - -> type-epic

---

@type_definition
  id: type-epic
  type_name: epic
  properties:
    - { name: "id", type: "String", required: true }
    - { name: "name", type: "String", required: true }
`;

function sha256Hex(s: string): string {
  return require('crypto').createHash('sha256').update(s).digest('hex');
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('RemoteFetcher (v6.5.0)', () => {
  it('rejects non-https schemes', async () => {
    const fetcher = new RemoteFetcher(os.tmpdir());
    await expect(fetcher.fetchImport('http://evil.com/x.alp')).rejects.toThrow(/https/);
  });

  it('rejects non-.alp urls', async () => {
    const fetcher = new RemoteFetcher(os.tmpdir());
    const t = async () => fetcher.fetchImport('https://example.com/x.txt');
    await expect(t()).rejects.toThrow(/\.alp/);
  });

  it('fetches, caches, and reuses on second call (no transport hit)', async () => {
    const fetcher = new RemoteFetcher(makeWorkspace({}));
    let hits = 0;
    const transport = async (url: string) => {
      hits++;
      return { status: 200, body: PLUGIN, etag: '"v1"' };
    };
    const a = await fetcher.fetchImport('https://example.com/plugins/scrum.alp', { transport });
    const b = await fetcher.fetchImport('https://example.com/plugins/scrum.alp', { transport });
    expect(a).toBe(PLUGIN);
    expect(b).toBe(PLUGIN);
    expect(hits).toBe(1); // second call served from cache
  });

  it('verifies !integrity and rejects mismatches', async () => {
    const fetcher = new RemoteFetcher(makeWorkspace({}));
    const good = 'sha256:' + sha256Hex(PLUGIN);
    await expect(
      fetcher.fetchImport('https://example.com/plugins/scrum.alp', {
        transport: async () => ({ status: 200, body: PLUGIN }),
        integrity: good,
      })
    ).resolves.toBe(PLUGIN);

    await expect(
      fetcher.fetchImport('https://example.com/plugins/scrum.alp', {
        transport: async () => ({ status: 200, body: PLUGIN }),
        integrity: 'sha256:deadbeef',
      })
    ).rejects.toThrow(/Integrity mismatch/);
  });

  it('resolves registry aliases to a registry URL', () => {
    const fetcher = new RemoteFetcher(os.tmpdir());
    const url = fetcher.resolveAlias('@alp/scrum@1.0.0', 'https://reg.test');
    expect(url).toBe('https://reg.test/plugins/alp/scrum/1.0.0/plugin.alp');
  });

  it('falls back to stale cache on network error', async () => {
    const fetcher = new RemoteFetcher(makeWorkspace({}));
    // Prime cache.
    await fetcher.fetchImport('https://example.com/plugins/scrum.alp', {
      transport: async () => ({ status: 200, body: PLUGIN }),
    });
    // Network fails; stale cache must be returned.
    const content = await fetcher.fetchImport('https://example.com/plugins/scrum.alp', {
      transport: async () => {
        throw new Error('boom');
      },
    });
    expect(content).toBe(PLUGIN);
  });
});

describe('PluginResolver remote imports (v6.5.0)', () => {
  it('loads a plugin via https !import through injected transport', async () => {
    const root = makeWorkspace({
      'project.alp': '!import: "https://example.com/plugins/scrum.alp"\n\n@epic\n  id: epic-q3\n  name: "Q3"\n',
    });
    const resolver = new PluginResolver(root);
    const objects = await resolver.parseWorkspace(
      fs.readFileSync(path.join(root, 'project.alp'), 'utf8'),
      root,
      { transport: async () => ({ status: 200, body: PLUGIN }) } as any
    );
    expect(resolver.isCustomType('epic')).toBe(true);
    expect(objects.some((o) => o._type === 'epic' && o.id === 'epic-q3')).toBe(true);
  });

  it('loads a plugin via @ns/name@version registry alias', async () => {
    const root = makeWorkspace({
      'project.alp': '!import: "@alp/scrum@1.0.0"\n\n@epic\n  id: epic-a\n  name: "A"\n',
    });
    const resolver = new PluginResolver(root);
    let hitUrl = '';
    const objects = await resolver.parseWorkspace(
      fs.readFileSync(path.join(root, 'project.alp'), 'utf8'),
      root,
      {
        registryBase: 'https://reg.test',
        transport: async (url: string) => {
          hitUrl = url;
          return { status: 200, body: PLUGIN };
        },
      } as any
    );
    expect(hitUrl).toBe('https://reg.test/plugins/alp/scrum/1.0.0/plugin.alp');
    expect(objects.some((o) => o._type === 'epic')).toBe(true);
  });
});
