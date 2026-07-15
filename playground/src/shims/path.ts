// Browser shim for Node's `path` used by @alp/parser's Node-only modules
// (LockManager / Memory). The playground never instantiates those at runtime,
// so these safe stubs only exist to keep the bundle self-contained.
export const sep = '/';

export function join(...parts: string[]): string {
  return parts
    .filter((p) => p !== '' && p != null)
    .join('/')
    .replace(/\/+/g, '/');
}

export function resolve(...parts: string[]): string {
  return join(...parts);
}

export function dirname(p: string): string {
  return p.replace(/\/[^/]*$/, '') || '/';
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

export default { sep, join, resolve, dirname, basename };
