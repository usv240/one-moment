// The self-audit: every call graded against a stronger transcript of itself.
//
// MEASURED 17 Sept: the realtime API cannot see a mid-sentence pause (it
// reports 46ms gaps and stretches the words instead), but AssemblyAI's
// pre-recorded API, built for accuracy rather than speed, exposes the real
// gap (6313ms on the same clip). So after a call, the caller's audio is sent
// back through the pre-recorded API, and the live system's decisions are
// checked against what the careful model heard:
//
//   - was every word we relayed actually said?
//   - how long was the pause really, and how close was our estimate?
//   - how far did the live transcript drift from the careful one?
//
// Only with audio the caller agreed to keep (always, for the recorded demo
// caller). The audio goes to AssemblyAI for this and nowhere else.

import { contentWords, disagreementRate, normalizeTokens, swallowedSilenceMs, type CallAudit, type StreamTurn } from '@one-moment/core';

const BASE = 'https://api.assemblyai.com/v2';

function wav16k(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

type Careful = { text: string; words: { text: string; start: number; end: number; confidence: number }[]; model: string };

export async function transcribeCarefully(apiKey: string, pcm: Buffer, timeoutMs = 60000): Promise<Careful> {
  const up = await fetch(`${BASE}/upload`, { method: 'POST', headers: { authorization: apiKey }, body: new Uint8Array(wav16k(pcm)) });
  if (!up.ok) throw new Error(`upload failed ${up.status}`);
  const { upload_url } = (await up.json()) as { upload_url: string };
  const sub = await fetch(`${BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, speech_models: ['universal-3-5-pro', 'universal-2'] }),
  });
  if (!sub.ok) throw new Error(`transcript request failed ${sub.status}`);
  const { id } = (await sub.json()) as { id: string };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    const r = await fetch(`${BASE}/transcript/${id}`, { headers: { authorization: apiKey } });
    const j = (await r.json()) as { status: string; text?: string; words?: Careful['words']; error?: string; speech_model_used?: string; speech_model?: string };
    if (j.status === 'completed') return { text: j.text ?? '', words: j.words ?? [], model: j.speech_model_used ?? j.speech_model ?? 'universal-3-5-pro' };
    if (j.status === 'error') throw new Error(j.error ?? 'transcription error');
  }
  throw new Error('transcription timed out');
}

const largestGap = (ws: { start: number; end: number }[]) =>
  ws.slice(1).reduce((m, w, i) => Math.max(m, w.start - ws[i]!.end), 0);

export function grade(args: {
  careful: Careful;
  patientTurns: StreamTurn[];
  relays: string[];
  callerName: string;
  /** Labels the caller tapped. A word they chose is confirmed by them, not by the audio. */
  chosen?: string[];
  ms: number;
}): CallAudit {
  const { careful, patientTurns } = args;
  const heard = new Set(contentWords(careful.text));
  const near = (w: string) => heard.has(w) || [...heard].some((h) => h.slice(0, 5) === w.slice(0, 5) && Math.min(h.length, w.length) >= 4);
  const nameWords = new Set(contentWords(args.callerName));
  const chosen = new Set((args.chosen ?? []).flatMap(contentWords));
  const relays = args.relays.map((said) => {
    // "Robert says:" is framing we add, not a claim about what he said.
    const body = said.replace(/^[^:]{1,40}\bsays:\s*/i, '');
    const unheard = contentWords(body).filter((w) => !nameWords.has(w) && !near(w));
    const byChoice = unheard.filter((w) => chosen.has(w));
    const missing = unheard.filter((w) => !chosen.has(w));
    return { said, confirmed: missing.length === 0, missing, byChoice };
  });

  const livePatient = patientTurns.map((t) => t.transcript).join(' ');
  const liveWords = patientTurns.flatMap((t) => t.words);
  const drift = liveWords.length ? disagreementRate(normalizeTokens(livePatient), normalizeTokens(careful.text)) : null;

  const carefulGap = careful.words.length > 1 ? largestGap(careful.words) : null;
  const liveGap = liveWords.length > 1 ? largestGap(liveWords) : null;
  const estimate = liveWords.length ? swallowedSilenceMs(liveWords) : null;

  const allConfirmed = relays.every((r) => r.confirmed);
  const byChoice = [...new Set(relays.flatMap((r) => r.byChoice))];
  const verdict = relays.length === 0
    ? 'Nothing was relayed on this call, so there was nothing to confirm.'
    : !allConfirmed
      ? `Some relayed words were not in the careful transcript: ${relays.flatMap((r) => r.missing).join(', ')}.`
      : byChoice.length
        ? `Every relayed word was confirmed: by the careful transcript, or by the caller's own choice (${byChoice.join(', ')}).`
        : 'Every relayed word was confirmed by the careful transcript.';

  return {
    model: careful.model,
    ms: args.ms,
    carefulText: careful.text,
    pause: { carefulMs: carefulGap, liveGapMs: liveGap, estimatedMs: estimate },
    relays,
    drift,
    verdict,
    allConfirmed,
  };
}
