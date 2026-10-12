import type { DatasetDraft } from './parsers';
import type { Dataset, Interaction, Settings } from './types';

let counter = 0;

export function buildDataset(draft: DatasetDraft, slot: number, label?: string, id?: string): Dataset {
  counter += 1;
  return {
    id: id ?? `ds${Date.now().toString(36)}${counter}`,
    fileName: draft.fileName,
    target: draft.target,
    label: label ?? draft.target,
    slot,
    interactions: draft.interactions,
    meta: draft.meta,
  };
}

/** Interactions after dataset-level settings (exact-duplicate collapsing). */
export function activeInteractions(ds: Dataset, settings: Pick<Settings, 'dedupeExact'>): Interaction[] {
  return settings.dedupeExact ? ds.interactions.filter((i) => !i.dupOfPrev) : ds.interactions;
}

export function isComm(it: Interaction): boolean {
  return it.service === 'call' || it.service === 'sms';
}

export function datasetName(ds: Pick<Dataset, 'label' | 'target'>): string {
  return ds.label && ds.label !== ds.target ? `${ds.label} (${ds.target})` : ds.target;
}
