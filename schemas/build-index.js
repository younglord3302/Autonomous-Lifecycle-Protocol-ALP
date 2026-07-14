const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(file => file.endsWith('.schema.json'));

let out = `// AUTO-GENERATED. DO NOT EDIT.
module.exports = {
`;

for (const file of files) {
  const schemaName = file.replace('.schema.json', '');
  out += `  "${schemaName}": require("./${file}"),\n`;
}

out += `};\n`;

fs.writeFileSync(path.join(__dirname, 'index.js'), out, 'utf8');
console.log('Static schemas/index.js generated.');
