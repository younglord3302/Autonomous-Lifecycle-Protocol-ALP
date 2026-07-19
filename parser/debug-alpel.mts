import { evaluate } from './src/alpel';
for (const e of ["['a', 'b'].contains('c')", "'hello world'.startsWith('hello')"]) {
  try { console.log(e, '=>', JSON.stringify(evaluate(e, {}))); }
  catch (err) { console.log(e, 'ERR', (err as Error).message); }
}
