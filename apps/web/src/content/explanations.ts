// Every info button on the site, and the glossary, come from this one file.
// Three depths, never all at once: plain words (reading age about 12, no
// jargon), how it works (real parameter names and numbers), and a source.
// If a feature cannot be explained in the plain layer, it is not ready.

export type Explanation = {
  id: string;
  term: string;
  plain: string;
  technical: string;
  source?: { text: string; href: string };
};

const AAI_STREAMING = { text: 'AssemblyAI Streaming API reference', href: 'https://www.assemblyai.com/docs/api-reference/streaming-api/streaming-api' };
const AAI_VOICE_AGENT = { text: 'AssemblyAI Voice Agent API: connect your own LLM', href: 'https://www.assemblyai.com/docs/voice-agents/voice-agent-api/connect-your-own-llm' };
const SCA = { text: 'Aphasia Institute, Supported Conversation techniques', href: 'https://www.aphasia.ca/communication-tools-communicative-access-sca/' };

export const EXPLANATIONS: Explanation[] = [
  {
    id: 'aphasia',
    term: 'Aphasia',
    plain: 'A language problem, often after a stroke. The person knows exactly what they mean. Finding the word is what takes time.',
    technical: 'An acquired language disorder. Intelligence is unaffected. Word retrieval (anomia) commonly produces pauses of several seconds mid-sentence. 2 to 4 million people in the US live with aphasia.',
    source: { text: 'ASHA Practice Portal: Aphasia', href: 'https://www.asha.org/practice-portal/clinical-topics/aphasia/' },
  },
  {
    id: 'turn-detection',
    term: 'Turn detection',
    plain: 'How the computer decides you have finished talking. If it decides too early, it cuts you off.',
    technical: 'AssemblyAI ends a turn after a window of silence, set by min_turn_silence and max_turn_silence. On the same recording, server defaults split a 6-second pause into two turns; our settings kept one sentence.',
    source: AAI_STREAMING,
  },
  {
    id: 'two-streams',
    term: 'Listening twice',
    plain: 'We listen in two different ways at the same time. Where the two disagree, the words were unclear, so we ask instead of guessing.',
    technical: 'Two concurrent Universal-3.5 Pro sessions on one microphone. Patient: mode=max_accuracy, min_turn_silence=6000, max_turn_silence=9000, vad_threshold=0.12, the caller\'s vocabulary in keyterms_prompt. Fast: mode=min_latency, defaults, unbiased. Measured: the second session costs -67ms.',
    source: AAI_STREAMING,
  },
  {
    id: 'patient-stream',
    term: 'Patient listener',
    plain: 'The careful listener. It waits up to nine seconds and knows your own words, like your medicines.',
    technical: 'mode=max_accuracy, min_turn_silence=6000, max_turn_silence=9000, vad_threshold=0.12 (quiet speech is still speech), keyterms_prompt set from the caller\'s lexicon.',
    source: AAI_STREAMING,
  },
  {
    id: 'fast-stream',
    term: 'Fast listener',
    plain: 'The quick listener. It lets you know straight away that you are being heard, and it has no idea what words to expect.',
    technical: 'mode=min_latency with default turn detection and no vocabulary bias. It is the control: if the patient listener only heard a word because we told it to expect that word, this one will disagree.',
    source: AAI_STREAMING,
  },
  {
    id: 'swallowed-silence',
    term: 'Hidden pauses',
    plain: 'The live transcript does not show pauses directly. It stretches the words around them. We measure that stretching to find the pause.',
    technical: 'Measured: a 6020ms pause appeared as uniform 46ms gaps between words, with the silence absorbed into word durations. Summing each word\'s excess over 60ms per letter plus 100ms recovered 7186ms of non-speech against 7220ms actual, 0.5 percent error.',
  },
  {
    id: 'hold',
    term: 'Holding the line',
    plain: 'When the other person starts talking while you are still finding a word, the assistant asks them to wait. You keep your turn.',
    technical: 'The Floor Controller, a deterministic state machine, queues a hold line when the far party speaks while the caller\'s turn is still open. The first hold also discloses that it is an assistant. If the caller starts speaking again mid-hold, the orchestrator stops relaying the agent\'s audio at once.',
    source: SCA,
  },
  {
    id: 'floor-controller',
    term: 'Who may speak',
    plain: 'A small set of fixed rules decides whose turn it is. No AI decides when you are finished. You are.',
    technical: 'A pure reducer: (state, event) to (state, actions), with nine states from IDLE to ESCALATE. It never calls a model. It marks the caller as pausing after 2.5 seconds of mid-turn silence, answers the far party with a hold line, runs Dissent only once the patient stream closes the turn, and treats Stop as final from any state.',
  },
  {
    id: 'voice-agent-brain',
    term: 'Why it cannot invent words',
    plain: 'The voice on the other end of the call can only say sentences our checking rules approved. It has nowhere else to get words from.',
    technical: 'The AssemblyAI Voice Agent API lets a stored agent use your own OpenAI-compatible endpoint as its LLM. Ours is not a model: it returns exactly the Adjudicator\'s approved text, or nothing. Measured: spoken word for word, and silent when we approve nothing.',
    source: AAI_VOICE_AGENT,
  },
  {
    id: 'verbatim',
    term: 'Your own words',
    plain: 'When you say a clear, complete sentence, it is passed on exactly as you said it. Nothing added, nothing changed.',
    technical: 'Rule 9. If the turn ends in terminal punctuation, has at least three content words, every word is at confidence 0.8 or above, both listeners agree, and no boosted vocabulary went unconfirmed, the relay is "Name says: <transcript>". Zero model calls.',
  },
  {
    id: 'dissent',
    term: 'Two AIs checking each other',
    plain: 'When speech is broken up, one AI suggests what you meant and a second AI looks for anything you did not actually say. If they disagree, you are asked.',
    technical: 'Advocate and Skeptic run in parallel on the evidence bundle. Deterministic rules run first and cannot be overridden: a disputed "not" (rule 1), an invented word (rule 2), a flipped yes and no (rule 3). The Adjudicator is code, not a model.',
    source: { text: 'Irving, Christiano and Amodei (2018), AI safety via debate', href: 'https://arxiv.org/abs/1805.00899' },
  },
  {
    id: 'forced-choice',
    term: 'Two real choices',
    plain: 'We never ask "is that right?". We give you two real answers to pick from, because the answer then tells us something.',
    technical: 'In aphasia the default response may be "yes", and clinicians use a Yes/No Questionnaire just to establish whether a person\'s yes can be trusted. Fixed-choice questions are a published Supported Conversation technique. Two options, at most four words each, plus "Something else".',
    source: SCA,
  },
  {
    id: 'negation',
    term: 'The word "not"',
    plain: 'Losing one small word like "not" turns a sentence into its opposite. So a doubtful "not" always means we ask.',
    technical: 'If the two listeners disagree about a negator, or a negator was heard below 0.6 confidence, rule 1 fires before any model runs. Honest limit: if both listeners lose the same "not", no check on the text can recover it.',
  },
  {
    id: 'self-audit',
    term: 'Grading itself',
    plain: 'After the call, a slower and more careful AssemblyAI model listens to the recording. The system checks every word it said on the caller\'s behalf against what the careful model heard.',
    technical: 'The caller\'s audio (only with consent, or the synthetic demo caller) is uploaded to /v2/upload and transcribed by /v2/transcript with speech_models universal-3-5-pro then universal-2. The pre-recorded API exposes the real pause the realtime API hides. Relayed content words are checked against the careful transcript; the audio is then dropped.',
    source: { text: 'AssemblyAI pre-recorded transcription', href: 'https://www.assemblyai.com/docs/getting-started/transcribe-an-audio-file' },
  },
  {
    id: 'evidence-colors',
    term: 'The colors on the words',
    plain: 'Blue means you said it. Amber means we worked it out and you need to agree. Red with a line through it means it was blocked and will not be said.',
    technical: 'Chosen by a colorblind-safety validator, not by eye. The first draft used green and red, which people with red-green color blindness cannot tell apart (measured separation 4.1, target 8). Every color also has an icon and a label.',
  },
  {
    id: 'sts',
    term: 'Speech-to-Speech Relay',
    plain: 'A free phone service, required by US law, where a trained person repeats what someone with a speech disability says. The government says not enough people use it.',
    technical: 'STS is mandated under ADA Title IV for every state with a certified relay programme, and paid from the Interstate TRS Fund at $8.4822 per minute (FCC DA 25-571, Fund Year 2025 to 26). The FCC describes it as under-utilised.',
    source: { text: 'FCC: Speech to Speech Relay Service', href: 'https://www.fcc.gov/consumers/guides/speech-speech-relay-service' },
  },
  {
    id: 'simulated',
    term: 'What is simulated',
    plain: 'In the recorded demo, Robert and the pharmacist are computer voices. Everything that listens, checks and speaks for Robert is real and running live.',
    technical: 'Sample mode streams a synthetic caller with an exactly known 6-second pause, and a synthetic pharmacist who speaks when the caller goes quiet. The two AssemblyAI streams, the Voice Agent session, the Floor Controller and the Adjudicator are live on every run.',
  },
];

export const explanation = (id: string): Explanation | undefined => EXPLANATIONS.find((e) => e.id === id);
