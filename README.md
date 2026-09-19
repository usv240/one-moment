# One Moment

**The voice agent that waits for you.**

One Moment waits as long as a stroke survivor needs, offers two choices when the word
will not come, asks the pharmacist to hold the line, and speaks only the words he
actually said.

**Live:** https://one-moment-mu.vercel.app  (try a call at [/demo](https://one-moment-mu.vercel.app/demo), the three-minute path for judges at [/judges](https://one-moment-mu.vercel.app/judges))
**API:** https://orchestrator-production-494f.up.railway.app/v1/decide  (playground at [/api](https://one-moment-mu.vercel.app/api))

Built for the AssemblyAI Voice Agent Hackathon, September 2026. MIT licensed.
Not a medical device. Not clinically validated.

---

## The problem, in one paragraph

People with aphasia, often after a stroke, know exactly what they mean. Finding the word
takes time: several seconds of silence in the middle of a sentence. Every voice agent is
built to treat that silence as the end of a turn. On a recording of one such sentence,
AssemblyAI's default settings split it into two turns at the pause. One Moment keeps it
whole, holds the line while the caller finds the word, and relays only what was said.

---

## What it does, measured against the live AssemblyAI APIs

Every line below came from a real run, and the command to reproduce it is beside it.

| Claim | Measured | Reproduce |
|---|---|---|
| A 6-second mid-sentence pause survives | Server defaults split it into **2 turns**. The patient ear keeps **1 sentence**. | `node --env-file=.env eval/spike/tests/02-patience.js` |
| Two differently configured listening sessions on one microphone | Both run, **4 held at once**, the second costs **-67ms** | `node --env-file=.env eval/spike/tests/01-dual-stream.js` |
| The silence the realtime API hides can be recovered | **7186ms** of hidden silence estimated against **7220ms** actual | `npm test` |
| The Voice Agent speaks only what our Adjudicator approves | **Word for word**, and silent when we approve nothing | `node --env-file=.env eval/proofs/voice-agent-verbatim.mjs` |
| The hold line never talks over the caller | Cut off by the orchestrator about 100ms after the caller resumes | `npm run record` |
| No dead air after a finished sentence | Turn ended **1.5s** after the last word instead of 6s+, via `ForceEndpoint` | `npm run record` |
| Every call graded against itself | The pre-recorded model heard the pause as **6.3s**, the live stream showed **45ms**; every relayed word confirmed | `npm run record` |
| A boosted word is not trusted on its own | 4 of 4 slurred ways of saying "amlodipine" came back as amlodipine from the ear told the caller's words, 0 of 4 from the unbiased ear. So rule 11 asks: "Amlodipine, or metformin?" | `node --env-file=.env eval/probe-vocabulary.mjs` |
| It does not invent words | NEGBENCH on the product's own engine, failures included | `npm run bench` |
| It holds up on real disordered speech | 120 recorded sentences, 8 speakers with dysarthria (TORGO): an ordinary agent would have relayed something wrong in **65 of 120**; One Moment in **11 of the 57** it spoke, asking on the other 63 (52 of those questions needed). Ordinary settings split **48** sentences mid-way; the patient ear split **0** | `eval/audiobench-stream.mjs`, then `eval/audiobench-decide.mjs` |
| When both ears are wrong, the audit catches it | A documented failure: both live ears heard "amlodipine" in "am low dippy"; the careful model did not; the self-audit flagged the relay | see `/evidence#failure` |

---

## How it works

    caller mic --16kHz--> patient ear    Universal-3.5 Pro, max_accuracy,
                   |                     6s min / 9s max turn silence,
                   |                     the caller's own vocabulary
                   +----> fast ear       min_latency, defaults, unbiased

    pharmacist ---24kHz--> Voice Agent API, whose "LLM" is One Moment's own endpoint

    patient turn ends --> evidence --> Dissent --> Adjudicator --> relay | ask | hold
    pharmacist speaks while the caller is mid-turn --> Floor Controller --> hold line
    caller speaks again mid-hold --> orchestrator stops relaying the agent's audio
    both ears agree the sentence is finished --> ForceEndpoint after 1.5s of silence
    call ends --> pre-recorded API transcribes the caller's audio --> self-audit

**The central idea.** The Voice Agent API lets a stored agent point its LLM at any
OpenAI-compatible endpoint. One Moment hosts that endpoint, and it is not a language
model. It is the Adjudicator's output channel. It returns exactly the approved text, or
nothing. **The voice cannot say a word the rules did not approve, because it has no other
source of words.** The live view checks every reply against AssemblyAI's own transcript
of what the agent said.

### Deciding what to say

1. **Deterministic checks first.** If the two listening streams disagree about a "not",
   ask, offering the two readings the ears actually heard. No model is involved.
2. **Verbatim when possible.** A complete, clear sentence is relayed as the caller's own
   words: "Robert says: ...". Zero model calls, so zero chance of an invented word.
3. **Dissent for fragments.** An Advocate proposes what was meant. A Skeptic gives its own
   independent reading. If they disagree, or the proposal contains a word the caller never
   said, the caller is asked, never guessed for.
4. **Never trust a half-found word.** A word from the caller's own list that only the ear
   listening for it heard, or that only partly came out ("am, am lo"), is offered as a
   choice with its sibling from the list (rule 11). Medicines, pharmacy, doctor, family,
   place only: never "prescription, or refill?".
