/** ALP Universal Protocol Bridge (v17.0.0 — V13 The Universal Era).
 *
 * Adapts ALP objects to and from external protocol descriptions:
 *
 * - OpenAPI 3.0  — REST API specs
 * - GraphQL SDL  — schema definitions
 * - gRPC proto   — protobuf service definitions
 * - AsyncAPI     — event-driven / message API specs
 *
 * `ProtocolBridge` is the single entrypoint; `alp bridge export` and
 * `alp bridge import` are the planned CLI commands. Mirrors
 * `sdk/python/alp_sdk/bridge.py`.
 */

export const SUPPORTED_FORMATS = ['openapi', 'graphql', 'grpc', 'asyncapi'] as const
export type SupportedFormat = typeof SUPPORTED_FORMATS[number]

export class BridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeError'
  }
}

export interface BridgeExportResult {
  format: SupportedFormat
  spec: Record<string, any>
  source_workflow_id: string
  warnings: string[]
}

export interface BridgeImportResult {
  format: SupportedFormat
  workflow: Record<string, any>
  source_spec: Record<string, any>
  warnings: string[]
}

export class ProtocolBridge {
  private exporters: Record<SupportedFormat, (workflow: Record<string, any>) => [Record<string, any> | string, string[]]>
  private importers: Record<SupportedFormat, (spec: any) => [Record<string, any>, string[]]>

  constructor() {
    this.exporters = {
      openapi: (wf) => this.exportOpenapi(wf),
      graphql: (wf) => this.exportGraphql(wf),
      grpc: (wf) => this.exportGrpc(wf),
      asyncapi: (wf) => this.exportAsyncapi(wf),
    }
    this.importers = {
      openapi: (spec) => this.importOpenapi(spec),
      graphql: (spec) => this.importGraphql(spec),
      grpc: (spec) => this.importGrpc(spec),
      asyncapi: (spec) => this.importAsyncapi(spec),
    }
  }

  exportWorkflow(workflow: Record<string, any>, fmt: SupportedFormat): BridgeExportResult {
    const key = fmt.toLowerCase() as SupportedFormat
    if (!(key in this.exporters)) {
      throw new BridgeError(`Unsupported export format '${fmt}'. Supported: ${SUPPORTED_FORMATS.join(', ')}`)
    }
    const [spec, warnings] = this.exporters[key](workflow)
    return {
      format: key,
      spec: spec as Record<string, any>,
      source_workflow_id: String(workflow.id ?? workflow.name ?? '_unknown'),
      warnings,
    }
  }

  importSpec(spec: Record<string, any>, fmt: SupportedFormat): BridgeImportResult {
    const key = fmt.toLowerCase() as SupportedFormat
    if (!(key in this.importers)) {
      throw new BridgeError(`Unsupported import format '${fmt}'. Supported: ${SUPPORTED_FORMATS.join(', ')}`)
    }
    const [workflow, warnings] = this.importers[key](spec)
    return {
      format: key,
      workflow,
      source_spec: spec,
      warnings,
    }
  }

  // ── OpenAPI 3.0 ─────────────────────────────────────────────────────────

