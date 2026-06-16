# Spanish trainer

Date: 2026-06-16
Status: Approved

## Context

`/chat` today is "talk to nabu": text in → `POST /api/chat` → `HAClient.conversationProcess()` → HA `/api/conversation/process` (agent_id = `config.homeAssistant.conversationAgentId`, e.g. an Ollama agent). That agent is tuned for home control (it calls HA services) and is unsuitable as a language tutor. No speech anywhere — text only.

User wants a Spanish conversation trainer for a B1–B2 learner, two-way voice, used primarily on **iPhone** (likely the installed PWA). The trainer must: correct mistakes, stay mostly in Spanish and adapt to level, translate/explain on demand, and drive structured practice (roleplay/scenarios).

Decisions locked in brainstorming:
- Separate trainer surface — nabu `/chat` untouched.
- Brain = **direct to Ollama** (dashboard owns the system prompt + history), reusing the same Ollama host + model HA already uses. Tutor behavior lives entirely in our prompt; no conflict with nabu.
- Voice input = **iOS keyboard dictation** (Apple on-device Spanish STT). Browser `SpeechRecognition` is unreliable on iOS (caniuse "partial" 14.5+, real-world broken Jan 2026) — not used.
- Voice output = browser `speechSynthesis` with an `es` voice.

## Goals

- New page `public/espanol.html` + `GET /espanol`, cloned from the `chat.html` shell (header, theme, weather chip, transcript/composer). Small link to it from landing.
- `POST /api/espanol`: stateless tutor turn over Ollama, returning a structured `{reply, correction, translation}`.
- Spoken replies (tap-to-hear speaker button per assistant bubble; optional best-effort auto-speak) and Spanish-friendly text/dictation input.
- Match app vocabulary: JetBrains Mono + Rajdhani, dracula/catppuccin CSS vars, `--current-line` borders, `--ease-out` transitions, lowercase labels.
- Zero new npm dependencies (built-in `fetch`, browser speech APIs). No HA dependency for this feature.

## Non-goals (v1 / YAGNI)

- In-app push-to-talk + backend Whisper STT — documented fast-follow, not built now.
- Click-a-word/sentence-to-hear, level-picker UI, persistent history / vocab SRS, streaming responses.
- Auth (dashboard ships open on LAN; inherits same trust as `/chat`).

## Prerequisites (operational)

- Dashboard host can reach Ollama HTTP API (default port `11434`). HA reaches Ollama internally; the dashboard reaches it directly. If Ollama runs on a different host than the dashboard, bind it to the network (`OLLAMA_HOST=0.0.0.0`) and open the port.
- `spanishTrainer.model` matches a model pulled on that Ollama.
- iPhone: Spanish keyboard added — iOS dictation language follows the **keyboard**, not the field's `lang`. README must state this.

## Configuration

Add optional `spanishTrainer` block to `config.js` (gitignored). Absent block = feature disabled, route returns 503, landing link hidden. Template added to `config.example.js`. Validated by new `validateTrainerConfig` (mirrors `validateTvConfig`), called from `validateConfig` in `server.js`.

```js
spanishTrainer: {
  ollamaUrl: "http://OLLAMA_HOST:11434",  // required, non-empty URL, no REPLACE_ME
  model: "llama3.1",                       // required, non-empty string
  // systemPrompt: "...",                  // optional override of default tutor prompt
  // voice: "es-ES",                       // optional TTS lang hint for client (default "es-ES")
  // temperature: 0.7,                     // optional, default 0.7
}
```

Validation rules: `ollamaUrl` non-empty string, no `REPLACE_ME`; `model` non-empty string; `systemPrompt`/`voice` non-empty strings if set; `temperature` a number in [0,2] if set.

## Components

### lib/spanish_trainer.js (new, unit-tested)

- `buildSystemPrompt({ systemPrompt } = {})` → string. Returns the override verbatim if provided, else the default tutor prompt (below).
- `TRAINER_SCHEMA` → JSON schema object for Ollama `format`: object with `reply` (string, required), `correction` (string), `translation` (string).
- `parseTrainerReply(content)` → `{ reply, correction, translation }`. Pure. `JSON.parse` the model content; coerce missing/non-string fields to `''`; on parse failure, fallback `{ reply: String(content), correction: '', translation: '' }`. Never throws.
- `class OllamaClient { constructor({ ollamaUrl, model, temperature }) }` with `async chat(messages, { format } = {})` → `POST ${ollamaUrl}/api/chat` body `{ model, messages, stream: false, format, options: { temperature } }`, global `fetch`, `AbortSignal.timeout(60_000)`. Throws `Ollama HTTP <status>: <detail>` on non-2xx. Returns `message.content` string.

Default tutor prompt (constant) encodes: friendly Spanish conversation tutor for a B1–B2 learner; converse in Spanish, English only for a brief correction note or when the learner is clearly stuck/asks; correct meaningful errors (gender, conjugation, agreement, word choice) concisely without nitpicking; answer "¿cómo se dice…?" / "what does X mean" with translation + short explanation; keep momentum with follow-up questions and roleplay scenarios; **respond ONLY as JSON** matching `{reply, correction, translation}` where `reply` is the Spanish turn (the only field spoken aloud), `correction` is a short note on the user's last-message errors (or `""`), `translation` is an English gloss when asked/helpful (or `""`).

