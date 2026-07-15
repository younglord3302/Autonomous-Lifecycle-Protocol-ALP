import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AlpParser } from '@alp/parser';

const parser = new AlpParser();
const root = join(process.cwd(), 'tests', 'compliance');

const valid = readdirSync(join(root, 'valid')).filter((f) => f.endsWith('.alp'));
const invalid = readdirSync(join(root, 'invalid')).filter((f) => f.endsWith('.alp'));

describe('ALP compliance — valid fixtures', () => {
  for (const f of valid) {
    it(`parses & validates ${f}`, () => {
      const content = readFileSync(join(root, 'valid', f), 'utf-8');
      expect(() => parser.parseAndValidate(content)).not.toThrow();
    });
  }
});

describe('ALP compliance — invalid fixtures', () => {
  for (const f of invalid) {
    it(`rejects ${f}`, () => {
      const content = readFileSync(join(root, 'invalid', f), 'utf-8');
      expect(() => parser.parseAndValidate(content)).toThrow();
    });
  }
});
