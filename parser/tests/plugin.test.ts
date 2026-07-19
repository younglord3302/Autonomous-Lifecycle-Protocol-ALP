import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginResolver } from '../src/plugin';

let tmpDir: string | null = null;

function makeWorkspace(files: Record<string, string>): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-plugin-'));
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
    - -> type-sprint

---

@type_definition
  id: type-epic
  type_name: epic
  description: "A large body of work"
  properties:
    - { name: "id", type: "String", required: true }
    - { name: "name", type: "String", required: true }
    - { name: "status", type: "Status", required: true }
  allowed_nested:
    - "accept"
`;

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('PluginResolver (v6.5.0)', () => {
  it('registers custom types from a locally imported plugin', async () => {
    const root = makeWorkspace({
      'project.alp': '!import: "plugins/scrum.alp"\n\n@project\n  id: my-proj\n',
      'plugins/scrum.alp': PLUGIN,
    });
    const resolver = new PluginResolver(root);
    const objects = await resolver.parseWorkspace(
      fs.readFileSync(path.join(root, 'project.alp'), 'utf8'),
      root
    );
    expect(resolver.isCustomType('epic')).toBe(true);
    expect(resolver.types.get('epic')!.properties.map((p) => p.name)).toContain('status');
    expect(objects.some((o) => o._type === 'project')).toBe(true);
    expect(resolver.plugins.has('plugin-scrum')).toBe(true);
  });

  it('parses and collects a custom-type instance', async () => {
    const root = makeWorkspace({
      'project.alp':
        '!import: "plugins/scrum.alp"\n\n@epic\n  id: epic-q3\n  name: "Q3"\n  status: [~]\n',
      'plugins/scrum.alp': PLUGIN,
    });
    const resolver = new PluginResolver(root);
    const objects = await resolver.parseWorkspace(
      fs.readFileSync(path.join(root, 'project.alp'), 'utf8'),
      root
    );
    const epic = objects.find((o) => o._type === 'epic');
    expect(epic).toBeDefined();
    expect(epic!.id).toBe('epic-q3');
  });

  it('validates required properties of a custom type', async () => {
    const root = makeWorkspace({
      'project.alp': '!import: "plugins/scrum.alp"\n\n@epic\n  id: epic-bad\n  name: "No status"\n',
      'plugins/scrum.alp': PLUGIN,
    });
    const resolver = new PluginResolver(root);
    await resolver.parseWorkspace(
      fs.readFileSync(path.join(root, 'project.alp'), 'utf8'),
      root
    );
    const epic = resolver.objects.find((o) => o._type === 'epic')!;
    expect(() => resolver.validateCustom(epic)).toThrow(/Missing required property 'status'/);
  });

  it('detects circular imports', async () => {
    const root = makeWorkspace({
      'a.alp': '!import: "b.alp"\n@project\n  id: a\n',
      'b.alp': '!import: "a.alp"\n@feature\n  id: b\n',
    });
    const resolver = new PluginResolver(root);
    await expect(
      resolver.parseWorkspace(fs.readFileSync(path.join(root, 'a.alp'), 'utf8'), root)
    ).rejects.toThrow(/Circular/);
  });

  it('rejects non-https remote imports in v6.5.0', async () => {
    const root = makeWorkspace({
      'project.alp': '!import: "http://example.com/x.alp"\n@project\n  id: p\n',
    });
    const resolver = new PluginResolver(root);
    await expect(
      resolver.parseWorkspace(fs.readFileSync(path.join(root, 'project.alp'), 'utf8'), root)
    ).rejects.toThrow(/https/);
  });
});
