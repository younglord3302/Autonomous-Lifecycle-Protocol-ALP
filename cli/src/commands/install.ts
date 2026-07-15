import * as fs from 'fs';
import * as path from 'path';

/**
 * `alp install` — The ALP Package Registry Installer.
 *
 * Scaffolding for Pillar 5. This command simulates fetching a community
 * ALP package (e.g., an agent definition or workflow template) and
 * installing it into the current workspace.
 */
export function installCommand(pkgName: string) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  console.log(`\n📦 Fetching ${pkgName} from the ALP Registry...`);
  
  // Simulate network delay
  setTimeout(() => {
    // Generate a mock package based on the requested name
    let installPath = '';
    let content = '';

    if (pkgName.includes('scrum')) {
      installPath = path.join(alpDir, 'workflows', 'scrum.alp');
      content = `@workflow
  id: wf-scrum-sprint
  description: "Standard 2-week Agile Scrum Sprint"
  phases:
    - sprint-planning
    - daily-standups
    - sprint-review
    - retrospective
`;
    } else if (pkgName.includes('agent')) {
      installPath = path.join(alpDir, 'agents', 'custom-agent.alp');
      content = `@agent
  id: ${pkgName.replace(/[^a-zA-Z0-9-]/g, '-')}
  description: "Community provided agent template"
  capabilities:
    - write-code
    - run-tests
`;
    } else {
      installPath = path.join(alpDir, 'plugins', `${pkgName.replace(/[^a-zA-Z0-9-]/g, '')}.alp`);
      content = `@plugin
  id: plugin-${pkgName.replace(/[^a-zA-Z0-9-]/g, '')}
  description: "Community Plugin"
  version: "1.0.0"
`;
    }

    // Ensure directory exists
    const dir = path.dirname(installPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(installPath, content, 'utf-8');

    console.log(`✅ Successfully installed ${pkgName}`);
    console.log(`   -> Wrote to: ${path.relative(process.cwd(), installPath)}`);
    console.log('');
  }, 1000);
}
