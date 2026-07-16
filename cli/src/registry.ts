import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  files: string[];
}

export class RegistryClient {
  private baseDir: string;
  
  constructor() {
    this.baseDir = path.resolve(process.cwd(), '.alp');
  }

  private parsePackageName(pkgName: string): { owner: string, repo: string, version: string } {
    let owner = 'alp-registry';
    let repo = pkgName;
    let version = 'main';

    // handle @owner/repo@version
    if (pkgName.startsWith('@')) {
      const parts = pkgName.substring(1).split('/');
      owner = parts[0];
      repo = parts[1];
    }

    if (repo && repo.includes('@')) {
      const parts = repo.split('@');
      repo = parts[0];
      version = parts[1];
    }

    return { owner, repo, version };
  }

  async install(pkgName: string) {
    const { owner, repo, version } = this.parsePackageName(pkgName);
    const githubUrl = `https://github.com/${owner}/${repo}.git`;
    
    console.log(`Resolving ${owner}/${repo}@${version} from registry...`);
    
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-pkg-'));
    
    try {
      // Clone only the specific branch/tag we want, and only a depth of 1
      execSync(`git clone --depth 1 --branch ${version} ${githubUrl} ${tmpDir}`, { stdio: 'ignore' });
      
      const pkgJsonPath = path.join(tmpDir, 'alp-package.json');
      if (!fs.existsSync(pkgJsonPath)) {
         console.error(`Error: Package ${pkgName} does not contain an alp-package.json manifest.`);
         return;
      }
      
      const manifest: PackageManifest = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      
      console.log(`Downloading ${manifest.name} v${manifest.version}...`);
      
      const targetDir = path.join(this.baseDir, 'packages', manifest.name.replace(/[^a-zA-Z0-9-]/g, '_'));
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      // Copy files
      for (const file of manifest.files) {
         const srcPath = path.join(tmpDir, file);
         const destPath = path.join(targetDir, file);
         
         if (fs.existsSync(srcPath)) {
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            fs.copyFileSync(srcPath, destPath);
         }
      }
      
      // Update local manifest
      this.updateLocalManifest(manifest.name, manifest.version, targetDir);
      
      console.log(`✅ Successfully installed ${manifest.name}@${manifest.version}`);
      
    } catch (e: any) {
      console.error(`Failed to install package ${pkgName}: ${e.message}`);
    } finally {
       fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async uninstall(pkgName: string) {
    const manifestPath = path.join(this.baseDir, '.packages.json');
    if (!fs.existsSync(manifestPath)) {
      console.log(`Package ${pkgName} is not installed.`);
      return;
    }
    
    const localManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!localManifest[pkgName]) {
      console.log(`Package ${pkgName} is not installed.`);
      return;
    }
    
    const targetDir = localManifest[pkgName].path;
    if (fs.existsSync(targetDir)) {
       fs.rmSync(targetDir, { recursive: true, force: true });
    }
    
    delete localManifest[pkgName];
    fs.writeFileSync(manifestPath, JSON.stringify(localManifest, null, 2), 'utf8');
    
    console.log(`✅ Successfully uninstalled ${pkgName}`);
  }

  async publish(pkgDir: string) {
    const pkgJsonPath = path.join(pkgDir, 'alp-package.json');
    if (!fs.existsSync(pkgJsonPath)) {
       console.error(`Error: Cannot publish. No alp-package.json found in ${pkgDir}.`);
       return;
    }
    const manifest: PackageManifest = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    
    console.log(`📦 Packaging ${manifest.name}@${manifest.version}...`);
    // Validation
    for (const file of manifest.files) {
       if (!fs.existsSync(path.join(pkgDir, file))) {
          console.error(`Error: Declared file ${file} does not exist.`);
          return;
       }
    }
    
    console.log(`✅ Package ${manifest.name} is valid.`);
    console.log(`\nTo publish, create a GitHub repository for this package and push the code:`);
    console.log(`  git init`);
    console.log(`  git add .`);
    console.log(`  git commit -m "Initial release"`);
    console.log(`  git tag main`);
    console.log(`  git remote add origin https://github.com/alp-registry/${manifest.name.replace('@', '').replace('/', '-')}.git`);
    console.log(`  git push -u origin main`);
  }
  
  private updateLocalManifest(name: string, version: string, installPath: string) {
    const manifestPath = path.join(this.baseDir, '.packages.json');
    let manifest: any = {};
    if (fs.existsSync(manifestPath)) {
       manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    manifest[name] = { version, path: installPath, installedAt: new Date().toISOString() };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }
}
