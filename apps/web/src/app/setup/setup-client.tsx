'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Download, KeyRound, Plus, Trash2, Upload, X } from 'lucide-react';
import type { LexiconTerm } from '@one-moment/core';
import { Explain } from '@/components/explain';
import { ORCHESTRATOR_URL } from '@/lib/use-call';
import { EMPTY_SETTINGS, exportSettings, forgetEverything, importSettings, useSettings, type Settings } from '@/lib/settings';

const CATEGORIES: { id: NonNullable<LexiconTerm['category']>; label: string }[] = [
  { id: 'medication', label: 'Medicine' },
  { id: 'pharmacy', label: 'Pharmacy' },
  { id: 'doctor', label: 'Doctor' },
  { id: 'family', label: 'Family' },
  { id: 'place', label: 'Place' },
  { id: 'phrase', label: 'Phrase' },
  { id: 'other', label: 'Other' },
];

const field = 'min-h-12 w-full rounded-xl border border-line-strong bg-raised px-4 text-ink placeholder:text-subtle';

function Card({ title, explain, children, hint }: { title: string; explain?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-raised p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">{title}{explain && <Explain id={explain} />}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function SetupClient() {
  const { settings: s, update, key, setKey, loaded } = useSettings();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<LexiconTerm['category']>('medication');
  const [models, setModels] = useState<string[] | null>(null);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Settings>) => update({ ...s, ...patch });

  const addWord = () => {
    const t = term.trim();
    if (!t || s.words.some((w) => w.term.toLowerCase() === t.toLowerCase()) || s.words.length >= 100) return;
    set({ words: [...s.words, { term: t, ...(category ? { category } : {}) }] });
    setTerm('');
  };

  const checkKey = async () => {
    setKeyStatus('Checking');
    setModels(null);
    try {
      const r = await fetch(`${ORCHESTRATOR_URL}/v1/models`, { headers: { authorization: `Bearer ${key.key.trim()}` } });
      const j = (await r.json()) as { models?: string[]; error?: string };
      if (!r.ok || !j.models) throw new Error(j.error ?? 'not accepted');
      setModels(j.models);
      setKeyStatus(`Accepted. ${j.models.length} ${j.models.length === 1 ? 'model is' : 'models are'} available to this key.`);
    } catch (err) {
      setKeyStatus(`Not accepted: ${(err as Error).message}`);
    }
  };

  const download = () => {
    const blob = new Blob([exportSettings(s)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(s.name || 'my').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-one-moment-profile.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (f: File) => {
    try {
      update(importSettings(await f.text()));
      setNotice('Profile loaded.');
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  if (!loaded) return null;

  return (
    <div className="space-y-6">
      <Card title="Who is calling" hint="How the assistant refers to you when it speaks for you: &ldquo;Sam says: ...&rdquo;.">
        <label className="block">
          <span className="text-sm font-medium text-ink">Your first name</span>
          <input className={`${field} mt-1`} value={s.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Sam" autoComplete="given-name" />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-ink">When it talks about you, it says</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {([['he', 'he'], ['she', 'she'], ['they', 'they']] as const).map(([v, l]) => (
              <label key={v} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-4 ${s.pronoun === v ? 'border-accent bg-accent-soft' : 'border-line-strong'}`}>
                <input type="radio" name="pronoun" value={v} checked={s.pronoun === v} onChange={() => set({ pronoun: v })} className="accent-[var(--accent)]" />
                <span className="text-ink">{l}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-sm font-medium text-ink">What the call is usually about (optional)</span>
          <input className={`${field} mt-1`} value={s.context} maxLength={500} onChange={(e) => set({ context: e.target.value })} placeholder="Calling my pharmacy about my blood pressure tablets." />
        </label>
      </Card>

      <Card title="Your words" explain="patient-stream" hint="Medicines, your pharmacy, your doctor, family names. The patient ear listens for these; the fast ear does not, so it can confirm a word was really said. About ninety seconds, and someone can do it with you.">
        <div className="flex flex-wrap gap-2">
          <input className={`${field} min-w-0 flex-1 basis-48`} value={term} maxLength={60} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWord(); } }} placeholder="amlodipine" aria-label="A word or name" />
          <select className={`${field} w-auto`} value={category} onChange={(e) => setCategory(e.target.value as LexiconTerm['category'])} aria-label="What kind of word">
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button type="button" onClick={addWord} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-fg hover:bg-accent-hover">
            <Plus aria-hidden className="h-5 w-5" /> Add
          </button>
        </div>
        {s.words.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Your words">
            {s.words.map((w) => (
              <li key={w.term} className="flex items-center gap-1 rounded-full border border-line-strong bg-sunken py-1 pl-3 pr-1 text-sm text-ink">
                {w.term}
                {w.category && <span className="text-xs text-muted">({CATEGORIES.find((c) => c.id === w.category)?.label})</span>}
                <button type="button" aria-label={`Remove ${w.term}`} onClick={() => set({ words: s.words.filter((x) => x.term !== w.term) })} className="grid h-7 w-7 place-items-center rounded-full hover:bg-raised">
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No words yet.</p>
        )}
      </Card>

      <Card title="Can your yes be trusted?" explain="forced-choice" hint="It never asks you yes or no anyway. This goes to a human assistant if a call is handed over, so they know how to ask.">
        <div className="flex flex-wrap gap-2">
          {([['reliable', 'Usually'], ['unreliable', 'Not always'], ['unknown', 'Not sure']] as const).map(([v, l]) => (
            <label key={v} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-4 ${s.yesNo === v ? 'border-accent bg-accent-soft' : 'border-line-strong'}`}>
              <input type="radio" name="yesno" value={v} checked={s.yesNo === v} onChange={() => set({ yesNo: v })} className="accent-[var(--accent)]" />
              <span className="text-ink">{l}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="Your AssemblyAI key (optional)" hint="Without one, calls use the shared demo key, which has an hourly limit. With yours, calls run on your account.">
        <div className="flex flex-wrap gap-2">
          <input
            className={`${field} min-w-0 flex-1 basis-64 font-mono`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key.key}
            onChange={(e) => { setKey(e.target.value, key.remembered); setKeyStatus(null); setModels(null); }}
            placeholder="Paste your key"
            aria-label="AssemblyAI API key"
          />
          <button type="button" onClick={checkKey} disabled={!key.key.trim()} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-4 font-semibold text-ink hover:border-accent disabled:opacity-50">
            <KeyRound aria-hidden className="h-5 w-5" /> Check it
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={key.remembered} onChange={(e) => setKey(key.key, e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
          Remember on this device (otherwise it is forgotten when you close the tab)
        </label>
        {keyStatus && <p role="status" className="text-sm text-ink">{keyStatus}</p>}
        <p className="text-sm text-muted">
          Where it goes: from this browser to our server when a call starts, then to AssemblyAI for that call. Our server keeps it
          in memory for the length of the call and never writes it down or logs it. The code is open, so you can check.
        </p>
      </Card>

      <Card title="Your model (optional)" explain="dissent" hint="The model the Advocate and the Skeptic run on, when speech is broken up. Clear sentences never use a model.">
        {models ? (
          <select className={field} value={s.model} onChange={(e) => set({ model: e.target.value })} aria-label="Model">
            <option value="">Automatic: the smallest model your key can use</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <p className="text-sm text-muted">{s.model ? <>Chosen: <code className="font-mono text-ink">{s.model}</code>. </> : null}Check your key above to see the models it can use.</p>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/demo" className="inline-flex min-h-12 items-center rounded-xl bg-accent px-5 font-semibold text-accent-fg shadow-1 hover:bg-accent-hover">
          Try a call with these
        </Link>
        <button type="button" onClick={download} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-4 font-semibold text-ink hover:border-accent">
          <Download aria-hidden className="h-5 w-5" /> Export
        </button>
        <button type="button" onClick={() => file.current?.click()} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-4 font-semibold text-ink hover:border-accent">
          <Upload aria-hidden className="h-5 w-5" /> Import
        </button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <button
          type="button"
          onClick={() => { forgetEverything(); update(EMPTY_SETTINGS); setKey('', false); setModels(null); setKeyStatus(null); setNotice('Everything on this device has been forgotten.'); }}
          className="ml-auto inline-flex min-h-12 items-center gap-2 rounded-xl px-4 font-semibold text-ink underline-offset-4 hover:underline"
        >
          <Trash2 aria-hidden className="h-5 w-5" /> Forget everything
        </button>
      </div>
      {notice && <p role="status" className="text-sm text-ink">{notice}</p>}
      <p className="text-sm text-muted">
        Saved on this device as you type. Your words and name are sent only when you start a call, and only for that call. The
        export never contains your key.
      </p>
    </div>
  );
}
