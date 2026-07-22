import { useState, useEffect, useCallback, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import ReactFlow, {
  Background,
  Controls,
  Position,
  Handle,
  MarkerType,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import type { Edge, Node, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import { AlpParser, AlpGraph } from '@alp/parser';
import type { AlpObject } from '@alp/parser';
import './App.css';

// ── Preset Templates ───────────────────────────────────────────────────
const TEMPLATES: Record<string, { label: string; code: string }> = {
  webApp: {
    label: '🚀 Web App Lifecycle',
    code: `!alp-version: 3.0.0

@project
  id: alp-commerce-app
  status: [~]
  description: "Next-gen Autonomous E-Commerce Platform"

@feature
  id: feat-auth
  status: [x]
  description: "User Authentication & OAuth2"

@feature
  id: feat-checkout
  status: [~]
  description: "Stripe & Crypto Payment Gateway"

@task
  id: task-db-schema
  status: [x]
  feature: -> feat-auth
  owner: "@agent-backend"
  verify:
    - "npm run db:migrate"

@task
  id: task-auth-api
  status: [x]
  feature: -> feat-auth
  depends_on:
    - -> task-db-schema
  verify:
    - "npm test tests/auth.test.ts"

@task
  id: task-cart-api
  status: [~]
  feature: -> feat-checkout
  depends_on:
    - -> task-auth-api
  verify:
    - "npm test tests/cart.test.ts"

@task
  id: task-stripe-integration
  status: [!]
  feature: -> feat-checkout
  depends_on:
    - -> task-cart-api
  requires:
    - "env.STRIPE_SECRET_KEY != ''"
  verify:
    - "npm test tests/stripe.test.ts"

@rule
  id: rule-no-direct-db-write
  description: "All DB updates must pass through the repository pattern"
`,
  },
  swarm: {
    label: '🐝 Swarm & Multi-Agent Network',
    code: `!alp-version: 3.0.0

@project
  id: autonomous-swarm-cluster
  status: [~]

@agent
  id: agent-architect
  role: "Lead Systems Architect"

@agent
  id: agent-coder
  role: "Senior Fullstack Engineer"

@agent
  id: agent-qa
  role: "Automated QA & Security Audit"

@task
  id: task-spec-decomposition
  status: [x]
  owner: -> agent-architect

@task
  id: task-build-core
  status: [~]
  depends_on:
    - -> task-spec-decomposition
  owner: -> agent-coder

@task
  id: task-run-fuzzing
  status: [ ]
  depends_on:
    - -> task-build-core
  owner: -> agent-qa
`,
  },
  governance: {
    label: '🛡️ Policy & Vault Governance',
    code: `!alp-version: 3.0.0

@project
  id: secure-banking-service
  status: [~]

@policy
  id: policy-prod-deploy
  applies_to: "@agent-deployer"
  allow_paths:
    - "deploy/**"
  deny_paths:
    - "secrets/**"
  require_approval: true

@contract
  id: contract-deploy-boundary
  from: "@agent-deployer"
  to: "@agent-k8s"
  allows:
    - "deploy.k8s.*"
  denies:
    - "admin.system.*"

@timeline
  id: tl-nightly-health
  cron: "0 1 * * *"
  description: "Nightly cluster health check"
  status: [ ]

@vault
  id: vault-prod-db
  recipients:
    - "maintainer.pub"

@task
  id: task-deploy-service
  status: [?]
  policy: -> policy-prod-deploy
  contract: -> contract-deploy-boundary
  vault: -> vault-prod-db
`,
  },
};

// ── Custom ReactFlow Node ─────────────────────────────────────────────
function AlpCustomNode({ data, selected }: NodeProps) {
  const status = data.status || '[ ]';
  const getStatusClass = (st: string) => {
    switch (st) {
      case '[x]': return 'done';
      case '[~]': return 'progress';
      case '[!]': return 'blocked';
      case '[?]': return 'review';
      default: return 'todo';
    }
  };

  return (
    <div className={`alp-custom-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ background: '#00f0ff', width: 8, height: 8 }} />
      <div className="node-type-badge">@{data.type}</div>
      <div className="node-title">{data.id}</div>
      <div className="node-footer">
        <span className={`status-badge ${getStatusClass(status)}`}>
          {status} {status === '[x]' ? 'Done' : status === '[~]' ? 'In Progress' : status === '[!]' ? 'Blocked' : status === '[?]' ? 'Review' : 'Todo'}
        </span>
        {data.owner && <span className="node-owner">{data.owner}</span>}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#9d4edd', width: 8, height: 8 }} />
    </div>
  );
}

// ── Main App Component ────────────────────────────────────────────────
export default function App() {
  const [templateKey, setTemplateKey] = useState<string>('webApp');
  const [code, setCode] = useState<string>(TEMPLATES['webApp'].code);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedObj, setSelectedObj] = useState<AlpObject | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Register custom node types
  const nodeTypes = useMemo(() => ({ alpNode: AlpCustomNode }), []);

  // ── Hierarchical Graph Layout Algorithm ─────────────────────────────
  const processCode = useCallback((newCode: string) => {
    setCode(newCode);
    try {
      const parser = new AlpParser();
      const objects = parser.parseAndValidate(newCode);

      const graph = new AlpGraph();
      graph.buildGraph(objects);

      // Map edges & build dependency map for topological depth layering
      const edgeList: { from: string; to: string; type: string }[] = [];
      const inDegree: Record<string, number> = {};
      const adj: Record<string, string[]> = {};

      objects.forEach((obj) => {
        inDegree[obj.id] = 0;
        adj[obj.id] = [];
      });

      graph.edges.forEach((e) => {
        edgeList.push({ from: e.source, to: e.target, type: e.type });
        if (adj[e.source]) adj[e.source].push(e.target);
        if (inDegree[e.target] !== undefined) inDegree[e.target] += 1;
      });

      // Calculate depth levels (Kahn's layer assignment)
      const depth: Record<string, number> = {};
      const queue: string[] = [];

      Object.keys(inDegree).forEach((id) => {
        if (inDegree[id] === 0) {
          queue.push(id);
          depth[id] = 0;
        }
      });

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const d = depth[curr];
        (adj[curr] || []).forEach((next) => {
          depth[next] = Math.max(depth[next] || 0, d + 1);
          inDegree[next] -= 1;
          if (inDegree[next] === 0) queue.push(next);
        });
      }

      // Group nodes by depth column
      const columns: Record<number, AlpObject[]> = {};
      objects.forEach((obj) => {
        const d = depth[obj.id] ?? 0;
        if (!columns[d]) columns[d] = [];
        columns[d].push(obj);
      });

      // Position nodes dynamically into clean matrix grid (Left to Right)
      const newNodes: Node[] = [];
      const colWidth = 260;
      const rowHeight = 120;

      Object.entries(columns).forEach(([colStr, colObjects]) => {
        const c = parseInt(colStr, 10);
        colObjects.forEach((obj, r) => {
          newNodes.push({
            id: obj.id,
            type: 'alpNode',
            position: { x: 50 + c * colWidth, y: 50 + r * rowHeight },
            data: {
              id: obj.id,
              type: obj._type,
              status: obj.status,
              owner: (obj as any).owner || null,
              rawObject: obj,
            },
          });
        });
      });

      // Build styled edges with smooth bezier lines & neon glow colors
      const newEdges: Edge[] = edgeList.map((e, idx) => {
        let strokeColor = '#00f0ff';
        if (e.type === 'feature') strokeColor = '#9d4edd';
        if (e.type === 'owner') strokeColor = '#3b82f6';
        if (e.type === 'requires') strokeColor = '#f59e0b';

        return {
          id: `edge-${idx}`,
          source: e.from,
          target: e.to,
          label: e.type,
          type: 'smoothstep',
          animated: e.type === 'depends_on' || e.type === 'requires',
          style: { stroke: strokeColor, strokeWidth: 2 },
          labelStyle: { fill: '#8a94b0', fontSize: 10, fontFamily: 'JetBrains Mono' },
          labelBgStyle: { fill: '#131625', fillOpacity: 0.8 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: strokeColor,
          },
        };
      });

      setNodes(newNodes);
      setEdges(newEdges);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Syntax Error in ALP specification');
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    processCode(code);
  }, [code, processCode]);

  const handleTemplateChange = (key: string) => {
    setTemplateKey(key);
    if (TEMPLATES[key]) {
      setCode(TEMPLATES[key].code);
    }
  };

  const handleNodeClick = (_: any, node: Node) => {
    if (node.data && node.data.rawObject) {
      setSelectedObj(node.data.rawObject);
    }
  };

  const handleCopyBundle = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Stats calculation
  const totalTasks = nodes.filter((n) => n.data.type === 'task').length;
  const doneTasks = nodes.filter((n) => n.data.status === '[x]').length;
  const inProgressTasks = nodes.filter((n) => n.data.status === '[~]').length;
  const blockedTasks = nodes.filter((n) => n.data.status === '[!]').length;

  return (
    <div className="playground">
      {/* Navbar Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">ALP</div>
          <span className="brand-title">Execution Engine &amp; DAG Playground</span>
          <span className="brand-badge">v16.0.0</span>
        </div>

        <div className="header-controls">
          <select
            className="template-select"
            value={templateKey}
            onChange={(e) => handleTemplateChange(e.target.value)}
          >
            {Object.entries(TEMPLATES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>

          <button className="action-btn" onClick={handleCopyBundle}>
            {copied ? '✅ Copied' : '📋 Copy Bundle'}
          </button>

          <div className={`status-indicator ${error ? 'invalid' : 'valid'}`}>
            {error ? '❌ Invalid Spec' : '⚡ Verified DAG'}
          </div>
        </div>
      </header>

      {/* Main Workspace Split-Pane */}
      <div className="main-workspace">
        {/* Left: Code Editor */}
        <div className="editor-container">
          <div className="editor-header">
            <span>spec.alp — Autonomous LifeCycle Protocol</span>
            <span>UTF-8</span>
          </div>
          <Editor
            height="100%"
            defaultLanguage="yaml"
            theme="vs-dark"
            value={code}
            onChange={(val) => processCode(val || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'JetBrains Mono',
              scrollBeyondLastLine: false,
              padding: { top: 12 },
              lineNumbersMinChars: 3,
            }}
          />
        </div>

        {/* Right: DAG Visualizer */}
        <div className="graph-container">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            fitView
          >
            <Background color="#1e2338" gap={20} size={1} />
            <Controls />
          </ReactFlow>

          {/* Node Inspector Sidebar */}
          {selectedObj && (
            <div className="inspector-panel">
              <div className="inspector-header">
                <h3>@{selectedObj._type} Details</h3>
                <button className="close-btn" onClick={() => setSelectedObj(null)}>
                  ✕
                </button>
              </div>
              <div className="inspector-field">
                <div className="field-label">Object ID</div>
                <div className="field-value">{selectedObj.id}</div>
              </div>
              {selectedObj.status && (
                <div className="inspector-field">
                  <div className="field-label">Lifecycle Status</div>
                  <div className="field-value">{selectedObj.status}</div>
                </div>
              )}
              {selectedObj.description && (
                <div className="inspector-field">
                  <div className="field-label">Description</div>
                  <div className="field-value">{selectedObj.description}</div>
                </div>
              )}
              {(selectedObj as any).verify && (
                <div className="inspector-field">
                  <div className="field-label">Quality Gates (verify)</div>
                  <div className="field-value">
                    {JSON.stringify((selectedObj as any).verify, null, 2)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error Banner */}
          {error && <div className="error-toast">⚠️ {error}</div>}
        </div>
      </div>

      {/* Summary Footer */}
      <footer className="summary-bar">
        <div className="summary-item">
          Total Objects: <strong>{nodes.length}</strong>
        </div>
        <div className="summary-item">
          Tasks: <strong>{totalTasks}</strong>
        </div>
        <div className="summary-item" style={{ color: '#34d399' }}>
          Done: <strong>{doneTasks}</strong>
        </div>
        <div className="summary-item" style={{ color: '#38bdf8' }}>
          In Progress: <strong>{inProgressTasks}</strong>
        </div>
        <div className="summary-item" style={{ color: '#fb7185' }}>
          Blocked: <strong>{blockedTasks}</strong>
        </div>
      </footer>
    </div>
  );
}