5. **Forced choice, never yes or no.** In aphasia the default answer may be "yes". So the
   caller gets two real options, and the full grounded sentence behind the one they pick
   is what the pharmacist hears.

---

## Bring your own

- **Your words.** Medicines, pharmacy, doctor, family names, on the setup page. They bias
  the patient ear only, so the unbiased fast ear can confirm a boosted word was said.
  Exported as a file you can take elsewhere.
- **Your key.** Paste an AssemblyAI key on the setup page and calls run on your account.
  It goes from the browser to the orchestrator for that call only, and is never stored or
  logged there.
- **Your model.** Pick the LLM Gateway model the Advocate and the Skeptic run on.
- **Your voice.** Pick which of the 18 AssemblyAI voices speaks for you. It still
  says only what the rules approved: the voice changes, the words cannot. A voice
  id from a browser is checked against that list before an agent is created.

## The API

    POST /v1/decide     {"turn": <AssemblyAI Turn>} or {"transcript": "..."} in,
                        relay | ask | hold out, with the rule that decided
    GET  /v1/models     the LLM Gateway models a key can use

Send formatted text. A complete, punctuated sentence takes the verbatim path and
is relayed in the caller's own words with no model call; an unpunctuated string
is read as a fragment, which needs a model, so without a key it is asked about
instead. `text` and `fastText` are accepted as synonyms of `transcript` and
`fastTranscript`.

Stateless, open to any origin, rate limited on the public demo. Without a key it still
answers every turn that needs no model, and asks on the rest. The website has a live
playground at `/api`.

---

## Run it

Requires Node 24 (runs TypeScript natively, no build step) and an AssemblyAI API key.

    cp .env.example .env         # add ASSEMBLYAI_API_KEY
    npm install
    npm test                     # the engine, no network
    npm run orchestrator         # opens a Cloudflare quick tunnel for the Voice Agent
    npm run web                  # http://localhost:3000

Other commands:

    npm run e2e:headless         # a full live call in the terminal, about 40 seconds
                                 # add -- --voice george to hear a different voice
    npm run record               # record the demo call the website replays
    npm run bench                # NEGBENCH, about 75 minutes on the free LLM tier

The Voice Agent API only calls public HTTPS endpoints, so on a laptop the orchestrator
opens a Cloudflare quick tunnel automatically. Deployed, set `PUBLIC_URL` instead.

## Deploy

- **Orchestrator:** `apps/orchestrator/Dockerfile`, built from the repository root. On
  Railway set `RAILWAY_DOCKERFILE_PATH=apps/orchestrator/Dockerfile`, plus
  `ASSEMBLYAI_API_KEY`, `PUBLIC_URL` (its own https address) and `ALLOWED_ORIGINS` (the
  website's address). See `.env.example` for the demo limits.
- **Website:** `apps/web` on Vercel, with `NEXT_PUBLIC_ORCHESTRATOR_URL` set to the
  orchestrator's address. The build fails if any colour pair falls below its WCAG ratio.

---

## Repository

    packages/core/        the engine: evidence, negation checks, Dissent, Adjudicator,
                          forced choices, Floor Controller, stream settings. Pure and tested.
    apps/orchestrator/    the call: two realtime streams, the Voice Agent leg, the endpoint
                          the agent calls, the self-audit, the public API, the demo guard
    apps/web/             the website: landing page, live demo, replay, setup, API
                          playground, evidence, accessibility report
    eval/negbench.mjs     the benchmark, run against the product's own engine
    eval/spike/           the day-one assumption tests that proved the architecture
    eval/proofs/          standalone proofs of each claim above
    eval/fixtures/        the demo voices, generated with AssemblyAI text to speech

---

## What we measured, and what we did not

- Tested on synthetic speech with exactly known pauses, on published sentence sets, and on
  120 recorded sentences from 8 speakers with dysarthria (TORGO; Rudzicz, Namasivayam and
  Wolff, 2012; free for academic, non-profit use; no audio redistributed). Dysarthria is a
  motor speech disorder, not aphasia. **Not tested with people who have aphasia.**
- On that real speech, AssemblyAI's pre-recorded model was barely more accurate than the
  live ears (35% word error rate against 36%), so the self-audit flagged 3 of One Moment's
  11 wrong relays: it catches context-driven mistakes, not errors every model shares.
- Recognition of disordered speech is hard for every system. We do not improve it and do
  not claim to. The claim is that the conversation still reaches its goal without
  anything being invented.
- If both listening streams lose the same "not", no check can recover it from text alone.
  NEGBENCH publishes how often that happens.
- The free-tier LLM Gateway allows 2 requests per minute. The verbatim path needs none;
  fragmentary turns need two. For more, bring your own key and model.

---

## Built on

AssemblyAI Universal-Streaming (Universal-3.5 Pro, two sessions per call, `ForceEndpoint`),
the Voice Agent API with a custom LLM endpoint and its text to speech, the LLM Gateway, and
the pre-recorded API for the post-call self-audit.

Cite the Harvard Sentences (IEEE Std 297-1969) and, where used, the TORGO database
(Rudzicz, Namasivayam and Wolff, 2012) wherever their numbers appear.
