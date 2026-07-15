#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { validateCommand } from './commands/validate';
import { graphCommand } from './commands/graph';
import { statusCommand } from './commands/status';
import { runCommand } from './commands/run';

const program = new Command();

program
  .name('alp')
  .description('Autonomous Lifecycle Protocol (ALP) CLI')
  .version('2.0.0');

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
  .action((task, opts) => runCommand(task, opts));

program.parse(process.argv);

