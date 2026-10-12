import type { ColumnMapping, DatasetMeta, FlatField, Interaction, RawSheet, RawWorkbook, ZMode } from '../types';
import { normalizeNumber } from '../phone';
import { countBy } from '../util';
import { looksLikeDtac, parseDtacWorkbook } from './dtac';
import { parseFlatSheet } from './flat';
import { findHeader } from './table';

export interface DatasetDraft {
  fileName: string;
  target: string;
  interactions: Interaction[];
  meta: DatasetMeta;
}

export interface SheetSuggestion {
  sheet: string;
  headerRow: number;
  headers: string[];
  columns: Partial<Record<FlatField, number>>;
  sampleRows: (string | null)[][];
}

export type ParseOutcome =
  | { kind: 'ok'; drafts: DatasetDraft[] }
  | { kind: 'needs-mapping'; suggestions: SheetSuggestion[]; reason: string };

function hasRequired(columns: Partial<Record<FlatField, number>>): boolean {
  const hasTime = columns.time !== undefined || columns.date !== undefined;
  return hasTime && columns.a !== undefined && columns.b !== undefined;
}

/**
 * A combined export can hold several served numbers (one block per target).
 * Split it when two or more A-numbers each own a real share of the rows.
 */
function servedNumbers(sheet: RawSheet, headerRow: number, aCol: number): string[] {
  const keys = sheet.rows.slice(headerRow + 1).map((r) => normalizeNumber(r[aCol]).key);
  const total = keys.filter(Boolean).length;
  const counts = countBy(keys, (k) => k || undefined);
  return [...counts.entries()]
    .filter(([, n]) => n >= 20 && n >= total * 0.1)
    .sort((x, y) => y[1] - x[1])
    .map(([k]) => k);
}

function parseFlat(sheet: RawSheet, mapping: Pick<ColumnMapping, 'headerRow' | 'columns' | 'target'>, fileName: string, zMode: ZMode): DatasetDraft[] {
  if (!mapping.target && mapping.columns.type !== undefined && mapping.columns.a !== undefined) {
    const served = servedNumbers(sheet, mapping.headerRow, mapping.columns.a);
    if (served.length >= 2) {
      const aCol = mapping.columns.a;
      return served.map((key) => {
        const rows = sheet.rows.filter((r, i) => i <= mapping.headerRow || normalizeNumber(r[aCol]).key === key);
        return parseFlatSheet({ name: sheet.name, rows }, { ...mapping, target: key }, fileName, zMode);
      });
    }
  }
  return [parseFlatSheet(sheet, mapping, fileName, zMode)];
}

/** Several sheets/blocks of the same target in one workbook become one dataset. */
function mergeByTarget(drafts: DatasetDraft[]): DatasetDraft[] {
  const byTarget = new Map<string, DatasetDraft>();
  for (const d of drafts) {
    const cur = byTarget.get(d.target);
    if (!cur) {
      byTarget.set(d.target, d);
      continue;
    }
    cur.interactions = [...cur.interactions, ...d.interactions].sort((x, y) => x.ts - y.ts);
    cur.interactions.forEach((it, i) => (it.id = i));
    cur.meta = {
      ...cur.meta,
      sheets: [...cur.meta.sheets, ...d.meta.sheets],
      notes: [...new Set([...cur.meta.notes, ...d.meta.notes])],
      targetImsis: [...new Set([...cur.meta.targetImsis, ...d.meta.targetImsis])],
      hasCoordinates: cur.meta.hasCoordinates || d.meta.hasCoordinates,
    };
  }
  return [...byTarget.values()];
}

export function parseWorkbook(wb: RawWorkbook, zMode: ZMode, mapping?: ColumnMapping): ParseOutcome {
  if (mapping) {
    const sheet = wb.sheets.find((s) => s.name === mapping.sheet);
    if (!sheet) return { kind: 'needs-mapping', suggestions: suggest(wb), reason: 'ไม่พบชีตที่เลือก' };
    return { kind: 'ok', drafts: mergeByTarget(parseFlat(sheet, mapping, wb.fileName, zMode)) };
  }

  if (looksLikeDtac(wb)) {
    return { kind: 'ok', drafts: [parseDtacWorkbook(wb, zMode)] };
  }

  const drafts: DatasetDraft[] = [];
  for (const sheet of wb.sheets) {
    const header = findHeader(sheet);
    if (!header || !hasRequired(header.columns)) continue;
    if (sheet.rows.length <= header.headerRow + 1) continue;
    drafts.push(...parseFlat(sheet, header, wb.fileName, zMode));
  }
  const usable = drafts.filter((d) => d.interactions.length > 0);
  if (usable.length > 0) return { kind: 'ok', drafts: mergeByTarget(usable) };

  return {
    kind: 'needs-mapping',
    suggestions: suggest(wb),
    reason: 'ระบบหาคอลัมน์ที่จำเป็น (วันเวลา, หมายเลข A, หมายเลข B) ไม่ครบ กรุณาเลือกคอลัมน์เอง',
  };
}

export function suggest(wb: RawWorkbook): SheetSuggestion[] {
  return wb.sheets
    .filter((s) => s.rows.length > 0)
    .map((s) => {
      const h = findHeader(s);
      const headerRow = h?.headerRow ?? 0;
      return {
        sheet: s.name,
        headerRow,
        headers: (s.rows[headerRow] ?? []).map((c, i) => String(c ?? `คอลัมน์ ${i + 1}`)),
        columns: h?.columns ?? {},
        sampleRows: s.rows.slice(headerRow + 1, headerRow + 6),
      };
    })
    .sort((x, y) => Object.keys(y.columns).length - Object.keys(x.columns).length);
}
