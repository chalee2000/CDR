import { activeInteractions, isComm } from '../dataset';
import { imeiCore } from '../imei';
import { isPersonKind } from '../phone';
import { dayKey, DAY, isNight, startOfDay } from '../time';
import type { Dataset, Settings } from '../types';
import { siteLabelOf } from './locations';

export interface Summary {
  records: number;
  firstTs?: number;
  lastTs?: number;
  spanDays: number;
  activeDays: number;
  callsOut: number;
  callsIn: number;
  callsFwd: number;
  callsAnswered: number;
  callsUnanswered: number;
  talkSec: number;
  avgTalkSec: number;
  maxTalkSec: number;
  smsOut: number;
  smsIn: number;
  dataSessions: number;
  dataBytes: number;
  wifiSessions: number;
  contactsPerson: number;
  contactsService: number;
  intlContacts: number;
  nightComm: number;
  commTotal: number;
  imsis: string[];
  imeiCores: string[];
  sites: number;
  cells: number;
  provinces: string[];
  withTargetLocation: number;
}

export function summarize(ds: Dataset, settings: Settings): Summary {
  const items = activeInteractions(ds, settings);
  const s: Summary = {
    records: items.length,
    spanDays: 0,
    activeDays: 0,
    callsOut: 0,
    callsIn: 0,
    callsFwd: 0,
    callsAnswered: 0,
    callsUnanswered: 0,
    talkSec: 0,
    avgTalkSec: 0,
    maxTalkSec: 0,
    smsOut: 0,
    smsIn: 0,
    dataSessions: 0,
    dataBytes: 0,
    wifiSessions: 0,
    contactsPerson: 0,
    contactsService: 0,
    intlContacts: 0,
    nightComm: 0,
    commTotal: 0,
    imsis: [],
    imeiCores: [],
    sites: 0,
    cells: 0,
    provinces: [],
    withTargetLocation: 0,
  };
  const days = new Set<string>();
  const persons = new Set<string>();
  const services = new Set<string>();
  const intl = new Set<string>();
  const imsis = new Set<string>();
  const imeis = new Set<string>();
  const sites = new Set<string>();
  const cells = new Set<string>();
  const provinces = new Set<string>();

  for (const it of items) {
    if (s.firstTs === undefined || it.ts < s.firstTs) s.firstTs = it.ts;
    if (s.lastTs === undefined || it.ts > s.lastTs) s.lastTs = it.ts;
    days.add(dayKey(it.ts));
    if (it.service === 'call') {
      if (it.direction === 'out') s.callsOut++;
      else if (it.direction === 'in') s.callsIn++;
      else if (it.direction === 'fwd') s.callsFwd++;
      if (it.answered === true) {
        s.callsAnswered++;
        const d = it.durationSec ?? 0;
        s.talkSec += d;
        if (d > s.maxTalkSec) s.maxTalkSec = d;
      } else if (it.answered === false) s.callsUnanswered++;
    } else if (it.service === 'sms') {
      if (it.direction === 'out') s.smsOut++;
      else s.smsIn++;
    } else if (it.service === 'data') {
      s.dataSessions++;
      s.dataBytes += it.bytes ?? 0;
    } else if (it.service === 'wifi') s.wifiSessions++;

    if (isComm(it)) {
      s.commTotal++;
      if (isNight(it.ts, settings.nightStart, settings.nightEnd)) s.nightComm++;
      if (it.peer) {
        if (isPersonKind(it.peerKind)) persons.add(it.peer);
        else services.add(it.peer);
        if (it.peerKind === 'intl') intl.add(it.peer);
      }
    }
    const obs = it.targetObs;
    if (obs) {
      if (obs.imsi) imsis.add(obs.imsi);
      if (it.source !== 'WIFI') {
        const core = imeiCore(obs.imei);
        if (core) imeis.add(core);
      }
      if (obs.cell) {
        s.withTargetLocation++;
        cells.add(obs.cell.key);
        sites.add(siteLabelOf(obs.cell).key);
        if (obs.cell.province) provinces.add(obs.cell.province);
      }
    }
  }
  if (s.firstTs !== undefined && s.lastTs !== undefined) {
    s.spanDays = Math.round((startOfDay(s.lastTs) - startOfDay(s.firstTs)) / DAY) + 1;
  }
  s.activeDays = days.size;
  s.avgTalkSec = s.callsAnswered ? s.talkSec / s.callsAnswered : 0;
  s.contactsPerson = persons.size;
  s.contactsService = services.size;
  s.intlContacts = intl.size;
  s.imsis = [...imsis];
  s.imeiCores = [...imeis];
  s.sites = sites.size;
  s.cells = cells.size;
  s.provinces = [...provinces];
  return s;
}
