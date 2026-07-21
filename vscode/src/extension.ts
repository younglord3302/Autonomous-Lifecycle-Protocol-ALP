import * as vscode from 'vscode';
import * as path from 'path';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('ALP Language Support v15.2.0 is now active.');

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
  statusBar.text = '$(symbol-misc) ALP';
  statusBar.tooltip = 'Autonomous Lifecycle Protocol — Active';
  statusBar.show();
  context.subscriptions.push(statusBar);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
