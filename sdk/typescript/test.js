import { AlpWorkspace } from './dist/index.js';

const workspace = new AlpWorkspace();
workspace.load('../../examples/todo-app');

console.log(`Loaded ${workspace.objects.length} objects.`);

const order = workspace.getExecutionOrder();
console.log('Execution Order:');
order.forEach(node => {
  console.log(`- ${node.id} (${node.type})`);
});
