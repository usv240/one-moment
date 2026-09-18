// A thin AssemblyAI streaming client built for measurement, not for production.
// It records every server message with a wall-clock timestamp so the tests can
// reason about latency and turn boundaries.

import WebSocket from 'ws';
import { toFrames, durationMs } from './wav.js';

const WS_URL = 'wss://streaming.assemblyai.com/v3/ws';

/**
 * Open a streaming session.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {object} opts.config      query-string parameters, passed through verbatim
 * @param {string} [opts.label]     name used in logs and results
 * @param {boolean} [opts.verbose]
 */
export function openSession({ apiKey, config = {}, label = 'session', verbose = false }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(config)) {
    if (v === undefined || v === null) continue;
    params.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
  }

  const url = `${WS_URL}?${params.toString()}`;
  const t0 = Date.now();

  const state = {
    label,
    url,
    config,
    openedAt: null,
    beginMessage: null,
    messages: [],   // { at, dt, type, raw }
    turns: [],      // every Turn message
    finalTurns: [], // Turn messages with end_of_turn true
    errors: [],
    closed: false,
    closeCode: null,
    closeReason: null,
    terminationMessage: null,
  };

  const ws = new WebSocket(url, { headers: { Authorization: apiKey } });
  ws.binaryType = 'nodebuffer';

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[${label}] timed out waiting for Begin after 15s`)),
      15000
    );

    ws.on('open', () => {
      state.openedAt = Date.now() - t0;
      if (verbose) console.log(`  [${label}] socket open at +${state.openedAt}ms`);
    });

    ws.on('message', (data) => {
      const at = Date.now();
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        state.errors.push({ at: at - t0, error: 'non-JSON message', body: String(data).slice(0, 200) });
        return;
      }

      const record = { at: at - t0, type: msg.type, raw: msg };
      state.messages.push(record);

      if (msg.type === 'Begin') {
        state.beginMessage = msg;
        clearTimeout(timer);
        resolve(state);
      } else if (msg.type === 'Turn') {
        state.turns.push(record);
        if (msg.end_of_turn) state.finalTurns.push(record);
        if (verbose) {
          const tag = msg.end_of_turn ? 'FINAL' : 'part ';
          console.log(`  [${label}] +${String(record.at).padStart(6)}ms ${tag} "${msg.transcript ?? ''}"`);
        }
      } else if (msg.type === 'Termination') {
        state.terminationMessage = msg;
      } else if (msg.type === 'Error' || msg.error) {
        state.errors.push({ at: record.at, error: msg.error ?? JSON.stringify(msg) });
        clearTimeout(timer);
        reject(new Error(`[${label}] server error: ${msg.error ?? JSON.stringify(msg)}`));
      }
    });

    ws.on('error', (err) => {
      state.errors.push({ at: Date.now() - t0, error: err.message });
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', (code, reason) => {
      state.closed = true;
      state.closeCode = code;
      state.closeReason = reason?.toString() ?? '';
      clearTimeout(timer);
      // A close before Begin means the config or the key was rejected.
      reject(new Error(`[${label}] closed before Begin: ${code} ${state.closeReason}`));
    });
  });

  return { ws, state, ready, t0 };
}

/**
 * Stream PCM into an open session at real time, one frame per frameMs.
 *
 * Pacing matters more than anything else in this harness. Turn detection is a
 * function of wall-clock silence, so blasting the file at full speed collapses
 * every gap and makes the results meaningless.
 */
export async function streamRealtime(session, pcm, { frameMs = 50, verbose = false } = {}) {
  const frames = toFrames(pcm, frameMs);
  const start = Date.now();

  for (let i = 0; i < frames.length; i++) {
    const due = start + i * frameMs;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);

    if (session.ws.readyState !== WebSocket.OPEN) {
      session.state.errors.push({
        at: Date.now() - session.t0,
        error: `socket not open at frame ${i} of ${frames.length}`,
      });
      break;
    }
    session.ws.send(frames[i]);
  }

  const drift = Date.now() - start - frames.length * frameMs;
  if (verbose) {
    console.log(
      `  [${session.state.label}] sent ${frames.length} frames, ` +
      `${Math.round(durationMs(pcm))}ms of audio, drift ${drift}ms`
    );
  }
  return { framesSent: frames.length, driftMs: drift };
}

/** Send Terminate, then wait for the Termination message or a timeout. */
export async function closeSession(session, { drainMs = 4000 } = {}) {
  // NOTE: the server holds a session for a moment after Terminate. Draining too
  // briefly and immediately reopening produces a spurious
  // "Unauthorized Connection: Too many concurrent sessions" error. Measured
  // 17 Sept: 500ms is too short, 2000ms+ is reliable.
  if (session.ws.readyState === WebSocket.OPEN) {
    try {
      session.ws.send(JSON.stringify({ type: 'Terminate' }));
    } catch { /* already gone */ }
  }

  const deadline = Date.now() + drainMs;
  while (Date.now() < deadline && !session.state.terminationMessage && !session.state.closed) {
    await sleep(50);
  }

  if (session.ws.readyState === WebSocket.OPEN) session.ws.close();
  await sleep(100);
  return session.state;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Concatenate the final transcripts of a session into one string. */
export function fullTranscript(state) {
  return state.finalTurns
    .map((t) => t.raw.transcript ?? '')
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The last transcript seen, final or partial. Useful when no turn ever closed. */
export function latestTranscript(state) {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const t = state.turns[i].raw.transcript;
    if (t) return t;
  }
  return '';
}
