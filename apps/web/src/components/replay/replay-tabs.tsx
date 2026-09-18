'use client';

// Two recorded calls, one player. Each is a real run of the live system.

import { useState } from 'react';
import { RECORDING, RECORDING_CHOICE } from '@/content/measured';
import { ReplayPlayer } from './replay-player';

const CALLS = [
  { id: 'pause', label: 'The long pause', blurb: 'Robert stops for six seconds mid-sentence. The pharmacist fills the silence.', recording: RECORDING, audio: '/recorded/robert-call.mp3' },
  { id: 'choice', label: 'The half-found word', blurb: 'The medicine name only half comes out: "am, am lo". It is never guessed.', recording: RECORDING_CHOICE, audio: '/recorded/robert-call-choice.mp3' },
] as const;

export function ReplayTabs({ full = false }: { full?: boolean }) {
  const [id, setId] = useState<(typeof CALLS)[number]['id']>('pause');
  const call = CALLS.find((c) => c.id === id)!;
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Choose a recorded call" className="grid gap-2 sm:grid-cols-2">
        {CALLS.map((c) => (
          <button
            key={c.id}
            role="tab"
            type="button"
            aria-selected={c.id === id}
            onClick={() => setId(c.id)}
            className={`rounded-2xl border p-4 text-left transition-colors ${c.id === id ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-line-strong'}`}
          >
            <span className="block font-semibold text-ink">{c.label}</span>
            <span className="mt-1 block text-sm text-muted">{c.blurb}</span>
          </button>
        ))}
      </div>
      {/* Keyed, so switching calls starts the new one from the beginning. */}
      <div role="tabpanel">
        <ReplayPlayer key={call.id} recording={call.recording} audioSrc={call.audio} compact={!full} full={full} />
      </div>
    </div>
  );
}
