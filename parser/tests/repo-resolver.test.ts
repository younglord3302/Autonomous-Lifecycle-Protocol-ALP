import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalResolver } from '../src/index';

describe('ExternalResolver (Pillar 2: cross-repo)', () => {
  function makeFederation(): { root: string; cleanup: () => void } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-fed-'));

    // Local workspace .alp with a @repo pointing to a sibling local repo.
    const wsAlp = path.join(root, '.alp');
    fs.mkdirSync(wsAlp, { recursive: true });
    fs.writeFileSync(path.join(wsAlp, 'project.alp'), `
@repo
  id: billing
  src: "${path.join(root, 'billing').replace(/\\/g, '/')}"
  description: "local sibling"
`);
    fs.writeFileSync(path.join(wsAlp, 'tasks.alp'), `
@task
  id: task-checkout
  depends_on:
    - -> billing::task-stripe | blocks
`);
    fs.writeFileSync(path.join(wsAlp, 'dangling.alp'), `
@task
  id: task-broken
  depends_on:
    - -> billing::task-missing | blocks
`);

    // The sibling "billing" repo.
    const billingAlp = path.join(root, 'billing', '.alp');
    fs.mkdirSync(billingAlp, { recursive: true });
    fs.writeFileSync(path.join(billingAlp, 'tasks.alp'), `
@task
  id: task-stripe
  status: "[x]"
`);

    return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
  }

  it('discovers repos and resolves cross-repo references', () => {
    const { root, cleanup } = makeFederation();
    try {
      const resolver = new ExternalResolver(path.join(root, '.alp'));
      const result = resolver.resolve();

      expect(result.repos.length).toBe(1);
      expect(result.repos[0].id).toBe('billing');
      expect(result.repos[0].fetched).toBe(false);

      // billing::task-stripe should be in the object index.
      expect(result.objects.has('billing::task-stripe')).toBe(true);

      const resolvedRef = result.references.find((r) => r.target === 'task-stripe');
      expect(resolvedRef?.resolved).toBe(true);

      const danglingRef = result.references.find((r) => r.target === 'task-missing');
      expect(danglingRef?.resolved).toBe(false);

      // Exactly one dangling ref.
      expect(result.dangling.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('builds a merged graph with nodes from both repos', () => {
    const { root, cleanup } = makeFederation();
    try {
      const resolver = new ExternalResolver(path.join(root, '.alp'));
      const result = resolver.resolve();
      const ids = result.graph.nodes.map((n) => `${n.repo}::${n.id}`);
      expect(ids).toContain('local::task-checkout');
      expect(ids).toContain('billing::task-stripe');
      expect(result.graph.edges.some((e) => e.from === 'billing::task-stripe' && e.to === 'task-checkout')).toBe(true);
    } finally {
      cleanup();
    }
  });
});
