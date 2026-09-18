// The two listening streams, as sent to AssemblyAI Universal-Streaming.
//
// Kept in core, not in the orchestrator, so the website's technology page
// renders these exact objects instead of a hand-typed copy that could drift.
// Every value here was accepted by the live API on 17 September 2026.

export type RealtimeConfig = Record<string, string | number | boolean | string[] | undefined>;

/** The patient ear: built to be right, and to wait. */
export function patientConfig(keyterms: string[] = [], prompt?: string): RealtimeConfig {
  return {
    encoding: 'pcm_s16le',
    sample_rate: 16000,
    speech_model: 'universal-3-5-pro',
    mode: 'max_accuracy',
    min_turn_silence: 6000,
    max_turn_silence: 9000,
    vad_threshold: 0.12,
    ...(keyterms.length ? { keyterms_prompt: keyterms.slice(0, 100) } : {}),
    ...(prompt ? { prompt: prompt.slice(0, 1500) } : {}),
  };
}

/** The fast ear: set up like an ordinary voice agent, unbiased by the caller's vocabulary. */
export function fastConfig(): RealtimeConfig {
  return {
    encoding: 'pcm_s16le',
    sample_rate: 16000,
    speech_model: 'universal-3-5-pro',
    mode: 'min_latency',
  };
}

/** Why each patient-ear value is what it is. Rendered on the technology page. */
export const PARAMETER_REASONS: Record<string, string> = {
  speech_model: 'Universal-3.5 Pro. The flagship streaming model, set explicitly because it is not the default.',
  mode: 'max_accuracy on the patient ear, min_latency on the fast ear. One ear optimises for being right, the other for being quick, and where they disagree is the uncertainty signal.',
  min_turn_silence: 'A word-finding block commonly lasts several seconds. Measured: with defaults, a 6.0-second pause split one sentence into two turns; with 6000 it stayed one.',
  max_turn_silence: 'The hard ceiling. 9 seconds, so even a long block is not cut off, while a caller who has genuinely stopped is not left hanging forever.',
  vad_threshold: 'Lower than default, so quiet speech (common after a stroke, and in Parkinson\'s) is not classified as silence.',
  keyterms_prompt: 'The caller\'s own words: medications, pharmacy, doctor. Only on the patient ear, so the unbiased fast ear can confirm a boosted word was really said.',
  prompt: 'Short context about the caller and the call, so the model expects pharmacy vocabulary.',
};

/** Silence after a sentence both ears agree is finished, before the turn is ended early. */
export const EARLY_END_SILENCE_MS = 1500;

/** Ends like a finished sentence: terminal punctuation, and not the "..." of trailing off. */
export const soundsFinished = (s: string): boolean => {
  const t = s.trim();
  return /[.!?]["')]?$/.test(t) && !/(\.\.\.|…|—)["')]?$/.test(t);
};
