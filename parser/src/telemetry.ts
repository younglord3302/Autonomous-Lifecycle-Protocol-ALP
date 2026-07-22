import * as crypto from 'node:crypto';

export interface Span {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  agent?: string;
  action: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  attributes: Record<string, any>;
}

export class TelemetryEngine {
  private activeSpans: Map<string, Span> = new Map();
  private completedSpans: Span[] = [];

  public generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  public generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  public startSpan(action: string, opts?: { traceId?: string; parentSpanId?: string; agent?: string; attributes?: Record<string, any> }): Span {
    const traceId = opts?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();

    const span: Span = {
      id: `span-${spanId}`,
      traceId,
      spanId,
      parentSpanId: opts?.parentSpanId,
      agent: opts?.agent,
      action,
      startTime: Date.now(),
      status: 'UNSET',
      attributes: opts?.attributes || {},
    };

    this.activeSpans.set(span.spanId, span);
    return span;
  }

  public endSpan(spanId: string, status: 'OK' | 'ERROR' = 'OK', attributes?: Record<string, any>): Span | null {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;

    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = status;
    if (attributes) {
      span.attributes = { ...span.attributes, ...attributes };
    }

    this.activeSpans.delete(spanId);
    this.completedSpans.push(span);
    return span;
  }

  public injectContext(span: Span): string {
    // W3C traceparent header format: version-traceId-spanId-traceFlags
    return `00-${span.traceId}-${span.spanId}-01`;
  }

  public extractContext(traceparent: string): { traceId: string; parentSpanId: string } | null {
    const parts = traceparent.split('-');
    if (parts.length < 4 || parts[0] !== '00') return null;
    return {
      traceId: parts[1],
      parentSpanId: parts[2],
    };
  }

  public exportOTLP(): any {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'alp-execution-engine' } },
              { key: 'telemetry.sdk.name', value: { stringValue: 'alp-telemetry' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: '@alp/telemetry', version: '17.0.0' },
              spans: this.completedSpans.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId || '',
                name: s.action,
                kind: 1, // SPAN_KIND_INTERNAL
                startTimeUnixNano: String(s.startTime * 1000000),
                endTimeUnixNano: String((s.endTime || s.startTime) * 1000000),
                status: { code: s.status === 'OK' ? 1 : s.status === 'ERROR' ? 2 : 0 },
                attributes: Object.entries(s.attributes).map(([k, v]) => ({
                  key: k,
                  value: { stringValue: String(v) },
                })),
              })),
            },
          ],
        },
      ],
    };
  }

  public getTraceSummary(): { totalSpans: number; activeSpans: number; okCount: number; errorCount: number } {
    const okCount = this.completedSpans.filter((s) => s.status === 'OK').length;
    const errorCount = this.completedSpans.filter((s) => s.status === 'ERROR').length;
    return {
      totalSpans: this.completedSpans.length + this.activeSpans.size,
      activeSpans: this.activeSpans.size,
      okCount,
      errorCount,
    };
  }

  public getCompletedSpans(): Span[] {
    return [...this.completedSpans];
  }
}
