import { describe, it, expect } from 'vitest';
import { TelemetryEngine } from '../src/telemetry';

describe('TelemetryEngine (v17.0.0)', () => {
  it('creates and tracks spans with trace IDs and duration', () => {
    const engine = new TelemetryEngine();
    const span = engine.startSpan('task-run', { agent: '@agent-devops' });

    expect(span.spanId).toBeDefined();
    expect(span.traceId).toBeDefined();
    expect(span.agent).toBe('@agent-devops');
    expect(span.status).toBe('UNSET');

    const ended = engine.endSpan(span.spanId, 'OK', { result: 'success' });
    expect(ended).not.toBeNull();
    expect(ended?.status).toBe('OK');
    expect(ended?.durationMs).toBeGreaterThanOrEqual(0);
    expect(ended?.attributes.result).toBe('success');
  });

  it('injects and extracts W3C traceparent headers', () => {
    const engine = new TelemetryEngine();
    const span = engine.startSpan('hand-off');
    const header = engine.injectContext(span);

    expect(header).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);

    const extracted = engine.extractContext(header);
    expect(extracted).not.toBeNull();
    expect(extracted?.traceId).toBe(span.traceId);
    expect(extracted?.parentSpanId).toBe(span.spanId);
  });

  it('exports spans in OTLP JSON format', () => {
    const engine = new TelemetryEngine();
    const span = engine.startSpan('compile-ast');
    engine.endSpan(span.spanId, 'OK');

    const otlp = engine.exportOTLP();
    expect(otlp.resourceSpans).toBeDefined();
    expect(otlp.resourceSpans[0].scopeSpans[0].spans.length).toBe(1);
    expect(otlp.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('compile-ast');
  });
});