  private exportOpenapi(workflow: Record<string, any>): [Record<string, any>, string[]] {
    const warnings: string[] = []
    const wfId = String(workflow.id ?? workflow.name ?? '_unknown')
    const paths: Record<string, any> = {}
    const schemas: Record<string, any> = {}
    let stepIdx = 0

    for (const step of workflow.steps ?? []) {
      const stepName = String(step.name ?? step.id ?? `step-${stepIdx++}`)
      const path = `/${stepName}`
      const requestBody = {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { input: { type: 'string' } } },
          },
        },
      }
      const responses = {
        '200': {
          description: 'Success',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      }
      paths[path] = {
        post: {
          operationId: `${wfId}.${stepName}`,
          requestBody,
          responses,
        },
      }
      const schemaName = `${wfId}.${stepName}.Request`
      schemas[schemaName] = { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] }
    }

    if (!Object.keys(paths).length) {
      warnings.push('Workflow has no steps; OpenAPI spec will be empty.')
    }

    const spec = {
      openapi: '3.0.0',
      info: { title: `ALP Workflow: ${wfId}`, version: '1.0.0' },
      paths,
      components: { schemas },
    }
    return [spec, warnings]
  }

  private importOpenapi(spec: Record<string, any>): [Record<string, any>, string[]] {
    const warnings: string[] = []
    const info = spec.info ?? {}
    const title = String(info.title ?? 'imported-workflow')
    const wfId = title.replace(/ /g, '-').toLowerCase()
    const steps: Array<Record<string, any>> = []

    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      const methodDetails = methods as Record<string, any>
      for (const [method, details] of Object.entries(methodDetails)) {
        if (typeof details !== 'object' || !details) continue
        const opId = String(details.operationId ?? path.replace(/^\//, ''))
        steps.push({ id: opId, name: opId, type: 'step' })
        break
      }
    }

    const workflow = {
      id: wfId,
      name: title,
      source_format: 'openapi',
      steps,
    }
    if (!steps.length) {
      warnings.push('No paths found in OpenAPI spec.')
    }
    return [workflow, warnings]
  }

  // ── GraphQL SDL ─────────────────────────────────────────────────────────

  private exportGraphql(workflow: Record<string, any>): [string, string[]] {
    const warnings: string[] = []
    const wfId = String(workflow.id ?? workflow.name ?? '_unknown').replace(/-/g, '_')
    const typeName = `${wfId}Workflow`
    const lines: string[] = [`type ${typeName} {`]
    for (const step of workflow.steps ?? []) {
      const name = String(step.name ?? step.id ?? 'step').replace(/-/g, '_')
      lines.push(`  ${name}: String`)
    }
    lines.push('}')
    lines.push('')
    lines.push(`type Query {`)
    lines.push(`  ${wfId}: ${typeName}`)
    lines.push('}')
    const sdl = lines.join('\n')
    return [sdl, warnings]
  }

  private importGraphql(spec: Record<string, any> | string): [Record<string, any>, string[]] {
    const warnings: string[] = []
    const sdl = typeof spec === 'string' ? spec : JSON.stringify(spec)
    const steps: Array<Record<string, any>> = []
    let inType = false

    for (const line of sdl.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      if (trimmed.startsWith('type ')) {
        inType = true
        continue
      }
      if (trimmed === '}') {
        inType = false
        continue
      }
      if (inType && trimmed.includes(': ')) {
        const fieldName = trimmed.split(':')[0].trim().replace('{', '').trim()
        if (fieldName) {
          steps.push({ id: fieldName, name: fieldName, type: 'step' })
        }
      }
    }

    const workflow = {
      id: 'imported-graphql-workflow',
      name: 'Imported GraphQL Workflow',
      source_format: 'graphql',
      steps,
    }
    if (!steps.length) {
      warnings.push('No fields found in GraphQL SDL.')
    }
    return [workflow, warnings]
  }

  // ── gRPC proto ──────────────────────────────────────────────────────────

  private exportGrpc(workflow: Record<string, any>): [string, string[]] {
    const warnings: string[] = []
    const wfId = String(workflow.id ?? workflow.name ?? '_unknown').replace(/-/g, '_')
    const serviceName = `${wfId}Service`
    const lines: string[] = ['syntax = "proto3";', '', 'package alp;', `service ${serviceName} {`]

    for (const step of workflow.steps ?? []) {
      const name = String(step.name ?? step.id ?? 'step').replace(/-/g, '_')
      lines.push(`  rpc ${name}(${name}Request) returns (${name}Response);`)
    }
    lines.push('}')
    lines.push('')

    for (const step of workflow.steps ?? []) {
      const name = String(step.name ?? step.id ?? 'step').replace(/-/g, '_')
      lines.push(`message ${name}Request {`)
      lines.push('  string input = 1;')
      lines.push('}')
      lines.push(`message ${name}Response {`)
      lines.push('  string output = 1;')
      lines.push('}')
      lines.push('')
    }

    return [lines.join('\n'), warnings]
  }

  private importGrpc(spec: Record<string, any> | string): [Record<string, any>, string[]] {
    const warnings: string[] = []
    const proto = typeof spec === 'string' ? spec : JSON.stringify(spec)
    const steps: Array<Record<string, any>> = []

    for (const line of proto.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('rpc ') && trimmed.includes('(')) {
        const rpcName = trimmed.split('(')[0].replace('rpc ', '').trim()
        if (rpcName) {
          steps.push({ id: rpcName, name: rpcName, type: 'step' })
        }
      }
    }

    const workflow = {
      id: 'imported-grpc-workflow',
      name: 'Imported gRPC Workflow',
      source_format: 'grpc',
      steps,
    }
    if (!steps.length) {
      warnings.push('No RPC methods found in proto spec.')
    }
    return [workflow, warnings]
  }

  // ── AsyncAPI ────────────────────────────────────────────────────────────

  private exportAsyncapi(workflow: Record<string, any>): [Record<string, any>, string[]] {
    const warnings: string[] = []
    const wfId = String(workflow.id ?? workflow.name ?? '_unknown')
    const channels: Record<string, any> = {}

    for (const step of workflow.steps ?? []) {
      const name = String(step.name ?? step.id ?? 'step')
      const channelName = `${wfId}/${name}`
      channels[channelName] = {
        publish: {
          message: {
            name: `${name}Request`,
            payload: { type: 'object', properties: { input: { type: 'string' } } },
          },
        },
        subscribe: {
          message: {
            name: `${name}Response`,
            payload: { type: 'object', properties: { output: { type: 'string' } } },
          },
        },
      }
    }

    const spec = {
      asyncapi: '2.0.0',
      info: { title: `ALP Workflow: ${wfId}`, version: '1.0.0' },
      channels,
    }
    if (!Object.keys(channels).length) {
      warnings.push('Workflow has no steps; AsyncAPI spec will be empty.')
    }
    return [spec, warnings]
  }

  private importAsyncapi(spec: Record<string, any>): [Record<string, any>, string[]] {
    const warnings: string[] = []
    const info = spec.info ?? {}
    const title = String(info.title ?? 'imported-asyncapi-workflow')
    const wfId = title.replace(/ /g, '-').toLowerCase()
    const steps: Array<Record<string, any>> = []

    for (const channel of Object.values(spec.channels ?? {})) {
      if (typeof channel === 'object' && channel) {
        const pub = (channel as Record<string, any>).publish ?? {}
        const msg = pub.message ?? {}
        const name = String(msg.name ?? 'step')
        steps.push({ id: name, name: name, type: 'step' })
      }
    }

    const workflow = {
      id: wfId,
      name: title,
      source_format: 'asyncapi',
      steps,
    }
    if (!steps.length) {
      warnings.push('No channels found in AsyncAPI spec.')
    }
    return [workflow, warnings]
  }
}
