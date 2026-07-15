"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const parser_1 = require("@alp/parser");
const fs = require("fs");
const path = require("path");
// ─── Connection Setup ───────────────────────────────────────────────────────
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let workspaceIndex = new Map();
let workspaceRoot = '';
// ─── Initialization ─────────────────────────────────────────────────────────
connection.onInitialize((params) => {
    if (params.workspaceFolders && params.workspaceFolders.length > 0) {
        workspaceRoot = new URL(params.workspaceFolders[0].uri).pathname;
        // Fix Windows paths (remove leading slash from /C:/...)
        if (workspaceRoot.match(/^\/[A-Za-z]:\//)) {
            workspaceRoot = workspaceRoot.substring(1);
        }
        workspaceRoot = decodeURIComponent(workspaceRoot);
    }
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            completionProvider: {
                triggerCharacters: ['-', '>', '@', ' '],
            },
            definitionProvider: true,
            hoverProvider: true,
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
    if (!fs.existsSync(alpDir))
        return;
    indexDirectory(alpDir);
}
function indexDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            indexDirectory(fullPath);
        }
        else if (entry.name.endsWith('.alp')) {
            indexFile(fullPath);
        }
    }
}
function indexFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const uri = 'file:///' + filePath.replace(/\\/g, '/');
        const parser = new parser_1.AlpParser();
        const objects = parser.parse(content);
        const lines = content.split('\n');
        for (const obj of objects) {
            if (obj.id) {
                // Find the line number where this object's @type marker appears
                let objLine = 0;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim() === `@${obj._type}`) {
                        // Check if the next few lines contain this id
                        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                            if (lines[j].trim().startsWith('id:') && lines[j].includes(obj.id)) {
                                objLine = i;
                                break;
                            }
                        }
                        if (objLine > 0)
                            break;
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
    }
    catch {
        // Silently skip files with parse errors during indexing
    }
}
// ─── Diagnostics ────────────────────────────────────────────────────────────
documents.onDidChangeContent((change) => {
    validateDocument(change.document);
});
function validateDocument(doc) {
    const diagnostics = [];
    const text = doc.getText();
    try {
        const parser = new parser_1.AlpParser();
        parser.parse(text);
    }
    catch (err) {
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
                ? node_1.DiagnosticSeverity.Warning
                : node_1.DiagnosticSeverity.Error,
            range: node_1.Range.create(line, 0, line, Number.MAX_SAFE_INTEGER),
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
                    severity: node_1.DiagnosticSeverity.Warning,
                    range: node_1.Range.create(i, col, i, col + refId.length),
                    message: `Unresolved reference: '${refId}'`,
                    source: 'ALP',
                });
            }
        }
    }
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}
// ─── Go to Definition ───────────────────────────────────────────────────────
connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return null;
    const line = doc.getText(node_1.Range.create(params.position.line, 0, params.position.line, Number.MAX_SAFE_INTEGER));
    // Match `-> some-id` references
    const refMatch = line.match(/->\s+([a-zA-Z0-9_-]+)/);
    if (refMatch) {
        const targetId = refMatch[1];
        const entry = workspaceIndex.get(targetId);
        if (entry) {
            return node_1.Location.create(entry.uri, node_1.Range.create(entry.line, 0, entry.line, 0));
        }
    }
    return null;
});
// ─── Hover ──────────────────────────────────────────────────────────────────
connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return null;
    const line = doc.getText(node_1.Range.create(params.position.line, 0, params.position.line, Number.MAX_SAFE_INTEGER));
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
            ].filter(Boolean).join('\n');
            return { contents: { kind: 'markdown', value: details } };
        }
    }
    // Hover over @type block markers
    const blockMatch = line.match(/^@([a-z_]+)$/);
    if (blockMatch) {
        const typeDescriptions = {
            project: 'Defines the top-level project configuration, including goals, features, and metadata.',
            task: 'A unit of work that can be assigned to an agent. Has dependencies, acceptance criteria, and verification steps.',
            feature: 'A high-level product capability composed of multiple tasks.',
            workflow: 'Defines the step-by-step process agents follow (e.g., standard development lifecycle).',
            agent: 'An autonomous role with defined capabilities, permissions, and responsibilities.',
            memory: 'A piece of persistent knowledge stored across agent sessions.',
            state: 'Tracks the current state of the project, including active workflows and recent changes.',
            goal: 'A high-level objective the project is working toward.',
            rule: 'An architectural constraint that must always be satisfied.',
            decision: 'A recorded architectural decision with context, alternatives, and rationale.',
            plugin: 'An extension module that adds custom object types or tool integrations.',
        };
        const desc = typeDescriptions[blockMatch[1]];
        if (desc) {
            return { contents: { kind: 'markdown', value: `**@${blockMatch[1]}**\n\n${desc}` } };
        }
    }
    return null;
});
// ─── Completion (IntelliSense) ──────────────────────────────────────────────
connection.onCompletion(() => {
    const items = [];
    // Suggest all known IDs when user types `-> `
    for (const [id, entry] of workspaceIndex) {
        items.push({
            label: id,
            kind: node_1.CompletionItemKind.Reference,
            detail: `@${entry.type}`,
            documentation: entry.properties.description || `Reference to @${entry.type} ${id}`,
            insertText: id,
        });
    }
    // Suggest block markers
    const blockTypes = [
        'project', 'task', 'feature', 'workflow', 'agent',
        'memory', 'state', 'goal', 'rule', 'decision', 'plugin',
    ];
    for (const t of blockTypes) {
        items.push({
            label: `@${t}`,
            kind: node_1.CompletionItemKind.Keyword,
            detail: 'ALP Block Marker',
            insertText: `@${t}\n  id: `,
        });
    }
    return items;
});
// ─── File Watcher (re-index when .alp files change) ─────────────────────────
documents.onDidSave(() => {
    indexWorkspace();
});
// ─── Start ──────────────────────────────────────────────────────────────────
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map