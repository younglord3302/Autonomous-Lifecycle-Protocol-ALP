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

const program = new Command();

program
  .name('alp')
  .description('Autonomous Lifecycle Protocol (ALP) CLI')
  .version('3.0.0');

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
  .action((task, opts) => runCommand(task, opts));

program
  .command('checkpoint')
  .description('Report a task status update from an agent (used in swarm mode)')
  .argument('<taskId>', 'The ID of the task to update')
  .argument('<status>', 'New status: done, blocked, in-progress, todo')
  .argument('[message]', 'Optional message to log to the runtime log')
  .action(checkpointCommand);

program
  .command('install')
  .description('Install a community package from the ALP Registry')
  .argument('<package>', 'Name of the package to install (e.g. @community/scrum-master)')
  .action(installCommand);

program
  .command('uninstall')
  .description('Uninstall a package from the ALP Registry')
  .argument('<package>', 'Name of the package to uninstall')
  .action(uninstallCommand);

program
  .command('publish')
  .description('Publish a local package to the ALP Registry')
  .argument('<directory>', 'Directory containing the package (must have alp-package.json)')
  .action(publishCommand);

program
  .command('export')
  .description('Export the ALP workspace to a unified JSON or YAML file')
  .option('--format <format>', 'Export format: json or yaml', 'json')
  .option('--out <file>', 'Output file path (prints to stdout if omitted)')
  .option('--minified', 'Minify JSON output (only applies to json format)')
  .action(exportCommand);

program.parse(process.argv);

