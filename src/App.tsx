import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import {
  AppWindow as AppWindowIcon,
  BatteryFull,
  Calculator as CalculatorIcon,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Home,
  Maximize2,
  Menu,
  Minus,
  Monitor,
  Moon,
  Pencil,
  Power,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Square,
  Sun,
  Terminal as TerminalIcon,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  basename,
  dirname,
  getNode,
  initialFs,
  listDir,
  loadFs,
  makeDir,
  mutateFs,
  normalizePath,
  readFile,
  removeNode,
  renameNode,
  saveFs,
  touchFile,
  writeFile,
} from './lib/vfs';
import type { VfsNode } from './lib/vfs';

type AppKind = 'terminal' | 'files' | 'editor' | 'settings' | 'calculator' | 'browser';
type Theme = 'dark' | 'light';
type Wallpaper = 'a' | 'b' | 'c' | 'd';

type AppWindowState = {
  id: string;
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

const appDefinitions: Record<AppKind, { title: string; icon: LucideIcon; width: number; height: number }> = {
  terminal: { title: 'Terminal', icon: TerminalIcon, width: 720, height: 460 },
  files: { title: 'Files', icon: FolderOpen, width: 780, height: 520 },
  editor: { title: 'Text Editor', icon: FileText, width: 760, height: 540 },
  settings: { title: 'Settings', icon: SettingsIcon, width: 700, height: 500 },
  calculator: { title: 'Calculator', icon: CalculatorIcon, width: 360, height: 500 },
  browser: { title: 'Web Browser', icon: Globe, width: 900, height: 600 },
};

interface DesktopStore {
  windows: AppWindowState[];
  activeId: string | null;
  startOpen: boolean;
  theme: Theme;
  wallpaper: Wallpaper;
  openApp: (kind: AppKind, data?: Record<string, string>) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindow: (id: string, patch: Partial<AppWindowState>) => void;
  toggleMaximize: (id: string) => void;
  setStartOpen: (value: boolean) => void;
  setTheme: (theme: Theme) => void;
  setWallpaper: (wallpaper: Wallpaper) => void;
}

const useDesktop = create<DesktopStore>((set, get) => ({
  windows: [],
  activeId: null,
  startOpen: false,
  theme: (localStorage.getItem('vibe-theme') as Theme) || 'dark',
  wallpaper: (localStorage.getItem('vibe-wallpaper') as Wallpaper) || 'a',
  openApp: (kind, data) => {
    const def = appDefinitions[kind];
    const count = get().windows.length;
    const id = `${kind}-${crypto.randomUUID()}`;
    const z = Math.max(10, ...get().windows.map((w) => w.z + 1));
    const offset = (count % 8) * 24;
    set((state) => ({
      windows: [
        ...state.windows,
        {
          id,
          kind,
          title: def.title,
          x: 90 + offset,
          y: 76 + offset,
          width: def.width,
          height: def.height,
          minimized: false,
          maximized: false,
          z,
          data,
        },
      ],
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
  minimizeWindow: (id) =>
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
      activeId: state.activeId === id ? null : state.activeId,
    })),
  restoreWindow: (id) => {
    const top = Math.max(10, ...get().windows.map((w) => w.z + 1));
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: false, z: top } : w)),
      activeId: id,
    }));
  },
  focusWindow: (id) => {
    const current = get().windows.find((w) => w.id === id);
    if (!current || get().activeId === id) return;
    const top = Math.max(10, ...get().windows.map((w) => w.z + 1));
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

export default function App() {
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
      {contextMenu && (
        <DesktopContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          openApp={openApp}
          commit={commit}
        />
      )}
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
        <button
          className="flex h-7 items-center gap-2 rounded-md px-2 font-semibold hover:bg-white/15"
          onClick={() => setStartOpen(!startOpen)}
        >
          <Menu size={16} /> Activities
        </button>
        <div className="ml-1 flex min-w-0 items-center gap-1">
          {windows.map((win) => {
            const Icon = appDefinitions[win.kind].icon;
            return (
              <button
                key={win.id}
                title={win.title}
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
      <div className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/10">
        <Wifi size={15} />
        <BatteryFull size={16} />
        <Power size={15} />
      </div>
    </header>
  );
}

function DesktopIcons({ onOpen }: { onOpen: (kind: AppKind, data?: Record<string, string>) => void }) {
  const icons: Array<{ label: string; icon: LucideIcon; action: () => void }> = [
    { label: 'Home', icon: Home, action: () => onOpen('files', { path: '/home/user' }) },
    { label: 'Terminal', icon: TerminalIcon, action: () => onOpen('terminal') },
    { label: 'Documents', icon: Folder, action: () => onOpen('files', { path: '/home/user/Documents' }) },
  ];
  return (
    <div className="absolute left-3 top-12 z-[1] flex flex-col gap-2">
      {icons.map(({ label, icon: Icon, action }) => (
        <button key={label} className="desktop-icon flex flex-col items-center gap-1" onDoubleClick={action} onClick={(e) => e.currentTarget.focus()}>
          <Icon size={42} strokeWidth={1.5} />
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
  const [query, setQuery] = useState('');
  if (!open) return null;

  const apps = (Object.keys(appDefinitions) as AppKind[]).filter((kind) => appDefinitions[kind].title.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="start-menu absolute left-2 top-10 z-[12000] w-[410px] rounded-2xl p-4" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center gap-3">
        <CircleUserRound size={34} />
        <div>
          <div className="font-semibold">Vibe User</div>
          <div className="text-xs opacity-60">user@vibe-linux</div>
        </div>
        <button className="ubuntu-button ml-auto rounded-lg p-2" onClick={() => setOpen(false)}><X size={16} /></button>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search applications"
        className="mb-4 w-full rounded-xl border border-[var(--border)] bg-black/15 px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500/50"
      />
      <div className="grid grid-cols-3 gap-2">
        {apps.map((kind) => {
          const def = appDefinitions[kind];
          const Icon = def.icon;
          return (
            <button key={kind} className="rounded-xl p-3 text-center hover:bg-white/10" onClick={() => openApp(kind)}>
              <Icon className="mx-auto mb-2" size={30} />
              <span className="text-xs">{def.title}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DesktopContextMenu({ x, y, onClose, openApp, commit }: { x: number; y: number; onClose: () => void; openApp: (kind: AppKind) => void; commit: FsCommit }) {
  const action = (fn: () => void) => {
    fn();
    onClose();
  };
  return (
    <div className="context-menu absolute z-[13000] w-56 rounded-xl p-1.5 text-sm" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => action(() => openApp('terminal'))}>Open Terminal</button>
      <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => action(() => openApp('files'))}>Open Files</button>
      <div className="my-1 border-t border-[var(--border)]" />
      <button
        className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
        onClick={() => action(() => {
          const name = prompt('New folder name');
          if (name) commit((draft) => makeDir(draft, `/home/user/Desktop/${name}`));
        })}
      >New Folder</button>
      <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => action(() => useDesktop.getState().openApp('settings'))}>Change Background</button>
    </div>
  );
}

function WindowFrame({ win, children }: { win: AppWindowState; children: React.ReactNode }) {
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
    const move = (ev: PointerEvent) => {
      updateWindow(win.id, {
        x: Math.max(-win.width + 140, Math.min(window.innerWidth - 140, start.x + ev.clientX - start.px)),
        y: Math.max(34, Math.min(window.innerHeight - 80, start.y + ev.clientY - start.py)),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const beginResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (win.maximized) return;
    e.stopPropagation();
    const start = { px: e.clientX, py: e.clientY, w: win.width, h: win.height };
    const move = (ev: PointerEvent) => updateWindow(win.id, {
      width: Math.max(320, Math.min(window.innerWidth - win.x, start.w + ev.clientX - start.px)),
      height: Math.max(220, Math.min(window.innerHeight - win.y, start.h + ev.clientY - start.py)),
    });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
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
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium"><Icon size={16} /><span className="truncate">{win.title}</span></div>
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
    case 'settings': return <SettingsApp resetFs={resetFs} />;
    case 'calculator': return <CalculatorApp />;
    case 'browser': return <BrowserApp />;
  }
}

function shellTokens(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((part) => part.replace(/^(["'])|(["'])$/g, ''));
}

function TerminalApp({ fs, commit }: { fs: VfsNode; commit: FsCommit }) {
  const [cwd, setCwd] = useState('/home/user');
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<Array<{ prompt: string; command: string; output: string }>>([
    { prompt: '', command: '', output: 'Vibe Linux 1.0 — browser shell\nType “help” to see available commands.' },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history]);

  const promptText = `user@vibe:${cwd === '/home/user' ? '~' : cwd.replace('/home/user', '~')}$`;

  const execute = (raw: string): string => {
    const command = raw.trim();
    const tokens = shellTokens(command);
    const name = tokens[0] ?? '';
    const args = tokens.slice(1);
    const pathArg = (value?: string) => normalizePath(value || '.', cwd);

    if (name === 'pwd') return cwd;
    if (name === 'help') return [
      'Available commands:',
      '  ls [path]       list directory',
      '  cd [path]       change directory',
      '  pwd             print working directory',
      '  mkdir <name>    create directory',
      '  touch <file>    create empty file',
      '  cat <file>      print file contents',
      '  rm <path>       remove file or folder',
      '  echo <text>     print text',
      '  echo x > file   write text to file',
      '  clear           clear terminal',
      '  whoami, date, uname, neofetch',
    ].join('\n');
    if (name === 'whoami') return 'user';
    if (name === 'date') return new Date().toString();
    if (name === 'uname') return args.includes('-a') ? 'VibeLinux vibe-linux 1.0.0 web x86_64 browser' : 'VibeLinux';
    if (name === 'neofetch') return [
      '        .-/+oossssoo+/-.',
      '    `:+ssssssssssssssssss+:`',
      '  -+ssssssssssssssssssyyssss+-',
      '',
      'user@vibe-linux',
      'OS: Vibe Linux Web Desktop',
      'Kernel: vibe-web 1.0',
      'Shell: vibe-sh',
      `Resolution: ${window.innerWidth}x${window.innerHeight}`,
      'Storage: IndexedDB',
    ].join('\n');
    if (name === 'ls') {
      const target = pathArg(args[0]);
      const node = getNode(fs, target);
      if (!node) throw new Error(`ls: cannot access '${args[0] ?? target}': No such file or directory`);
      if (node.type === 'file') return basename(target);
      return listDir(fs, target).map(([n, child]) => (child.type === 'dir' ? `${n}/` : n)).join('  ');
    }
    if (name === 'cd') {
      const target = normalizePath(args[0] || '/home/user', cwd);
      const node = getNode(fs, target);
      if (!node) throw new Error(`cd: ${args[0] ?? ''}: No such file or directory`);
      if (node.type !== 'dir') throw new Error(`cd: ${args[0]}: Not a directory`);
      setCwd(target);
      return '';
    }
    if (name === 'mkdir') {
      if (!args[0]) throw new Error('mkdir: missing operand');
      commit((draft) => makeDir(draft, pathArg(args[0])));
      return '';
    }
    if (name === 'touch') {
      if (!args[0]) throw new Error('touch: missing file operand');
      commit((draft) => touchFile(draft, pathArg(args[0])));
      return '';
    }
    if (name === 'cat') {
      if (!args[0]) throw new Error('cat: missing file operand');
      return readFile(fs, pathArg(args[0]));
    }
    if (name === 'rm') {
      if (!args[0]) throw new Error('rm: missing operand');
      commit((draft) => removeNode(draft, pathArg(args[0])));
      return '';
    }
    if (name === 'echo') {
      const rest = command.slice(4).trimStart();
      const redirectIndex = rest.indexOf('>');
      if (redirectIndex >= 0) {
        let text = rest.slice(0, redirectIndex).trim();
        const target = rest.slice(redirectIndex + 1).trim();
        if (!target) throw new Error('echo: missing redirect file');
        text = text.replace(/^(["'])|(["'])$/g, '');
        commit((draft) => writeFile(draft, pathArg(target), `${text}\n`));
        return '';
      }
      return rest.replace(/^(["'])|(["'])$/g, '');
    }
    if (!name) return '';
    throw new Error(`${name}: command not found`);
  };

  const submit = () => {
    const command = input;
    setInput('');
    if (!command.trim()) {
      setHistory((h) => [...h, { prompt: promptText, command: '', output: '' }]);
      return;
    }
    if (command.trim() === 'clear') {
      setHistory([]);
      return;
    }
    try {
      const output = execute(command);
      setHistory((h) => [...h, { prompt: promptText, command, output }]);
    } catch (error) {
      setHistory((h) => [...h, { prompt: promptText, command, output: error instanceof Error ? error.message : String(error) }]);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#2b1b2f] font-mono text-[13px] text-[#f4edf5]">
      <div ref={scrollRef} className="terminal-scroll flex-1 overflow-auto p-4 whitespace-pre-wrap">
        {history.map((item, i) => (
          <div key={i} className="mb-2">
            {item.prompt && <div><span className="font-bold text-[#8ae234]">{item.prompt}</span> <span>{item.command}</span></div>}
            {item.output && <div className="text-[#eee8d5]">{item.output}</div>}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-bold text-[#8ae234]">{promptText}</span>
          <input
            autoFocus
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="min-w-0 flex-1 bg-transparent text-white outline-none"
          />
        </div>
      </div>
    </div>
  );
}

function FileManagerApp({ fs, commit, initialPath }: { fs: VfsNode; commit: FsCommit; initialPath?: string }) {
  const [path, setPath] = useState(initialPath || '/home/user');
  const openApp = useDesktop((s) => s.openApp);
  const entries = useMemo(() => {
    try { return listDir(fs, path); } catch { return []; }
  }, [fs, path]);

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

  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)] text-[var(--text)]">
      <div className="flex h-11 items-center gap-1 border-b border-[var(--border)] px-2">
        <button className="ubuntu-button rounded-lg p-2" onClick={() => setPath(dirname(path))}><ChevronLeft size={16} /></button>
        <button className="ubuntu-button rounded-lg p-2" onClick={() => setPath('/home/user')}><Home size={16} /></button>
        <div className="mx-1 min-w-0 flex-1 truncate rounded-lg border border-[var(--border)] bg-black/10 px-3 py-1.5 text-sm">{path}</div>
        <button title="New folder" className="ubuntu-button rounded-lg p-2" onClick={createFolder}><FolderPlus size={16} /></button>
        <button title="New file" className="ubuntu-button rounded-lg p-2" onClick={createFile}><FilePlus2 size={16} /></button>
      </div>
      <div className="file-scroll flex-1 overflow-auto p-3">
        <div className="grid grid-cols-[1fr_100px_80px] border-b border-[var(--border)] px-2 pb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
          <div>Name</div><div>Type</div><div className="text-right">Actions</div>
        </div>
        {entries.map(([name, node]) => {
          const full = normalizePath(name, path);
          const Icon = node.type === 'dir' ? Folder : FileText;
          return (
            <div key={name} className="grid grid-cols-[1fr_100px_80px] items-center rounded-lg px-2 py-2 hover:bg-white/8" onDoubleClick={() => node.type === 'dir' ? setPath(full) : openApp('editor', { path: full })}>
              <div className="flex min-w-0 items-center gap-2"><Icon size={20} className={node.type === 'dir' ? 'text-orange-400' : 'opacity-80'} /><span className="truncate text-sm">{name}</span></div>
              <div className="text-xs opacity-60">{node.type === 'dir' ? 'Folder' : 'Text file'}</div>
              <div className="flex justify-end gap-1">
                <button className="rounded-md p-1.5 hover:bg-white/10" title="Rename" onClick={() => {
                  const next = prompt('New name', name);
                  if (!next || next === name) return;
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
  );
}

function TextEditorApp({ fs, commit, initialPath }: { fs: VfsNode; commit: FsCommit; initialPath?: string }) {
  const [path, setPath] = useState(initialPath || '/home/user/Documents/untitled.txt');
  const [content, setContent] = useState(() => {
    try { return readFile(fs, initialPath || '/home/user/Documents/untitled.txt'); } catch { return ''; }
  });
  const [saved, setSaved] = useState(true);

  const openFile = () => {
    const target = prompt('Path to open', path);
    if (!target) return;
    try {
      const normalized = normalizePath(target, '/home/user');
      setContent(readFile(fs, normalized));
      setPath(normalized);
      setSaved(true);
    } catch (e) { alert(e instanceof Error ? e.message : e); }
  };
  const save = () => {
    try {
      commit((draft) => writeFile(draft, path, content));
      setSaved(true);
    } catch (e) { alert(e instanceof Error ? e.message : e); }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)]">
      <div className="flex h-11 items-center gap-2 border-b border-[var(--border)] px-2">
        <button className="ubuntu-button flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm" onClick={openFile}><FolderOpen size={15} /> Open</button>
        <button className="ubuntu-button flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm" onClick={save}><Save size={15} /> Save</button>
        <input value={path} onChange={(e) => { setPath(e.target.value); setSaved(false); }} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-1.5 text-sm outline-none" />
      </div>
      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setSaved(false); }}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-6 outline-none"
      />
      <div className="border-t border-[var(--border)] px-3 py-1 text-right text-[11px] opacity-60">{saved ? 'Saved' : 'Unsaved changes'} · {content.length} chars</div>
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
      <h2 className="mb-5 text-xl font-semibold">Appearance</h2>
      <section className="mb-6 rounded-2xl border border-[var(--border)] p-4">
        <div className="mb-3 text-sm font-medium">Color scheme</div>
        <div className="grid grid-cols-2 gap-3">
          <button className={`ubuntu-button flex items-center justify-center gap-2 rounded-xl p-4 ${theme === 'dark' ? 'ring-2 ring-orange-500' : ''}`} onClick={() => setTheme('dark')}><Moon size={20} /> Dark</button>
          <button className={`ubuntu-button flex items-center justify-center gap-2 rounded-xl p-4 ${theme === 'light' ? 'ring-2 ring-orange-500' : ''}`} onClick={() => setTheme('light')}><Sun size={20} /> Light</button>
        </div>
      </section>
      <section className="mb-6 rounded-2xl border border-[var(--border)] p-4">
        <div className="mb-3 text-sm font-medium">Wallpaper</div>
        <div className="grid grid-cols-4 gap-3">
          {wallpapers.map((item) => (
            <button key={item} className={`wallpaper-${item} aspect-video rounded-xl border border-white/15 ${wallpaper === item ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-transparent' : ''}`} onClick={() => setWallpaper(item)} />
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-[var(--border)] p-4">
        <div className="font-medium">Virtual filesystem</div>
        <p className="mt-1 text-sm opacity-60">Files are stored only in this browser using IndexedDB.</p>
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
    try {
      const value = Function(`"use strict"; return (${expr.replace(/%/g, '/100')})`)();
      setExpr(String(value));
    } catch { setExpr('Error'); }
  };
  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)] p-4">
      <input value={expr} onChange={(e) => setExpr(e.target.value)} className="mb-4 h-20 rounded-xl border border-[var(--border)] bg-black/15 px-4 text-right text-3xl outline-none" />
      <div className="grid flex-1 grid-cols-4 gap-2">
        <button className="ubuntu-button col-span-2 rounded-xl" onClick={() => setExpr('')}>AC</button>
        <button className="ubuntu-button rounded-xl" onClick={() => setExpr((v) => v.slice(0, -1))}>⌫</button>
        <button className="rounded-xl bg-orange-600 text-white hover:bg-orange-500" onClick={calculate}>=</button>
        {keys.map((key) => <button key={key} className="ubuntu-button rounded-xl text-lg" onClick={() => setExpr((v) => v === 'Error' ? key : v + key)}>{key}</button>)}
      </div>
    </div>
  );
}

function BrowserApp() {
  const [input, setInput] = useState('https://example.com');
  const [url, setUrl] = useState('https://example.com');
  const [frameKey, setFrameKey] = useState(0);
  const navigate = () => {
    const next = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    setInput(next);
    setUrl(next);
  };
  return (
    <div className="flex h-full flex-col bg-[var(--panel-2)]">
      <div className="flex h-12 items-center gap-1 border-b border-[var(--border)] px-2">
        <button className="ubuntu-button rounded-lg p-2" onClick={() => history.back()}><ChevronLeft size={16} /></button>
        <button className="ubuntu-button rounded-lg p-2" onClick={() => history.forward()}><ChevronRight size={16} /></button>
        <button className="ubuntu-button rounded-lg p-2" onClick={() => setFrameKey((k) => k + 1)}><RefreshCw size={16} /></button>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && navigate()} className="mx-1 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-1.5 text-sm outline-none" />
        <button className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm text-white hover:bg-orange-500" onClick={navigate}>Go</button>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        <iframe key={frameKey} title="Vibe browser" src={url} className="h-full w-full border-0" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[10px] text-white opacity-70">Some websites block iframe embedding.</div>
      </div>
    </div>
  );
}
