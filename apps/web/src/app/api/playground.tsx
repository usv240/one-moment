'use client';

// Live playground for POST /v1/decide. Every response here is the real engine.

import { useState } from 'react';
import { Check, CircleHelp, Pause, Send } from 'lucide-react';
import type { ServerMessage } from '@one-moment/core';
import { ORCHESTRATOR_URL } from '@/lib/use-call';
import { loadKey } from '@/lib/settings';
import { RECORDING } from '@/content/measured';

const recordedTurn = (RECORDING.events as ServerMessage[]).find(
  (m): m is Extract<ServerMessage, { type: 'turn' }> => m.type === 'turn' && m.stream === 'patient' && m.turn.end_of_turn,
)?.turn;

const PRESETS: { id: string; label: string; body: object }[] = [
  { id: 'clear', label: 'A clear sentence', body: { transcript: 'I need to refill my amlodipine prescription, please.', name: 'Robert' } },
  { id: 'not', label: 'One ear lost the "not"', body: { transcript: 'I want a refill of the white tablet.', fastTranscript: 'I do not want a refill of the white tablet.', name: 'Robert' } },
  { id: 'broken', label: 'Broken-up speech', body: { transcript: 'tablet... the white one... refill no', name: 'Robert', lexicon: ['amlodipine', 'metformin'] } },
  ...(recordedTurn ? [{ id: 'turn', label: 'A raw AssemblyAI Turn', body: { turn: recordedTurn, name: 'Robert' } }] : []),
];

type Result = {
  action: 'relay' | 'ask' | 'hold'; say: string | null;
  question: { prompt: string; options: { label: string; relay?: string }[] } | null;
  rule: { number: number; name: string; plain: string }; models: { used: string | null; calls: number }; ms: number;
};

const ACTION = {
  relay: { Icon: Check, label: 'Say it', tone: 'text-grounded' },
  ask: { Icon: CircleHelp, label: 'Ask the caller', tone: 'text-inferred' },
  hold: { Icon: Pause, label: 'Keep waiting', tone: 'text-muted' },
} as const;

export function Playground() {
  const [preset, setPreset] = useState(PRESETS[0]!.id);
  const [body, setBody] = useState(JSON.stringify(PRESETS[0]!.body, null, 2));
  const [useKey, setUseKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setBody(JSON.stringify(p.body, null, 2));
    setResult(null); setRaw(null); setError(null);
  };

  const send = async () => {
    setBusy(true); setError(null); setResult(null); setRaw(null);
    try {
      JSON.parse(body);
      const key = useKey ? loadKey().key.trim() : '';
      const r = await fetch(`${ORCHESTRATOR_URL}/v1/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body,
      });
      const text = await r.text();
      setRaw(JSON.stringify(JSON.parse(text), null, 2));
      if (!r.ok) setError((JSON.parse(text) as { error?: string }).error ?? `HTTP ${r.status}`);
      else setResult(JSON.parse(text) as Result);
    } catch (err) {
      setError(err instanceof SyntaxError ? 'The request body is not valid JSON.' : `Could not reach the engine at ${ORCHESTRATOR_URL}.`);
    } finally {
      setBusy(false);
    }
  };

  const a = result ? ACTION[result.action] : null;

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Examples" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => choose(p.id)}
            className={`min-h-11 rounded-xl border px-4 text-sm font-medium ${preset === p.id ? 'border-accent bg-accent-soft text-ink' : 'border-line-strong bg-raised text-muted hover:text-ink'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-sm font-medium text-ink">Request body</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} rows={10}
          className="mt-1 w-full rounded-xl border border-line-strong bg-sunken p-4 font-mono text-sm text-ink" />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={send} disabled={busy} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-fg shadow-1 hover:bg-accent-hover disabled:opacity-60">
          <Send aria-hidden className="h-5 w-5" /> {busy ? 'Deciding' : 'POST /v1/decide'}
        </button>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={useKey} onChange={(e) => setUseKey(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
          Send my AssemblyAI key from the setup page (lets it use a model)
        </label>
      </div>
      {error && <p role="alert" className="rounded-lg border border-vetoed bg-raised px-3 py-2 text-sm text-ink">{error}</p>}
      {result && a && (
        <div aria-live="polite" className="rounded-2xl border border-line bg-raised p-5">
          <p className="flex items-center gap-2 text-lg font-semibold text-ink"><a.Icon aria-hidden className={`h-5 w-5 ${a.tone}`} />{a.label}</p>
          {result.say && <p className="mt-2 font-caller text-xl text-ink">&ldquo;{result.say}&rdquo;</p>}
          {result.question && (
            <div className="mt-3">
              <p className="font-caller text-xl font-bold text-ink">{result.question.prompt}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {result.question.options.map((o) => (
                  <span key={o.label} className="rounded-xl border-2 border-line-strong px-4 py-2 font-caller text-lg font-bold text-ink" title={o.relay}>{o.label}</span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-sm text-ink"><span className="font-mono text-xs text-muted">Rule {result.rule.number}</span> {result.rule.plain}</p>
          <p className="mt-1 font-mono text-xs text-muted">{result.models.calls} model calls{result.models.used ? ` on ${result.models.used}` : ''}, {result.ms}ms</p>
        </div>
      )}
      {raw && (
        <details className="rounded-xl border border-line" open={!result}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">Raw response</summary>
          <pre className="max-h-96 overflow-auto border-t border-line bg-sunken p-4 font-mono text-xs text-ink">{raw}</pre>
        </details>
      )}
    </div>
  );
}
