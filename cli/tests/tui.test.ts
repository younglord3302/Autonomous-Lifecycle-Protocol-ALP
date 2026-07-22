import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { tuiCommand } from '../src/commands/tui';

describe('alp tui (Terminal UI Dashboard)', () => {
  it('errors cleanly if .alp directory is not found', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-tui-test-'));
    const origCwd = process.cwd();
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spyExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    try {
      process.chdir(tmp);
      tuiCommand();
      expect(spyError).toHaveBeenCalledWith(expect.stringContaining('.alp directory not found'));
      expect(spyExit).toHaveBeenCalledWith(1);
    } finally {
      process.chdir(origCwd);
      spyError.mockRestore();
      spyExit.mockRestore();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