### server.js (additions)

- Require `lib/spanish_trainer.js` at top alongside other libs.
- `validateTrainerConfig(cfg.spanishTrainer)` wired into `validateConfig`.
- On boot, if `config.spanishTrainer`, instantiate one `OllamaClient` (reused per request; stateless).
- `GET /espanol` → `res.sendFile(public/espanol.html)`.
- `POST /api/espanol`:
  - 503 if `spanishTrainer` not configured.
  - Body `{ messages }`: array of `{ role: 'user'|'assistant', content: string }`. Validate: array, each item shape, role in set, `content` non-empty string ≤ 4000 chars, total ≤ 20 messages (else trim to last 20). 400 on malformed.
  - Compose `[{ role:'system', content: buildSystemPrompt(cfg) }, ...messages]`, call `ollama.chat(..., { format: TRAINER_SCHEMA })`, `parseTrainerReply`, respond `{ reply, correction, translation }`.
  - 502 on Ollama error (message surfaced to client).

### public/espanol.html (new)

- Clone `chat.html` shell + CSS. Branding "español" / "entrenador". Empty-state heading + Spanish example chips: "practiquemos pedir comida", "corrígeme cuando me equivoque", "¿cómo se dice…?".
- Client holds `messages` array (the running transcript). Each turn: push user msg, `POST /api/espanol { messages }`, push `{role:'assistant', content: reply}`.
- Render: assistant `reply` bubble (Spanish). If `correction` non-empty, render as a subtle inset annotation (distinct muted style, e.g. `--comment`/`--yellow`), visually attached to the turn, **not** spoken. `translation` shown inline/under the reply when present.
- TTS: speaker button on each assistant bubble → `speechSynthesis.speak(new SpeechSynthesisUtterance(reply))`, `utterance.lang = config voice (default "es-ES")`, voice picked from `getVoices()` matching `es`. Optional "auto-speak" toggle in composer foot (best-effort; iOS frequently requires the per-bubble tap, so the button is the reliable path). Cancel any in-flight utterance before speaking a new one.
- Input: `<textarea lang="es">` + Spanish placeholder to nudge dictation; reuse autosize, Enter-to-send, reset.
- `config.voice` reaches the client via `GET /api/espanol/config` → `{ voice }` (same small-GET pattern as `/api/chat/agent-info` and `/api/landing-config`). Client defaults to `es-ES` if unset or endpoint fails.

### Landing link

- Add a link/affordance to `/espanol` on the landing page, shown only when `spanishTrainer` is configured (mirror how `tv` gates its chip). Lowercase label, existing styling.

## Data flow

iPhone user dictates/types Spanish → client appends `{role:'user'}` → `POST /api/espanol {messages}` → server prepends system prompt → Ollama `/api/chat` (`stream:false`, `format:TRAINER_SCHEMA`) → `message.content` (JSON text) → `parseTrainerReply` → `{reply, correction, translation}` → client renders reply (+ correction/translation), appends to history, user taps speaker → `speechSynthesis` reads `reply` in Spanish.

## Error handling

- Missing config → 503; client shows error bubble (existing pattern).
- Ollama unreachable / non-2xx / timeout → 502 with message; error bubble.
- Model returns non-JSON → `parseTrainerReply` fallback (whole text as `reply`), never crashes.
- No `es` TTS voice on device → fall back to default voice with `lang="es-ES"` (browser best-effort); button still appears.

## Testing

Node built-in test runner, `test/spanish_trainer.test.js`:
- `parseTrainerReply`: valid full JSON; partial (missing correction/translation → `''`); non-string/null fields coerced; non-JSON input → fallback `reply`.
- `buildSystemPrompt`: default contains key directives (B1–B2, JSON-only, correction); override returned verbatim.
- `TRAINER_SCHEMA`: required `reply`, three fields present.
- `OllamaClient.chat`: mocked `fetch` — success returns `message.content`; non-2xx throws with status+detail; verifies request body (`stream:false`, `format`, `options.temperature`). Mirror `home_assistant.test.js` fetch-mock style.
- `validateTrainerConfig`: mirror `tv.test.js` — missing/empty `ollamaUrl`/`model`, `REPLACE_ME`, bad optional types, valid passes clean.

Manual (browser-only, not unit-testable): on iPhone — dictation input in Spanish, tap-to-hear TTS pronunciation, correction/translation rendering, error bubble when Ollama down.

## Fast-follow (separate spec when wanted)

In-app push-to-talk: `MediaRecorder` in the page → `POST /api/espanol/stt` (audio) → transcribe via HA Whisper add-on or a Whisper service → text into the composer. Gives a hands-free in-app mic button on iOS instead of relying on keyboard dictation. Deferred to keep v1 shippable and dependency-free.
