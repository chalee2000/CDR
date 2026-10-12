export type CsvValue = string | number | boolean | null | undefined;

function esc(v: CsvValue): string {
  if (v == null) return '';
  const s = String(v);
  // Neutralise spreadsheet formula injection from untrusted cell text.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 CSV with BOM so Excel shows Thai text correctly. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  return '﻿' + lines.join('\r\n');
}
