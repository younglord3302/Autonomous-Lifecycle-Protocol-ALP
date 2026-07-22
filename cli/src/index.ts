#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { validateCommand } from './commands/validate';
import { graphCommand } from './commands/graph';
import { statusCommand } from './commands/status';
import { runCommand } from './commands/run';
import { installCommand } from './commands/install';
import { uninstallCommand } from './commands/uninstall';
import { publishCommand } from './commands/publish';
import { exportCommand } from './commands/export';
import { lintCommand } from './commands/lint';
import { verifyCommand } from './commands/verify';
import { doctorCommand } from './commands/doctor';
import { upgradeCommand } from './commands/upgrade';
import { importCommand } from './commands/import';
import { checkpointCommand } from './commands/checkpoint';
import { serveCommand } from './commands/serve';
import { evolveCommand } from './commands/evolve';
import { policyCommand } from './commands/policy';
import { scheduleCommand } from './commands/schedule';
import { swarmCommand } from './commands/swarm';
import { repoCommand } from './commands/repo';
import { registryCommand } from './commands/registry';
import { keysCommand } from './commands/keys';
import { testHarnessCommand } from './commands/test-harness';
import { replayCommand } from './commands/replay';
import { visualizeCommand } from './commands/visualize';
import { pluginCommand } from './commands/plugin';
import { costCommand } from './commands/cost';
import { debugCommand } from './commands/debug';
import { bridgeCommand } from './commands/bridge';
import { domainTrustCommand } from './commands/domain-trust';
import { governanceCommand } from './commands/governance';
import { tenantCommand } from './commands/tenant';
import { healingCommand } from './commands/healing';
import { resilienceCommand } from './commands/resilience';
import { identityCommand } from './commands/identity';
import { p2pCommand } from './commands/p2p';
import { tuiCommand } from './commands/tui';
import { registerTraceCommand } from './commands/trace';
import { registerZKCommand } from './commands/zk';
import { registerVectorCommand } from './commands/vector';
import { registerDIDCommand } from './commands/did';
import { registerCRDTSyncCommand } from './commands/crdt-sync';
import { registerHealCommand } from './commands/heal';
import { registerFormalVerifyCommand } from './commands/formal-verify';
import { registerAssetCommand } from './commands/asset';
import { registerBudgetCommand } from './commands/budget';
import { registerSandboxCommand } from './commands/sandbox';
import { registerTenantMeshCommand } from './commands/tenant-mesh';
import { registerDecomposeCommand } from './commands/decompose';
import { registerEdgeCommand } from './commands/edge';
import { registerCodeIndexCommand } from './commands/code-index';
import { registerEvalSuiteCommand } from './commands/eval-suite';
import { registerPromptOptimizerCommand } from './commands/prompt-optimizer';
import { registerConsensusVoteCommand } from './commands/consensus-vote';
import { registerCodeTransformCommand } from './commands/code-transform';
import { registerEventMeshCommand } from './commands/event-mesh';
import { registerSwarmMarketplaceCommand } from './commands/swarm-marketplace';
const program = new Command();

program
  .name('alp')
  .description('Autonomous Lifecycle Protocol (ALP) CLI')
  .version('36.0.0');

program
  .command('init')
  .description('Initialize a new ALP project in the current directory')
  .action(initCommand);

program
  .command('validate')
  .description('Validate all .alp files against schemas')
  .argument('[file]', 'Optional specific file to validate')
  .action(validateCommand);

program
  .command('lint')
  .description('Lint the ALP workspace for style conventions and best practices')
  .action(lintCommand);

program
  .command('verify')
  .description('Execute quality gates and verification scripts for a task')
  .argument('<taskId>', 'The ID of the task to verify')
  .option('--formal <policyId>', 'Run formal model-checking verification for a policy (v10.9.0)')
  .action(verifyCommand);

program
  .command('doctor')
  .description('Diagnose workspace health and environment configuration')
  .action(doctorCommand);

program
  .command('upgrade')
  .description('Upgrade legacy ALP files to the latest specification version')
  .action(upgradeCommand);

