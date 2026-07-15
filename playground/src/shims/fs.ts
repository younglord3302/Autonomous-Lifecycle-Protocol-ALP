// Browser shim for Node's `fs` used by @alp/parser's Node-only modules
// (LockManager / Memory). The playground never instantiates those at runtime,
// so these no-op stubs only exist to keep the bundle self-contained.
export function existsSync(_path: string): boolean {
  return false;
}

export function mkdirSync(_path: string, _options?: unknown): void {}

export function readFileSync(_path: string, _encoding?: unknown): string {
  return '';
}

export function writeFileSync(
  _path: string,
  _data: unknown,
  _encoding?: unknown,
): void {}

export function readdirSync(_path: string): string[] {
  return [];
}

export function statSync(_path: string): unknown {
  return {};
}

export function unlinkSync(_path: string): void {}

export const constants = {} as Record<string, number>;

export default {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  constants,
};
