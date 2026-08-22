export type VfsNode =
  | { type: 'dir'; children: Record<string, VfsNode> }
  | { type: 'file'; content: string };

const DB_NAME = 'vibe-linux-db';
const STORE = 'kv';
const KEY = 'filesystem';

export const initialFs: VfsNode = {
  type: 'dir',
  children: {
    home: {
      type: 'dir',
      children: {
        user: {
          type: 'dir',
          children: {
            Desktop: { type: 'dir', children: {} },
            Documents: {
              type: 'dir',
              children: {
                'welcome.txt': {
                  type: 'file',
                  content:
                    'Welcome to Vibe Linux!\n\nThis is a browser-only Linux desktop simulation.\nTry opening Terminal and running: help, ls, cat welcome.txt\n',
                },
              },
            },
            Downloads: { type: 'dir', children: {} },
            Pictures: { type: 'dir', children: {} },
          },
        },
      },
    },
    etc: {
      type: 'dir',
      children: {
        hostname: { type: 'file', content: 'vibe-linux\n' },
        'os-release': {
          type: 'file',
          content: 'NAME="Vibe Linux"\nPRETTY_NAME="Vibe Linux Web Desktop"\n',
        },
      },
    },
    tmp: { type: 'dir', children: {} },
  },
};

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

export async function loadFs(): Promise<VfsNode> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as VfsNode | undefined) ?? structuredClone(initialFs));
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
  const parts = (path.startsWith('/') ? path : `${cwd}/${path}`).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return `/${stack.join('/')}`;
}

export function dirname(path: string): string {
  const p = normalizePath(path);
  if (p === '/') return '/';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return `/${parts.join('/')}` || '/';
}

export function basename(path: string): string {
  const p = normalizePath(path);
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

export function makeDir(root: VfsNode, path: string): void {
  const target = getParent(root, path);
  if (!target) throw new Error('Invalid path');
  if (target.parent.children[target.name]) throw new Error(`File exists: ${target.name}`);
  target.parent.children[target.name] = { type: 'dir', children: {} };
}

export function touchFile(root: VfsNode, path: string): void {
  const target = getParent(root, path);
  if (!target) throw new Error('Invalid path');
  const existing = target.parent.children[target.name];
  if (existing?.type === 'dir') throw new Error(`Is a directory: ${target.name}`);
  if (!existing) target.parent.children[target.name] = { type: 'file', content: '' };
}

export function readFile(root: VfsNode, path: string): string {
  const node = getNode(root, path);
  if (!node) throw new Error(`No such file: ${path}`);
  if (node.type !== 'file') throw new Error(`Is a directory: ${path}`);
  return node.content;
}

export function writeFile(root: VfsNode, path: string, content: string): void {
  const target = getParent(root, path);
  if (!target) throw new Error('Invalid path');
  const existing = target.parent.children[target.name];
  if (existing?.type === 'dir') throw new Error(`Is a directory: ${target.name}`);
  target.parent.children[target.name] = { type: 'file', content };
}

export function removeNode(root: VfsNode, path: string): void {
  const target = getParent(root, path);
  if (!target || !target.parent.children[target.name]) throw new Error(`No such file or directory: ${path}`);
  delete target.parent.children[target.name];
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
}
