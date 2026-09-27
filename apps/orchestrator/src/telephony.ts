// One Moment on a real phone line, over Twilio Media Streams.
//
// The whole point of the product is a phone call, and until now the far party
// has been a browser. This is the leg that makes it a phone call: someone dials
// a number, and their audio goes through exactly the same two AssemblyAI
// listening streams, the same Floor Controller, the same Adjudicator and the
// same Voice Agent as every other call. Nothing about the decision layer knows
// or cares that the caller is on a phone.
//
// The caller is the person with aphasia. They hear what One Moment says on
// their behalf and what the other party says back, which is why both the agent
// and far-party channels are mixed down to the line.
//
// Twilio's side of the contract:
//   - a webhook asks us what to do with an inbound call; we answer with TwiML
//     that connects the call to a WebSocket here
//   - over that socket it sends JSON: `start` once, then `media` every 20ms
//     carrying base64 8kHz mu-law, then `stop`
//   - we send `media` frames back the same way, tagged with the stream id
//
// The conversions all live in audio-codec.ts and are tested without a phone.
// This file is the plumbing: framing, pacing, and the lifecycle of one call.

import type { WebSocket } from 'ws';
import { Framer, phoneToCaller, toPhone } from './audio-codec.ts';
import type { Call } from './call.ts';

/** 20ms of 8kHz mu-law, the unit Twilio speaks in. */
const PHONE_FRAME_BYTES = 160;
/** 50ms of 16kHz PCM16, the unit the listening streams want. */
const CALLER_FRAME_BYTES = 1600;

type TwilioEvent =
  | { event: 'connected' }
  | { event: 'start'; streamSid: string; start?: { callSid?: string; customParameters?: Record<string, string> } }
  | { event: 'media'; media: { payload: string } }
  | { event: 'mark'; mark: { name: string } }
  | { event: 'stop' };

/**
 * The TwiML that answers an inbound call.
 *
 * `<Connect><Stream>` is bidirectional, unlike `<Start><Stream>`, which only
 * forks audio to us and would leave the caller hearing nothing at all.
 */
export function inboundTwiml(wsUrl: string, greeting?: string): string {
  const say = greeting ? `<Say voice="Polly.Matthew">${greeting.replace(/[<>&]/g, '')}</Say>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Connect><Stream url="${wsUrl}"/></Connect></Response>`;
}

/**
 * Bridge one phone call to one Call.
 *
 * Returns when the socket closes. The caller's audio is re-cut from Twilio's
 * 20ms into the 50ms the streams expect, rather than padded, because padding a
 * live stream with silence tells a turn detector that someone stopped speaking
 * when they had not, which is the exact failure this product exists to prevent.
 */
export function bridgeCall(ws: WebSocket, call: Call, log: (m: string) => void = () => {}): void {
  const framer = new Framer(CALLER_FRAME_BYTES);
  const outbound = new Framer(PHONE_FRAME_BYTES);
  let streamSid: string | null = null;
  let framesIn = 0;
  let framesOut = 0;

  // Everything One Moment plays for the caller: what it says on their behalf,
  // and what the other party says back. Both are mixed down to the one line.
  const onAudio = (channel: string, pcm: Buffer) => {
    if (channel === 'caller' || !streamSid || ws.readyState !== ws.OPEN) return;
    // The agent speaks at 24kHz and the far party arrives at 24kHz too.
    for (const frame of outbound.push(toPhone(pcm, 24000))) {
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: frame.toString('base64') } }));
      framesOut++;
    }
  };
  call.on('audio', onAudio);

  const finish = () => {
    call.off('audio', onAudio);
    const tail = framer.flush();
    if (tail) call.callerFrame(tail);
    log(`phone leg closed after ${framesIn} frames in, ${framesOut} out`);
    void call.end();
  };

  ws.on('message', (raw: Buffer | string) => {
    let ev: TwilioEvent;
    try {
      ev = JSON.parse(String(raw)) as TwilioEvent;
    } catch {
      return;
    }
    switch (ev.event) {
      case 'start':
        streamSid = ev.streamSid;
        log(`phone leg open, stream ${streamSid}`);
        break;
      case 'media': {
        if (!ev.media?.payload) return;
        const pcm16k = phoneToCaller(Buffer.from(ev.media.payload, 'base64'));
        for (const frame of framer.push(pcm16k)) {
          call.callerFrame(frame);
          framesIn++;
        }
        break;
      }
      case 'stop':
        finish();
        break;
      default:
        break;
    }
  });
  ws.on('close', finish);
  ws.on('error', (e: Error) => log(`phone leg error: ${e.message}`));
}

/**
 * Is a request really from Twilio?
 *
 * Twilio signs every webhook with the account's auth token. Without checking
 * it, anyone who finds the URL can make this server place a call on the demo
 * key. Implemented here rather than pulled in as a dependency because it is
 * nine lines and the dependency is not.
 */
export async function isFromTwilio(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  if (!signature) return false;
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