program
  .command('import')
  .description('Import legacy markdown rules (.cursorrules, etc.) into ALP format')
  .argument('[file]', 'Optional specific file to import')
  .action(importCommand);

program
  .command('graph')
  .description('Visualize the project dependency graph')
  .argument('[file]', 'Optional specific file to graph')
  .action(graphCommand);

program
  .command('status')
  .description('Show project state and progress')
  .action(statusCommand);

program
  .command('run')
  .description('Execute a task by compiling its full context bundle')
  .argument('[task]', 'Task ID to execute (auto-selects next available if omitted)')
  .option('--agent <agent>', 'Override the assigned agent')
  .option('--dry-run', 'Preview the context bundle without executing')
  .option('--concurrent <n>', 'Number of parallel agent loops (v3 swarm mode)', parseInt)
  .option('--provider <provider>', 'LLM provider to use for native execution (openai, anthropic, ollama)')
  .option('--model <model>', 'LLM model to use with the selected provider')
  .option('--swarm <id>', 'Join the named networked swarm (v4 Pillar 1) and coordinate claims via a coordinator')
  .action((task, opts) => runCommand(task, opts));

program
  .command('checkpoint')
  .description('Report a task status update from an agent (used in swarm mode)')
  .argument('<taskId>', 'The ID of the task to update')
  .argument('[status]', 'New status: done, blocked, in-progress, review, todo')
  .argument('[message]', 'Optional message to log to the runtime log')
  .option('--ask-human', 'Pause for human review: mark the task [ ?] and stop the loop')
  .action(checkpointCommand);

program
  .command('serve')
  .description('Run the ALP State Server: a live dashboard for the swarm (v3 Pillar 4)')
  .option('--port <n>', 'Port to listen on (default 4000)', (v) => parseInt(v, 10))
  .option('--host <host>', 'Host to bind to (default 127.0.0.1)')
  .option('--db', 'Persist a durable state store of runtime events for analytics (v4 Pillar 5)')
  .option('--registry', 'Host the ALP package registry over HTTP (v4 Pillar 3)')
  .option('--registry-token <token>', 'Require this bearer token on all /api/registry requests (spec/14 §4.2)')
  .option('--registry-sign-key <file>', 'Ed25519 private key (PEM) to sign published versions on the host (v4.1)')
  .action((opts) => serveCommand(opts));

program
  .command('evolve')
  .description('Analyze runtime telemetry and propose self-improvements (v3 Pillar 5)')
  .option('--apply', 'Write proposed rules to .alp/evolved.alp')
  .option('--from-pr <n>', 'Extract rules from a GitHub PR (requires provider)')
  .action((opts) => evolveCommand(opts));

program
  .command('policy')
  .description('List or evaluate policy guardrails governing agent actions (v4; v2 in v8.1.0)')
  .option('--path <path>', 'Check whether a file path may be modified')
  .option('--command <cmd>', 'Check whether a shell command may be run')
  .option('--agent <agent>', 'Scope the check to a specific agent')
  .option('--proposal <id>', 'v8.1.0: verify a signed action proposal by id')
  .option('--trust <pem>', 'v8.1.0: trust root (ns=pem) for proposal verification')
  .action((opts) => policyCommand(opts));

program
  .command('schedule')
  .description('List and evaluate @timeline schedules (v8.2.0)')
  .option('--next', 'Show only timelines that are due at the current time')
  .option('--enable <id>', 'Enable a disabled @timeline by id')
  .option('--disable <id>', 'Disable an enabled @timeline by id')
  .option('--at <iso>', 'Evaluate schedules as of a fixed ISO datetime (testing)')
  .action((opts) => scheduleCommand(opts));

program
  .command('swarm')
  .description('Manage membership in a networked swarm (v4 Pillar 1)')
  .argument('[subcommand]', 'join | leave | roster (default roster)')
  .argument('[swarm]', 'Swarm id (first @swarm in the workspace if omitted)')
  .option('--coordinator <url>', 'Coordinator base URL (overrides @swarm coordinator)')
  .option('--token <token>', 'Bearer token for the coordinator')
  .option('--node <id>', 'This node id')
  .action((sub, swarm, opts) => swarmCommand(sub, swarm, opts));

