import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { create } from 'zustand';
import {
  Activity,
  Archive as ArchiveIcon,
  BatteryFull,
  Bold,
  BookOpen,
  Calculator as CalculatorIcon,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Cpu,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  HardDrive,
  Home,
  Image as ImageIcon,
  Italic,
  List,
  Maximize2,
  Menu,
  Minus,
  Moon,
  Package,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  Square,
  Sun,
  Terminal as TerminalIcon,
  Trash2,
  Underline,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  appendFile,
  basename,
  copyNode,
  dirname,
  getNode,
  globToRegExp,
  initialFs,
  listDir,
  loadFs,
  makeDir,
  moveNode,
  mutateFs,
  nodeSize,
  normalizePath,
  readFile,
  removeNode,
  renameNode,
  saveFs,
  touchFile,
  treeText,
  walkFs,
  writeFile,
} from './lib/vfs';
import type { VfsNode } from './lib/vfs';

type AppKind =
  | 'terminal'
  | 'files'
  | 'editor'
  | 'documents'
  | 'settings'
  | 'calculator'
  | 'browser'
  | 'store'
  | 'systemMonitor'
  | 'archive'
  | 'imageViewer';

type Theme = 'dark' | 'light';
type Wallpaper = 'a' | 'b' | 'c' | 'd';

type AppDefinition = {
  title: string;
  icon: LucideIcon;
  width: number;
  height: number;
  packageName: string;
  description: string;
  core?: boolean;
};

type AppWindowState = {
  id: string;
  pid: number;
  kind: AppKind;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  z: number;
  data?: Record<string, string>;
};

const appDefinitions: Record<AppKind, AppDefinition> = {
  terminal: { title: 'Terminal', icon: TerminalIcon, width: 760, height: 500, packageName: 'vibe-terminal', description: 'Linux-style shell connected to the virtual filesystem.', core: true },
  files: { title: 'Files', icon: FolderOpen, width: 860, height: 560, packageName: 'vibe-files', description: 'Browse, upload, download, rename and manage files.', core: true },
  editor: { title: 'Text Editor', icon: FileText, width: 780, height: 560, packageName: 'vibe-editor', description: 'Plain-text editor for files in the virtual filesystem.', core: true },
  documents: { title: 'Documents', icon: BookOpen, width: 900, height: 650, packageName: 'vibe-documents', description: 'Rich document editor with formatting, save and export.' },
  settings: { title: 'Settings', icon: SettingsIcon, width: 720, height: 540, packageName: 'vibe-settings', description: 'Appearance and virtual system settings.', core: true },
  calculator: { title: 'Calculator', icon: CalculatorIcon, width: 370, height: 510, packageName: 'vibe-calculator', description: 'Desktop calculator.' },
  browser: { title: 'Web Browser', icon: Globe, width: 980, height: 650, packageName: 'vibe-browser', description: 'Tabbed web browser with bookmarks and external-open fallback.', core: true },
  store: { title: 'Software', icon: Package, width: 850, height: 590, packageName: 'vibe-software', description: 'Install, remove and launch Vibe Linux applications.', core: true },
  systemMonitor: { title: 'System Monitor', icon: Activity, width: 820, height: 560, packageName: 'vibe-system-monitor', description: 'Processes, browser resources and storage usage.' },
  archive: { title: 'Archive Manager', icon: ArchiveIcon, width: 700, height: 500, packageName: 'vibe-archive', description: 'Create and extract persistent Vibe archive files.' },
  imageViewer: { title: 'Image Viewer', icon: ImageIcon, width: 760, height: 560, packageName: 'vibe-image-viewer', description: 'View images uploaded to the virtual filesystem.' },
};

const allAppKinds = Object.keys(appDefinitions) as AppKind[];

function loadInstalledApps(): AppKind[] {
  try {
    const saved = JSON.parse(localStorage.getItem('vibe-installed-apps') || 'null') as AppKind[] | null;
    const valid = saved?.filter((kind) => allAppKinds.includes(kind)) ?? allAppKinds;
    const core = allAppKinds.filter((kind) => appDefinitions[kind].core);
    return Array.from(new Set([...core, ...valid]));
  } catch {
    return allAppKinds;
  }
}

interface DesktopStore {
  windows: AppWindowState[];
  activeId: string | null;
  startOpen: boolean;
  theme: Theme;
  wallpaper: Wallpaper;
  installedApps: AppKind[];
  nextPid: number;
  openApp: (kind: AppKind, data?: Record<string, string>) => void;
  closeWindow: (id: string) => void;
  closePid: (pid: number) => boolean;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindow: (id: string, patch: Partial<AppWindowState>) => void;
  toggleMaximize: (id: string) => void;
  setStartOpen: (value: boolean) => void;
  setTheme: (theme: Theme) => void;
  setWallpaper: (wallpaper: Wallpaper) => void;
  installApp: (kind: AppKind) => void;
  uninstallApp: (kind: AppKind) => void;
}

const useDesktop = create<DesktopStore>((set, get) => ({
  windows: [],
  activeId: null,
  startOpen: false,
  theme: (localStorage.getItem('vibe-theme') as Theme) || 'dark',
  wallpaper: (localStorage.getItem('vibe-wallpaper') as Wallpaper) || 'a',
  installedApps: loadInstalledApps(),
  nextPid: 1200,
  openApp: (kind, data) => {
    const def = appDefinitions[kind];
    const state = get();
    const id = `${kind}-${crypto.randomUUID()}`;
    const z = Math.max(10, ...state.windows.map((w) => w.z)) + 1;
    const offset = (state.windows.length % 9) * 22;
    const pid = state.nextPid;
    set((current) => ({
      windows: [
        ...current.windows,
        {
          id,
          pid,
          kind,
          title: def.title,
          x: 82 + offset,
          y: 68 + offset,
          width: def.width,
          height: def.height,
          minimized: false,
          maximized: false,
          z,
          data,
        },
      ],
      nextPid: pid + 1,
      activeId: id,
      startOpen: false,
    }));
  },
  closeWindow: (id) =>
    set((state) => {
      const remaining = state.windows.filter((w) => w.id !== id);
      const next = [...remaining].sort((a, b) => b.z - a.z).find((w) => !w.minimized);
      return { windows: remaining, activeId: next?.id ?? null };
    }),
  closePid: (pid) => {
    const win = get().windows.find((w) => w.pid === pid);
    if (!win) return false;
    get().closeWindow(win.id);
    return true;
  },
  minimizeWindow: (id) =>
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
      activeId: state.activeId === id ? null : state.activeId,
    })),
  restoreWindow: (id) => {
    const top = Math.max(10, ...get().windows.map((w) => w.z)) + 1;
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: false, z: top } : w)),
      activeId: id,
    }));
  },
  focusWindow: (id) => {
    const current = get().windows.find((w) => w.id === id);
    if (!current || get().activeId === id) return;
    const top = Math.max(10, ...get().windows.map((w) => w.z)) + 1;
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, z: top, minimized: false } : w)),
      activeId: id,
    }));
  },
  updateWindow: (id, patch) => set((state) => ({ windows: state.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
  toggleMaximize: (id) => set((state) => ({ windows: state.windows.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w)) })),
  setStartOpen: (value) => set({ startOpen: value }),
  setTheme: (theme) => {
    localStorage.setItem('vibe-theme', theme);
    set({ theme });
  },
  setWallpaper: (wallpaper) => {
    localStorage.setItem('vibe-wallpaper', wallpaper);
    set({ wallpaper });
  },
  installApp: (kind) => {
    const next = Array.from(new Set([...get().installedApps, kind]));
    localStorage.setItem('vibe-installed-apps', JSON.stringify(next));
    set({ installedApps: next });
  },
  uninstallApp: (kind) => {
    if (appDefinitions[kind].core) return;
    const next = get().installedApps.filter((item) => item !== kind);
    localStorage.setItem('vibe-installed-apps', JSON.stringify(next));
    set({ installedApps: next, windows: get().windows.filter((w) => w.kind !== kind) });
  },
}));

type FsCommit = (action: (draft: VfsNode) => void) => void;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char] || char);
}

function isTextMime(mime?: string) {
  return !mime || mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript');
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',', 2);
  const mime = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const binary = atob(data || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadNode(name: string, node: Extract<VfsNode, { type: 'file' }>) {
  const blob = node.content.startsWith('data:') && !isTextMime(node.mime) ? dataUrlToBlob(node.content) : new Blob([node.content], { type: node.mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function browserFileToContent(file: File): Promise<string> {
  if (isTextMime(file.type)) return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function VibeDesktop() {
  const theme = useDesktop((s) => s.theme);
  const wallpaper = useDesktop((s) => s.wallpaper);
  const windows = useDesktop((s) => s.windows);
  const openApp = useDesktop((s) => s.openApp);
  const [fs, setFs] = useState<VfsNode>(() => structuredClone(initialFs));
  const fsRef = useRef(fs);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    loadFs()
      .then((loaded) => {
        fsRef.current = loaded;
        setFs(loaded);
        void saveFs(loaded);
      })
      .catch(() => undefined);
  }, []);

  const commit: FsCommit = (action) => {
    const next = mutateFs(fsRef.current, action);
    fsRef.current = next;
    setFs(next);
    void saveFs(next);
  };

  const resetFs = () => {
    const next = structuredClone(initialFs);
    fsRef.current = next;
    setFs(next);
    void saveFs(next);
  };

  return (
    <main
      className={`desktop-root ${theme} wallpaper-${wallpaper} relative h-full w-full overflow-hidden select-none`}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.window-shell, .top-bar, .start-menu')) return;
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.context-menu')) setContextMenu(null);
      }}
    >
      <TopBar />
      <DesktopIcons onOpen={openApp} />
      {windows.map((win) => (
        <WindowFrame key={win.id} win={win}>
          <AppContent win={win} fs={fs} commit={commit} resetFs={resetFs} />
        </WindowFrame>
      ))}
      <StartMenu />
      {contextMenu && <DesktopContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} commit={commit} />}
    </main>
  );
}

