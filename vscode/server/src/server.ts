import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  DefinitionParams,
  Location,
  Range,
  Position,
  Diagnostic,
  DiagnosticSeverity,
  Hover,
  HoverParams,
  RenameParams,
  WorkspaceEdit,
  TextEdit,
  SymbolInformation,
  SymbolKind,
  DocumentSymbolParams,
  DocumentSymbol,
  SemanticTokensParams,
  SemanticTokensBuilder,
  SemanticTokens,
  CodeActionParams,
  CodeAction,
  CodeActionKind,
  CompletionParams,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { AlpParser, AlpObject } from '@alp/parser';
import * as fs from 'fs';
import * as path from 'path';

// ─── Connection Setup ────────────────────────────────────────────────────────
const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// ─── Workspace Index ────────────────────────────────────────────────────────
interface SymbolEntry {
  id: string;
  type: string;
  uri: string;
  line: number;
  properties: Record<string, any>;
}

let workspaceIndex: Map<string, SymbolEntry> = new Map();
let workspaceRoot: string = '';

// ─── Block Type Registry ─────────────────────────────────────────────────────
const BLOCK_TYPES: Record<string, string> = {
  project: 'Defines the top-level project configuration, including goals, features, and metadata.',
  task: 'A unit of work that can be assigned to an agent. Has dependencies, acceptance criteria, and verification steps.',
  feature: 'A high-level product capability composed of multiple tasks.',
  workflow: 'Defines the step-by-step process agents follow (e.g., standard development lifecycle).',
  agent: 'An autonomous role with defined capabilities, permissions, and responsibilities.',
  memory: 'A piece of persistent knowledge stored across agent sessions.',
  state: 'Tracks the current state of the project, including active workflows and recent changes.',
  artifact: 'A tangible output produced by a task or workflow (e.g., a document, binary, or deployment).',
  decision: 'A recorded architectural decision with context, alternatives, and rationale.',
  constraint: 'An immutable rule that restricts how the system can evolve.',
  verification: 'A testable acceptance criterion for a task or feature.',
  dependency: 'Declares a hard or soft dependency on another object.',
  resource: 'A shared resource (API endpoint, database, service) consumed by tasks.',
  event: 'A lifecycle event emitted by the runtime or an agent.',
  goal: 'A high-level objective the project is working toward.',
  context: 'A scoped set of variables and rules available to a workflow or agent.',
  rule: 'An architectural constraint that must always be satisfied.',
  plugin: 'An extension module that adds custom object types or tool integrations.',
  policy: 'A governance rule that controls which actions are allowed, denied, or warned.',
  timeline: 'A declarative schedule for triggering events or actions using cron or one-shot triggers.',
  contract: 'A runtime boundary contract defining least-privilege access between two entities.',
  vault: 'An encrypted secrets store with recipient-scoped X25519 envelope + AES-256-GCM.',
  type: 'Declares a custom object type with custom properties and validation.',
  macro: 'A dynamic object generator that produces objects from templates.',
  repo: 'A remote Git repository used for cross-repository orchestration.',
  swarm: 'A coordinated group of agents executing tasks concurrently.',
  package: 'A distributable plugin package with versioned dependencies.',
  plan: 'A structured execution plan with ranked steps and dependencies.',
  lesson: 'A post-run self-critique record capturing what went wrong and how to improve.',
  offer: 'A negotiation offer from one agent to another with terms and constraints.',
  trace: 'A signed execution trace for end-to-end provenance tracking.',
  migration: 'A live upgrade manifest defining steps and rollback procedures for version migration.',
};

const DIRECTIVE_DESCRIPTIONS: Record<string, string> = {
  '!alp-version': 'Declares the ALP specification version this file conforms to (e.g., `!alp-version: 3.0.0`).',
  '!import': 'Imports another `.alp` file or remote URL into the current workspace.',
  '!deprecated': 'Marks the following object as deprecated with a migration note (V8+).',
  '!assert': 'Declares a boolean precondition that must hold true or parsing fails (fail-closed since V9).',
  '!if': 'Conditionally includes the next top-level object based on an ALPEL boolean expression.',
  '!integrity': 'Declares a SHA-256 integrity hash for a remote import, verified on load.',
};

