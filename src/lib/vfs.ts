export type VfsNode =
  | { type: 'dir'; children: Record<string, VfsNode>; createdAt?: number; modifiedAt?: number }
  | { type: 'file'; content: string; mime?: string; createdAt?: number; modifiedAt?: number };

const DB_NAME = 'vibe-linux-db';
const STORE = 'kv';
const KEY = 'filesystem';

const now = () => Date.now();
const file = (content = '', mime = 'text/plain'): VfsNode => ({ type: 'file', content, mime, createdAt: now(), modifiedAt: now() });
const dir = (children: Record<string, VfsNode> = {}): VfsNode => ({ type: 'dir', children, createdAt: now(), modifiedAt: now() });

export const initialFs: VfsNode = dir({
  home: dir({
    user: dir({
      Desktop: dir({}),
      Documents: dir({
        'welcome.txt': file(
          'Welcome to Vibe Linux!\n\nThis is a browser-only Linux desktop environment with a persistent virtual filesystem.\nOpen Terminal and run: help, ls -la, tree, ps, apt list --installed\n',
        ),
        'Getting Started.vdoc': file(
          '<h1>Welcome to Vibe Linux</h1><p>This document was created inside the browser-based Linux desktop.</p><p>Try the Terminal, Files, Software Store, System Monitor, Browser, and Documents apps.</p>',
          'text/html',
        ),
      }),
      Downloads: dir({}),
      Pictures: dir({}),
      Music: dir({}),
      Videos: dir({}),
      '.config': dir({
        'vibe.conf': file('theme=dark\nshell=vibe-sh\n'),
      }),
      '.bashrc': file('export USER=user\nexport HOME=/home/user\nexport SHELL=/bin/vibe-sh\n'),
    }),
  }),
  etc: dir({
    hostname: file('vibe-linux\n'),
    hosts: file('127.0.0.1 localhost\n127.0.1.1 vibe-linux\n'),
    passwd: file('root:x:0:0:root:/root:/bin/vibe-sh\nuser:x:1000:1000:Vibe User:/home/user:/bin/vibe-sh\n'),
    group: file('root:x:0:\nusers:x:100:user\nsudo:x:27:user\n'),
    'os-release': file('NAME="Vibe Linux"\nPRETTY_NAME="Vibe Linux Web Desktop"\nVERSION="2.0"\nID=vibe\n'),
  }),
  bin: dir({
    README: file('Virtual commands are implemented by the Vibe Linux browser shell.\n'),
  }),
  usr: dir({
    bin: dir({}),
    share: dir({
      applications: dir({}),
      doc: dir({
        'browser-limitations.txt': file('Native Linux binaries cannot run directly in a normal browser. Vibe Linux emulates common desktop and shell behavior client-side.\n'),
      }),
    }),
  }),
  var: dir({
    log: dir({
      'vibe.log': file('Vibe Linux virtual system initialized.\n'),
    }),
    tmp: dir({}),
  }),
  tmp: dir({}),
  root: dir({}),
  proc: dir({
    version: file('Vibe Linux virtual kernel 2.0 (browser sandbox)\n'),
  }),
});

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function mergeDefaults(current: VfsNode, defaults: VfsNode): VfsNode {
  if (current.type !== defaults.type) return structuredClone(current);
  if (current.type === 'file' && defaults.type === 'file') {
    return {
      ...current,
      mime: current.mime ?? defaults.mime,
      createdAt: current.createdAt ?? defaults.createdAt,
      modifiedAt: current.modifiedAt ?? defaults.modifiedAt,
    };
  }
  if (current.type === 'dir' && defaults.type === 'dir') {
    const merged = structuredClone(current);
    merged.createdAt ??= defaults.createdAt;
    merged.modifiedAt ??= defaults.modifiedAt;
    for (const [name, defaultChild] of Object.entries(defaults.children)) {
      merged.children[name] = merged.children[name]
        ? mergeDefaults(merged.children[name], defaultChild)
        : structuredClone(defaultChild);
    }
    return merged;
  }
  return structuredClone(current);
}

