import { describe, it, expect } from 'vitest';
import { LWWRegister, ORSet, EdgeRuntime } from '../src/crdt';

describe('LWWRegister', () => {
  it('sets and gets a value', () => {
    const reg = new LWWRegister('node-1');
    reg.set('hello');
    expect(reg.get()).toBe('hello');
  });

  it('merge wins with newer timestamp', () => {
    const reg = new LWWRegister('node-1', 'old', 1000);
    reg.merge({ value: 'new', timestamp: 2000 });
    expect(reg.get()).toBe('new');
  });

  it('merge keeps older timestamp', () => {
    const reg = new LWWRegister('node-1', 'current', 2000);
    reg.merge({ value: 'old', timestamp: 1000 });
    expect(reg.get()).toBe('current');
  });
});

describe('ORSet', () => {
  it('adds and checks membership', () => {
    const s = new ORSet('node-1');
    s.add('a');
    expect(s.has('a')).toBe(true);
  });

  it('removes items', () => {
    const s = new ORSet('node-1');
    s.add('a');
    s.remove('a');
    expect(s.has('a')).toBe(false);
  });

  it('returns distinct values', () => {
    const s = new ORSet('node-1');
    s.add('a');
    s.add('b');
    expect(new Set(s.values())).toEqual(new Set(['a', 'b']));
  });

  it('merges entries from another set', () => {
    const s1 = new ORSet('node-1');
    const s2 = new ORSet('node-2');
    s1.add('a');
    s2.add('b');
    s1.merge(s2.toJSON());
    expect(s1.has('b')).toBe(true);
  });
});

describe('EdgeRuntime', () => {
  it('sets and gets state', () => {
    const runtime = new EdgeRuntime('edge-1', 'us-east');
    runtime.setState('key', 'value');
    expect(runtime.getState('key')).toBe('value');
  });

  it('queues tasks while offline', () => {
    const runtime = new EdgeRuntime('edge-1');
    runtime.goOffline();
    runtime.queueTask({ id: 't1' });
    expect(runtime['pending'].length).toBe(1);
  });

  it('resync applies pending tasks', () => {
    const runtime = new EdgeRuntime('edge-1');
    runtime.goOffline();
    runtime.queueTask({ id: 't1' });
    const result = runtime.resync();
    expect(result.applied).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it('selects nearest online peer', () => {
    const runtime = new EdgeRuntime('edge-1');
    runtime.registerPeer({ node_id: 'p1', region: 'us-east', online: true, latency_ms: 50 });
    runtime.registerPeer({ node_id: 'p2', region: 'us-west', online: true, latency_ms: 150 });
    const peer = runtime.nearestPeer({});
    expect(peer?.node_id).toBe('p1');
  });
});