program
  .command('repo')
  .description('Cross-repository orchestration: discover, fetch, and resolve external repos (v4 Pillar 2)')
  .argument('[subcommand]', 'ls | fetch | resolve | graph (default resolve)')
  .option('--fetch', 'Fetch/update Git-backed repos before resolving')
  .action((sub, opts) => repoCommand(sub, opts));

program
  .command('registry')
  .description('Hosted registry & marketplace: serve, publish, list, search, install (v4 Pillar 3)')
  .argument('[subcommand]', 'serve | publish | list | search | install | verify (default list)')
  .argument('[target]', 'Package dir (publish) or name[version] (install/search)')
  .option('--url <url>', 'Registry base URL (overrides ALP_REGISTRY_URL)')
  .option('--version <v>', 'Version for install')
  .option('--token <token>', 'Bearer token for the registry (overrides .alprc / ALP_REGISTRY_TOKEN)')
  .option('--key <file>', 'Trusted public key (PEM) — require + verify signed installs (v4.1)')
  .option('--sign-key <file>', 'Ed25519 private key (PEM) to sign published versions (v4.1)')
  .action((sub, target, opts) => registryCommand(sub, target, opts));

program
  .command('install')
  .description('Install a community package from the ALP Registry')
  .argument('<package>', 'Name of the package to install (e.g. @community/scrum-master)')
  .option('--url <url>', 'Registry base URL (overrides ALP_REGISTRY_URL)')
  .option('--version <v>', 'Version to install (default latest)')
  .option('--key <file>', 'Trusted public key (PEM) — require + verify signed installs (v4.1)')
  .action((pkg, opts) => installCommand(pkg, opts));

program
  .command('uninstall')
  .description('Uninstall a package from the ALP Registry')
  .argument('<package>', 'Name of the package to uninstall')
  .action(uninstallCommand);

program
  .command('publish')
  .description('Publish a local package to the ALP Registry (v4 Pillar 3)')
  .argument('<directory>', 'Directory containing the package (must have alp-package.json)')
  .option('--url <url>', 'Publish to a remote registry host (alp serve --registry) instead of the local store')
  .option('--token <token>', 'Bearer token for the registry (overrides .alprc / ALP_REGISTRY_TOKEN)')
  .option('--sign-key <file>', 'Ed25519 private key (PEM) to sign the published version (v4.1 trust)')
  .action((dir, opts) => publishCommand(dir, opts));

program
  .command('keys')
  .description('Manage registry package-signing keypairs & trust roots (v4.2/4.3)')
  .argument('[args...]', 'generate | fingerprint <file> | trust add <ns|*> <fingerprint|file> | trust list')
  .action((args: string[]) => keysCommand(args[0], args.slice(1)));

program
  .command('test-harness')
  .description('Run the ALP compliance test suite against the bundled parser or an external one (v6.2.0)')
  .option('--executable <cmd>', 'External parser executable: takes a .alp path, prints AST JSON to stdout, non-zero on failure')
  .option('--suite <dir>', 'Path to the compliance suite directory (default ./tests/compliance)')
  .action((opts) => testHarnessCommand(opts));

program
  .command('replay')
  .description('Replay the immutable event log of workspace mutations (v10.1.0 Event Sourcing)')
  .option('--from <iso>', 'Replay events at or after this ISO timestamp')
  .option('--to <iso>', 'Replay events at or before this ISO timestamp')
  .option('--type <types>', 'Comma-separated event types to include (e.g. status_changed,object_created)')
  .option('--object-id <id>', 'Only events whose payload references this object id')
  .action((opts) => replayCommand(opts));

