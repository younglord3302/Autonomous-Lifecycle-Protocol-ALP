import { Command } from 'commander';
import { TelemetryEngine } from '@alp/parser';

export function registerTraceCommand(program: Command) {
  const trace = program
    .command('trace')
    .description('Manage OpenTelemetry distributed tracing and span exports (v17.0.0)');

  trace
    .command('summary')
    .description('Show telemetry span summary and active traces')
    .action(() => {
      const engine = new TelemetryEngine();
      
      // Simulate active span monitoring demo
      const span1 = engine.startSpan('task-execution', { agent: '@agent-architect', attributes: { env: 'production' } });
      const span2 = engine.startSpan('contract-check', { traceId: span1.traceId, parentSpanId: span1.spanId, agent: '@agent-coder' });
      
      engine.endSpan(span2.spanId, 'OK');
      engine.endSpan(span1.spanId, 'OK');

      const summary = engine.getTraceSummary();

      console.log('\n📊 ALP Telemetry & Span Summary (v17.0.0)');
      console.log('==========================================');
      console.log(`  Total Spans:    ${summary.totalSpans}`);
      console.log(`  Active Spans:   ${summary.activeSpans}`);
      console.log(`  Successful OK:  ${summary.okCount}`);
      console.log(`  Errors:         ${summary.errorCount}\n`);
    });

  trace
    .command('export')
    .description('Export recorded traces in OTLP JSON format')
    .option('--json', 'Output pretty-printed JSON', true)
    .action(() => {
      const engine = new TelemetryEngine();
      const s = engine.startSpan('agent-handoff', { agent: '@agent-devops' });
      engine.endSpan(s.spanId, 'OK', { status_code: 200 });

      const otlp = engine.exportOTLP();
      console.log(JSON.stringify(otlp, null, 2));
    });
}
