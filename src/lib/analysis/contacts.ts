import { activeInteractions, isComm } from '../dataset';
import { imeiCore } from '../imei';
import { isPersonKind } from '../phone';
import { dayKey, hourOf, isNight } from '../time';
import type { Dataset, Interaction, PeerKind, Settings } from '../types';
import { siteLabelOf } from './locations';

export interface ContactStat {
  peer: string;
  kind: PeerKind;
  country?: string;
  isPerson: boolean;
  rawValues: string[];
  callsOut: number;
  callsIn: number;
  callsFwd: number;
  answered: number;
  unanswered: number;
  talkSec: number;
  maxTalkSec: number;
  smsOut: number;
  smsIn: number;
  total: number;
  activeDays: number;
  firstTs: number;
  lastTs: number;
  night: number;
  hours: number[];
  /** Devices and positions of the other party, when the operator supplied them. */
  peerImeis: string[];
  peerImsis: string[];
  peerSites: string[];
  /** Target sites seen while talking to this party. */
  targetSites: string[];
}

export function contactStats(ds: Dataset, settings: Settings): ContactStat[] {
  const map = new Map<string, ContactStat & { _days: Set<string>; _raw: Set<string>; _pi: Set<string>; _ps: Set<string>; _ts: Set<string>; _pims: Set<string> }>();
  for (const it of activeInteractions(ds, settings)) {
    if (!isComm(it) || !it.peer) continue;
    let c = map.get(it.peer);
    if (!c) {
      c = {
        peer: it.peer,
        kind: it.peerKind,
        country: it.peerCountry,
        isPerson: isPersonKind(it.peerKind),
        rawValues: [],
        callsOut: 0,
        callsIn: 0,
        callsFwd: 0,
        answered: 0,
        unanswered: 0,
        talkSec: 0,
        maxTalkSec: 0,
        smsOut: 0,
        smsIn: 0,
        total: 0,
        activeDays: 0,
        firstTs: it.ts,
        lastTs: it.ts,
        night: 0,
        hours: new Array(24).fill(0),
        peerImeis: [],
        peerImsis: [],
        peerSites: [],
        targetSites: [],
        _days: new Set(),
        _raw: new Set(),
        _pi: new Set(),
        _ps: new Set(),
        _ts: new Set(),
        _pims: new Set(),
      };
      map.set(it.peer, c);
    }
    addTo(c, it, settings);
  }
  const out: ContactStat[] = [];
  for (const c of map.values()) {
    const { _days, _raw, _pi, _ps, _ts, _pims, ...rest } = c;
    out.push({
      ...rest,
      activeDays: _days.size,
      rawValues: [..._raw],
      peerImeis: [..._pi],
      peerImsis: [..._pims],
      peerSites: [..._ps],
      targetSites: [..._ts],
    });
  }
  out.sort((a, b) => b.total - a.total || b.talkSec - a.talkSec || a.peer.localeCompare(b.peer));
  return out;
}

function addTo(
  c: ContactStat & { _days: Set<string>; _raw: Set<string>; _pi: Set<string>; _ps: Set<string>; _ts: Set<string>; _pims: Set<string> },
  it: Interaction,
  settings: Settings,
) {
  c.total++;
  if (it.service === 'call') {
    if (it.direction === 'out') c.callsOut++;
    else if (it.direction === 'in') c.callsIn++;
    else if (it.direction === 'fwd') c.callsFwd++;
    if (it.answered === true) {
      c.answered++;
      const d = it.durationSec ?? 0;
      c.talkSec += d;
      if (d > c.maxTalkSec) c.maxTalkSec = d;
    } else if (it.answered === false) c.unanswered++;
  } else if (it.direction === 'out') c.smsOut++;
  else c.smsIn++;
  if (it.ts < c.firstTs) c.firstTs = it.ts;
  if (it.ts > c.lastTs) c.lastTs = it.ts;
  c._days.add(dayKey(it.ts));
  if (it.peerRaw && it.peerRaw !== it.peer) c._raw.add(it.peerRaw);
  if (isNight(it.ts, settings.nightStart, settings.nightEnd)) c.night++;
  c.hours[hourOf(it.ts)]++;
  const p = it.peerObs;
  if (p) {
    const core = imeiCore(p.imei);
    if (core) c._pi.add(core);
    if (p.imsi) c._pims.add(p.imsi);
    if (p.cell) c._ps.add(siteLabelOf(p.cell).label);
  }
  if (it.targetObs?.cell) c._ts.add(siteLabelOf(it.targetObs.cell).label);
}

/** All communications with one party, across every loaded dataset. */
export function interactionsWith(datasets: Dataset[], peer: string, settings: Settings): { ds: Dataset; it: Interaction }[] {
  const out: { ds: Dataset; it: Interaction }[] = [];
  for (const ds of datasets) {
    for (const it of activeInteractions(ds, settings)) {
      if (it.peer === peer && isComm(it)) out.push({ ds, it });
    }
  }
  return out.sort((a, b) => a.it.ts - b.it.ts);
}
