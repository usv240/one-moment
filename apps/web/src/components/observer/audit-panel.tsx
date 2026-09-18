// After the call: the live system graded against a careful transcript of the
// same audio, from AssemblyAI's pre-recorded model. The live stream cannot see
// a pause; the careful model can. So this is where the pause is finally
// measured, and where every relayed word is checked against what was said.

import { Ban, Check, ClipboardCheck } from 'lucide-react';
import type { CallAudit } from '@one-moment/core';

const s = (ms: number | null) => (ms === null ? 'n/a' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export function AuditPanel({ audit, failed, pending, compact = false }: { audit: CallAudit | null; failed: string | null; pending: boolean; compact?: boolean }) {
  if (!audit && !failed && !pending) return null;
  return (
    <section aria-labelledby="audit-h" className="space-y-3">
      <h3 id="audit-h" className="flex items-center gap-2 text-base font-semibold text-ink">
        <ClipboardCheck aria-hidden className="h-5 w-5 text-accent" />
        After the call: graded against itself
      </h3>
      {pending && !audit && !failed && (
        <p aria-live="polite" className="rounded-lg bg-sunken px-3 py-2 text-sm text-muted">
          Sending the caller&apos;s audio to AssemblyAI&apos;s pre-recorded model, built for accuracy rather than speed.
        </p>
      )}
      {failed && <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-muted">The self-audit could not run: {failed}</p>}
      {audit && (
        <div aria-live="polite" className="space-y-4 rounded-xl border border-line bg-raised p-4">
          <p className="flex items-start gap-2 font-semibold text-ink">
            {audit.allConfirmed
              ? <Check aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-grounded" />
              : <Ban aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-vetoed" />}
            {audit.verdict}
          </p>
          {!compact && <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted">The careful transcript ({audit.model})</p>
            <p className="mt-1 text-ink">&ldquo;{audit.carefulText}&rdquo;</p>
          </div>}
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-sunken p-3">
              <dt className="text-xs text-muted">The pause, as the careful model heard it</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold text-ink">{s(audit.pause.carefulMs)}</dd>
            </div>
            <div className="rounded-lg bg-sunken p-3">
              <dt className="text-xs text-muted">The same pause in the live stream</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold text-ink">{s(audit.pause.liveGapMs)}</dd>
              <dd className="text-xs text-muted">longest gap between words</dd>
            </div>
            <div className="rounded-lg bg-sunken p-3">
              <dt className="text-xs text-muted">Our estimate, from how stretched the words were</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold text-ink">{s(audit.pause.estimatedMs)}</dd>
            </div>
          </dl>
          {!compact && audit.relays.length > 0 && (
            <ul className="space-y-1.5">
              {audit.relays.map((r) => (
                <li key={r.said} className="flex items-start gap-2 text-sm text-ink">
                  {r.confirmed
                    ? <Check aria-label="confirmed" className="mt-0.5 h-4 w-4 shrink-0 text-grounded" />
                    : <Ban aria-label="not confirmed" className="mt-0.5 h-4 w-4 shrink-0 text-vetoed" />}
                  <span>
                    &ldquo;{r.said}&rdquo;
                    {r.missing.length ? ` (not heard: ${r.missing.join(', ')})` : ''}
                    {r.byChoice?.length ? ` (${r.byChoice.join(', ')}: confirmed by the caller's choice, not by the audio)` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            {audit.drift !== null && <>Live and careful transcripts differ on {Math.round(audit.drift * 100)} percent of words. </>}
            Graded in {s(audit.ms)}.
          </p>
        </div>
      )}
    </section>
  );
}
