import { describe, it, expect } from 'vitest';
import { ProtocolBridge, SUPPORTED_FORMATS, BridgeError } from '../src/bridge';

describe('ProtocolBridge (v17.0.0)', () => {
  const bridge = new ProtocolBridge()
  const workflow = {
    id: 'my-wf',
    name: 'My Workflow',
    steps: [
      { name: 'create', type: 'step' },
      { name: 'update', type: 'step' },
    ],
  }

  it('exports OpenAPI 3.0 spec', () => {
    const result = bridge.exportWorkflow(workflow, 'openapi')
    expect(result.format).toBe('openapi')
    expect(result.spec.openapi).toBe('3.0.0')
    expect(result.spec.paths['/create'].post.operationId).toBe('my-wf.create')
    expect(result.warnings).toHaveLength(0)
  })

  it('exports GraphQL SDL', () => {
    const result = bridge.exportWorkflow(workflow, 'graphql')
    expect(result.format).toBe('graphql')
    expect(result.spec).toContain('type my_wfWorkflow {')
    expect(result.spec).toContain('create: String')
    expect(result.spec).toContain('update: String')
  })

  it('exports gRPC proto', () => {
    const result = bridge.exportWorkflow(workflow, 'grpc')
    expect(result.format).toBe('grpc')
    expect(result.spec).toContain('syntax = "proto3";')
    expect(result.spec).toContain('service my_wfService {')
    expect(result.spec).toContain('rpc create(createRequest) returns (createResponse);')
  })

  it('exports AsyncAPI 2.0 spec', () => {
    const result = bridge.exportWorkflow(workflow, 'asyncapi')
    expect(result.format).toBe('asyncapi')
    expect(result.spec.asyncapi).toBe('2.0.0')
    expect(result.spec.channels['my-wf/create']).toBeDefined()
  })

  it('warns on empty workflow export', () => {
    const result = bridge.exportWorkflow({ id: 'empty', steps: [] }, 'openapi')
    expect(result.warnings).toContain('Workflow has no steps; OpenAPI spec will be empty.')
  })

  it('imports OpenAPI spec back to workflow', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0.0' },
      paths: {
        '/hello': {
          post: { operationId: 'hello-world' },
        },
      },
    }
    const result = bridge.importSpec(spec, 'openapi')
    expect(result.format).toBe('openapi')
    expect(result.workflow.steps).toHaveLength(1)
    expect(result.workflow.steps[0].name).toBe('hello-world')
  })

  it('imports GraphQL SDL back to workflow', () => {
    const sdl = `type Query {
  my_wf: my_wf_workflow
}
type my_wf_workflow {
  hello: String
}`
    const result = bridge.importSpec(sdl, 'graphql')
    expect(result.format).toBe('graphql')
    expect(result.workflow.steps.length).toBeGreaterThanOrEqual(1)
    expect(result.workflow.steps.some(s => s.name === 'hello')).toBe(true)
  })

  it('imports gRPC proto back to workflow', () => {
    const proto = `syntax = "proto3";
service testService {
  rpc create(createRequest) returns (createResponse);
}`
    const result = bridge.importSpec(proto, 'grpc')
    expect(result.format).toBe('grpc')
    expect(result.workflow.steps).toHaveLength(1)
    expect(result.workflow.steps[0].name).toBe('create')
  })

  it('imports AsyncAPI spec back to workflow', () => {
    const spec = {
      asyncapi: '2.0.0',
      info: { title: 'Event API', version: '1.0.0' },
      channels: {
        'wf/step': {
          publish: { message: { name: 'stepRequest' } },
        },
      },
    }
    const result = bridge.importSpec(spec, 'asyncapi')
    expect(result.format).toBe('asyncapi')
    expect(result.workflow.steps).toHaveLength(1)
    expect(result.workflow.steps[0].name).toBe('stepRequest')
  })

  it('round-trips workflow through OpenAPI', () => {
    const exported = bridge.exportWorkflow(workflow, 'openapi')
    const imported = bridge.importSpec(exported.spec, 'openapi')
    expect(imported.workflow.steps.map(s => s.name).sort()).toEqual(['my-wf.create', 'my-wf.update'])
  })

  it('throws BridgeError on unsupported format', () => {
    expect(() => bridge.exportWorkflow(workflow, 'xml' as any)).toThrow(BridgeError)
    expect(() => bridge.importSpec({}, 'yaml' as any)).toThrow(BridgeError)
  })

  it('lists supported formats', () => {
    expect(SUPPORTED_FORMATS).toEqual(['openapi', 'graphql', 'grpc', 'asyncapi'])
  })
})
