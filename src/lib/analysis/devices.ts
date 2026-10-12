import { activeInteractions } from '../dataset';
import { imei15, imeiCore, likelySameHandset, tacOf } from '../imei';
import { dayKey } from '../time';
import type { Dataset, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

export interface DeviceUse {
  core: string;
  imei15: string;
  tac: string;
  rawValues: string[];
  count: number;
  days: number;
  firstTs: number;
  lastTs: number;
}

export interface ImsiUse {
  imsi: string;
  count: number;
  firstTs: number;
  lastTs: number;
}

export interface DeviceRun {
  core: string;
  from: number;
  to: number;
  count: number;
}

export interface PeerDevice {
  peer: string;
  core: string;
  imsi?: string;
  count: number;
}

export interface DeviceStats {
  imeis: DeviceUse[];
  imsis: ImsiUse[];
  runs: DeviceRun[];
  switches: number;
  dualSim: [string, string][];
  peerDevices: PeerDevice[];
}

/**
 * Handsets (IMEI) and SIMs (IMSI) of the target over time. Wi-Fi accounting
 * rows are excluded: their IMEI field is not reliably the handset.
 */
export function deviceStats(ds: Dataset, settings: Pick<Settings, 'dedupeExact'> = DEFAULT_SETTINGS): DeviceStats {
  const imeis = new Map<string, DeviceUse & { _days: Set<string>; _raw: Set<string> }>();
  const imsis = new Map<string, ImsiUse>();
  const runs: DeviceRun[] = [];
  const peerDev = new Map<string, PeerDevice>();

  for (const it of activeInteractions(ds, settings)) {
    if (it.source === 'WIFI') continue;
    const obs = it.targetObs;
    if (obs) {
      const core = imeiCore(obs.imei);
      if (core) {
        let d = imeis.get(core);
        if (!d) {
          d = { core, imei15: imei15(core), tac: tacOf(core), rawValues: [], count: 0, days: 0, firstTs: it.ts, lastTs: it.ts, _days: new Set(), _raw: new Set() };
          imeis.set(core, d);
        }
        d.count++;
        d.firstTs = Math.min(d.firstTs, it.ts);
        d.lastTs = Math.max(d.lastTs, it.ts);
        d._days.add(dayKey(it.ts));
        if (obs.imei) d._raw.add(obs.imei);
        const last = runs[runs.length - 1];
        if (last && last.core === core) {
          last.to = it.ts;
          last.count++;
        } else runs.push({ core, from: it.ts, to: it.ts, count: 1 });
      }
      if (obs.imsi) {
        const u = imsis.get(obs.imsi);
        if (!u) imsis.set(obs.imsi, { imsi: obs.imsi, count: 1, firstTs: it.ts, lastTs: it.ts });
        else {
          u.count++;
          u.firstTs = Math.min(u.firstTs, it.ts);
          u.lastTs = Math.max(u.lastTs, it.ts);
        }
      }
    }
    const p = it.peerObs;
    if (p && it.peer) {
      const core = imeiCore(p.imei);
      if (core) {
        const key = `${it.peer}|${core}`;
        const cur = peerDev.get(key);
        if (cur) cur.count++;
        else peerDev.set(key, { peer: it.peer, core, imsi: p.imsi, count: 1 });
      }
    }
  }

  const list = [...imeis.values()]
    .map(({ _days, _raw, ...d }) => ({ ...d, days: _days.size, rawValues: [..._raw] }))
    .sort((a, b) => a.firstTs - b.firstTs);

  // Dual-SIM candidates: neighbouring serials of one model. The SIM may have
  // moved between the two slots of one phone, so overlap in time is not required.
  const dualSim: [string, string][] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (likelySameHandset(list[i].core, list[j].core)) dualSim.push([list[i].core, list[j].core]);
    }
  }

  return {
    imeis: list,
    imsis: [...imsis.values()].sort((a, b) => a.firstTs - b.firstTs),
    runs,
    switches: Math.max(0, runs.length - 1),
    dualSim,
    peerDevices: [...peerDev.values()].sort((a, b) => b.count - a.count),
  };
}