// ─── Initialization ──────────────────────────────────────────────────────────
connection.onInitialize((params: InitializeParams): InitializeResult => {
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    workspaceRoot = new URL(params.workspaceFolders[0].uri).pathname;
    if (workspaceRoot.match(/^\/[A-Za-z]:\//)) {
      workspaceRoot = workspaceRoot.substring(1);
    }
    workspaceRoot = decodeURIComponent(workspaceRoot);
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['-', '>', '@', ' '],
      },
      definitionProvider: true,
      hoverProvider: true,
      renameProvider: { prepareProvider: false },
      workspaceSymbolProvider: true,
      documentSymbolProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: ['keyword', 'type', 'variable', 'string', 'property'],
          tokenModifiers: ['declaration']
        },
        full: true
      },
      codeActionProvider: true,
    },
  };
});

connection.onInitialized(() => {
  indexWorkspace();
});

// ─── Workspace Indexer ──────────────────────────────────────────────────────
function indexWorkspace() {
  workspaceIndex.clear();
  const alpDir = path.join(workspaceRoot, '.alp');
  if (!fs.existsSync(alpDir)) return;

  indexDirectory(alpDir);
}

function indexDirectory(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      indexDirectory(fullPath);
    } else if (entry.name.endsWith('.alp')) {
      indexFile(fullPath);
    }
  }
}

function indexFile(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const uri = 'file:///' + filePath.replace(/\\/g, '/');
    const parser = new AlpParser();
    const objects = parser.parse(content);
    const lines = content.split('\n');

    for (const obj of objects) {
      if (obj.id) {
        let objLine = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === `@${obj._type}`) {
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
              if (lines[j].trim().startsWith('id:') && lines[j].includes(obj.id)) {
                objLine = i;
                break;
              }
            }
            if (objLine > 0) break;
          }
        }

        workspaceIndex.set(obj.id, {
          id: obj.id,
          type: obj._type,
          uri,
          line: objLine,
          properties: obj,
        });
      }
    }
  } catch {
    // Silently skip files with parse errors during indexing
  }
}

// ─── Diagnostics ────────────────────────────────────────────────────────────
documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

function validateDocument(doc: TextDocument) {
  const diagnostics: Diagnostic[] = [];
  const text = doc.getText();

  try {
    const parser = new AlpParser();
    parser.parse(text);
  } catch (err: any) {
    const message = err.message || 'Unknown ALP error';
    let line = 0;
    const lineMatch = message.match(/at line (\d+)/);
    if (lineMatch) {
      line = Math.max(0, parseInt(lineMatch[1], 10) - 1);
    }
    if (line >= doc.lineCount) {
      line = doc.lineCount - 1;
    }

    diagnostics.push({
      severity: message.includes('Validation')
        ? DiagnosticSeverity.Warning
        : DiagnosticSeverity.Error,
      range: Range.create(line, 0, line, Number.MAX_SAFE_INTEGER),
      message,
      source: 'ALP',
    });
  }

  // Check for unresolved references
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const refMatch = lines[i].match(/->\s+([a-zA-Z0-9_-]+)/);
    if (refMatch) {
      const refId = refMatch[1];
      if (!workspaceIndex.has(refId)) {
        const col = lines[i].indexOf(refId);
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: Range.create(i, col, i, col + refId.length),
          message: `Unresolved reference: '${refId}'`,
          source: 'ALP',
        });
      }
    }

    // Check for status markers missing reasons (V9+)
    const blockedMatch = lines[i].match(/\[\!\](?!\s+\S)/);
    if (blockedMatch && blockedMatch.index !== undefined) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: Range.create(i, blockedMatch.index, i, blockedMatch.index + 3),
        message: "Status marker '[!]' requires a reason (e.g. '[!] waiting for review'). Mandatory since v9.0.0.",
        source: 'ALP',
      });
    }
    const humanGateMatch = lines[i].match(/\[\?\](?!\s+\S)/);
    if (humanGateMatch && humanGateMatch.index !== undefined) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: Range.create(i, humanGateMatch.index, i, humanGateMatch.index + 3),
        message: "Status marker '[?]' requires a reason (e.g. '[?] awaiting human approval'). Mandatory since v9.0.0.",
        source: 'ALP',
      });
    }
  }

  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

// ─── Go to Definition ───────────────────────────────────────────────────────
connection.onDefinition((params: DefinitionParams): Location | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const line = doc.getText(Range.create(params.position.line, 0, params.position.line, Number.MAX_SAFE_INTEGER));

  const refMatch = line.match(/->\s+([a-zA-Z0-9_-]+)/);
  if (refMatch) {
    const targetId = refMatch[1];
    const entry = workspaceIndex.get(targetId);
    if (entry) {
      return Location.create(
        entry.uri,
        Range.create(entry.line, 0, entry.line, 0)
      );
    }
  }

  return null;
});

