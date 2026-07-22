import * as vscode from 'vscode';
import * as path from 'path';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { AlpParser, AlpGraph } from '@alp/parser';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
  console.log('ALP Language Support v16.0.0 is now active.');

  // ─── Language Server ────────────────────────────────────────────────
  const serverModule = context.asAbsolutePath(path.join('server', 'dist', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'alp' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.alp'),
    },
  };

  client = new LanguageClient(
    'alpLanguageServer',
    'ALP Language Server',
    serverOptions,
    clientOptions
  );

  client.start();

  // ─── Status Bar ─────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(graph) ALP DAG';
  statusBar.tooltip = 'Click to open ALP Interactive Visualizer';
  statusBar.command = 'alp.showVisualizer';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ─── Register alp.showVisualizer Webview Command ────────────────────
  const visualizerCmd = vscode.commands.registerCommand('alp.showVisualizer', () => {
    const editor = vscode.window.activeTextEditor;
    const documentText = editor ? editor.document.getText() : '';

    const panel = vscode.window.createWebviewPanel(
      'alpVisualizer',
      'ALP Interactive DAG Visualizer',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    let parsedGraphHtml = '';
    try {
      if (documentText.trim()) {
        const parser = new AlpParser();
        const objects = parser.parseAndValidate(documentText);
        const graph = new AlpGraph();
        graph.buildGraph(objects);

        const nodesHtml = objects
          .map((o) => {
            const status = o.status || '[ ]';
            const cls = status === '[x]' ? 'done' : status === '[~]' ? 'progress' : status === '[!]' ? 'blocked' : 'todo';
            return `<div class="node-card ${cls}"><span class="badge">@${o._type}</span><div class="title">${o.id}</div><span class="status-tag">${status}</span></div>`;
          })
          .join('');

        parsedGraphHtml = `<div class="nodes-grid">${nodesHtml}</div>`;
      } else {
        parsedGraphHtml = `<div class="placeholder">Open an .alp specification file to view its live dependency graph.</div>`;
      }
    } catch (err: any) {
      parsedGraphHtml = `<div class="error-box">⚠️ Syntax / Validation Error: ${err.message || err}</div>`;
    }

    panel.webview.html = getWebviewContent(parsedGraphHtml);
  });

  // ─── Register alp.checkPolicy Command ─────────────────────────────
  const policyCmd = vscode.commands.registerCommand('alp.checkPolicy', async () => {
    const editor = vscode.window.activeTextEditor;
    const filePath = editor ? editor.document.uri.fsPath : '';
    
    if (!filePath) {
      vscode.window.showInformationMessage('ALP Policy Check: No active file open to check.');
      return;
    }

    try {
      const parser = new AlpParser();
      const text = editor ? editor.document.getText() : '';
      const objects = parser.parseAndValidate(text);
      const policies = objects.filter((o: any) => o._type === 'policy');

      if (policies.length === 0) {
        vscode.window.showInformationMessage(`ALP Policy Check: Permitted (No policies declared in file)`);
      } else {
        vscode.window.showInformationMessage(`ALP Policy Check: Found ${policies.length} policy object(s) in active spec.`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`ALP Policy Check Error: ${err.message || err}`);
    }
  });

  // ─── Register alp.showTimelines Command ───────────────────────────
  const timelinesCmd = vscode.commands.registerCommand('alp.showTimelines', () => {
    const editor = vscode.window.activeTextEditor;
    const documentText = editor ? editor.document.getText() : '';

    const panel = vscode.window.createWebviewPanel(
      'alpTimelines',
      'ALP Scheduled Timelines',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    let html = '';
    try {
      if (documentText.trim()) {
        const parser = new AlpParser();
        const objects = parser.parseAndValidate(documentText);
        const timelines = objects.filter((o: any) => o._type === 'timeline');

        if (timelines.length === 0) {
          html = `<div class="placeholder">No @timeline objects declared in this file.</div>`;
        } else {
          const list = timelines.map((t: any) => `
            <div class="node-card progress">
              <span class="badge">@timeline</span>
              <div class="title">${t.id}</div>
              <div><strong>Cron:</strong> <code>${t.cron || t.at || 'N/A'}</code></div>
              <div>${t.description || ''}</div>
            </div>
          `).join('');
          html = `<div class="nodes-grid">${list}</div>`;
        }
      } else {
        html = `<div class="placeholder">Open an .alp specification file to view timelines.</div>`;
      }
    } catch (err: any) {
      html = `<div class="error-box">⚠️ Parsing Error: ${err.message || err}</div>`;
    }

    panel.webview.html = getWebviewContent(html);
  });

  context.subscriptions.push(visualizerCmd, policyCmd, timelinesCmd);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

function getWebviewContent(graphHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALP Visualizer</title>
<style>
  body {
    background: #090a10;
    color: #f0f4fd;
    font-family: system-ui, -apple-system, sans-serif;
    padding: 20px;
    margin: 0;
  }
  h2 { font-size: 1.1rem; color: #00f0ff; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .nodes-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }
  .node-card {
    background: #131625;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  }
  .node-card.done { border-color: rgba(16, 185, 129, 0.4); box-shadow: 0 0 12px rgba(16, 185, 129, 0.2); }
  .node-card.progress { border-color: rgba(0, 240, 255, 0.4); box-shadow: 0 0 12px rgba(0, 240, 255, 0.2); }
  .node-card.blocked { border-color: rgba(244, 63, 94, 0.4); box-shadow: 0 0 12px rgba(244, 63, 94, 0.2); }
  .badge { font-size: 0.7rem; font-family: monospace; color: #9d4edd; font-weight: bold; }
  .title { font-size: 0.95rem; font-weight: 700; word-break: break-all; }
  .status-tag { font-size: 0.75rem; font-family: monospace; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); align-self: flex-start; }
  .placeholder { padding: 40px; text-align: center; color: #7e89a3; border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; }
  .error-box { padding: 16px; background: rgba(244,63,94,0.15); border: 1px solid rgba(244,63,94,0.4); color: #fecdd3; border-radius: 8px; font-family: monospace; font-size: 0.85rem; }
</style>
</head>
<body>
  <h2>⚡ ALP Interactive DAG Visualizer Panel</h2>
  ${graphHtml}
</body>
</html>`;
}
