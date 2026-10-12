import readXlsxFile from 'read-excel-file/universal';
import Papa from 'papaparse';
import type { RawSheet, RawWorkbook } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Excel date cells arrive as Date objects built from the serial in UTC. */
function cellToString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = String(v);
  return s === '' ? null : s;
}

export async function readXlsx(data: ArrayBuffer, fileName: string): Promise<RawWorkbook> {
  // parseNumber keeps the cell text untouched: long identifiers such as
  // 16-digit IMEISVs would otherwise lose precision as JS numbers.
  const sheets = await readXlsxFile(data, { parseNumber: (s: string) => s, trim: false });
  return {
    fileName,
    sheets: sheets.map((s): RawSheet => ({
      name: s.sheet,
      rows: s.data.map((row) => row.map(cellToString)),
    })),
  };
}

/** Thai CSV exports are UTF-8 (often with BOM) or legacy Windows-874. */
export function decodeText(data: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-874').decode(data);
  }
}

export function readCsv(data: ArrayBuffer, fileName: string): RawWorkbook {
  const text = decodeText(data);
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const rows = parsed.data.map((r) => r.map((c) => (c === '' ? null : c)));
  return { fileName, sheets: [{ name: fileName.replace(/\.[^.]+$/, ''), rows }] };
}

export class UnsupportedFileError extends Error {}

export async function readWorkbook(data: ArrayBuffer, fileName: string): Promise<RawWorkbook> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return readCsv(data, fileName);
  if (lower.endsWith('.xls')) {
    throw new UnsupportedFileError('ไฟล์ .xls รุ่นเก่ายังไม่รองรับ กรุณาเปิดใน Excel แล้วบันทึกเป็น .xlsx หรือ .csv');
  }
  // .xlsx / .xlsm, or unknown extension: sniff the ZIP signature.
  const sig = new Uint8Array(data.slice(0, 2));
  if (sig[0] === 0x50 && sig[1] === 0x4b) return readXlsx(data, fileName);
  return readCsv(data, fileName);
}
