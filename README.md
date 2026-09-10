# Loophole

Describe any world, its current rules and your own rubric. AssemblyAI Dictation returns a transcript and structured draft in one request. Review it, then explore a replayable model when the mechanics can be represented, or a labeled AI critique when they cannot.

[Try Loophole](https://loophole-voice-lab.tbud.workers.dev) · [Create your world](https://loophole-voice-lab.tbud.workers.dev/create)

The freeform creator accepts your own setting, actors, resources, rules and rubric. Generated models expose every state variable, action, criterion and assumption before you apply them. You can search, play the actions yourself, revise, share a world or export its evidence. Qualitative critiques cover each rubric item with hypothetical scenarios and proposed revisions. They do not claim proof.

The example playground also has three distinct models with nine test cases and 38 exact rule combinations. Each supports typed or dictated rules, review before applying, exact controls, manual actions, counterexample replay, shared links and JSON evidence export. No sign-in is required.

- [Coupon redemption](https://loophole-voice-lab.tbud.workers.dev/lab?world=coupons): eligibility, per-order versus per-customer limits, and checkout rechecks.
- [Document approval](https://loophole-voice-lab.tbud.workers.dev/lab?world=approvals): independent review, version binding and withdrawn approvals.
- [Robot checkpoint](https://loophole-voice-lab.tbud.workers.dev/play?challenge=tailgate): badge checks, shared openings and revocation.

## Judge walkthrough

1. Open **Create a world** and choose **Transcribe a sample world**, or speak your own setting, current rules and rubric.
2. Read **Your AssemblyAI transcript**, then expand **See endpoint response & structured rewrite**. The same Dictation request produces the verbatim transcript and structured fields. The synthetic sample includes a correction from two tools to three.
3. Review and edit the fields. Choose **Prepare a test or critique**. Inspect the proposed model before applying it. If it cannot capture the rules, choose **Get AI critique**; this is a separate, explicit provider request.
4. For a concrete simulation example, expand **Prefer to type?**, load **Space station**, extract its text and prepare the model. Apply it, step through the counterexample and try the actions yourself. Review generated assumptions: structural validation cannot establish that a model faithfully represents your wording.
5. **Share world** includes only the reviewed brief and model/critique. **Export evidence** also retains the associated transcript and request receipt. Revised-model replay is available when the original action IDs and labels remain compatible.

## Run locally

Requires Node 22 or later. Run `npm ci` to install the JSON syntax repair dependency. Set `ASSEMBLYAI_API_KEY` in a local `.env` file, then run `npm run dev`. Open http://127.0.0.1:4317. An API key is only needed for voice and custom natural-language interpretation; presets, controls, search, and replay work without it.

Run `npm run check` and `npm test`. Deploy through the existing Cloudflare Worker configuration with `npx wrangler deploy`; provision the key using `npx wrangler secret put ASSEMBLYAI_API_KEY`. Never put a key in browser code.

## AssemblyAI integration

Dictation is the primary input path. The microphone and synthetic audio sample both call `POST https://dictation.assemblyai.com/transcribe` through our server. One request returns the original `text` and an `llm_response` containing the world draft, produced with `llm_instruction`. Users see the original transcript before reviewing extracted fields. Audio is mono 16 kHz PCM; receipts retain the session ID, duration and elapsed time.

The second API is `POST https://llm-gateway.assemblyai.com/v1/chat/completions`, configured with `qwen3.5-4b-32k-fast`. It prepares a finite model or rubric-based critique after review, extracts drafts from the optional typed input, and compiles custom rules in the preset playground. Those preset calls request Gateway JSON repair; the freeform creator repairs JSON syntax locally and discloses it.

The preset speech flow also uses a custom Dictation instruction to remove fillers and resolve explicit self-corrections while preserving conditions and quantities. Keyterm boosting was evaluated in our feedback tests and is omitted from shipped speech requests following the recording-specific accuracy regression. Streaming STT, the separate pre-recorded transcription API, diarization and text-to-speech are not integrated. Search, simulation and replay run in the browser.

## How it works

In the freeform creator, AssemblyAI Dictation transcribes mono 16 kHz PCM audio and uses `llm_instruction` to extract the world, actors, resources, current rules and separate rubric. AssemblyAI LLM Gateway proposes a data-only finite model or qualitative critique. The interpreter supports bounded primitive state, predicates and set/increment effects; it never executes generated code. Malformed JSON receives local syntax repair, disclosed in its receipt; repaired output still passes the same validation. Invalid or incomplete proposals are rejected. Search caps of 6,000 states and 24 moves yield an inconclusive result when exhausted.

In the preset playground, Dictation transcribes and cleans speech and the Gateway maps custom wording to a constrained policy. The user reviews that mapping before applying it. Breadth-first search checks the selected finite model and returns an actual shortest counterexample. Revised-rule replay preserves the original actions, including counterexamples discovered manually.

Each preset world also has editable rubrics separate from its action rules. Choose **Create or edit your rubric**, name it, select criteria, and **Apply rubric & retest**. Coupon rubrics set eligibility and per-customer/per-order discount caps. Approval rubrics choose independent review, version matching and active approval. Checkpoint rubrics choose badge color, revocation requirements and capacity. Every selected requirement must hold; empty rubrics are rejected. Applying a rubric clears evidence from the previous rubric and reruns the applied rule. The original goals remain available as defaults. Each model states its bounds; timers, arbitrary actors and external systems are not simulated. AI interpretation can be wrong; the exact controls remain available. Model success does not certify a real system.

## Data and limits

The freeform creator keeps its session in page memory. Share/export before leaving. World sharing uses a URL fragment and excludes speech and provider receipts. Exports may contain your original words, so review them before sharing. The checkpoint saves applied rules, rubrics and recent history in browser local storage. Coupon and approval sessions remain in memory until navigation; use Share rule or Export evidence to keep them. Export downloads local JSON. Sharing includes the structured rule, named rubric and selected experiment, not transcript/history. Recordings are sent through the server to AssemblyAI; Loophole does not persist audio. Provider retention is governed by AssemblyAI, with Dictation-specific details identified as a documentation question in the review. Public AI usage is capped at 200 calls per UTC day across the deployment; additional short-term concurrency/rate controls apply. No provider calls are needed for the exact rule builder.

The repository includes a synthetic sample recording and font licenses. No security vulnerability or competition submission is claimed.

## Local files

Keep recordings, narration, publication drafts, feedback evidence and submission bundles in the ignored `outputs/`, `work/`, `local/`, `recordings/` or `drafts/` directories. Keep credentials in `.env` or `.dev.vars`, which are also ignored; `.env.example` contains placeholders only. Cloudflare serves assets from `public/`, so that directory must contain only intentional public assets. The synthetic sample audio is part of the playable demo.
