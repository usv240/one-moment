'use client';

// The record a call leaves behind, offered wherever a call can be heard.
//
// A caller never hears the sentence that goes out in their name, so the system
// owes them one afterwards. This builds it in the browser from the same event
// log the player is driving, using the same core function the orchestrator
// serves at /calls/:id/record.txt, so what a visitor downloads here is exactly
// what a caller would be handed after a live call.

import { FileDown } from 'lucide-react';
import { callRecord, recordAsText, type ServerMessage } from '@one-moment/core';
import type { Recording } from '@/lib/replay';

export function CallRecordLink({ id, recording, caller = 'Robert', className = '' }: {
  id: string;
  recording: Recording;
  caller?: string;
  className?: string;
}) {
  const download = () => {
    const rec = callRecord(recording.events as ServerMessage[], {
      callId: id,
      caller,
      ...(recording.recordedAt ? { startedAt: recording.recordedAt } : {}),
    });
    const blob = new Blob([recordAsText(rec)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `one-moment-call-${id}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <p className={`flex flex-wrap items-center gap-3 text-sm text-muted ${className}`}>
      <button
        type="button"
        onClick={download}
        className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-4 font-semibold text-ink hover:border-accent"
      >
        <FileDown aria-hidden className="h-5 w-5" />
        What was said in {caller}&apos;s name
      </button>
      <span className="max-w-xl">
        The record every call leaves behind: each line approved for the agent to say, whether it was spoken or cut off, every
        question the caller was asked and what went out as a result, and the post-call audit&apos;s verdict on each relay. It
        re-checks the guarantee that the voice said no word the rules did not approve.
      </span>
    </p>
  );
}
