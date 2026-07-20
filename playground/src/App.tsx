import { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import ReactFlow, { Background, Controls, Position } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { AlpParser, AlpGraph } from '@alp/parser';
import './App.css';

const DEFAULT_CODE = `!alp-version: 3.0.0

@project
  id: my-awesome-project
  status: [~]
  description: "A cool project built with ALP"

@feature
  id: feat-auth
  status: [~]

@task
  id: task-login
  status: [~]
  feature: -> feat-auth
  depends_on:
    - -> task-db

@task
  id: task-db
  status: [x]
  feature: -> feat-auth
`;

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);

  const processCode = useCallback((newCode: string) => {
    setCode(newCode);
    try {
      const parser = new AlpParser();
      const objects = parser.parseAndValidate(newCode);
      
      const graph = new AlpGraph();
      graph.buildGraph(objects);
      graph.detectCycles(); // Throws if cycle exists

      const sorted = graph.topologicalSort();
      
      // Convert to React Flow nodes/edges
      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];

      let yPos = 50;
      sorted.forEach((node) => {
        const status = node.object.status || '[ ]';
        let color = '#fff';
        if (status === '[x]') color = '#d4edda'; // green
        if (status === '[~]') color = '#fff3cd'; // yellow
        if (status === '[!]') color = '#f8d7da'; // red

        newNodes.push({
          id: node.id,
          position: { x: 250, y: yPos },
          data: { label: `${status} @${node.type}\n${node.id}` },
          style: { background: color, border: '1px solid #333', borderRadius: '4px', padding: '10px' },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        });
        yPos += 100;
      });

      graph.edges.forEach((edge, idx) => {
        newEdges.push({
          id: `e-${idx}`,
          source: edge.source,
          target: edge.target,
          label: edge.type,
          animated: edge.type === 'blocks' || edge.type === 'requires',
        });
      });

      setNodes(newNodes);
      setEdges(newEdges);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    processCode(DEFAULT_CODE);
  }, [processCode]);

  return (
    <div className="playground">
      <header className="header">
        <h1>ALP Playground</h1>
        {error ? (
          <div className="error-badge">❌ {error}</div>
        ) : (
          <div className="success-badge">✅ Valid</div>
        )}
      </header>
      
      <div className="split-pane">
        <div className="editor-pane">
          <Editor
            height="100%"
            defaultLanguage="yaml"
            theme="vs-dark"
            value={code}
            onChange={(val) => processCode(val || '')}
            options={{ minimap: { enabled: false }, fontSize: 14 }}
          />
        </div>
        
        <div className="graph-pane">
          <ReactFlow nodes={nodes} edges={edges} fitView>
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

export default App;
