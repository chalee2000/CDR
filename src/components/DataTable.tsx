import { useMemo, useState, type ReactNode } from 'react';
import { toCsv, type CsvValue } from '../lib/export/csv';
import { downloadBlob } from './download';

export interface Column<T> {
  key: string;
  header: string;
  num?: boolean;
  sortValue?: (row: T) => number | string | undefined;
  render: (row: T) => ReactNode;
  /** Value written to CSV; defaults to sortValue. */
  csv?: (row: T) => CsvValue;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  pageSize?: number;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  search?: (row: T) => string;
  searchPlaceholder?: string;
  csvName?: string;
  empty?: string;
  label: string;
}

export function DataTable<T>({ rows, columns, pageSize = 50, initialSort, search, searchPlaceholder, csvName, empty, label }: Props<T>) {
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle && search ? rows.filter((r) => search(r).toLowerCase().includes(needle)) : rows;
  }, [rows, q, search]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = col.sortValue!(a);
      const y = col.sortValue!(b);
      if (x === y) return 0;
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'th')) * dir;
    });
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize);

  const toggleSort = (key: string, num?: boolean) => {
    setPage(0);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: num ? 'desc' : 'asc' }));
  };

  const exportCsv = () => {
    const csv = toCsv(
      columns.map((c) => c.header),
      sorted.map((r) => columns.map((c) => (c.csv ? c.csv(r) : (c.sortValue?.(r) as CsvValue)))),
    );
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${csvName ?? 'table'}.csv`);
  };

  return (
    <div>
      {(search || csvName) && (
        <div className="filters no-print" style={{ marginBottom: 8 }}>
          {search && (
            <input
              className="input"
              type="search"
              placeholder={searchPlaceholder ?? 'ค้นหา…'}
              value={q}
              aria-label={`ค้นหาใน${label}`}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              style={{ minWidth: 220, flex: '0 1 320px' }}
            />
          )}
          <span className="caveat" style={{ marginLeft: 'auto' }}>
            {sorted.length.toLocaleString('th-TH')} รายการ
          </span>
          {csvName && (
            <button className="btn small" onClick={exportCsv} type="button">
              ดาวน์โหลด CSV
            </button>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="data" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={c.num ? 'num' : undefined} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortValue ? (
                      <button type="button" onClick={() => toggleSort(c.key, c.num)}>
                        {c.header}
                        <span aria-hidden="true" style={{ opacity: active ? 1 : 0.35 }}>
                          {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty">
                  {empty ?? 'ไม่มีข้อมูล'}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? 'num' : undefined}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <span>
            หน้า {current + 1} / {pages} (แสดง {visible.length} จาก {sorted.length.toLocaleString('th-TH')})
          </span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn small" disabled={current === 0} onClick={() => setPage(0)} type="button">
              « แรก
            </button>
            <button className="btn small" disabled={current === 0} onClick={() => setPage(current - 1)} type="button">
              ‹ ก่อนหน้า
            </button>
            <button className="btn small" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} type="button">
              ถัดไป ›
            </button>
            <button className="btn small" disabled={current >= pages - 1} onClick={() => setPage(pages - 1)} type="button">
              สุดท้าย »
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