export async function loadFs(): Promise<VfsNode> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const existing = req.result as VfsNode | undefined;
      resolve(existing ? mergeDefaults(existing, initialFs) : structuredClone(initialFs));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveFs(fs: VfsNode): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(fs, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function normalizePath(path: string, cwd = '/home/user'): string {
  if (!path) return normalizePath(cwd, '/');
  const expanded = path === '~' || path.startsWith('~/') ? `/home/user${path.slice(1)}` : path;
  const parts = (expanded.startsWith('/') ? expanded : `${cwd}/${expanded}`).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return `/${stack.join('/')}`;
}

export function dirname(path: string): string {
  const p = normalizePath(path, '/');
  if (p === '/') return '/';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return `/${parts.join('/')}` || '/';
}

export function basename(path: string): string {
  const p = normalizePath(path, '/');
  if (p === '/') return '/';
  return p.split('/').filter(Boolean).at(-1) ?? '/';
}

export function getNode(root: VfsNode, path: string): VfsNode | undefined {
  const p = normalizePath(path, '/');
  if (p === '/') return root;
  let current: VfsNode | undefined = root;
  for (const part of p.split('/').filter(Boolean)) {
    if (!current || current.type !== 'dir') return undefined;
    current = current.children[part];
  }
  return current;
}

function getParent(root: VfsNode, path: string): { parent: Extract<VfsNode, { type: 'dir' }>; name: string } | undefined {
  const p = normalizePath(path, '/');
  if (p === '/') return undefined;
  const parentNode = getNode(root, dirname(p));
  if (!parentNode || parentNode.type !== 'dir') return undefined;
  return { parent: parentNode, name: basename(p) };
}

export function listDir(root: VfsNode, path: string): Array<[string, VfsNode]> {
  const node = getNode(root, path);
  if (!node) throw new Error(`No such file or directory: ${path}`);
  if (node.type !== 'dir') throw new Error(`Not a directory: ${path}`);
  return Object.entries(node.children).sort(([a, av], [b, bv]) => {
    if (av.type !== bv.type) return av.type === 'dir' ? -1 : 1;
    return a.localeCompare(b);
  });
}

export function mutateFs(root: VfsNode, action: (draft: VfsNode) => void): VfsNode {
  const draft = structuredClone(root);
  action(draft);
  return draft;
}

export function makeDir(root: VfsNode, path: string, recursive = false): void {
  const p = normalizePath(path, '/');
  if (p === '/') return;
  if (recursive) {
    let current = root;
    for (const part of p.split('/').filter(Boolean)) {
      if (current.type !== 'dir') throw new Error(`Not a directory: ${part}`);
      const existing = current.children[part];
      if (!existing) current.children[part] = dir({});
      else if (existing.type !== 'dir') throw new Error(`Not a directory: ${part}`);
      current.modifiedAt = now();
      current = current.children[part];
    }
    return;
  }
  const target = getParent(root, p);
  if (!target) throw new Error('Invalid path');
  if (target.parent.children[target.name]) throw new Error(`File exists: ${target.name}`);
  target.parent.children[target.name] = dir({});
  target.parent.modifiedAt = now();
}

export function touchFile(root: VfsNode, path: string): void {
  const target = getParent(root, path);
  if (!target) throw new Error('Invalid path');
  const existing = target.parent.children[target.name];
  if (existing?.type === 'dir') throw new Error(`Is a directory: ${target.name}`);
  if (!existing) target.parent.children[target.name] = file('');
  else existing.modifiedAt = now();
  target.parent.modifiedAt = now();
}

export function readFile(root: VfsNode, path: string): string {
  const node = getNode(root, path);
  if (!node) throw new Error(`No such file: ${path}`);
  if (node.type !== 'file') throw new Error(`Is a directory: ${path}`);
  return node.content;
}

export function writeFile(root: VfsNode, path: string, content: string, mime = 'text/plain'): void {
  const target = getParent(root, path);
  if (!target) throw new Error('Invalid path');
  const existing = target.parent.children[target.name];
  if (existing?.type === 'dir') throw new Error(`Is a directory: ${target.name}`);
  target.parent.children[target.name] = {
    type: 'file',
    content,
    mime: existing?.type === 'file' ? existing.mime ?? mime : mime,
    createdAt: existing?.type === 'file' ? existing.createdAt ?? now() : now(),
    modifiedAt: now(),
  };
  target.parent.modifiedAt = now();
}

export function appendFile(root: VfsNode, path: string, content: string): void {
  const existing = getNode(root, path);
  const old = existing?.type === 'file' ? existing.content : '';
  writeFile(root, path, old + content, existing?.type === 'file' ? existing.mime : 'text/plain');
}

export function removeNode(root: VfsNode, path: string): void {
  const target = getParent(root, path);
  if (!target || !target.parent.children[target.name]) throw new Error(`No such file or directory: ${path}`);
  delete target.parent.children[target.name];
  target.parent.modifiedAt = now();
}

export function renameNode(root: VfsNode, path: string, newName: string): void {
  if (!newName || newName.includes('/')) throw new Error('Invalid name');
  const target = getParent(root, path);
  if (!target) throw new Error('Invalid path');
  const node = target.parent.children[target.name];
  if (!node) throw new Error(`No such file or directory: ${path}`);
  if (target.parent.children[newName]) throw new Error(`File exists: ${newName}`);
  target.parent.children[newName] = node;
  delete target.parent.children[target.name];
  target.parent.modifiedAt = now();
}

export function copyNode(root: VfsNode, source: string, destination: string): void {
  const src = getNode(root, source);
  if (!src) throw new Error(`No such file or directory: ${source}`);
  let destPath = normalizePath(destination, '/');
  const destNode = getNode(root, destPath);
  if (destNode?.type === 'dir') destPath = normalizePath(`${destPath}/${basename(source)}`, '/');
  const target = getParent(root, destPath);
  if (!target) throw new Error(`Invalid destination: ${destination}`);
  if (target.parent.children[target.name]) throw new Error(`File exists: ${destPath}`);
  target.parent.children[target.name] = structuredClone(src);
  target.parent.modifiedAt = now();
}

export function moveNode(root: VfsNode, source: string, destination: string): void {
  copyNode(root, source, destination);
  removeNode(root, source);
}

export function walkFs(root: VfsNode, start = '/'): Array<{ path: string; node: VfsNode }> {
  const startPath = normalizePath(start, '/');
  const node = getNode(root, startPath);
  if (!node) throw new Error(`No such file or directory: ${start}`);
  const result: Array<{ path: string; node: VfsNode }> = [];
  const visit = (current: VfsNode, path: string) => {
    result.push({ path, node: current });
    if (current.type === 'dir') {
      for (const [name, child] of Object.entries(current.children)) {
        visit(child, normalizePath(`${path}/${name}`, '/'));
      }
    }
  };
  visit(node, startPath);
  return result;
}

export function nodeSize(node: VfsNode): number {
  if (node.type === 'file') return new Blob([node.content]).size;
  return Object.values(node.children).reduce((sum, child) => sum + nodeSize(child), 0);
}

export function treeText(root: VfsNode, start = '/'): string {
  const startPath = normalizePath(start, '/');
  const node = getNode(root, startPath);
  if (!node) throw new Error(`No such file or directory: ${start}`);
  const lines = [basename(startPath) || '/'];
  const render = (current: VfsNode, prefix: string) => {
    if (current.type !== 'dir') return;
    const entries = Object.entries(current.children).sort(([a], [b]) => a.localeCompare(b));
    entries.forEach(([name, child], index) => {
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${name}${child.type === 'dir' ? '/' : ''}`);
      render(child, `${prefix}${last ? '    ' : '│   '}`);
    });
  };
  render(node, '');
  return lines.join('\n');
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
