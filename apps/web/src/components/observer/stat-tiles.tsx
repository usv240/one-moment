// The live counters. A single headline number per tile is not a chart: value
// and label, in text ink, never in a series color.

import type { FloorModel } from '@one-moment/core';
import { Explain } from '../explain';

export function StatTiles({ stats }: { stats: FloorModel['stats'] }) {
  const tiles: { label: string; value: string; explain?: string }[] = [
    { label: 'Silence protected', value: `${(stats.silenceProtectedMs / 1000).toFixed(1)}s`, explain: 'turn-detection' },
    { label: 'Times the line was held', value: String(stats.holdsSpoken), explain: 'hold' },
    { label: 'Inventions blocked', value: String(stats.inventionsBlocked), explain: 'dissent' },
    { label: 'Relayed to the other person', value: String(stats.relays), explain: 'verbatim' },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-line bg-raised p-4">
          <dt className="flex items-start justify-between gap-2 text-xs font-medium text-muted">
            <span>{t.label}</span>
            {t.explain && <Explain id={t.explain} />}
          </dt>
          <dd className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-ink">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
