import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../../src/lib/io/readWorkbook';

// A workbook whose sheet XML is tens of MB, as in real AIS exports padded
// with about a million formatted empty rows. Chunked parsing in
// read-excel-file made such files slow (see vite.config.ts).
function bigWorkbook(dataRows: number, emptyRows: number): ArrayBuffer {
  const cell = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const rows: string[] = [`<row r="1">${cell('A1', 'START_DATETIME')}${cell('B1', 'A_NUMBER')}${cell('C1', 'B_NUMBER')}</row>`];
  for (let i = 2; i <= dataRows + 1; i++) rows.push(`<row r="${i}">${cell(`A${i}`, '2026-08-01 10:00:00')}${cell(`B${i}`, '0810000101')}${cell(`C${i}`, '0899999999')}</row>`);
  // Excel writes formatted empty rows down to the end of the sheet as self-closing <row/> elements.
  const pad = Array.from({ length: emptyRows }, (_, k) => `<row r="${dataRows + 2 + k}" customFormat="1" x14ac:dyDescent="0.25"/>`);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"><sheetData>${rows.join('')}${pad.join('')}</sheetData></worksheet>`;
  const zip = zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}

describe('large .xlsx files', () => {
  it('reads a sheet of tens of MB in one quick pass', async () => {
    const t0 = Date.now();
    const wb = await readWorkbook(bigWorkbook(500, 1_040_000), 'big.xlsx');
    const rows = wb.sheets[0].rows.filter((r) => r.some((c) => c !== null));
    expect(rows).toHaveLength(501);
    expect(rows[500]).toEqual(['2026-08-01 10:00:00', '0810000101', '0899999999']);
    // About 3 s in one pass; chunked parsing took about 18 s on the same machine.
    expect(Date.now() - t0).toBeLessThan(12_000);
  }, 60_000);
});
