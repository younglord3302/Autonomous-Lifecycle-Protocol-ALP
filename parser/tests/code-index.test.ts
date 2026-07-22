import { describe, it, expect } from 'vitest';
import { CodeIndexEngine } from '../src/code-index';

describe('CodeIndexEngine (v30.0.0)', () => {
  const sampleTS = `
    export function processUserData(user: { name: string }): string {
      return user.name.toUpperCase();
    }

    export class UserStore {
      private users: string[] = [];
      public addUser(name: string): void {
        this.users.push(name);
      }
    }
  `;

  it('indexes TypeScript source and extracts symbols correctly', () => {
    const engine = new CodeIndexEngine();
    const config = engine.indexSource('idx-user', 'typescript', 'src/user.ts', sampleTS, 'function');

    expect(config.id).toBe('idx-user');
    expect(config.language).toBe('typescript');
    expect(config.symbols.length).toBe(2);
    expect(config.symbols[0].name).toBe('processUserData');
    expect(config.symbols[0].kind).toBe('function');
    expect(config.symbols[1].name).toBe('UserStore');
    expect(config.symbols[1].kind).toBe('class');
  });

  it('chunks source and performs semantic search', () => {
    const engine = new CodeIndexEngine();
    engine.indexSource('idx-user', 'typescript', 'src/user.ts', sampleTS, 'function');

    const results = engine.semanticSearch('process user data function', 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].chunk.sourcePath).toBe('src/user.ts');
  });

  it('handles empty/file chunking strategy gracefully', () => {
    const engine = new CodeIndexEngine();
    const config = engine.indexSource('idx-file', 'python', 'app.py', 'print("hello")', 'file');

    expect(config.symbols.length).toBe(0);
    expect(engine.getChunkCount()).toBe(1);
    const searchRes = engine.semanticSearch('hello', 1);
    expect(searchRes.length).toBe(1);
  });
});
