import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isBackupFile, type SessionSnapshot } from '../lib/backup';
import { buildDataset } from '../lib/dataset';
import { readWorkbook } from '../lib/io/readWorkbook';
import { parseWorkbook, type SheetSuggestion } from '../lib/parsers';
import { generateSamples } from '../lib/samples/generate';
import type { ImportedCoords } from '../lib/analysis/locations';
import { hasContent, mergeProfiles, type PersonProfile, type ProfileMap } from '../lib/profiles';
import { cleanSettings, DEFAULT_SETTINGS, type ColumnMapping, type Dataset, type RawWorkbook, type Settings } from '../lib/types';

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
  notify: (kind: 'error' | 'info', text: string) => void;
  /** Person details typed in by the user — page memory only, never browser storage. */
  profiles: ProfileMap;
  saveProfile: (p: PersonProfile) => void;
  removeProfile: (number: string) => void;
  loadProfiles: (list: PersonProfile[]) => { added: number; replaced: number };
  clearProfiles: () => void;
  /** Profiles changed since they were last saved to (or opened from) a file. */
  profilesDirty: boolean;
  markProfilesSaved: () => void;
  profileEditor?: string;
  openProfileEditor: (number: string | undefined) => void;
  /** Everything in the page, ready to write to a backup file. */
  makeSnapshot: () => SessionSnapshot;
  /** Replace the whole session with one read from a backup file. */
  restoreSession: (s: SessionSnapshot) => void;
  /** A backup file waiting for the restore dialog. */
  restoreRequest?: File;
  requestRestore: (file: File | undefined) => void;
}

const Ctx = createContext<Store | null>(null);

const SETTINGS_KEY = 'cdr-analyzer:settings';
const THEME_KEY = 'cdr-analyzer:theme';

// Browser storage holds preferences only — never CDR data.
function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? cleanSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
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
  const [settings, setSettingsState] = useState<Settings>(readSettings);
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
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [profilesDirty, setProfilesDirty] = useState(false);
  const [profileEditor, setProfileEditor] = useState<string>();
  const [restoreRequest, setRestoreRequest] = useState<File>();

  const notify = useCallback((kind: 'error' | 'info', text: string) => {
    setMessages((m) => [...m, { id: ++msgSeq, kind, text }]);
  }, []);

  // Unsaved person details would be lost with the page: let the browser ask.
  useEffect(() => {
    if (!profilesDirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [profilesDirty]);

  const saveProfile = useCallback((p: PersonProfile) => {
    setProfiles((cur) => {
      const next = { ...cur };
      if (hasContent(p)) next[p.number] = { ...p, updatedAt: Date.now() };
      else delete next[p.number];
      return next;
    });
    setProfilesDirty(true);
  }, []);

  const removeProfile = useCallback((number: string) => {
    setProfiles((cur) => {
      if (!cur[number]) return cur;
      const next = { ...cur };
      delete next[number];
      return next;
    });
    setProfilesDirty(true);
  }, []);

  const loadProfiles = useCallback(
    (list: PersonProfile[]) => {
      const { next, added, replaced } = mergeProfiles(profiles, list);
      setProfiles(next);
      // Opening a file onto an empty set leaves nothing new to save.
      setProfilesDirty(Object.keys(profiles).length > 0 && (added > 0 || replaced > 0) ? true : profilesDirty);
      return { added, replaced };
    },
    [profiles, profilesDirty],
  );

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
        // A backup dropped here is restored, not read as CDR. Restoring
        // replaces the session, so files picked with it are left out.
        const backups = await Promise.all(list.map((f) => isBackupFile(f).catch(() => false)));
        const backup = list.find((_, i) => backups[i]);
        if (backup) {
          setRestoreRequest(backup);
          if (list.length > 1) notify('info', `เปิดไฟล์สำรอง ${backup.name} — ไม่ได้นำเข้าไฟล์อื่นที่เลือกมาพร้อมกัน (${list.length - 1} ไฟล์) เพราะการกู้ไฟล์จะแทนที่งานทั้งหมด`);
          return;
        }
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

  const makeSnapshot = useCallback(
    (): SessionSnapshot => ({
      settings,
      files: files.map((f) => ({
        fileName: f.raw.fileName,
        sheets: f.raw.sheets,
        ...(f.mapping ? { mapping: f.mapping } : {}),
        targets: datasets
          .filter((d) => d.id.startsWith(`${f.id}:`))
          .map((d) => ({ target: d.target, slot: d.slot, ...(d.label !== d.target ? { label: d.label } : {}) })),
      })),
      profiles: Object.values(profiles),
      ...(coordImport ? { coords: { name: coordImport.name, entries: [...coordImport.coords].map(([key, [lat, lon]]): [string, number, number] => [key, lat, lon]) } } : {}),
    }),
    [settings, files, datasets, profiles, coordImport],
  );

  const restoreSession = useCallback(
    (s: SessionSnapshot) => {
      const entries: FileEntry[] = [];
      const nextSlots: Record<string, number> = {};
      const nextLabels: Record<string, string> = {};
      const unread: MappingRequest[] = [];
      for (const f of s.files) {
        const entry: FileEntry = { id: `f${++fileSeq}`, raw: { fileName: f.fileName, sheets: f.sheets }, mapping: f.mapping };
        for (const t of f.targets) {
          nextSlots[`${entry.id}:${t.target}`] = t.slot;
          if (t.label) nextLabels[`${entry.id}:${t.target}`] = t.label;
        }
        // A file the parser no longer recognises goes to the column dialog, as on import.
        const res = parseWorkbook(entry.raw, s.settings.zMode, entry.mapping);
        if (res.kind === 'ok') entries.push(entry);
        else if (res.suggestions.length) unread.push({ file: entry, suggestions: res.suggestions, reason: res.reason });
        else notify('error', `${f.fileName}: อ่านไฟล์นี้จากไฟล์สำรองไม่ได้`);
      }
      // The online basemap stays as this device has it: it is a privacy choice, not part of the case.
      const nextSettings = { ...s.settings, showBasemap: settings.showBasemap };
      setSettingsState(nextSettings);
      writeStored(SETTINGS_KEY, nextSettings);
      setFiles(entries);
      setSlots(nextSlots);
      setLabels(nextLabels);
      setQueue(unread);
      setProfiles(Object.fromEntries(s.profiles.map((p) => [p.number, p])));
      setProfilesDirty(false);
      setCoordImport(s.coords ? { name: s.coords.name, coords: new Map(s.coords.entries.map(([key, lat, lon]) => [key, [lat, lon]])) } : undefined);
      setDrawerPeer(undefined);
      setProfileEditor(undefined);
      setSelectedId(undefined);
    },
    [notify, settings.showBasemap],
  );

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
    notify,
    profiles,
    saveProfile,
    removeProfile,
    loadProfiles,
    clearProfiles: () => {
      setProfiles({});
      setProfilesDirty(false);
    },
    profilesDirty,
    markProfilesSaved: () => setProfilesDirty(false),
    profileEditor,
    openProfileEditor: setProfileEditor,
    makeSnapshot,
    restoreSession,
    restoreRequest,
    requestRestore: setRestoreRequest,
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
