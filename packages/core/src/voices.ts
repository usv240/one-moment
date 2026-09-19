// Bring your own voice: which AssemblyAI voice speaks for the caller.
//
// The Voice Agent API takes a voice_id when the agent is created, and there is
// no endpoint that lists the ids. This list is the API's own: creating an agent
// with an unknown id returns "Must be one of: ...", and this is that answer,
// checked on 19 Sept 2026. Every id here was accepted by a real agent create.
//
// The orchestrator checks a requested voice against this list before creating
// an agent, so a value typed by a visitor never reaches AssemblyAI unchecked.
//
// Only the voices this project has actually used carry a note. We have not
// listened to the rest, so we do not describe them.

export const VOICE_IDS = [
  'alba', 'anna', 'charles', 'estelle', 'eve', 'george', 'giovanni', 'iris', 'jane',
  'jean', 'juergen', 'lola', 'mary', 'michael', 'paul', 'rafael', 'reid', 'vera',
] as const;

export type VoiceId = (typeof VOICE_IDS)[number];

export const DEFAULT_VOICE: VoiceId = 'anna';

/** Where this project has already used a voice, so the note is something we heard. */
export const VOICE_NOTES: Partial<Record<VoiceId, string>> = {
  anna: 'The default. Warm and even.',
  george: 'Robert in the recorded calls.',
  jane: 'The pharmacist in the recorded calls.',
  charles: 'Narrates the demo video.',
};

export const VOICES: { id: VoiceId; label: string; note?: string }[] = VOICE_IDS.map((id) => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  ...(VOICE_NOTES[id] ? { note: VOICE_NOTES[id] } : {}),
}));

export const isVoice = (x: unknown): x is VoiceId => VOICE_IDS.includes(x as VoiceId);

/** The voice to use for a call: the caller's, if it is one the API accepts. */
export const voiceOrDefault = (x: unknown): VoiceId => (isVoice(x) ? x : DEFAULT_VOICE);
