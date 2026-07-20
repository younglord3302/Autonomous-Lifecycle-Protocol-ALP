import fs from 'fs';
import path from 'path';

export function initCommand(options: any) {
  const targetDir = path.join(process.cwd(), '.alp');
  
  if (fs.existsSync(targetDir)) {
    console.error('Error: .alp directory already exists in this project.');
    process.exit(1);
  }
  
  fs.mkdirSync(targetDir, { recursive: true });
  
  const defaultProject = `!alp-version: 3.0.0

@project
  id: my-project
  name: "My New Project"
  version: 0.1.0
  status: [~]
  description: "Initialized by ALP CLI"
`;

  fs.writeFileSync(path.join(targetDir, 'project.alp'), defaultProject);
  
  console.log('✅ ALP project initialized successfully!');
  console.log('Created .alp/project.alp');
}
