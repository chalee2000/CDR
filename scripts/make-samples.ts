/**
 * Writes the fictitious sample workbooks to samples/ (same generator as the
 * in-app "ข้อมูลตัวอย่าง" button), so the file-import path can be tested too.
 *
 *   npm run make:samples
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import writeXlsxFile from 'write-excel-file/node';
import { generateSamples } from '../src/lib/samples/generate';

async function main() {
  const dir = join(process.cwd(), 'samples');
  mkdirSync(dir, { recursive: true });
  for (const wb of generateSamples()) {
    const sheets = wb.sheets.map((s) => ({ sheet: s.name, data: s.rows.map((r) => r.map((c) => (c === null ? null : String(c)))) }));
    const out = join(dir, wb.fileName);
    await writeXlsxFile(sheets, { fontFamily: 'Tahoma', fontSize: 10 }).toFile(out);
    console.log(`wrote ${out} (${wb.sheets.map((s) => `${s.name}:${s.rows.length - 1}`).join(', ')})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