// ─── Hover ──────────────────────────────────────────────────────────────────
connection.onHover((params: HoverParams): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const line = doc.getText(Range.create(params.position.line, 0, params.position.line, Number.MAX_SAFE_INTEGER));

  // Hover over `-> some-id` to see details
  const refMatch = line.match(/->\s+([a-zA-Z0-9_-]+)/);
  if (refMatch) {
    const targetId = refMatch[1];
    const entry = workspaceIndex.get(targetId);
    if (entry) {
      const details = [
        `**@${entry.type}** \`${entry.id}\``,
        '',
        entry.properties.description ? entry.properties.description : '',
        entry.properties.status ? `Status: \`${entry.properties.status}\`` : '',
        entry.properties.owner ? `Owner: \`${entry.properties.owner}\`` : '',
        entry.properties.priority ? `Priority: \`${entry.properties.priority}\`` : '',
      ].filter(Boolean).join('\n');

      return { contents: { kind: 'markdown', value: details } };
    }
  }

  // Hover over @type block markers
  const blockMatch = line.match(/^@([a-z_]+)$/);
  if (blockMatch) {
    const desc = BLOCK_TYPES[blockMatch[1]];
    if (desc) {
      return { contents: { kind: 'markdown', value: `**@${blockMatch[1]}**\n\n${desc}` } };
    }
  }

  // Hover over directives
  const directiveMatch = line.match(/^\\s+(![a-zA-Z_][a-zA-Z0-9_-]*)/);
  if (directiveMatch) {
    const desc = DIRECTIVE_DESCRIPTIONS[directiveMatch[1]];
    if (desc) {
      return { contents: { kind: 'markdown', value: `**${directiveMatch[1]}**\n\n${desc}` } };
    }
  }

  return null;
});

// ─── Completion (IntelliSense) ──────────────────────────────────────────────
connection.onCompletion((params: CompletionParams): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const lineStr = doc.getText(Range.create(params.position.line, 0, params.position.line, Number.MAX_SAFE_INTEGER));
  const textBeforeCursor = lineStr.substring(0, params.position.character);
  
  const items: CompletionItem[] = [];

  if (textBeforeCursor.match(/->\s*$/)) {
    // Suggest all known IDs when user types `-> `
    for (const [id, entry] of workspaceIndex) {
      items.push({
        label: id,
        kind: CompletionItemKind.Reference,
        detail: `@${entry.type}`,
        documentation: entry.properties.description || `Reference to @${entry.type} ${id}`,
        insertText: id,
      });
    }
  } else if (textBeforeCursor.match(/^@$/)) {
    // Suggest block markers
    const blockTypes = [
      'project', 'task', 'feature', 'workflow', 'agent',
      'memory', 'state', 'artifact', 'decision', 'constraint',
      'verification', 'dependency', 'resource', 'event', 'goal',
      'context', 'rule', 'plugin', 'policy', 'timeline',
      'contract', 'vault', 'type', 'macro', 'repo',
      'swarm', 'package', 'plan', 'lesson', 'offer',
      'trace', 'migration',
    ];
    for (const t of blockTypes) {
      items.push({
        label: t,
        kind: CompletionItemKind.Keyword,
        detail: 'ALP Block Marker',
        insertText: `${t}\n  id: `,
      });
    }
  } else if (textBeforeCursor.match(/^\\s+!$/)) {
    // Suggest directives
    const directives = [
      '!alp-version', '!import', '!deprecated', '!assert', '!if', '!integrity',
    ];
    for (const d of directives) {
      items.push({
        label: d,
        kind: CompletionItemKind.Keyword,
        detail: 'ALP Directive',
        insertText: d,
      });
    }
  }

  return items;
});

