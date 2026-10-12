import { useMemo } from 'react';
import type { ECharts } from 'echarts/core';
import type { Network } from '../lib/analysis/network';
import { PEER_KIND_TH } from '../lib/labels';
import { slotColor, type ThemeMode } from '../lib/palette';
import { chrome, EChart } from './Chart';
import { escapeHtml } from './download';

export type NetColorBy = 'role' | 'community';

interface Props {
  network: Network;
  mode: ThemeMode;
  colorBy: NetColorBy;
  /** community id -> palette slot (largest communities first, rest grey). */
  communitySlots: Map<number, number>;
  onNodeClick: (id: string) => void;
  onReady: (c: ECharts) => void;
}

export function NetworkGraph({ network, mode, colorBy, communitySlots, onNodeClick, onReady }: Props) {
  const option = useMemo(() => {
    const ch = chrome(mode);
    const maxW = Math.max(1, ...network.nodes.filter((n) => !n.isTarget).map((n) => n.weightedDegree));
    const maxE = Math.max(1, ...network.edges.map((e) => e.weight));
    const fill = (n: Network['nodes'][number]) => {
      if (colorBy === 'community') return communitySlots.has(n.community) ? slotColor(communitySlots.get(n.community)!, mode) : ch.other;
      if (n.isTarget) return slotColor(n.slot ?? 99, mode);
      return n.shared ? ch.ink2 : ch.other;
    };
    return {
      textStyle: ch.textStyle,
      tooltip: {
        ...ch.tooltip,
        formatter: (p: { dataType: string; data: Record<string, unknown> }) => {
          const d = p.data;
          if (p.dataType === 'edge') {
            return `<strong>${escapeHtml(d.source)} ↔ ${escapeHtml(d.target)}</strong><br>${escapeHtml(d.events)} ครั้ง · โทร ${escapeHtml(d.calls)} · SMS ${escapeHtml(d.sms)} · สนทนา ${escapeHtml(Math.round(Number(d.talkSec) / 60))} นาที`;
          }
          const kind = d.isTarget ? 'เป้าหมาย' : (PEER_KIND_TH[d.kind as keyof typeof PEER_KIND_TH] ?? '');
          const title = d.label && d.label !== d.id ? `${d.label} (${d.id})` : d.id;
          return `<strong>${escapeHtml(title)}</strong> <span style="opacity:.7">${escapeHtml(kind)}</span><br>เชื่อมกับ ${escapeHtml(d.degree)} โหนด · น้ำหนักรวม ${escapeHtml(d.weightedDegree)}<br>Betweenness ${escapeHtml(Number(d.betweenness).toFixed(3))} · กลุ่มที่ ${escapeHtml(Number(d.community) + 1)}${d.shared ? '<br>ติดต่อกับเป้าหมาย 2 รายขึ้นไป' : ''}`;
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          animationDurationUpdate: 300,
          // Strong ties shorten edges; the floor keeps room for both labels.
          // Larger graphs get less repulsion and more gravity so they stay on
          // the canvas, and settle before the first paint up to ~150 nodes.
          force: {
            repulsion: Math.max(60, Math.min(320, 1400 / Math.sqrt(network.nodes.length || 1))),
            edgeLength: network.nodes.length > 60 ? [45, 150] : [80, 190],
            gravity: network.nodes.length > 60 ? 0.14 : 0.07,
            friction: 0.2,
            layoutAnimation: network.nodes.length > 150,
          },
          labelLayout: { hideOverlap: true },
          emphasis: { focus: 'adjacency', label: { show: true }, lineStyle: { opacity: 1 } },
          blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.08 }, label: { opacity: 0.2 } },
          // Links resolve nodes by name, so name stays the unique number; the
          // display text (alias + number) goes through the label formatter.
          data: network.nodes.map((n) => ({
            ...n,
            name: n.id,
            symbolSize: n.isTarget ? 36 : 7 + 17 * Math.sqrt(n.weightedDegree / maxW),
            itemStyle: { color: fill(n), borderColor: ch.surface, borderWidth: n.isTarget ? 3 : 2 },
            label: {
              show: n.isTarget || n.shared,
              formatter: n.label === n.id ? n.id : `${n.label}\n${n.id}`,
              position: 'right',
              color: ch.ink,
              fontSize: n.isTarget ? 12.5 : 11,
              fontWeight: n.isTarget ? 600 : 400,
              textBorderColor: ch.surface,
              textBorderWidth: 3,
            },
          })),
          links: network.edges.map((e) => ({
            ...e,
            value: e.weight,
            lineStyle: { width: 1 + 4 * (Math.log1p(e.weight) / Math.log1p(maxE)), color: ch.axisColor, opacity: 0.75, curveness: 0 },
          })),
        },
      ],
    };
  }, [network, mode, colorBy, communitySlots]);

  return (
    <EChart
      option={option}
      height={600}
      label="ผังเครือข่ายการติดต่อ"
      onReady={onReady}
      onClick={(p) => {
        if (p.dataType === 'node' && p.data && typeof p.data === 'object' && 'id' in p.data) onNodeClick(String((p.data as { id: string }).id));
      }}
    />
  );
}