program
  .command('visualize')
  .description('Generate a diagram from @workflow objects (v10.2.0 Workflow Visualization)')
  .argument('[id]', 'Workflow id to visualize (all workflows if omitted)')
  .option('--format <format>', 'Output format: mermaid, dot, json (default mermaid)')
  .option('--out <file>', 'Write output to a file instead of stdout')
  .action((id, opts) => visualizeCommand(id, opts));

program
  .command('export')
  .description('Export the ALP workspace to a unified JSON or YAML file')
  .option('--format <format>', 'Export format: json or yaml', 'json')
  .option('--out <file>', 'Output file path (prints to stdout if omitted)')
  .option('--minified', 'Minify JSON output (only applies to json format)')
  .action(exportCommand);

program
  .command('cost')
  .description('Show token usage and compute cost for a task (v10.7.0 Resource Metering)')
  .argument('[task-id]', 'Task ID to inspect (defaults to latest metered task)')
  .option('--workflow <id>', 'Optimize a workflow and show cost savings (v16.0.0)')
  .action((taskId, opts) => costCommand(taskId, opts));

program
  .command('debug')
  .description('Time-travel debug a run via snapshots (v10.8.0)')
  .argument('<run-id>', 'Run identifier')
  .option('--step <n>', 'Step forward (positive) or backward (negative) by N snapshots', parseInt)
  .option('--to-stage <name>', 'Jump to the snapshot matching this engine stage')
  .option('--diff <a> <b>', 'Diff two snapshot ids')
  .action((runId, opts) => debugCommand(runId, opts));

program
  .command('bridge')
  .description('Export/import ALP workflows to/from OpenAPI, GraphQL, gRPC, or AsyncAPI (v17.0.0)')
  .argument('<format>', 'Target format: openapi, graphql, grpc, asyncapi')
  .argument('[file]', 'Import from a JSON spec file instead of exporting the local workflow')
  .action((format, file) => bridgeCommand(format, file));

program
  .command('domain-trust')
  .description('Manage cross-domain trust relationships (v14)')
  .argument('<subcommand>', 'create-domain | link | accept | list | revoke')
  .argument('[args...]', 'Subcommand arguments')
  .action((subcommand, args) => domainTrustCommand(subcommand, ...args));

program
  .command('governance')
  .description('Autonomous governance ballots (v14)')
  .argument('<subcommand>', 'propose | vote | close | list')
  .argument('[args...]', 'Subcommand arguments')
  .action((subcommand, args) => governanceCommand(subcommand, ...args));

program
  .command('tenant')
  .description('Multi-tenant isolation (v14)')
  .argument('<subcommand>', 'create | list | vault | delete')
  .argument('[args...]', 'Subcommand arguments')
  .action((subcommand, args) => tenantCommand(subcommand, ...args));

program
  .command('healing')
  .description('Self-healing workflow history (v12)')
  .argument('<subcommand>', 'history | report')
  .argument('[args...]', 'Subcommand arguments')
  .action((subcommand, args) => healingCommand(subcommand, ...args));

program
  .command('resilience')
  .description('Swarm resilience and agent status (v12)')
  .argument('<subcommand>', 'agents | report')
  .argument('[args...]', 'Subcommand arguments')
  .action((subcommand, args) => resilienceCommand(subcommand, ...args));

program
  .command('tui')
  .description('Launch the interactive terminal UI dashboard (v16.0.0)')
  .action(tuiCommand);

registerTraceCommand(program);
registerZKCommand(program);
registerVectorCommand(program);
registerDIDCommand(program);
registerCRDTSyncCommand(program);
registerHealCommand(program);
registerFormalVerifyCommand(program);
registerAssetCommand(program);
registerBudgetCommand(program);
registerSandboxCommand(program);
registerTenantMeshCommand(program);
registerDecomposeCommand(program);
registerEdgeCommand(program);
registerCodeIndexCommand(program);
registerEvalSuiteCommand(program);
registerPromptOptimizerCommand(program);
registerConsensusVoteCommand(program);
registerCodeTransformCommand(program);
registerEventMeshCommand(program);
registerSwarmMarketplaceCommand(program);

program.parse(process.argv);