// ─── Rename ──────────────────────────────────────────────────────────────────
connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const line = doc.getText(Range.create(params.position.line, 0, params.position.line, Number.MAX_SAFE_INTEGER));
  
  let oldId = '';
  let refMatch = line.match(/->\s+([a-zA-Z0-9_-]+)/);
  if (refMatch && params.position.character >= line.indexOf(refMatch[1])) {
    oldId = refMatch[1];
  } else {
    let idMatch = line.match(/id:\\s*([a-zA-Z0-9_-]+)/);
    if (idMatch && params.position.character >= line.indexOf(idMatch[1])) {
      oldId = idMatch[1];
    }
  }

  if (!oldId || !workspaceIndex.has(oldId)) return null;

  const newId = params.newName;
  const changes: Record<string, TextEdit[]> = {};

  const alpDir = path.join(workspaceRoot, '.alp');
  if (fs.existsSync(alpDir)) {
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (fullPath.endsWith('.alp')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\\n');
          const uri = 'file:///' + fullPath.replace(/\\\\/g, '/');
          const edits: TextEdit[] = [];
          
          for (let i = 0; i < lines.length; i++) {
             const idRegex = new RegExp(`^(\\s*id:\\s*)${oldId}(\\s*)$`);
             let match = lines[i].match(idRegex);
             if (match) {
                edits.push(TextEdit.replace(
                  Range.create(i, match[1].length, i, match[1].length + oldId.length),
                  newId
                ));
             }
             const refRegex = new RegExp(`(->\\s+)${oldId}\\b`, 'g');
             let rMatch;
             while ((rMatch = refRegex.exec(lines[i])) !== null) {
                edits.push(TextEdit.replace(
                  Range.create(i, rMatch.index + rMatch[1].length, i, rMatch.index + rMatch[1].length + oldId.length),
                  newId
                ));
             }
          }
          if (edits.length > 0) changes[uri] = edits;
        }
      }
    };
    walk(alpDir);
  }

  return { changes };
});

// ─── Workspace Symbols ──────────────────────────────────────────────────────
connection.onWorkspaceSymbol((params) => {
  const query = params.query.toLowerCase();
  const symbols: SymbolInformation[] = [];
  for (const [id, entry] of workspaceIndex) {
    if (id.toLowerCase().includes(query) || entry.type.toLowerCase().includes(query)) {
      symbols.push(SymbolInformation.create(
        id,
        SymbolKind.Object,
        Range.create(entry.line, 0, entry.line, id.length),
        entry.uri,
        entry.type
      ));
    }
  }
  return symbols;
});

// ─── Document Symbols ───────────────────────────────────────────────────────
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];
  for (const [id, entry] of workspaceIndex) {
    if (entry.uri === params.textDocument.uri) {
      symbols.push(DocumentSymbol.create(
        id,
        `@${entry.type}`,
        SymbolKind.Object,
        Range.create(entry.line, 0, entry.line + 5, 0),
        Range.create(entry.line, 0, entry.line, id.length)
      ));
    }
  }
  return symbols;
});

// ─── Semantic Tokens ────────────────────────────────────────────────────────
connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
  const builder = new SemanticTokensBuilder();
  const doc = documents.get(params.textDocument.uri);
  if (doc) {
    const lines = doc.getText().split('\\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const typeMatch = line.match(/^@([a-z_]+)$/);
      if (typeMatch) {
        builder.push(i, 0, typeMatch[0].length, 0, 0);
      }
      const propMatch = line.match(/^(\\s*)([a-z_!][a-z0-9_-]*):\\s*(.*)$/);
      if (propMatch) {
        const propName = propMatch[2];
        if (propName.startsWith('!')) {
          builder.push(i, propMatch[1].length, propName.length, 3, 0);
        } else {
          builder.push(i, propMatch[1].length, propName.length, 4, 0);
        }
      }
      const refRegex = /(->\\s+)([a-zA-Z0-9_-]+)/g;
      let refMatch;
      while ((refMatch = refRegex.exec(line)) !== null) {
         builder.push(i, refMatch.index, 2, 0, 0);
         builder.push(i, refMatch.index + refMatch[1].length, refMatch[2].length, 2, 0);
      }
    }
  }
  return builder.build();
});

// ─── Code Actions (Quick Fixes) ─────────────────────────────────────────────
connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  const actions: CodeAction[] = [];
  for (const diag of params.context.diagnostics) {
    if (diag.message.startsWith('Unresolved reference:')) {
      const match = diag.message.match(/'([^']+)'/);
      if (match) {
        const badId = match[1];
        for (const [id] of workspaceIndex) {
          if (id.includes(badId) || badId.includes(id) || 
              id.substring(0, 3) === badId.substring(0, 3)) {
            actions.push(CodeAction.create(
              `Change to '${id}'`,
              {
                changes: {
                  [params.textDocument.uri]: [
                    TextEdit.replace(diag.range, id)
                  ]
                }
              },
              CodeActionKind.QuickFix
            ));
          }
        }
      }
    }
  }
  return actions;
});

// ─── File Watcher (re-index when .alp files change) ──────────────────────────
documents.onDidSave(() => {
  indexWorkspace();
});

// ─── Start ──────────────────────────────────────────────────────────────────
documents.listen(connection);
connection.listen();
