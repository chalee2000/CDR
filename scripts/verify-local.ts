/**
 * Run the parsers + analysis on CDR files outside the repository and print
 * the key numbers, to cross-check the app against an independent tool
 * (pandas, Excel filters). Never copy real CDR files into this repository.
 *
 *   npm run verify:local -- /path/to/file1.xlsx /path/to/file2.xlsx
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readWorkbook } from '../src/lib/io/readWorkbook';
import { parseWorkbook } from '../src/lib/parsers';
import { buildDataset } from '../src/lib/dataset';
import { DEFAULT_SETTINGS, type Dataset } from '../src/lib/types';
import { summarize } from '../src/lib/analysis/summary';
import { contactStats } from '../src/lib/analysis/contacts';
import { siteStats } from '../src/lib/analysis/locations';
import { deviceStats } from '../src/lib/analysis/devices';
import { commonContacts } from '../src/lib/analysis/cross';
import { countBy } from '../src/lib/util';

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: npm run verify:local -- <file.xlsx> [...]');
    process.exit(1);
  }
  const datasets: Dataset[] = [];
  for (const f of files) {
    const buf = readFileSync(f);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const wb = await readWorkbook(ab, basename(f));
    const out = parseWorkbook(wb, DEFAULT_SETTINGS.zMode);
    if (out.kind !== 'ok') {
      console.log(`${basename(f)}: needs mapping — ${out.reason}`);
      continue;
    }
    for (const d of out.drafts) datasets.push(buildDataset(d, datasets.length));
  }

  for (const ds of datasets) {
    const s = summarize(ds, DEFAULT_SETTINGS);
    console.log(`\n=== ${ds.target}  (${ds.meta.formatLabel}, ${ds.meta.operator ?? '?'})`);
    for (const st of ds.meta.sheets) {
      console.log(`  sheet ${st.sheet}: rows=${st.rows} used=${st.used} noTime=${st.skippedNoTime} peerOwned=${st.peerOwned} dup=${st.duplicates} noLoc=${st.noLocation}`);
    }
    console.log('  interactions by source:', Object.fromEntries(countBy(ds.interactions, (i) => i.source)));
    console.log('  rawType counts:', Object.fromEntries(countBy(ds.interactions, (i) => i.rawType)));
    console.log('  summary:', JSON.stringify(s, null, 0));
    const contacts = contactStats(ds, DEFAULT_SETTINGS);
    console.log(`  contacts: ${contacts.length} (persons ${contacts.filter((c) => c.isPerson).length})`);
    console.log('  top contacts:', contacts.slice(0, 8).map((c) => `${c.peer}[${c.kind}] ${c.total}`).join(', '));
    console.log('  intl:', contacts.filter((c) => c.kind === 'intl').map((c) => `${c.peer} ${c.country} raw=${c.rawValues.join('|')}`).join('; '));
    const sites = siteStats(ds, DEFAULT_SETTINGS);
    console.log(`  sites: ${sites.length}`, sites.slice(0, 5).map((x) => `${x.label} ${x.count}`).join(', '));
    const dev = deviceStats(ds);
    console.log('  imei cores:', dev.imeis.map((d) => `${d.core}(${d.count}) ${d.firstTs ? new Date(d.firstTs).toISOString().slice(0, 10) : ''}→${d.lastTs ? new Date(d.lastTs).toISOString().slice(0, 10) : ''}`).join(', '));
    console.log('  dual-sim candidates:', dev.dualSim.map((p) => p.join('~')).join(', ') || '-');
    console.log('  notes:', ds.meta.notes);
  }

  const common = commonContacts(datasets, DEFAULT_SETTINGS);
  console.log('\n=== common person contacts across targets');
  for (const c of common) console.log(`  ${c.peer}: ${c.perTarget.map((p) => `${p.target}=${p.total}`).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