function TopBar() {
  const now = useClock();
  const windows = useDesktop((s) => s.windows);
  const activeId = useDesktop((s) => s.activeId);
  const restore = useDesktop((s) => s.restoreWindow);
  const focus = useDesktop((s) => s.focusWindow);
  const startOpen = useDesktop((s) => s.startOpen);
  const setStartOpen = useDesktop((s) => s.setStartOpen);

  return (
    <header className="top-bar absolute inset-x-0 top-0 z-[10000] flex h-[34px] items-center justify-between border-b border-white/10 bg-black/55 px-2 text-[13px] text-white backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-1">
        <button className="flex h-7 items-center gap-2 rounded-md px-2 font-semibold hover:bg-white/15" onClick={() => setStartOpen(!startOpen)}>
          <Menu size={16} /> Activities
        </button>
        <div className="ml-1 flex min-w-0 items-center gap-1">
          {windows.map((win) => {
            const Icon = appDefinitions[win.kind].icon;
            return (
              <button
                key={win.id}
                title={`${win.title} · PID ${win.pid}`}
                className={`flex h-7 max-w-32 items-center gap-1.5 rounded-md px-2 ${activeId === win.id && !win.minimized ? 'bg-white/20' : 'hover:bg-white/12'}`}
                onClick={() => (win.minimized ? restore(win.id) : focus(win.id))}
              >
                <Icon size={15} />
                <span className="truncate">{win.title}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 font-medium">
        {now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} &nbsp;
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/10"><Wifi size={15} /><BatteryFull size={16} /></div>
        <button className="rounded-md p-1.5 hover:bg-white/10" title="Restart virtual desktop" onClick={() => confirm('Restart Vibe Linux? Unsaved editor changes may be lost.') && location.reload()}><Power size={15} /></button>
      </div>
    </header>
  );
}

function DesktopIcons({ onOpen }: { onOpen: (kind: AppKind, data?: Record<string, string>) => void }) {
  const icons: Array<{ label: string; icon: LucideIcon; action: () => void }> = [
    { label: 'Home', icon: Home, action: () => onOpen('files', { path: '/home/user' }) },
    { label: 'Terminal', icon: TerminalIcon, action: () => onOpen('terminal') },
    { label: 'Browser', icon: Globe, action: () => onOpen('browser') },
    { label: 'Documents', icon: BookOpen, action: () => onOpen('documents') },
    { label: 'Software', icon: Package, action: () => onOpen('store') },
  ];
  return (
    <div className="absolute left-3 top-12 z-[1] flex flex-col gap-1">
      {icons.map(({ label, icon: Icon, action }) => (
        <button key={label} className="desktop-icon flex flex-col items-center gap-1" onDoubleClick={action} onClick={(e) => e.currentTarget.focus()}>
          <Icon size={40} strokeWidth={1.5} />
          <span className="text-xs font-medium">{label}</span>
        </button>
      ))}
    </div>
  );
}

function StartMenu() {
  const open = useDesktop((s) => s.startOpen);
  const setOpen = useDesktop((s) => s.setStartOpen);
  const openApp = useDesktop((s) => s.openApp);
  const installed = useDesktop((s) => s.installedApps);
  const [query, setQuery] = useState('');
  if (!open) return null;

  const apps = installed.filter((kind) => `${appDefinitions[kind].title} ${appDefinitions[kind].description}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="start-menu absolute left-2 top-10 z-[12000] w-[470px] rounded-2xl p-4" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center gap-3">
        <CircleUserRound size={34} />
        <div><div className="font-semibold">Vibe User</div><div className="text-xs opacity-60">user@vibe-linux</div></div>
        <button className="ubuntu-button ml-auto rounded-lg p-2" onClick={() => setOpen(false)}><X size={16} /></button>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-45" size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search applications" className="w-full rounded-xl border border-[var(--border)] bg-black/15 py-2 pl-9 pr-3 outline-none focus:ring-2 focus:ring-orange-500/50" />
      </div>
      <div className="grid max-h-[390px] grid-cols-4 gap-2 overflow-auto">
        {apps.map((kind) => {
          const def = appDefinitions[kind];
          const Icon = def.icon;
          return (
            <button key={kind} className="rounded-xl p-3 text-center hover:bg-white/10" onClick={() => openApp(kind)} title={def.description}>
              <Icon className="mx-auto mb-2" size={30} />
              <span className="text-xs">{def.title}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DesktopContextMenu({ x, y, onClose, commit }: { x: number; y: number; onClose: () => void; commit: FsCommit }) {
  const action = (fn: () => void) => { fn(); onClose(); };
  const openApp = useDesktop((s) => s.openApp);
  return (
    <div className="context-menu absolute z-[13000] w-60 rounded-xl p-1.5 text-sm" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => action(() => openApp('terminal'))}>Open Terminal</button>
      <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => action(() => openApp('files', { path: '/home/user/Desktop' }))}>Open Desktop Folder</button>
      <div className="my-1 border-t border-[var(--border)]" />
      <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => action(() => {
        const name = prompt('New folder name');
        if (name) commit((draft) => makeDir(draft, `/home/user/Desktop/${name}`));
      })}>New Folder</button>
      <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => action(() => openApp('documents', { path: '/home/user/Documents/Untitled.vdoc' }))}>New Document</button>
      <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => action(() => openApp('settings'))}>Change Background</button>
    </div>
  );
}

function WindowFrame({ win, children }: { win: AppWindowState; children: ReactNode }) {
  const closeWindow = useDesktop((s) => s.closeWindow);
  const minimizeWindow = useDesktop((s) => s.minimizeWindow);
  const focusWindow = useDesktop((s) => s.focusWindow);
  const updateWindow = useDesktop((s) => s.updateWindow);
  const toggleMaximize = useDesktop((s) => s.toggleMaximize);
  const activeId = useDesktop((s) => s.activeId);
  const Icon = appDefinitions[win.kind].icon;

  const beginDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (win.maximized || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    focusWindow(win.id);
    const start = { px: e.clientX, py: e.clientY, x: win.x, y: win.y };
    const move = (ev: PointerEvent) => updateWindow(win.id, {
      x: Math.max(-win.width + 140, Math.min(window.innerWidth - 140, start.x + ev.clientX - start.px)),
      y: Math.max(34, Math.min(window.innerHeight - 80, start.y + ev.clientY - start.py)),
    });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const beginResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (win.maximized) return;
    e.stopPropagation();
    const start = { px: e.clientX, py: e.clientY, w: win.width, h: win.height };
    const move = (ev: PointerEvent) => updateWindow(win.id, {
      width: Math.max(340, Math.min(window.innerWidth - win.x, start.w + ev.clientX - start.px)),
      height: Math.max(240, Math.min(window.innerHeight - win.y, start.h + ev.clientY - start.py)),
    });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (win.minimized) return null;
  const style = win.maximized
    ? { left: 0, top: 34, width: '100%', height: 'calc(100% - 34px)', zIndex: win.z }
    : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.z };

  return (
    <section className={`window-shell ${win.maximized ? 'maximized' : ''} ${activeId === win.id ? 'ring-1 ring-white/10' : ''}`} style={style} onPointerDown={() => focusWindow(win.id)}>
      <div className="window-titlebar" onPointerDown={beginDrag} onDoubleClick={() => toggleMaximize(win.id)}>
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium"><Icon size={16} /><span className="truncate">{win.title}</span><span className="text-[10px] opacity-35">PID {win.pid}</span></div>
        <div className="flex items-center gap-1">
          <button aria-label="Minimize" className="rounded-md p-1.5 hover:bg-white/10" onClick={() => minimizeWindow(win.id)}><Minus size={15} /></button>
          <button aria-label="Maximize" className="rounded-md p-1.5 hover:bg-white/10" onClick={() => toggleMaximize(win.id)}>{win.maximized ? <Square size={13} /> : <Maximize2 size={14} />}</button>
          <button aria-label="Close" className="rounded-md bg-orange-600/90 p-1.5 text-white hover:bg-orange-500" onClick={() => closeWindow(win.id)}><X size={15} /></button>
        </div>
      </div>
      <div className="window-content">{children}</div>
      {!win.maximized && <div className="resize-handle" onPointerDown={beginResize} />}
    </section>
  );
}

function AppContent({ win, fs, commit, resetFs }: { win: AppWindowState; fs: VfsNode; commit: FsCommit; resetFs: () => void }) {
  switch (win.kind) {
    case 'terminal': return <TerminalApp fs={fs} commit={commit} />;
    case 'files': return <FileManagerApp fs={fs} commit={commit} initialPath={win.data?.path} />;
    case 'editor': return <TextEditorApp fs={fs} commit={commit} initialPath={win.data?.path} />;
    case 'documents': return <DocumentsApp fs={fs} commit={commit} initialPath={win.data?.path} />;
    case 'settings': return <SettingsApp resetFs={resetFs} />;
    case 'calculator': return <CalculatorApp />;
    case 'browser': return <BrowserApp initialUrl={win.data?.url} />;
    case 'store': return <StoreApp />;
    case 'systemMonitor': return <SystemMonitorApp fs={fs} />;
    case 'archive': return <ArchiveApp fs={fs} commit={commit} />;
    case 'imageViewer': return <ImageViewerApp fs={fs} path={win.data?.path} />;
  }
}

function shellTokens(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((part) => part.replace(/^(["'])|(["'])$/g, ''));
}

const builtinCommands = [
  'help', 'man', 'ls', 'cd', 'pwd', 'mkdir', 'touch', 'cat', 'rm', 'cp', 'mv', 'echo', 'printf', 'grep', 'find', 'tree', 'head', 'tail', 'wc',
  'basename', 'dirname', 'history', 'clear', 'whoami', 'id', 'groups', 'hostname', 'date', 'uname', 'uptime', 'env', 'export', 'unset', 'which',
  'ps', 'top', 'kill', 'df', 'free', 'apt', 'sudo', 'nano', 'gedit', 'libreoffice', 'writer', 'firefox', 'browser', 'nautilus', 'software',
  'gnome-system-monitor', 'xdg-open', 'open', 'curl', 'wget', 'ping', 'reboot', 'shutdown', 'poweroff', 'chmod', 'chown',
];

const manPages: Record<string, string> = {
  ls: 'ls [-a] [-l] [path] — list directory contents',
  cp: 'cp [-r] SOURCE DEST — copy files or directories in the virtual filesystem',
  mv: 'mv SOURCE DEST — move or rename files and directories',
  find: 'find [path] [-name pattern] — recursively search the virtual filesystem',
  grep: 'grep [-i] [-n] PATTERN [file...] — search text',
  apt: 'apt update | install PKG | remove PKG | search TERM | list --installed — manage Vibe apps',
  ps: 'ps — list virtual desktop processes. Every open window has a PID.',
  curl: 'curl URL — HTTP GET using browser fetch. Cross-origin requests depend on the target CORS policy.',
  wget: 'wget URL [output] — download a CORS-accessible resource into the virtual Downloads folder.',
};

function TerminalApp({ fs, commit }: { fs: VfsNode; commit: FsCommit }) {
  const [cwd, setCwd] = useState('/home/user');
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [env, setEnv] = useState<Record<string, string>>({ USER: 'user', HOME: '/home/user', SHELL: '/bin/vibe-sh', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8' });
  const [history, setHistory] = useState<Array<{ prompt: string; command: string; output: string }>>([
    { prompt: '', command: '', output: 'Vibe Linux 2.0 — browser Linux environment\nType “help” for commands. Files, apps and processes are linked across the desktop.' },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openApp = useDesktop((s) => s.openApp);
  const installApp = useDesktop((s) => s.installApp);
  const uninstallApp = useDesktop((s) => s.uninstallApp);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [history]);

  const promptText = `user@vibe:${cwd === '/home/user' ? '~' : cwd.replace('/home/user', '~')}$`;
  const pathArg = (value?: string) => normalizePath(value || '.', cwd);
  const expand = (value: string) => value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, key: string) => env[key] ?? '');

  const openPath = (target: string) => {
    if (/^https?:\/\//i.test(target)) return openApp('browser', { url: target });
    const path = pathArg(target);
    const node = getNode(fs, path);
    if (!node) throw new Error(`open: ${target}: No such file or directory`);
    if (node.type === 'dir') return openApp('files', { path });
    if (node.mime?.startsWith('image/')) return openApp('imageViewer', { path });
    if (/\.(vdoc|html?|htm)$/i.test(path) || node.mime === 'text/html') return openApp('documents', { path });
    return openApp('editor', { path });
  };

  const packageFromName = (name: string) => allAppKinds.find((kind) => appDefinitions[kind].packageName === name || kind === name);

  const runSimple = async (rawCommand: string, stdin = ''): Promise<string> => {
    const command = rawCommand.trim();
    const tokens = shellTokens(command);
    const name = tokens[0] ?? '';
    const args = tokens.slice(1).map(expand);
    if (!name) return stdin;

    if (name === 'help') return [
      'File commands: ls cd pwd mkdir touch cat rm cp mv find tree basename dirname',
      'Text commands: echo printf grep head tail wc',
      'Shell commands: history env export unset which man clear',
      'System commands: whoami id groups hostname date uname uptime ps top kill df free',
      'Packages/apps: apt sudo nano gedit libreoffice firefox nautilus software gnome-system-monitor xdg-open',
      'Network: curl wget ping',
      'Power/metadata: reboot shutdown poweroff chmod chown',
      '',
      'Examples:',
      '  ls -la /home/user',
      '  mkdir -p ~/Projects/demo',
      '  echo "hello" > ~/Documents/hello.txt',
      '  grep -n hello ~/Documents/hello.txt',
      '  find ~ -name "*.txt"',
      '  apt search vibe',
      '  apt install vibe-archive',
      '  ps',
      '',
      'Native kernel drivers, ELF binaries, real sudo/systemd/SSH and raw sockets cannot run in a normal browser sandbox.',
    ].join('\n');
    if (name === 'man') return manPages[args[0]] || `${args[0] || 'man'}: no manual entry. Try help.`;
    if (name === 'pwd') return cwd;
    if (name === 'whoami') return 'user';
    if (name === 'id') return 'uid=1000(user) gid=1000(user) groups=1000(user),27(sudo),100(users)';
    if (name === 'groups') return 'user sudo users';
    if (name === 'hostname') return 'vibe-linux';
    if (name === 'date') return new Date().toString();
    if (name === 'uname') return args.includes('-a') ? 'VibeLinux vibe-linux 2.0.0 vibe-web x86_64 browser' : 'VibeLinux';
    if (name === 'uptime') return `up ${Math.floor(performance.now() / 60000)} min, 1 user, load average: 0.05, 0.03, 0.01`;
    if (name === 'ls') {
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const target = pathArg(args.find((a) => !a.startsWith('-')) || '.');
      const node = getNode(fs, target);
      if (!node) throw new Error(`ls: cannot access '${target}': No such file or directory`);
      if (node.type === 'file') return basename(target);
      let entries = listDir(fs, target);
      if (!flags.includes('a')) entries = entries.filter(([entry]) => !entry.startsWith('.'));
      if (!flags.includes('l')) return entries.map(([entry, child]) => child.type === 'dir' ? `${entry}/` : entry).join('  ');
      return entries.map(([entry, child]) => {
        const mode = child.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
        const size = nodeSize(child).toString().padStart(7, ' ');
        const modified = new Date(child.modifiedAt || Date.now()).toLocaleString();
        return `${mode} 1 user user ${size} ${modified} ${entry}${child.type === 'dir' ? '/' : ''}`;
      }).join('\n');
    }
    if (name === 'cd') {
      const target = pathArg(args[0] || env.HOME);
      const node = getNode(fs, target);
      if (!node) throw new Error(`cd: ${args[0] ?? ''}: No such file or directory`);
      if (node.type !== 'dir') throw new Error(`cd: ${args[0]}: Not a directory`);
      setCwd(target);
      return '';
    }
    if (name === 'mkdir') {
      const recursive = args.includes('-p');
      const targets = args.filter((a) => !a.startsWith('-'));
      if (!targets.length) throw new Error('mkdir: missing operand');
      commit((draft) => targets.forEach((target) => makeDir(draft, pathArg(target), recursive)));
      return '';
    }
    if (name === 'touch') {
      const targets = args.filter((a) => !a.startsWith('-'));
      if (!targets.length) throw new Error('touch: missing file operand');
      commit((draft) => targets.forEach((target) => touchFile(draft, pathArg(target))));
      return '';
    }
    if (name === 'cat') {
      if (!args.length) return stdin;
      return args.map((arg) => readFile(fs, pathArg(arg))).join('');
    }
    if (name === 'rm') {
      const recursive = args.some((a) => a.includes('r'));
      const targets = args.filter((a) => !a.startsWith('-'));
      if (!targets.length) throw new Error('rm: missing operand');
      for (const target of targets) {
        const node = getNode(fs, pathArg(target));
        if (node?.type === 'dir' && !recursive) throw new Error(`rm: cannot remove '${target}': Is a directory (use -r)`);
      }
      commit((draft) => targets.forEach((target) => removeNode(draft, pathArg(target))));
      return '';
    }
    if (name === 'cp') {
      const recursive = args.some((a) => a.includes('r'));
      const positional = args.filter((a) => !a.startsWith('-'));
      if (positional.length < 2) throw new Error('cp: missing file operand');
      const srcNode = getNode(fs, pathArg(positional[0]));
      if (srcNode?.type === 'dir' && !recursive) throw new Error(`cp: -r not specified; omitting directory '${positional[0]}'`);
      commit((draft) => copyNode(draft, pathArg(positional[0]), pathArg(positional[1])));
      return '';
    }
    if (name === 'mv') {
      if (args.length < 2) throw new Error('mv: missing file operand');
      commit((draft) => moveNode(draft, pathArg(args[0]), pathArg(args[1])));
      return '';
    }
    if (name === 'echo' || name === 'printf') {
      const rest = expand(command.slice(name.length).trimStart());
      const match = rest.match(/^(.*?)(>>|>)([^>]+)$/);
      let text = match ? match[1].trim() : rest;
      text = text.replace(/^(["'])|(["'])$/g, '');
      if (name === 'printf') text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      if (match) {
        const target = pathArg(match[3].trim());
        commit((draft) => match[2] === '>>' ? appendFile(draft, target, name === 'echo' ? `${text}\n` : text) : writeFile(draft, target, name === 'echo' ? `${text}\n` : text));
        return '';
      }
      return name === 'echo' ? text : text;
    }
    if (name === 'grep') {
      const insensitive = args.includes('-i');
      const numbered = args.includes('-n');
      const positional = args.filter((a) => !a.startsWith('-'));
      if (!positional[0]) throw new Error('grep: missing pattern');
      const pattern = positional[0];
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), insensitive ? 'i' : '');
      const sources = positional.slice(1);
      const blocks = sources.length ? sources.map((source) => ({ label: source, text: readFile(fs, pathArg(source)) })) : [{ label: '', text: stdin }];
      const output: string[] = [];
      blocks.forEach(({ label, text }) => text.split('\n').forEach((line, index) => {
        if (re.test(line)) output.push(`${sources.length > 1 ? `${label}:` : ''}${numbered ? `${index + 1}:` : ''}${line}`);
      }));
      return output.join('\n');
    }
    if (name === 'find') {
      const start = pathArg(args[0] && !args[0].startsWith('-') ? args[0] : '.');
      const nameIndex = args.indexOf('-name');
      const pattern = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
      const matcher = pattern ? globToRegExp(pattern) : null;
      return walkFs(fs, start).filter(({ path }) => !matcher || matcher.test(basename(path))).map(({ path }) => path).join('\n');
    }
    if (name === 'tree') return treeText(fs, pathArg(args.find((a) => !a.startsWith('-')) || '.'));
    if (name === 'head' || name === 'tail') {
      const nIndex = args.indexOf('-n');
      const count = nIndex >= 0 ? Math.max(0, Number(args[nIndex + 1]) || 10) : 10;
      const positional = args.filter((arg, index) => !arg.startsWith('-') && index !== nIndex + 1);
      const text = positional.length ? readFile(fs, pathArg(positional[0])) : stdin;
      const lines = text.split('\n');
      return (name === 'head' ? lines.slice(0, count) : lines.slice(-count)).join('\n');
    }
    if (name === 'wc') {
      const positional = args.filter((a) => !a.startsWith('-'));
      const text = positional.length ? readFile(fs, pathArg(positional[0])) : stdin;
      const lines = text ? text.split('\n').length : 0;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const chars = text.length;
      if (args.includes('-l')) return String(lines);
      if (args.includes('-w')) return String(words);
      if (args.includes('-c')) return String(chars);
      return `${lines} ${words} ${chars}${positional[0] ? ` ${positional[0]}` : ''}`;
    }
    if (name === 'basename') return basename(pathArg(args[0] || '.'));
    if (name === 'dirname') return dirname(pathArg(args[0] || '.'));
    if (name === 'history') return commandHistory.map((item, index) => `${String(index + 1).padStart(4, ' ')}  ${item}`).join('\n');
    if (name === 'env') return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n');
    if (name === 'export') {
      if (!args[0]) return Object.entries(env).map(([key, value]) => `declare -x ${key}="${value}"`).join('\n');
      const [key, ...rest] = args[0].split('=');
      if (!key) throw new Error('export: invalid identifier');
      setEnv((old) => ({ ...old, [key]: rest.join('=') }));
      return '';
    }
    if (name === 'unset') { if (args[0]) setEnv((old) => { const next = { ...old }; delete next[args[0]]; return next; }); return ''; }
    if (name === 'which') return args.map((cmd) => builtinCommands.includes(cmd) ? `/usr/bin/${cmd}` : `${cmd} not found`).join('\n');
    if (name === 'ps') {
      const windows = useDesktop.getState().windows;
      return ['  PID TTY      STAT CMD', '    1 ?        Ss   vibe-init', '   42 ?        Sl   gnome-shell', ...windows.map((w) => `${String(w.pid).padStart(5, ' ')} pts/0    S    ${appDefinitions[w.kind].packageName}`)].join('\n');
    }
    if (name === 'top') {
      const windows = useDesktop.getState().windows;
      return [`top - ${new Date().toLocaleTimeString()} up ${Math.floor(performance.now() / 60000)} min`, `Tasks: ${windows.length + 2} total, ${windows.length + 2} running`, '%Cpu(s): browser-managed', '', '  PID USER      %CPU %MEM COMMAND', '    1 root       0.0  0.1 vibe-init', '   42 user       0.4  1.2 gnome-shell', ...windows.map((w, i) => `${String(w.pid).padStart(5, ' ')} user      ${(0.1 + (i % 4) * 0.2).toFixed(1)}  0.4 ${appDefinitions[w.kind].packageName}`)].join('\n');
    }
    if (name === 'kill') {
      const pid = Number(args.find((a) => !a.startsWith('-')));
      if (!Number.isFinite(pid)) throw new Error('kill: usage: kill PID');
      if (pid === 1 || pid === 42) throw new Error(`kill: (${pid}) Operation not permitted`);
      if (!useDesktop.getState().closePid(pid)) throw new Error(`kill: (${pid}) No such process`);
      return '';
    }
    if (name === 'df') {
      const estimate = await navigator.storage?.estimate?.();
      const quota = estimate?.quota || 0;
      const usage = estimate?.usage || nodeSize(fs);
      return ['Filesystem      Size   Used  Avail Use% Mounted on', `indexeddb       ${formatBytes(quota).padStart(6)} ${formatBytes(usage).padStart(6)} ${formatBytes(Math.max(0, quota - usage)).padStart(6)} ${quota ? Math.round(usage / quota * 100) : 0}% /`].join('\n');
    }
    if (name === 'free') {
      const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0;
      return ['               total        used        free', `Mem:        ${memory ? `${memory}G` : 'browser'}     managed     managed`, 'Swap:             0B          0B          0B'].join('\n');
    }
    if (name === 'sudo') return runSimple(args.join(' '), stdin);
    if (name === 'apt') {
      const sub = args[0] || 'help';
      if (sub === 'update') return 'Hit:1 vibe://packages stable InRelease\nReading package lists... Done\nAll packages are up to date.';
      if (sub === 'search') {
        const q = (args[1] || '').toLowerCase();
        return allAppKinds.filter((kind) => `${appDefinitions[kind].packageName} ${appDefinitions[kind].description}`.toLowerCase().includes(q)).map((kind) => `${appDefinitions[kind].packageName}/stable 2.0 web\n  ${appDefinitions[kind].description}`).join('\n');
      }
      if (sub === 'list') {
        const installed = useDesktop.getState().installedApps;
        const pool = args.includes('--installed') ? installed : allAppKinds;
        return pool.map((kind) => `${appDefinitions[kind].packageName}/stable,now 2.0 web ${installed.includes(kind) ? '[installed]' : ''}`.trim()).join('\n');
      }
      if (sub === 'install') {
        if (!args[1]) throw new Error('apt: install requires a package name');
        const kind = packageFromName(args[1]);
        if (!kind) throw new Error(`E: Unable to locate package ${args[1]}`);
        installApp(kind);
        return `Reading package lists... Done\nInstalling ${appDefinitions[kind].packageName}... Done`;
      }
      if (sub === 'remove' || sub === 'purge') {
        if (!args[1]) throw new Error('apt: remove requires a package name');
        const kind = packageFromName(args[1]);
        if (!kind) throw new Error(`E: Unable to locate package ${args[1]}`);
        if (appDefinitions[kind].core) throw new Error(`${appDefinitions[kind].packageName} is an essential Vibe package and cannot be removed.`);
        uninstallApp(kind);
        return `Removing ${appDefinitions[kind].packageName}... Done`;
      }
      return 'apt commands: update, search TERM, list [--installed], install PACKAGE, remove PACKAGE';
    }
    if (name === 'nano' || name === 'gedit') { openApp('editor', { path: pathArg(args[0] || 'untitled.txt') }); return ''; }
    if (name === 'libreoffice' || name === 'writer') { openApp('documents', { path: pathArg(args[0] || 'Documents/Untitled.vdoc') }); return ''; }
    if (name === 'firefox' || name === 'browser') { openApp('browser', args[0] ? { url: args[0] } : undefined); return ''; }
    if (name === 'nautilus') { openApp('files', { path: pathArg(args[0] || '.') }); return ''; }
    if (name === 'software') { openApp('store'); return ''; }
    if (name === 'gnome-system-monitor') { openApp('systemMonitor'); return ''; }
    if (name === 'xdg-open' || name === 'open') { if (!args[0]) throw new Error(`${name}: missing operand`); openPath(args[0]); return ''; }
    if (name === 'curl') {
      if (!args[0]) throw new Error('curl: try curl URL');
      try {
        const response = await fetch(args[0]);
        const text = await response.text();
        return text.slice(0, 100000);
      } catch (error) {
        throw new Error(`curl: request failed (${error instanceof Error ? error.message : String(error)}). The remote server may block browser CORS.`);
      }
    }
    if (name === 'wget') {
      if (!args[0]) throw new Error('wget: missing URL');
      try {
        const response = await fetch(args[0]);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const mime = response.headers.get('content-type') || 'application/octet-stream';
        const defaultName = new URL(args[0]).pathname.split('/').filter(Boolean).at(-1) || 'index.html';
        const output = args[1] ? pathArg(args[1]) : `/home/user/Downloads/${defaultName}`;
        if (isTextMime(mime)) {
          const text = await response.text();
          commit((draft) => writeFile(draft, output, text, mime));
        } else {
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
          commit((draft) => writeFile(draft, output, dataUrl, mime));
        }
        return `Saved to ${output}`;
      } catch (error) {
        throw new Error(`wget: download failed (${error instanceof Error ? error.message : String(error)}). Browser CORS rules apply.`);
      }
    }
    if (name === 'ping') return 'ping: raw ICMP sockets are not available to browser JavaScript. Use curl for HTTP reachability instead.';
    if (name === 'reboot') { setTimeout(() => location.reload(), 500); return 'Broadcast message: The virtual system is going down for reboot NOW!'; }
    if (name === 'shutdown' || name === 'poweroff') return 'A web page cannot power off the host computer. Close this tab to stop Vibe Linux.';
    if (name === 'chmod' || name === 'chown') return `${name}: metadata accepted by the virtual shell; permission enforcement is not available yet.`;
    throw new Error(`${name}: command not found`);
  };

  const execute = async (raw: string): Promise<string> => {
    const segments = raw.split(/\s*;\s*/).filter(Boolean);
    const outputs: string[] = [];
    for (const segment of segments) {
      const pipes = segment.split(/\s*\|\s*/);
      let piped = '';
      for (const pipe of pipes) piped = await runSimple(pipe, piped);
      if (piped) outputs.push(piped);
    }
    return outputs.join('\n');
  };

  const submit = async () => {
    const command = input;
    setInput('');
    setHistoryIndex(-1);
    if (!command.trim()) { setHistory((h) => [...h, { prompt: promptText, command: '', output: '' }]); return; }
    setCommandHistory((old) => [...old, command]);
    if (command.trim() === 'clear') { setHistory([]); return; }
    try {
      const output = await execute(command);
      setHistory((h) => [...h, { prompt: promptText, command, output }]);
    } catch (error) {
      setHistory((h) => [...h, { prompt: promptText, command, output: error instanceof Error ? error.message : String(error) }]);
    }
  };

  const historyKey = (direction: -1 | 1) => {
    if (!commandHistory.length) return;
    let next = historyIndex;
    if (direction === -1) next = historyIndex < 0 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
    else next = historyIndex < 0 ? -1 : Math.min(commandHistory.length, historyIndex + 1);
    setHistoryIndex(next);
    setInput(next >= 0 && next < commandHistory.length ? commandHistory[next] : '');
  };

  return (
    <div className="flex h-full flex-col bg-[#2b1b2f] font-mono text-[13px] text-[#f4edf5]">
      <div ref={scrollRef} className="terminal-scroll flex-1 overflow-auto p-4 whitespace-pre-wrap">
        {history.map((item, i) => <div key={i} className="mb-2">{item.prompt && <div><span className="font-bold text-[#8ae234]">{item.prompt}</span> <span>{item.command}</span></div>}{item.output && <div className="text-[#eee8d5]">{item.output}</div>}</div>)}
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-bold text-[#8ae234]">{promptText}</span>
          <input autoFocus spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'ArrowUp') { e.preventDefault(); historyKey(-1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); historyKey(1); }
          }} className="min-w-0 flex-1 bg-transparent text-white outline-none" />
        </div>
      </div>
    </div>
  );
}

function FileManagerApp({ fs, commit, initialPath }: { fs: VfsNode; commit: FsCommit; initialPath?: string }) {
  const [path, setPath] = useState(initialPath || '/home/user');
  const openApp = useDesktop((s) => s.openApp);
  const uploadRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => { try { return listDir(fs, path); } catch { return []; } }, [fs, path]);
  const places = [['Home', '/home/user'], ['Desktop', '/home/user/Desktop'], ['Documents', '/home/user/Documents'], ['Downloads', '/home/user/Downloads'], ['Pictures', '/home/user/Pictures'], ['File System', '/']] as const;

  const createFolder = () => {
    const name = prompt('Folder name');
    if (!name) return;
    try { commit((draft) => makeDir(draft, normalizePath(name, path))); } catch (e) { alert(e instanceof Error ? e.message : e); }
  };
  const createFile = () => {
    const name = prompt('File name');
    if (!name) return;
    try { commit((draft) => touchFile(draft, normalizePath(name, path))); } catch (e) { alert(e instanceof Error ? e.message : e); }
  };
  const openNode = (name: string, node: VfsNode) => {
    const full = normalizePath(name, path);
    if (node.type === 'dir') return setPath(full);
    if (node.mime?.startsWith('image/')) return openApp('imageViewer', { path: full });
    if (/\.(vdoc|html?|htm)$/i.test(name) || node.mime === 'text/html') return openApp('documents', { path: full });
    return openApp('editor', { path: full });
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const source of Array.from(files)) {
      try {
        const content = await browserFileToContent(source);
        commit((draft) => writeFile(draft, normalizePath(source.name, path), content, source.type || 'application/octet-stream'));
      } catch (error) { alert(`Upload failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (uploadRef.current) uploadRef.current.value = '';
  };

  return (
    <div className="flex h-full bg-[var(--panel-2)] text-[var(--text)]">
      <aside className="w-40 shrink-0 border-r border-[var(--border)] p-2">
        <div className="mb-2 px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide opacity-45">Places</div>
        {places.map(([label, target]) => <button key={target} onClick={() => setPath(target)} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${path === target ? 'bg-orange-600/20 text-orange-300' : 'hover:bg-white/8'}`}><Folder size={16} />{label}</button>)}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 items-center gap-1 border-b border-[var(--border)] px-2">
          <button className="ubuntu-button rounded-lg p-2" onClick={() => setPath(dirname(path))}><ChevronLeft size={16} /></button>
          <button className="ubuntu-button rounded-lg p-2" onClick={() => setPath('/home/user')}><Home size={16} /></button>
          <div className="mx-1 min-w-0 flex-1 truncate rounded-lg border border-[var(--border)] bg-black/10 px-3 py-1.5 text-sm">{path}</div>
          <button title="Upload" className="ubuntu-button rounded-lg p-2" onClick={() => uploadRef.current?.click()}><Upload size={16} /></button>
          <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e) => void uploadFiles(e.target.files)} />
          <button title="New folder" className="ubuntu-button rounded-lg p-2" onClick={createFolder}><FolderPlus size={16} /></button>
          <button title="New file" className="ubuntu-button rounded-lg p-2" onClick={createFile}><FilePlus2 size={16} /></button>
        </div>
        <div className="file-scroll flex-1 overflow-auto p-3">
          <div className="grid grid-cols-[1fr_100px_90px_120px] border-b border-[var(--border)] px-2 pb-2 text-xs font-semibold uppercase tracking-wide opacity-60"><div>Name</div><div>Type</div><div>Size</div><div className="text-right">Actions</div></div>
          {entries.map(([name, node]) => {
            const full = normalizePath(name, path);
            const Icon = node.type === 'dir' ? Folder : node.mime?.startsWith('image/') ? ImageIcon : FileText;
            return (
              <div key={name} className="grid grid-cols-[1fr_100px_90px_120px] items-center rounded-lg px-2 py-2 hover:bg-white/8" onDoubleClick={() => openNode(name, node)}>
                <div className="flex min-w-0 items-center gap-2"><Icon size={20} className={node.type === 'dir' ? 'text-orange-400' : 'opacity-80'} /><span className="truncate text-sm">{name}</span></div>
                <div className="truncate text-xs opacity-60">{node.type === 'dir' ? 'Folder' : node.mime || 'File'}</div>
                <div className="text-xs opacity-60">{formatBytes(nodeSize(node))}</div>
                <div className="flex justify-end gap-1">
                  {node.type === 'file' && <button className="rounded-md p-1.5 hover:bg-white/10" title="Download" onClick={() => downloadNode(name, node)}><Download size={14} /></button>}
                  <button className="rounded-md p-1.5 hover:bg-white/10" title="Rename" onClick={() => {
                    const next = prompt('New name', name); if (!next || next === name) return;
                    try { commit((draft) => renameNode(draft, full, next)); } catch (e) { alert(e instanceof Error ? e.message : e); }
                  }}><Pencil size={14} /></button>
                  <button className="rounded-md p-1.5 hover:bg-red-500/20" title="Delete" onClick={() => {
                    if (!confirm(`Delete ${name}?`)) return;
                    try { commit((draft) => removeNode(draft, full)); } catch (e) { alert(e instanceof Error ? e.message : e); }
                  }}><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
          {!entries.length && <div className="p-8 text-center text-sm opacity-50">This folder is empty.</div>}
        </div>
      </div>
    </div>
  );
}

function TextEditorApp({ fs, commit, initialPath }: { fs: VfsNode; commit: FsCommit; initialPath?: string }) {
  const [path, setPath] = useState(initialPath || '/home/user/Documents/untitled.txt');
  const [content, setContent] = useState(() => { try { return readFile(fs, initialPath || '/home/user/Documents/untitled.txt'); } catch { return ''; } });
  const [saved, setSaved] = useState(true);
  const openFile = () => {
    const target = prompt('Path to open', path); if (!target) return;
    try { const normalized = normalizePath(target, '/home/user'); setContent(readFile(fs, normalized)); setPath(normalized); setSaved(true); } catch (e) { alert(e instanceof Error ? e.message : e); }
  };
  const save = () => { try { commit((draft) => writeFile(draft, path, content, 'text/plain')); setSaved(true); } catch (e) { alert(e instanceof Error ? e.message : e); } };
  const saveAs = () => { const target = prompt('Save as', path); if (!target) return; setPath(normalizePath(target, '/home/user')); setTimeout(save, 0); };
  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)]">
      <div className="flex h-11 items-center gap-2 border-b border-[var(--border)] px-2">
        <button className="ubuntu-button flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm" onClick={openFile}><FolderOpen size={15} /> Open</button>
        <button className="ubuntu-button flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm" onClick={save}><Save size={15} /> Save</button>
        <button className="ubuntu-button rounded-lg px-3 py-1.5 text-sm" onClick={saveAs}>Save As</button>
        <input value={path} onChange={(e) => { setPath(e.target.value); setSaved(false); }} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-1.5 text-sm outline-none" />
      </div>
      <textarea value={content} onChange={(e) => { setContent(e.target.value); setSaved(false); }} spellCheck={false} className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-6 outline-none" />
      <div className="border-t border-[var(--border)] px-3 py-1 text-right text-[11px] opacity-60">{saved ? 'Saved' : 'Unsaved changes'} · {content.length} chars</div>
    </div>
  );
}

function DocumentsApp({ fs, commit, initialPath }: { fs: VfsNode; commit: FsCommit; initialPath?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState(initialPath || '/home/user/Documents/Untitled.vdoc');
  const [status, setStatus] = useState('Ready');

  const setEditorHtml = (html: string) => { if (editorRef.current) editorRef.current.innerHTML = html; };
  const loadPath = (target: string) => {
    const normalized = normalizePath(target, '/home/user');
    const node = getNode(fs, normalized);
    if (!node) { setPath(normalized); setEditorHtml('<h1>Untitled document</h1><p></p>'); setStatus('New document'); return; }
    if (node.type !== 'file') throw new Error('Documents can only open files.');
    setPath(normalized);
    setEditorHtml(node.mime === 'text/html' || /\.(vdoc|html?)$/i.test(normalized) ? node.content : `<pre>${escapeHtml(node.content)}</pre>`);
    setStatus('Opened');
  };

  useEffect(() => {
    try { loadPath(initialPath || '/home/user/Documents/Getting Started.vdoc'); }
    catch { setEditorHtml('<h1>Untitled document</h1><p>Start writing here…</p>'); }
  }, []);

  const exec = (command: string, value?: string) => { editorRef.current?.focus(); document.execCommand(command, false, value); setStatus('Modified'); };
  const save = () => {
    try { commit((draft) => writeFile(draft, path, editorRef.current?.innerHTML || '', 'text/html')); setStatus(`Saved ${new Date().toLocaleTimeString()}`); }
    catch (e) { alert(e instanceof Error ? e.message : e); }
  };
  const saveAs = () => { const target = prompt('Save document as', path); if (!target) return; const normalized = normalizePath(target, '/home/user'); setPath(normalized); try { commit((draft) => writeFile(draft, normalized, editorRef.current?.innerHTML || '', 'text/html')); setStatus('Saved'); } catch (e) { alert(e instanceof Error ? e.message : e); } };
  const open = () => { const target = prompt('Open document path', path); if (!target) return; try { loadPath(target); } catch (e) { alert(e instanceof Error ? e.message : e); } };
  const newDoc = () => { setPath('/home/user/Documents/Untitled.vdoc'); setEditorHtml('<h1>Untitled document</h1><p></p>'); setStatus('New document'); };
  const exportHtml = () => { const blob = new Blob([`<!doctype html><meta charset="utf-8"><body>${editorRef.current?.innerHTML || ''}</body>`], { type: 'text/html' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${basename(path).replace(/\.vdoc$/i, '')}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)]">
      <div className="flex min-h-12 flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1">
        <button className="ubuntu-button rounded-lg px-3 py-1.5 text-sm" onClick={newDoc}>New</button>
        <button className="ubuntu-button rounded-lg px-3 py-1.5 text-sm" onClick={open}>Open</button>
        <button className="ubuntu-button flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm" onClick={save}><Save size={14} /> Save</button>
        <button className="ubuntu-button rounded-lg px-3 py-1.5 text-sm" onClick={saveAs}>Save As</button>
        <button className="ubuntu-button flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm" onClick={exportHtml}><Download size={14} /> Export</button>
        <div className="mx-1 h-6 border-l border-[var(--border)]" />
        <button className="ubuntu-button rounded-lg p-2" title="Bold" onClick={() => exec('bold')}><Bold size={15} /></button>
        <button className="ubuntu-button rounded-lg p-2" title="Italic" onClick={() => exec('italic')}><Italic size={15} /></button>
        <button className="ubuntu-button rounded-lg p-2" title="Underline" onClick={() => exec('underline')}><Underline size={15} /></button>
        <button className="ubuntu-button rounded-lg p-2" title="Bulleted list" onClick={() => exec('insertUnorderedList')}><List size={15} /></button>
        <select className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm" onChange={(e) => exec('formatBlock', e.target.value)} defaultValue="p"><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option></select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#b8b8b8] p-7">
        <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={() => setStatus('Modified')} className="document-surface mx-auto min-h-full max-w-[820px] bg-white p-12 text-[15px] leading-7 text-[#181818] shadow-xl outline-none" />
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-1 text-[11px] opacity-60"><span>{path}</span><span>{status}</span></div>
    </div>
  );
}

function SettingsApp({ resetFs }: { resetFs: () => void }) {
  const theme = useDesktop((s) => s.theme);
  const wallpaper = useDesktop((s) => s.wallpaper);
  const setTheme = useDesktop((s) => s.setTheme);
  const setWallpaper = useDesktop((s) => s.setWallpaper);
  const wallpapers: Wallpaper[] = ['a', 'b', 'c', 'd'];
  return (
    <div className="h-full overflow-auto bg-[var(--panel-2)] p-5">
      <h2 className="mb-5 text-xl font-semibold">Settings</h2>
      <section className="mb-6 rounded-2xl border border-[var(--border)] p-4">
        <div className="mb-3 text-sm font-medium">Color scheme</div>
        <div className="grid grid-cols-2 gap-3">
          <button className={`ubuntu-button flex items-center justify-center gap-2 rounded-xl p-4 ${theme === 'dark' ? 'ring-2 ring-orange-500' : ''}`} onClick={() => setTheme('dark')}><Moon size={20} /> Dark</button>
          <button className={`ubuntu-button flex items-center justify-center gap-2 rounded-xl p-4 ${theme === 'light' ? 'ring-2 ring-orange-500' : ''}`} onClick={() => setTheme('light')}><Sun size={20} /> Light</button>
        </div>
      </section>
      <section className="mb-6 rounded-2xl border border-[var(--border)] p-4">
        <div className="mb-3 text-sm font-medium">Wallpaper</div>
        <div className="grid grid-cols-4 gap-3">{wallpapers.map((item) => <button key={item} className={`wallpaper-${item} aspect-video rounded-xl border border-white/15 ${wallpaper === item ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-transparent' : ''}`} onClick={() => setWallpaper(item)} />)}</div>
      </section>
      <section className="mb-6 rounded-2xl border border-[var(--border)] p-4">
        <div className="font-medium">About this virtual system</div>
        <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm"><span className="opacity-55">OS</span><span>Vibe Linux 2.0</span><span className="opacity-55">Kernel</span><span>vibe-web (browser sandbox)</span><span className="opacity-55">CPU threads</span><span>{navigator.hardwareConcurrency || 'Unknown'}</span><span className="opacity-55">Storage</span><span>IndexedDB</span><span className="opacity-55">Platform</span><span>{navigator.platform || 'Web'}</span></div>
        <p className="mt-4 text-xs leading-5 opacity-55">Vibe Linux emulates Linux desktop behavior in the browser. Native drivers, host files, raw sockets, systemd and arbitrary native Linux executables remain isolated by browser security.</p>
      </section>
      <section className="rounded-2xl border border-[var(--border)] p-4">
        <div className="font-medium">Virtual filesystem</div>
        <p className="mt-1 text-sm opacity-60">Files are stored locally in this browser using IndexedDB.</p>
        <button className="mt-3 flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500" onClick={() => confirm('Reset all virtual files?') && resetFs()}><RefreshCw size={15} /> Reset filesystem</button>
      </section>
    </div>
  );
}

function CalculatorApp() {
  const [expr, setExpr] = useState('');
  const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '%', '+'];
  const calculate = () => {
    if (!expr || !/^[0-9+\-*/().%\s]+$/.test(expr)) return setExpr('Error');
    try { const value = Function(`"use strict"; return (${expr.replace(/%/g, '/100')})`)(); setExpr(String(value)); } catch { setExpr('Error'); }
  };
  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)] p-4">
      <input value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && calculate()} className="mb-4 h-20 rounded-xl border border-[var(--border)] bg-black/15 px-4 text-right text-3xl outline-none" />
      <div className="grid flex-1 grid-cols-4 gap-2"><button className="ubuntu-button col-span-2 rounded-xl" onClick={() => setExpr('')}>AC</button><button className="ubuntu-button rounded-xl" onClick={() => setExpr((v) => v.slice(0, -1))}>⌫</button><button className="rounded-xl bg-orange-600 text-white hover:bg-orange-500" onClick={calculate}>=</button>{keys.map((key) => <button key={key} className="ubuntu-button rounded-xl text-lg" onClick={() => setExpr((v) => v === 'Error' ? key : v + key)}>{key}</button>)}</div>
    </div>
  );
}

type BrowserTab = { id: string; url: string; input: string; history: string[]; index: number };

function normalizeBrowserUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 'vibe://home';
  if (trimmed === 'vibe://home') return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function BrowserApp({ initialUrl }: { initialUrl?: string }) {
  const newTab = (url = 'vibe://home'): BrowserTab => ({ id: crypto.randomUUID(), url, input: url, history: [url], index: 0 });
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [newTab(initialUrl ? normalizeBrowserUrl(initialUrl) : 'vibe://home')]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [frameKey, setFrameKey] = useState(0);
  const [bookmarks, setBookmarks] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('vibe-browser-bookmarks') || '[]'); } catch { return []; } });
  const active = tabs.find((tab) => tab.id === activeId) || tabs[0];
  const updateActive = (fn: (tab: BrowserTab) => BrowserTab) => setTabs((old) => old.map((tab) => tab.id === activeId ? fn(tab) : tab));
  const navigate = (value = active.input) => {
    const next = normalizeBrowserUrl(value);
    updateActive((tab) => ({ ...tab, url: next, input: next, history: [...tab.history.slice(0, tab.index + 1), next], index: tab.index + 1 }));
  };
  const moveHistory = (delta: number) => updateActive((tab) => { const index = Math.max(0, Math.min(tab.history.length - 1, tab.index + delta)); const url = tab.history[index]; return { ...tab, index, url, input: url }; });
  const addTab = () => { const tab = newTab(); setTabs((old) => [...old, tab]); setActiveId(tab.id); };
  const closeTab = (id: string) => {
    setTabs((old) => {
      if (old.length === 1) return [newTab()];
      const index = old.findIndex((tab) => tab.id === id);
      const next = old.filter((tab) => tab.id !== id);
      if (id === activeId) setActiveId(next[Math.max(0, index - 1)].id);
      return next;
    });
  };
  const toggleBookmark = () => {
    const next = bookmarks.includes(active.url) ? bookmarks.filter((url) => url !== active.url) : [...bookmarks, active.url];
    setBookmarks(next); localStorage.setItem('vibe-browser-bookmarks', JSON.stringify(next));
  };

  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)]">
      <div className="flex h-9 items-end gap-1 overflow-x-auto border-b border-[var(--border)] px-2 pt-1">
        {tabs.map((tab) => <button key={tab.id} onClick={() => setActiveId(tab.id)} className={`group flex min-w-32 max-w-52 items-center gap-2 rounded-t-lg px-3 py-1.5 text-xs ${tab.id === activeId ? 'bg-white/12' : 'hover:bg-white/7'}`}><Globe size={13} /><span className="min-w-0 flex-1 truncate">{tab.url === 'vibe://home' ? 'New Tab' : tab.url.replace(/^https?:\/\//, '')}</span><X size={12} className="opacity-40 hover:opacity-100" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} /></button>)}
        <button className="mb-1 rounded-md p-1 hover:bg-white/10" onClick={addTab}><Plus size={15} /></button>
      </div>
      <div className="flex h-12 items-center gap-1 border-b border-[var(--border)] px-2">
        <button className="ubuntu-button rounded-lg p-2" disabled={active.index <= 0} onClick={() => moveHistory(-1)}><ChevronLeft size={16} /></button>
        <button className="ubuntu-button rounded-lg p-2" disabled={active.index >= active.history.length - 1} onClick={() => moveHistory(1)}><ChevronRight size={16} /></button>
        <button className="ubuntu-button rounded-lg p-2" onClick={() => setFrameKey((k) => k + 1)}><RefreshCw size={16} /></button>
        <button className="ubuntu-button rounded-lg p-2" onClick={() => navigate('vibe://home')}><Home size={16} /></button>
        <input value={active.input} onChange={(e) => updateActive((tab) => ({ ...tab, input: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && navigate()} className="mx-1 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-1.5 text-sm outline-none" />
        <button className={`ubuntu-button rounded-lg px-2 py-1.5 text-sm ${bookmarks.includes(active.url) ? 'text-orange-400' : ''}`} title="Bookmark" onClick={toggleBookmark}>★</button>
        <button className="ubuntu-button rounded-lg p-2" title="Open in real browser tab" onClick={() => active.url.startsWith('http') && window.open(active.url, '_blank', 'noopener,noreferrer')}><ExternalLink size={16} /></button>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {active.url === 'vibe://home' ? (
          <div className="h-full overflow-auto bg-[#ece9ee] p-10 text-[#262127]">
            <div className="mx-auto max-w-3xl"><div className="mb-8 flex items-center gap-3"><Globe size={42} /><div><h2 className="text-2xl font-bold">Vibe Browser</h2><p className="text-sm opacity-60">Browse the web from your virtual Linux desktop.</p></div></div>
              <form onSubmit={(e) => { e.preventDefault(); navigate((e.currentTarget.elements.namedItem('q') as HTMLInputElement).value); }} className="mb-8 flex gap-2"><input name="q" autoFocus placeholder="Search or enter address" className="min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-4 py-3 outline-none" /><button className="rounded-xl bg-orange-600 px-5 text-white">Go</button></form>
              <div className="grid grid-cols-3 gap-3">{['https://example.com', 'https://wikipedia.org', 'https://github.com'].map((url) => <button key={url} onClick={() => navigate(url)} className="rounded-xl border border-black/10 bg-white p-4 text-left hover:bg-black/5"><Globe className="mb-2" size={22} /><div className="truncate text-sm font-medium">{url.replace('https://', '')}</div></button>)}</div>
              {!!bookmarks.length && <div className="mt-8"><h3 className="mb-3 font-semibold">Bookmarks</h3><div className="space-y-1">{bookmarks.map((url) => <button key={url} onClick={() => navigate(url)} className="block w-full truncate rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-black/5">{url}</button>)}</div></div>}
            </div>
          </div>
        ) : (
          <><iframe key={`${active.id}-${frameKey}-${active.url}`} title="Vibe browser" src={active.url} className="h-full w-full border-0" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads" /><div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[10px] text-white">If a site blocks embedding, use the ↗ button to open it in a normal tab.</div></>
        )}
      </div>
    </div>
  );
}

function StoreApp() {
  const installed = useDesktop((s) => s.installedApps);
  const install = useDesktop((s) => s.installApp);
  const uninstall = useDesktop((s) => s.uninstallApp);
  const openApp = useDesktop((s) => s.openApp);
  const [query, setQuery] = useState('');
  const apps = allAppKinds.filter((kind) => `${appDefinitions[kind].title} ${appDefinitions[kind].packageName} ${appDefinitions[kind].description}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)]">
      <div className="border-b border-[var(--border)] p-4"><div className="flex items-center gap-3"><Package size={28} className="text-orange-400" /><div><h2 className="text-lg font-semibold">Vibe Software</h2><p className="text-xs opacity-55">Client-side packages for this virtual desktop</p></div><div className="relative ml-auto w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search software" className="w-full rounded-xl border border-[var(--border)] bg-black/10 py-2 pl-9 pr-3 text-sm outline-none" /></div></div></div>
      <div className="file-scroll grid flex-1 grid-cols-2 gap-3 overflow-auto p-4">
        {apps.map((kind) => {
          const def = appDefinitions[kind]; const Icon = def.icon; const isInstalled = installed.includes(kind);
          return <article key={kind} className="flex min-h-36 gap-4 rounded-2xl border border-[var(--border)] bg-white/4 p-4"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-600/15 text-orange-400"><Icon size={30} /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold">{def.title}</h3><code className="text-[10px] opacity-45">{def.packageName}</code></div>{def.core && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]">Core</span>}</div><p className="mt-2 text-xs leading-5 opacity-60">{def.description}</p><div className="mt-3 flex gap-2">{isInstalled ? <><button className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs text-white" onClick={() => openApp(kind)}>Open</button>{!def.core && <button className="ubuntu-button rounded-lg px-3 py-1.5 text-xs" onClick={() => uninstall(kind)}>Remove</button>}</> : <button className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs text-white" onClick={() => install(kind)}>Install</button>}</div></div></article>;
        })}
      </div>
      <div className="border-t border-[var(--border)] px-4 py-2 text-xs opacity-50">Terminal equivalent: <code>apt search vibe</code> · <code>sudo apt install vibe-archive</code></div>
    </div>
  );
}

function SystemMonitorApp({ fs }: { fs: VfsNode }) {
  const windows = useDesktop((s) => s.windows);
  const closeWindow = useDesktop((s) => s.closeWindow);
  const [tab, setTab] = useState<'processes' | 'resources' | 'storage'>('processes');
  const [estimate, setEstimate] = useState<StorageEstimate>({});
  const [, setTick] = useState(0);
  useEffect(() => { void navigator.storage?.estimate?.().then(setEstimate); const id = setInterval(() => setTick((v) => v + 1), 1500); return () => clearInterval(id); }, []);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const perfMemory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const tabs = [['processes', 'Processes'], ['resources', 'Resources'], ['storage', 'Storage']] as const;
  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)]">
      <div className="flex gap-1 border-b border-[var(--border)] p-2">{tabs.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-lg px-4 py-2 text-sm ${tab === key ? 'bg-orange-600 text-white' : 'hover:bg-white/8'}`}>{label}</button>)}</div>
      <div className="file-scroll flex-1 overflow-auto p-4">
        {tab === 'processes' && <div><div className="mb-3 grid grid-cols-[70px_1fr_100px_100px] border-b border-[var(--border)] pb-2 text-xs uppercase opacity-50"><span>PID</span><span>Process</span><span>Status</span><span></span></div><div className="grid grid-cols-[70px_1fr_100px_100px] items-center rounded-lg px-2 py-2 text-sm"><span>1</span><span>vibe-init</span><span>Sleeping</span></div><div className="grid grid-cols-[70px_1fr_100px_100px] items-center rounded-lg px-2 py-2 text-sm"><span>42</span><span>gnome-shell</span><span>Running</span></div>{windows.map((win) => <div key={win.id} className="grid grid-cols-[70px_1fr_100px_100px] items-center rounded-lg px-2 py-2 text-sm hover:bg-white/7"><span>{win.pid}</span><span className="flex items-center gap-2">{appDefinitions[win.kind].title}<code className="text-[10px] opacity-35">{appDefinitions[win.kind].packageName}</code></span><span>{win.minimized ? 'Sleeping' : 'Running'}</span><button className="rounded-md bg-red-600/15 px-2 py-1 text-xs text-red-300 hover:bg-red-600/25" onClick={() => closeWindow(win.id)}>End</button></div>)}</div>}
        {tab === 'resources' && <div className="grid grid-cols-2 gap-4"><ResourceCard icon={Cpu} title="CPU" value={`${navigator.hardwareConcurrency || '?'} logical CPUs`} detail="Scheduling is managed by the browser and operating system." percent={Math.min(88, 12 + windows.length * 6)} /><ResourceCard icon={Activity} title="Memory" value={memory ? `${memory} GB device memory` : 'Browser-managed'} detail={perfMemory ? `${formatBytes(perfMemory.usedJSHeapSize)} JS heap used of ${formatBytes(perfMemory.jsHeapSizeLimit)}` : 'Detailed heap statistics are unavailable in this browser.'} percent={perfMemory ? Math.round(perfMemory.usedJSHeapSize / perfMemory.jsHeapSizeLimit * 100) : Math.min(75, 20 + windows.length * 4)} /><ResourceCard icon={Activity} title="Uptime" value={`${Math.floor(performance.now() / 60000)} minutes`} detail={`${windows.length} application windows open`} percent={Math.min(100, performance.now() / 360000)} /><ResourceCard icon={Wifi} title="Network" value={navigator.onLine ? 'Online' : 'Offline'} detail="Web networking uses browser HTTP/WebSocket APIs; raw sockets are unavailable." percent={navigator.onLine ? 100 : 0} /></div>}
        {tab === 'storage' && <div className="space-y-4"><ResourceCard icon={HardDrive} title="Browser storage quota" value={formatBytes(estimate.quota || 0)} detail={`${formatBytes(estimate.usage || 0)} used by this origin (estimate)`} percent={estimate.quota ? Math.round((estimate.usage || 0) / estimate.quota * 100) : 0} /><ResourceCard icon={Folder} title="Vibe filesystem" value={formatBytes(nodeSize(fs))} detail={`${walkFs(fs, '/').length} virtual filesystem nodes`} percent={Math.min(100, nodeSize(fs) / 1024 / 1024)} /></div>}
      </div>
    </div>
  );
}

function ResourceCard({ icon: Icon, title, value, detail, percent }: { icon: LucideIcon; title: string; value: string; detail: string; percent: number }) {
  return <section className="rounded-2xl border border-[var(--border)] p-4"><div className="mb-3 flex items-center gap-2"><Icon size={20} className="text-orange-400" /><span className="font-medium">{title}</span></div><div className="text-xl font-semibold">{value}</div><p className="mt-1 min-h-10 text-xs leading-5 opacity-55">{detail}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div></section>;
}

function ArchiveApp({ fs, commit }: { fs: VfsNode; commit: FsCommit }) {
  const [archivePath, setArchivePath] = useState('/home/user/Downloads/archive.vibe-archive');
  const [info, setInfo] = useState('Create an archive from any virtual file or folder, or inspect/extract an existing archive.');
  const createArchive = () => {
    const source = prompt('Path to archive', '/home/user/Documents'); if (!source) return;
    const normalized = normalizePath(source, '/home/user'); const node = getNode(fs, normalized); if (!node) return alert('Source does not exist.');
    const destination = prompt('Archive file path', archivePath) || archivePath;
    const payload = JSON.stringify({ format: 'vibe-archive-1', source: normalized, createdAt: Date.now(), node });
    try { commit((draft) => writeFile(draft, normalizePath(destination, '/home/user'), payload, 'application/x-vibe-archive')); setArchivePath(normalizePath(destination, '/home/user')); setInfo(`Created archive of ${normalized}`); } catch (e) { alert(e instanceof Error ? e.message : e); }
  };
  const inspect = () => {
    try { const raw = readFile(fs, archivePath); const data = JSON.parse(raw) as { source: string; node: VfsNode; createdAt: number }; setInfo(`Source: ${data.source}\nCreated: ${new Date(data.createdAt).toLocaleString()}\nSize: ${formatBytes(nodeSize(data.node))}\nItems: ${walkFs(data.node, '/').length}`); } catch (e) { alert(`Invalid archive: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const extract = () => {
    const destination = prompt('Extract into folder', '/home/user/Downloads'); if (!destination) return;
    try {
      const raw = readFile(fs, archivePath); const data = JSON.parse(raw) as { source: string; node: VfsNode };
      const dest = normalizePath(destination, '/home/user');
      commit((draft) => {
        const folder = getNode(draft, dest); if (!folder || folder.type !== 'dir') throw new Error('Destination is not a directory');
        const name = basename(data.source); if (folder.children[name]) throw new Error(`${name} already exists in destination`);
        folder.children[name] = structuredClone(data.node);
      });
      setInfo(`Extracted ${basename(data.source)} into ${dest}`);
    } catch (e) { alert(e instanceof Error ? e.message : e); }
  };
  const download = () => { const node = getNode(fs, archivePath); if (node?.type === 'file') downloadNode(basename(archivePath), node); else alert('Archive file does not exist.'); };
  return <div className="h-full overflow-auto bg-[var(--panel-2)] p-5"><div className="mb-5 flex items-center gap-3"><ArchiveIcon size={30} className="text-orange-400" /><div><h2 className="text-xl font-semibold">Archive Manager</h2><p className="text-xs opacity-55">Persistent browser-native archives</p></div></div><label className="text-xs font-medium opacity-60">Archive path</label><input value={archivePath} onChange={(e) => setArchivePath(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-black/10 px-3 py-2 text-sm outline-none" /><div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg bg-orange-600 px-3 py-2 text-sm text-white" onClick={createArchive}>Create Archive</button><button className="ubuntu-button rounded-lg px-3 py-2 text-sm" onClick={inspect}>Inspect</button><button className="ubuntu-button rounded-lg px-3 py-2 text-sm" onClick={extract}>Extract</button><button className="ubuntu-button flex items-center gap-2 rounded-lg px-3 py-2 text-sm" onClick={download}><Download size={14} /> Download</button></div><pre className="mt-5 min-h-44 whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-black/10 p-4 text-xs leading-6">{info}</pre><p className="mt-3 text-xs opacity-45">Vibe archives are JSON-based virtual filesystem snapshots, not native tar/zip archives.</p></div>;
}

function ImageViewerApp({ fs, path }: { fs: VfsNode; path?: string }) {
  const [zoom, setZoom] = useState(1);
  const node = path ? getNode(fs, path) : undefined;
  const valid = node?.type === 'file' && node.mime?.startsWith('image/') && node.content.startsWith('data:');
  return <div className="flex h-full flex-col bg-[#171717]"><div className="flex h-11 items-center gap-2 border-b border-white/10 px-3 text-white"><span className="min-w-0 flex-1 truncate text-sm">{path || 'No image selected'}</span><button className="rounded-lg bg-white/10 px-3 py-1 text-sm" onClick={() => setZoom((v) => Math.max(.25, v - .25))}>−</button><span className="w-14 text-center text-xs">{Math.round(zoom * 100)}%</span><button className="rounded-lg bg-white/10 px-3 py-1 text-sm" onClick={() => setZoom((v) => Math.min(4, v + .25))}>+</button></div><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">{valid ? <img src={node.content} alt={basename(path || '')} style={{ transform: `scale(${zoom})` }} className="max-h-full max-w-full origin-center object-contain transition-transform" /> : <div className="text-sm text-white/50">This viewer supports images uploaded through Files.</div>}</div></div>;
}
