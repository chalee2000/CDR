import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildDataset } from '../lib/dataset';
import { readWorkbook } from '../lib/io/readWorkbook';
import { parseWorkbook, type SheetSuggestion } from '../lib/parsers';
import { generateSamples } from '../lib/samples/generate';
import type { ImportedCoords } from '../lib/analysis/locations';
import { DEFAULT_SETTINGS, type ColumnMapping, type Dataset, type RawWorkbook, type Settings } from '../lib/types';

export type ThemeChoice = 'system' | 'light' | 'dark';

interface FileEntry {
  id: string;
  raw: RawWorkbook;
  mapping?: ColumnMapping;
}

export interface MappingRequest {
  file: FileEntry;
  suggestions: SheetSuggestion[];
  reason: string;
}

export interface CoordImport {
  name: string;
  coords: ImportedCoords;
}

interface Store {
  datasets: Dataset[];
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  selectedId?: string;
  select: (id: string) => void;
  selected?: Dataset;
  addFiles: (files: File[]) => Promise<void>;
  loadSamples: () => void;
  removeDataset: (id: string) => void;
  clearAll: () => void;
  setLabel: (id: string, label: string) => void;
  busy: boolean;
  messages: { id: number; kind: 'error' | 'info'; text: string }[];
  dismiss: (id: number) => void;
  mappingRequest?: MappingRequest;
  resolveMapping: (mapping: ColumnMapping | null) => void;
  drawerPeer?: string;
  openPeer: (peer: string | undefined) => void;
  coordImport?: CoordImport;
  setCoordImport: (c: CoordImport | undefined) => void;
}

const Ctx = createContext<Store | null>(null);

const SETTINGS_KEY = 'cdr-analyzer:settings';
const THEME_KEY = 'cdr-analyzer:theme';

// Browser storage holds preferences only — never CDR data.
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences simply do not persist */
  }
}

let fileSeq = 0;
let msgSeq = 0;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [slots, setSlots] = useState<Record<string, number>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [settings, setSettingsState] = useState<Settings>(() => readStored(SETTINGS_KEY, DEFAULT_SETTINGS));
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch {
      return 'system';
    }
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Store['messages']>([]);
  const [queue, setQueue] = useState<MappingRequest[]>([]);
  const [drawerPeer, setDrawerPeer] = useState<string>();
  const [coordImport, setCoordImport] = useState<CoordImport>();

  const notify = useCallback((kind: 'error' | 'info', text: string) => {
    setMessages((m) => [...m, { id: ++msgSeq, kind, text }]);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Parsing depends only on the files and the time interpretation; colours and
  // aliases are applied afterwards so renaming a target does not re-parse.
  const parsed = useMemo(
    () => files.map((f) => ({ id: f.id, res: parseWorkbook(f.raw, settings.zMode, f.mapping) })),
    [files, settings.zMode],
  );
  const datasets = useMemo(() => {
    const out: Dataset[] = [];
    for (const { id, res } of parsed) {
      if (res.kind !== 'ok') continue;
      for (const d of res.drafts) {
        const key = `${id}:${d.target}`;
        out.push(buildDataset(d, slots[key] ?? out.length, labels[key] ?? d.target, key));
      }
    }
    return out;
  }, [parsed, slots, labels]);

  useEffect(() => {
    if (datasets.length === 0) setSelectedId(undefined);
    else if (!selectedId || !datasets.some((d) => d.id === selectedId)) setSelectedId(datasets[0].id);
  }, [datasets, selectedId]);

  /** Accept a parsed workbook: register it and give its targets colour slots. */
  const accept = useCallback(
    (entry: FileEntry) => {
      const res = parseWorkbook(entry.raw, settings.zMode, entry.mapping);
      if (res.kind !== 'ok') {
        setQueue((q) => [...q, { file: entry, suggestions: res.suggestions, reason: res.reason }]);
        return;
      }
      const empty = res.drafts.filter((d) => d.interactions.length === 0);
      if (empty.length === res.drafts.length) {
        notify('error', `${entry.raw.fileName}: อ่านได้แต่ไม่พบรายการที่มีวันเวลาถูกต้อง`);
        return;
      }
      setSlots((s) => {
        const next = { ...s };
        const used = new Set(Object.values(next));
        for (const d of res.drafts) {
          const key = `${entry.id}:${d.target}`;
          if (next[key] !== undefined) continue;
          let slot = 0;
          while (used.has(slot)) slot++;
          next[key] = slot;
          used.add(slot);
        }
        return next;
      });
      setFiles((fs) => [...fs, entry]);
      for (const d of res.drafts) {
        if (!d.target) notify('error', `${entry.raw.fileName}: ไม่พบหมายเลขเป้าหมาย ผลวิเคราะห์อาจไม่ถูกต้อง`);
      }
    },
    [settings.zMode, notify],
  );

  const addFiles = useCallback(
    async (list: File[]) => {
      setBusy(true);
      try {
        for (const file of list) {
          try {
            const raw = await readWorkbook(await file.arrayBuffer(), file.name);
            accept({ id: `f${++fileSeq}`, raw });
          } catch (e) {
            notify('error', `${file.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [accept, notify],
  );

  const loadSamples = useCallback(() => {
    for (const raw of generateSamples()) accept({ id: `f${++fileSeq}`, raw });
    notify('info', 'โหลดข้อมูลตัวอย่าง (สมมติ) 3 เป้าหมายแล้ว — เลขหมาย IMSI IMEI และชื่อเสาทั้งหมดเป็นข้อมูลที่แต่งขึ้น');
  }, [accept, notify]);

  const removeDataset = useCallback((id: string) => {
    const fileId = id.split(':')[0];
    setFiles((fs) => fs.filter((f) => f.id !== fileId));
    setSlots((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith(`${fileId}:`))));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setSlots({});
    setLabels({});
    setDrawerPeer(undefined);
  }, []);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      writeStored(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
    writeStored(SETTINGS_KEY, DEFAULT_SETTINGS);
  }, []);

  const resolveMapping = useCallback(
    (mapping: ColumnMapping | null) => {
      const [head, ...rest] = queue;
      setQueue(rest);
      if (head && mapping) accept({ ...head.file, mapping });
    },
    [queue, accept],
  );

  const value: Store = {
    datasets,
    settings,
    setSettings,
    resetSettings,
    theme,
    setTheme: setThemeState,
    selectedId,
    select: setSelectedId,
    selected: datasets.find((d) => d.id === selectedId),
    addFiles,
    loadSamples,
    removeDataset,
    clearAll,
    setLabel: (id, label) => setLabels((l) => ({ ...l, [id]: label.trim() || id.split(':').slice(1).join(':') })),
    busy,
    messages,
    dismiss: (id) => setMessages((m) => m.filter((x) => x.id !== id)),
    mappingRequest: queue[0],
    resolveMapping,
    drawerPeer,
    openPeer: setDrawerPeer,
    coordImport,
    setCoordImport,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

/** Effective light/dark mode for canvas charts and the map. */
export function useEffectiveTheme(): 'light' | 'dark' {
  const { theme } = useStore();
  const [systemDark, setSystemDark] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
