import * as vscode from 'vscode';
import { AlpParser } from '@alp/parser';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('ALP Language Support is now active.');

  diagnosticCollection = vscode.languages.createDiagnosticCollection('alp');
  context.subscriptions.push(diagnosticCollection);

  // Validate on open
  if (vscode.window.activeTextEditor) {
    validateDocument(vscode.window.activeTextEditor.document);
  }

  // Validate when a document is opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === 'alp') {
        validateDocument(doc);
      }
    })
  );

  // Validate when a document is changed
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'alp') {
        validateDocument(event.document);
      }
    })
  );

  // Clear diagnostics when document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnosticCollection.delete(doc.uri);
    })
  );

  // Validate all open .alp documents on activation
  vscode.workspace.textDocuments.forEach((doc) => {
    if (doc.languageId === 'alp') {
      validateDocument(doc);
    }
  });
}

function validateDocument(document: vscode.TextDocument) {
  if (document.languageId !== 'alp') {
    return;
  }

  const text = document.getText();
  const diagnostics: vscode.Diagnostic[] = [];

  try {
    const parser = new AlpParser();
    parser.parseAndValidate(text);
    // No errors — clear diagnostics
  } catch (err: any) {
    const message = err.message || 'Unknown ALP error';

    // Try to extract the line number from our custom SyntaxError format
    // Our errors look like: "message at line N"
    let line = 0;
    const lineMatch = message.match(/at line (\d+)/);
    if (lineMatch) {
      line = Math.max(0, parseInt(lineMatch[1], 10) - 1); // VS Code is 0-indexed
    }

    // Ensure line is within document bounds
    if (line >= document.lineCount) {
      line = document.lineCount - 1;
    }

    const range = document.lineAt(line).range;

    const severity = message.includes('Validation failed')
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Error;

    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = 'ALP';
    diagnostics.push(diagnostic);
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
