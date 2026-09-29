# @one-moment/core

**The decision layer of a voice agent that waits.**

This is the engine behind [One Moment](https://one-moment-mu.vercel.app), a voice agent
whose job is to make the other person wait, so someone with aphasia can make their own
phone call. It decides one thing: given what two differently configured listening streams
heard, should the agent speak for the caller, ask them a question, or keep waiting?

It is pure. No network, no audio, no I/O of any kind except an optional model client you
pass in. That is what makes it testable, and it is why every number the project publishes
can be re-derived from committed files.

```bash
npm install @one-moment/core
```

Requires **Node 24**, which runs TypeScript natively. The package ships source rather than
a build step, and uses erasable syntax only.

## The idea

Most voice agents are optimised to respond faster. This one is designed to know when not to
respond, and never to say a word the caller did not say.

```ts
import { assembleEvidence, runDissent } from '@one-moment/core';

// What your patient stream heard, and optionally a second, faster one.
const evidence = assembleEvidence({ patient: turn, fastFinals: [fastTurn] });

const result = await runDissent(evidence, {
  apiKey: process.env.ASSEMBLYAI_API_KEY,
  callerName: 'Robert',
  lexicon: [{ term: 'amlodipine', category: 'medication' }],
});

result.decision.action; // 'relay' | 'ask' | 'hold'
result.decision.text;   // exactly what to say, when the action is relay
result.decision.policyRule; // which rule decided, and why
```

## How it decides

An ordered list of rules, checked in order, first match wins. The Adjudicator is code, not
a model.

1. **Deterministic checks first.** If the two streams disagree about a "not", it asks,
   offering the two readings the ears actually heard. No model involved.
2. **Verbatim when possible.** A complete, clear sentence is relayed as the caller's own
   words. Zero model calls, so zero chance of an invented word.
3. **Dissent for fragments.** An Advocate proposes what was meant; a Skeptic reads the same
   evidence independently. If they disagree, or the proposal contains a word the caller
   never said, the caller is asked rather than guessed for.
4. **Never trust a half-found word.** A word from the caller's own vocabulary that only the
   biased ear heard, or that only partly came out, becomes a two-way choice.
5. **Forced choice, never yes or no.** In aphasia the default answer may be "yes", so the
   caller gets two real options.

## What is in here

| | |
|---|---|
| `assembleEvidence` | Both readings, word confidence, hidden pauses, where the ears disagree |
| `runDissent` | Advocate and Skeptic, then the Adjudicator |
| `stepFloor`, `initialFloor` | The Floor Controller: who may speak, and when to hold the line |
| `buildQuestion`, `negationChoice` | Forced choices built from the caller's own words |
| `callRecord`, `recordAsText` | What was said in the caller's name, to keep |
| `patientConfig`, `fastConfig` | The two AssemblyAI stream configurations, and why each value is what it is |
| `VOICES`, `isVoice` | The voice ids the Voice Agent API accepts, checked |

## Measured

Every figure is re-derived from committed run files by `npm run verify` in the repository.

- **120 sentences from 8 speakers with dysarthria** (TORGO): an ordinary agent put words in
  the speaker's mouth in 65 of 120; this engine in 11 of the 57 it chose to speak.
- Ordinary turn settings split **48** of those sentences mid-way. The patient configuration
  split **0**. Repeated through a real 8kHz telephone encoder: 46 against 0.
- **60 sentences of fluent speech** (LibriSpeech): it relays 49 of 60, waits a 1.7 second
  median, and splits none, so the patience does not get in the way of speakers who do not
  need it.
- Across 48 relays of degraded speech it added **0** words the speaker never said, where a
  single model asked what the person meant added 11.

## Honest limits

Not tested with people who have aphasia. Not a medical device. It does not improve
recognition of disordered speech and assumes recognition is often wrong; the point of the
rules is what gets said anyway.

MIT licensed. Built for the AssemblyAI Voice Agent Hackathon, September 2026.
