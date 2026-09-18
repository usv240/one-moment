// The Floor Controller's state, live. One pill per state; the current one is
// filled, states already visited this call are outlined. Current state is also
// announced in words, so the fill is never the only signal.

import type { FloorState, ServerMessage } from '@one-moment/core';
import { Explain } from '../explain';

const STATES: { id: FloorState; label: string }[] = [
  { id: 'IDLE', label: 'Waiting' },
  { id: 'USER_SPEAKING', label: 'Caller speaking' },
  { id: 'USER_PAUSED', label: 'Caller pausing' },
  { id: 'HOLDING', label: 'Holding the floor' },
  { id: 'FAR_SPEAKING', label: 'Other person speaking' },
  { id: 'DECIDING', label: 'Deciding' },
  { id: 'CLARIFYING', label: 'Asking the caller' },
  { id: 'RELAYING', label: 'Relaying' },
  { id: 'ESCALATE', label: 'Handed to a person' },
];

export function FloorStrip({ state, events }: { state: FloorState; events: ServerMessage[] }) {
  const visited = new Set(events.flatMap((m) => (m.type === 'floor' ? [m.state] : [])));
  const current = STATES.find((s) => s.id === state)?.label ?? state;
  return (
    <section aria-labelledby="floor-h" className="space-y-2">
      <h3 id="floor-h" className="flex items-center gap-2 text-base font-semibold text-ink">
        Who may speak
        <Explain id="floor-controller" />
        <span className="sr-only">Current state: {current}</span>
      </h3>
      <ol className="flex flex-wrap gap-1.5" aria-hidden>
        {STATES.map((s) => (
          <li
            key={s.id}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              s.id === state
                ? 'bg-accent text-accent-fg'
                : visited.has(s.id)
                  ? 'border border-line-strong text-ink'
                  : 'border border-line text-muted'
            }`}
          >
            {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}
