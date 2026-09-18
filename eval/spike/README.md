# Spike: day-one assumption tests

This directory answers one question before a single line of the product is written:

> **Does the architecture in `01-One-Moment/docs/03-TECHNICAL-DESIGN.md` survive contact
> with the real API?**

It takes about four minutes to run and it costs a few cents of streaming credit.

---

## What you need to provide

**One thing: an AssemblyAI API key.**

1. Sign up through the hackathon link in `Rules.md`. **Accept cookies during sign-up**,
   or the free credits do not attach to the account. If you already have an account, log
   out first, then log back in through that link.
2. Copy the key from https://www.assemblyai.com/app/api-keys
3. Paste it into `.env`.

Nothing else. No audio, no accounts, no other services. The harness generates its own
test audio.

---

## Run it

```
cd spike
npm install
cp .env.example .env        # then paste your key into .env
npm run all
```

That generates fixtures, runs all six tests, and writes **`REPORT.md`**.

Paste `REPORT.md` back into the conversation. That file is the whole point of this
directory.

To run one test at a time:

```
npm run fixtures     # generate the test audio, once
npm run test:00      # connectivity and parameter discovery
npm run test:01      # two concurrent sessions      <- THE TEST
npm run test:02      # the patience window
npm run test:03      # bring your own vocabulary
npm run test:04      # the evidence layer
npm run test:05      # Dissent latency and negation
npm run test:06      # NEGBENCH, the headline number (bootstrap cases)
npm run bench        # NEGBENCH against TORGO (publishable numbers)
```

**Note on test 06.** It runs on bootstrap cases by default, which we wrote ourselves.
Those numbers wire the pipeline and **may not appear on the site**. The script enforces
this: it marks its own output `publishable: false` and says so. Rerun with `npm run bench`
once TORGO has downloaded, and only those numbers go on the page. See
`_shared/07-WINNER-PATTERNS.md` pattern 2.

Test 00 must run first. It discovers the real parameter names and writes them to
`results/00-connect.json`, which every other test reads.

---

## What each test decides

| Test | Question | If it fails |
|---|---|---|
| **00** | Does streaming work, and what are the parameters really called? | Nothing else can run. Check the key and the account credit. |
| **01** | **Can two differently configured sessions run on one microphone at once?** | **The architecture changes tonight.** This is the one that matters. |
| **02** | Does a 6-second mid-sentence pause survive, or end the turn? | The headline claim is wrong and the hero copy has to change. |
| **03** | Does `keyterms_prompt` help, and can it force a word nobody said? | The bring-your-own-data story needs a different mechanism. |
| **04** | Are per-word confidence and timings actually present? | Dissent has nothing to attack with. The grounding design collapses. |
| **05** | Can two models argue inside 400ms, and do they catch a dropped negation? | The fallback ladder becomes the main path. |
| **06** | **Does a single model speak words the person never said, and does Dissent stop it?** | Dissent is not earning its latency. Say so and reconsider. |

Tests 00, 01, 02 and 04 are critical. 03 and 05 are informative.

**Test 06 is the one that produces the submission's headline number.** The others prove
the machinery works. This one puts a score on the thing the product actually claims. It
reports two columns, a named baseline and the full system, and it reports the over-refusal
rate beside the invention rate, because a system that refuses everything scores perfectly
on inventions and is useless.

---

## Why the audio is synthetic

The fixtures are generated with Windows SAPI and spliced with exact silence.

That is deliberate. To know whether a 6000ms patience window works, the gap has to be
**exactly** 6000ms, not roughly six seconds. A synthetic fixture with a known gap makes a
failure unambiguous. A real recording would leave us guessing whether the parameter was
wrong or the pause was short.

Real and disordered speech comes later, from TORGO and AphasiaBank, in the evaluation
harness described in `01-One-Moment/docs/06-EVALUATION.md`. That is a different question:
this spike asks whether the machinery works, and the harness asks whether the product works.

### Using your own voice instead

Drop 16kHz mono 16-bit WAV files into `fixtures/custom/` and they take precedence over the
generated ones. Names the tests look for: `pause-6s`, `pause-2s`, `negation`, `lexicon`,
`control`.

To convert anything to the right format:

```
ffmpeg -i yours.m4a -ar 16000 -ac 1 -c:a pcm_s16le fixtures/custom/pause-6s.wav
```

For `pause-6s`, record yourself saying "I need to refill my", stay silent while you count
to six, then say "amlodipine prescription please".

If SAPI is unavailable or the voices sound wrong, this manual route works just as well.

---

## Real-time pacing

The harness streams audio at **1x real time**, one 50ms frame every 50ms.

This is not an optimisation, it is a correctness requirement. Turn detection is a function
of wall-clock silence. Blasting a file at full speed collapses every gap to nothing and
makes the patience test meaningless. Each test reports its send drift, and a drift above
1500ms invalidates that run.

---

## If test 01 fails

If two concurrent sessions on one key do not work, the honest response is to change the
plan, not the story.

1. Check whether it is a concurrency limit on the account tier rather than a hard
   restriction. A free-tier cap is a different problem from an API that forbids it.
2. Try two sessions on two different keys. If that works, the product is still buildable,
   it just costs two keys.
3. If it genuinely cannot work: fall back to **one patient stream plus a local VAD** for
   live feedback, and use **revision churn** as the uncertainty signal in place of
   cross-stream disagreement. Test 04 reports whether churn is usable.
4. Then edit `_shared/02-DISSENT-ENGINE.md` section 2, `_shared/03-ASSEMBLYAI-REFERENCE.md`
   section 4, and every page of the site that mentions two streams.

**Do not keep the dual-stream story and ship a single stream.** A judge who opens the
repository will see it, and `01-One-Moment/docs/09-RISKS-AND-ETHICS.md` commits us to
describing what we built.

---

## What gets written

```
results/*.json      raw measurements, one file per test
REPORT.md           the readable summary, and the file to paste back
fixtures/generated/ the test audio
```

`REPORT.md` ends with two sections that matter most:

- **What changes in the plan**, which lists the specific edits each failure forces.
- **Numbers to put on the site**, which are real measured figures that can go straight
  into the landing page, the video, and `docs/06-EVALUATION.md`.

---

## Cost

Roughly 90 seconds of streaming audio across all tests, plus about 10 short LLM calls.
A few cents. Test 05 is the only one that uses LLM credit, and it is the cheapest.

Every session is explicitly terminated. Unterminated streaming sessions stay open for
three hours and bill for the full duration, so if you interrupt a test with Ctrl+C, check
the dashboard.
