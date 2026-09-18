// The two configurations the whole architecture depends on, plus the baseline.
//
// Parameter naming is the first thing test 00 probes. Published examples use two
// different spellings for the short-silence parameter, so we do not hardcode a
// guess. Test 00 writes the winning spelling into results/00-connect.json and
// the other tests read it from there.

export const BASE = {
  encoding: 'pcm_s16le',
  sample_rate: 16000,
};

/**
 * Candidate spellings for the "wait this long before a speculative end-of-turn
 * check" parameter, in the order we try them.
 */
export const MIN_SILENCE_KEYS = [
  'min_turn_silence',
  'min_end_of_turn_silence_when_confident',
];

/** Candidate speech model identifiers, in the order we try them. */
export const MODEL_CANDIDATES = [
  'universal-3-5-pro',
  'u3-rt-pro',
  'universal-streaming-english',
  undefined, // let the server pick its default
];

/**
 * Build the three configurations under test.
 *
 * patient: what One Moment listens with. Optimised for not cutting someone off.
 * fast:    the control. Defaults, minimum latency, no vocabulary bias.
 * baseline: what any other voice agent in this hackathon would ship.
 */
export function buildConfigs({ model, minSilenceKey, keyterms = null }) {
  // CORRECTION, 17 Sept, from the official AssemblyAI agent instructions:
  //
  //   "Not U3.5 Pro knobs: format_turns and end_of_turn_confidence_threshold do
  //    not apply. Formatting always tracks end_of_turn, and end_of_turn_confidence
  //    is binary (1.0 on end-of-turn, 0.0 otherwise)."
  //
  // Both were in the original plan. Both are removed here. `mode` is the primary
  // control and sets the turn-detection defaults server-side, so the asymmetry
  // between the two streams now rests on mode + silence bounds + vad + lexicon.
  const patient = {
    ...BASE,
    ...(model ? { speech_model: model } : {}),
    mode: 'max_accuracy',
    [minSilenceKey]: 6000,
    max_turn_silence: 9000,
    vad_threshold: 0.12,
  };
  if (keyterms && keyterms.length) patient.keyterms_prompt = keyterms;

  const fast = {
    ...BASE,
    ...(model ? { speech_model: model } : {}),
    mode: 'min_latency',
  };

  // Deliberately bare. Whatever the server does by default IS the baseline,
  // because that is what every other voice agent ships.
  const baseline = {
    ...BASE,
    ...(model ? { speech_model: model } : {}),
  };

  return { patient, fast, baseline };
}

/** Human-readable one-liner for a config, used in logs and the report. */
export function describe(config) {
  const interesting = [
    'speech_model', 'mode', 'min_turn_silence',
    'min_end_of_turn_silence_when_confident', 'max_turn_silence',
    'vad_threshold',
  ];
  const parts = interesting
    .filter((k) => config[k] !== undefined)
    .map((k) => `${k}=${config[k]}`);
  if (config.keyterms_prompt) {
    const terms = Array.isArray(config.keyterms_prompt)
      ? config.keyterms_prompt
      : JSON.parse(config.keyterms_prompt);
    parts.push(`keyterms=[${terms.join(', ')}]`);
  }
  return parts.join(' ');
}
