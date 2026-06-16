# Spanish Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a B1–B2 Spanish conversation trainer at `/espanol` — voice-out (browser TTS) + iOS-dictation-in — reached via a small "ES" button on `/chat`, powered by a direct Ollama call with a tutor system prompt.

**Architecture:** New pure-logic module `lib/spanish_trainer.js` (config validation, system prompt, message validation, reply parsing, Ollama HTTP client). `server.js` mounts a config-gated `if (config.spanishTrainer)` block exposing `GET /espanol`, `GET /api/espanol/config`, `POST /api/espanol`. The server is stateless — the client (`public/espanol.html`, a clone of `chat.html`) holds the running transcript and sends it each turn. Replies are structured JSON `{reply, correction, translation}` enforced via Ollama's `format` JSON-schema; only `reply` is spoken.

**Tech Stack:** Node 20 (global `fetch`, built-in `node:test`), Express, Ollama `/api/chat`, browser `speechSynthesis`. No new npm dependencies.

---

## File Structure

- **Create** `lib/spanish_trainer.js` — `validateTrainerConfig`, `buildSystemPrompt` + `DEFAULT_SYSTEM_PROMPT`, `TRAINER_SCHEMA`, `validateMessages`, `parseTrainerReply`, `OllamaClient`. One responsibility: the trainer's pure logic + Ollama transport.
- **Create** `test/spanish_trainer.test.js` — unit tests for every exported function (mirrors `test/tv.test.js` + `test/home_assistant.test.js`).
- **Create** `public/espanol.html` — trainer UI, cloned from `public/chat.html`.
- **Modify** `server.js` — require the new module; add `validateTrainerConfig` to `validateConfig`; add the `if (config.spanishTrainer)` route block.
- **Modify** `public/chat.html` — add the gated "ES" button + probe.
- **Modify** `config.example.js` — add the `spanishTrainer` template block.
- **Modify** `README.md` — add a "Spanish trainer" section (prereqs: Ollama URL/model, iPhone Spanish keyboard).

Reused asset: `public/icons/vol-on.svg` path data is inlined as the TTS button icon (currentColor, no emoji — per project icon rule).

---

### Task 1: `validateTrainerConfig`

**Files:**
- Create: `lib/spanish_trainer.js`
- Test: `test/spanish_trainer.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/spanish_trainer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTrainerConfig } = require('../lib/spanish_trainer.js');

const good = { ollamaUrl: 'http://10.0.0.5:11434', model: 'llama3.1' };

test('validateTrainerConfig: good config passes', () => {
  assert.deepEqual(validateTrainerConfig(good), []);
});

test('validateTrainerConfig: non-object rejected', () => {
  assert.ok(validateTrainerConfig(null).some((e) => /must be an object/.test(e)));
});

test('validateTrainerConfig: missing ollamaUrl', () => {
  assert.ok(validateTrainerConfig({ model: 'x' }).some((e) => /ollamaUrl/.test(e)));
});

test('validateTrainerConfig: placeholder ollamaUrl rejected', () => {
  assert.ok(validateTrainerConfig({ ollamaUrl: 'http://OLLAMA_HOST:11434', model: 'x' })
    .some((e) => /ollamaUrl/.test(e)));
});

test('validateTrainerConfig: missing model', () => {
  assert.ok(validateTrainerConfig({ ollamaUrl: 'http://x:11434' }).some((e) => /model/.test(e)));
});

test('validateTrainerConfig: bad optional types', () => {
  const errs = validateTrainerConfig({ ...good, systemPrompt: '', voice: 5, temperature: 9 });
  assert.ok(errs.some((e) => /systemPrompt/.test(e)));
  assert.ok(errs.some((e) => /voice/.test(e)));
  assert.ok(errs.some((e) => /temperature/.test(e)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spanish_trainer.test.js`
Expected: FAIL — `Cannot find module '../lib/spanish_trainer.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/spanish_trainer.js`:

```js
function validateTrainerConfig(t) {
  const errors = [];
  if (!t || typeof t !== 'object') {
    errors.push('spanishTrainer must be an object');
    return errors;
  }
  if (typeof t.ollamaUrl !== 'string' || !t.ollamaUrl
      || t.ollamaUrl.includes('REPLACE_ME') || t.ollamaUrl.includes('OLLAMA_HOST')) {
    errors.push('spanishTrainer.ollamaUrl must be a non-empty URL (e.g. http://host:11434)');
  }
  if (typeof t.model !== 'string' || !t.model) {
    errors.push('spanishTrainer.model must be a non-empty string');
  }
  if (t.systemPrompt !== undefined && (typeof t.systemPrompt !== 'string' || !t.systemPrompt)) {
    errors.push('spanishTrainer.systemPrompt must be a non-empty string if set');
  }
  if (t.voice !== undefined && (typeof t.voice !== 'string' || !t.voice)) {
    errors.push('spanishTrainer.voice must be a non-empty string if set');
  }
  if (t.temperature !== undefined
      && (typeof t.temperature !== 'number' || t.temperature < 0 || t.temperature > 2)) {
    errors.push('spanishTrainer.temperature must be a number between 0 and 2 if set');
  }
  return errors;
}

module.exports = { validateTrainerConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spanish_trainer.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/spanish_trainer.js test/spanish_trainer.test.js
git commit -m "feat(trainer): validateTrainerConfig"
```

---

### Task 2: `buildSystemPrompt` + `TRAINER_SCHEMA`

**Files:**
- Modify: `lib/spanish_trainer.js`
- Test: `test/spanish_trainer.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/spanish_trainer.test.js`:

```js
const { buildSystemPrompt, TRAINER_SCHEMA } = require('../lib/spanish_trainer.js');

test('buildSystemPrompt: default mentions level + JSON contract', () => {
  const p = buildSystemPrompt();
  assert.match(p, /B1/);
  assert.match(p, /JSON/);
  assert.match(p, /reply/);
  assert.match(p, /correction/);
});

test('buildSystemPrompt: override returned verbatim', () => {
  assert.equal(buildSystemPrompt({ systemPrompt: 'custom prompt' }), 'custom prompt');
});

test('buildSystemPrompt: blank override falls back to default', () => {
  assert.equal(buildSystemPrompt({ systemPrompt: '   ' }), buildSystemPrompt());
});

test('TRAINER_SCHEMA: requires reply, has three string props', () => {
  assert.deepEqual(TRAINER_SCHEMA.required, ['reply']);
  assert.equal(TRAINER_SCHEMA.properties.reply.type, 'string');
  assert.equal(TRAINER_SCHEMA.properties.correction.type, 'string');
  assert.equal(TRAINER_SCHEMA.properties.translation.type, 'string');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spanish_trainer.test.js`
Expected: FAIL — `buildSystemPrompt is not a function` / `Cannot read properties of undefined`.

- [ ] **Step 3: Write minimal implementation**

In `lib/spanish_trainer.js`, add above `module.exports`:

```js
const DEFAULT_SYSTEM_PROMPT = `You are a warm, encouraging Spanish conversation tutor for an intermediate (B1-B2) learner.

Rules:
- Converse in natural Spanish at a B1-B2 level. Keep your turns fairly short so it stays a back-and-forth conversation.
- Use English only for a brief correction note, or when the learner is clearly stuck or explicitly asks.
- When the learner makes a meaningful mistake (gender, conjugation, agreement, prepositions, word choice), note it briefly and show the corrected version. Do not nitpick tiny or stylistic things; prioritize keeping the conversation flowing.
- If the learner asks "como se dice...?", "what does X mean", or for an explanation, give a short, clear answer with a quick example.
- Keep momentum: end most turns with a question or small prompt, and offer roleplay scenarios (ordering food, directions, small talk) when it helps.

Respond with ONLY a JSON object, no other text, of this exact shape:
{"reply": "<your Spanish conversational turn - the ONLY text that will be read aloud>", "correction": "<brief note (English ok) on errors in the learner's LAST message, or empty string if none>", "translation": "<English translation/gloss when the learner asked or it clearly helps, or empty string>"}`;

function buildSystemPrompt({ systemPrompt } = {}) {
  if (typeof systemPrompt === 'string' && systemPrompt.trim()) return systemPrompt;
  return DEFAULT_SYSTEM_PROMPT;
}

const TRAINER_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    correction: { type: 'string' },
    translation: { type: 'string' },
  },
  required: ['reply'],
};
```

Update `module.exports`:

```js
module.exports = { validateTrainerConfig, buildSystemPrompt, TRAINER_SCHEMA };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spanish_trainer.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/spanish_trainer.js test/spanish_trainer.test.js
git commit -m "feat(trainer): default system prompt + JSON schema"
```

---

### Task 3: `parseTrainerReply`

**Files:**
- Modify: `lib/spanish_trainer.js`
- Test: `test/spanish_trainer.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/spanish_trainer.test.js`:

```js
const { parseTrainerReply } = require('../lib/spanish_trainer.js');

test('parseTrainerReply: full valid JSON', () => {
  const out = parseTrainerReply('{"reply":"Hola","correction":"di hola","translation":"hi"}');
  assert.deepEqual(out, { reply: 'Hola', correction: 'di hola', translation: 'hi' });
});

test('parseTrainerReply: missing fields coerced to empty string', () => {
  const out = parseTrainerReply('{"reply":"Hola"}');
  assert.deepEqual(out, { reply: 'Hola', correction: '', translation: '' });
});

test('parseTrainerReply: non-string fields coerced', () => {
  const out = parseTrainerReply('{"reply":"Hola","correction":42,"translation":null}');
  assert.deepEqual(out, { reply: 'Hola', correction: '', translation: '' });
});

test('parseTrainerReply: non-JSON falls back to raw reply', () => {
  const out = parseTrainerReply('just plain text');
  assert.deepEqual(out, { reply: 'just plain text', correction: '', translation: '' });
});

test('parseTrainerReply: JSON string primitive becomes reply', () => {
  const out = parseTrainerReply('"hola"');
  assert.deepEqual(out, { reply: 'hola', correction: '', translation: '' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spanish_trainer.test.js`
Expected: FAIL — `parseTrainerReply is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/spanish_trainer.js`, add above `module.exports`:

```js
function parseTrainerReply(content) {
  const str = (v) => (typeof v === 'string' ? v : '');
  try {
    const obj = JSON.parse(content);
    if (typeof obj === 'string') return { reply: obj, correction: '', translation: '' };
    if (obj && typeof obj === 'object') {
      return { reply: str(obj.reply), correction: str(obj.correction), translation: str(obj.translation) };
    }
  } catch { /* fall through */ }
  return { reply: String(content ?? ''), correction: '', translation: '' };
}
```

Update `module.exports`:

```js
module.exports = { validateTrainerConfig, buildSystemPrompt, TRAINER_SCHEMA, parseTrainerReply };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spanish_trainer.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/spanish_trainer.js test/spanish_trainer.test.js
git commit -m "feat(trainer): parseTrainerReply with JSON fallback"
```

---

### Task 4: `validateMessages`

**Files:**
- Modify: `lib/spanish_trainer.js`
- Test: `test/spanish_trainer.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/spanish_trainer.test.js`:

```js
const { validateMessages } = require('../lib/spanish_trainer.js');

test('validateMessages: valid passes through', () => {
  const msgs = [{ role: 'user', content: 'hola' }];
  assert.deepEqual(validateMessages(msgs), { ok: true, trimmed: msgs });
});

test('validateMessages: empty/non-array rejected', () => {
  assert.equal(validateMessages([]).ok, false);
  assert.equal(validateMessages(undefined).ok, false);
});

test('validateMessages: bad role rejected', () => {
  assert.equal(validateMessages([{ role: 'system', content: 'x' }]).ok, false);
});

test('validateMessages: empty content rejected', () => {
  assert.equal(validateMessages([{ role: 'user', content: '   ' }]).ok, false);
});

test('validateMessages: over-long content rejected', () => {
  assert.equal(validateMessages([{ role: 'user', content: 'a'.repeat(4001) }]).ok, false);
});

test('validateMessages: trims to last 20', () => {
  const msgs = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const out = validateMessages(msgs);
  assert.equal(out.ok, true);
  assert.equal(out.trimmed.length, 20);
  assert.equal(out.trimmed[0].content, 'm5');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spanish_trainer.test.js`
Expected: FAIL — `validateMessages is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/spanish_trainer.js`, add above `module.exports`:

```js
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'messages must be a non-empty array' };
  }
  const trimmed = messages.slice(-20);
  for (const m of trimmed) {
    if (!m || typeof m !== 'object'
        || !['user', 'assistant'].includes(m.role)
        || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 4000) {
      return { ok: false, error: 'each message needs role user|assistant and content 1..4000 chars' };
    }
  }
  return { ok: true, trimmed };
}
```

Update `module.exports`:

```js
module.exports = { validateTrainerConfig, buildSystemPrompt, TRAINER_SCHEMA, parseTrainerReply, validateMessages };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spanish_trainer.test.js`
Expected: PASS (21 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/spanish_trainer.js test/spanish_trainer.test.js
git commit -m "feat(trainer): validateMessages"
```

---

### Task 5: `OllamaClient`

**Files:**
- Modify: `lib/spanish_trainer.js`
- Test: `test/spanish_trainer.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/spanish_trainer.test.js`:

```js
const { OllamaClient } = require('../lib/spanish_trainer.js');

test('OllamaClient.chat: posts correct body and returns content', async () => {
  const orig = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ message: { content: '{"reply":"hola"}' } }) };
  };
  try {
    const client = new OllamaClient({ ollamaUrl: 'http://h:11434/', model: 'llama3.1', temperature: 0.5 });
    const content = await client.chat([{ role: 'user', content: 'hi' }], { format: { type: 'object' } });
    assert.equal(content, '{"reply":"hola"}');
    assert.equal(captured.url, 'http://h:11434/api/chat');
    assert.equal(captured.body.model, 'llama3.1');
    assert.equal(captured.body.stream, false);
    assert.equal(captured.body.options.temperature, 0.5);
    assert.deepEqual(captured.body.format, { type: 'object' });
  } finally {
    globalThis.fetch = orig;
  }
});

test('OllamaClient.chat: non-2xx throws with status + detail', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  try {
    const client = new OllamaClient({ ollamaUrl: 'http://h:11434', model: 'm' });
    await assert.rejects(() => client.chat([{ role: 'user', content: 'x' }]), /Ollama HTTP 500: boom/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('OllamaClient.chat: missing message.content -> empty string', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  try {
    const client = new OllamaClient({ ollamaUrl: 'http://h:11434', model: 'm' });
    assert.equal(await client.chat([{ role: 'user', content: 'x' }]), '');
  } finally {
    globalThis.fetch = orig;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spanish_trainer.test.js`
Expected: FAIL — `OllamaClient is not a constructor`.

- [ ] **Step 3: Write minimal implementation**

In `lib/spanish_trainer.js`, add above `module.exports`:

```js
class OllamaClient {
  #ollamaUrl;
  #model;
  #temperature;

  constructor({ ollamaUrl, model, temperature = 0.7 }) {
    this.#ollamaUrl = String(ollamaUrl).replace(/\/+$/, '');
    this.#model = model;
    this.#temperature = typeof temperature === 'number' ? temperature : 0.7;
  }

  async chat(messages, { format } = {}) {
    const body = {
      model: this.#model,
      messages,
      stream: false,
      options: { temperature: this.#temperature },
    };
    if (format) body.format = format;
    const res = await globalThis.fetch(`${this.#ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await res.json();
    return data?.message?.content ?? '';
  }
}
```

Update `module.exports`:

```js
module.exports = {
  validateTrainerConfig,
  buildSystemPrompt,
  TRAINER_SCHEMA,
  parseTrainerReply,
  validateMessages,
  OllamaClient,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spanish_trainer.test.js`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/spanish_trainer.js test/spanish_trainer.test.js
git commit -m "feat(trainer): OllamaClient chat transport"
```

---

### Task 6: Wire `server.js`

**Files:**
- Modify: `server.js` (require ~line 10, `validateConfig` ~line 128, route block ~line 510)

- [ ] **Step 1: Add the require**

After the `lib/tv.js` require line, add the trainer require:

```js
const { validateTvConfig, trackedEntitiesFromTv, resolveShortcut, buildTvSnapshot } = require('./lib/tv.js');
const { validateTrainerConfig, buildSystemPrompt, parseTrainerReply, validateMessages, TRAINER_SCHEMA, OllamaClient } = require('./lib/spanish_trainer.js');
const { SseBroker } = require('./lib/sse_broker.js');
```

- [ ] **Step 2: Add config validation**

In `validateConfig`, immediately after the existing `if (cfg.tv !== undefined) { ... }` block, add:

```js
  if (cfg.spanishTrainer !== undefined) {
    const trainerErrors = validateTrainerConfig(cfg.spanishTrainer);
    for (const e of trainerErrors) errors.push(e);
  }
```

- [ ] **Step 3: Add the route block**

Find the close of the `if (config.tv) { ... }` block followed by `if (config.plan) {` and insert the trainer block between them. Anchor:

```js
  }

  if (config.plan) {
```

Replace that anchor with:

```js
  }

  if (config.spanishTrainer) {
    const trainer = new OllamaClient({
      ollamaUrl: config.spanishTrainer.ollamaUrl,
      model: config.spanishTrainer.model,
      temperature: config.spanishTrainer.temperature,
    });

    app.get('/espanol', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'espanol.html')));

    app.get('/api/espanol/config', (_req, res) => {
      res.json({ voice: config.spanishTrainer.voice || 'es-ES' });
    });

    app.post('/api/espanol', async (req, res) => {
      const check = validateMessages((req.body || {}).messages);
      if (!check.ok) return res.status(400).json({ error: check.error });
      try {
        const messages = [
          { role: 'system', content: buildSystemPrompt(config.spanishTrainer) },
          ...check.trimmed,
        ];
        const content = await trainer.chat(messages, { format: TRAINER_SCHEMA });
        res.json(parseTrainerReply(content));
      } catch (err) {
        res.status(502).json({ error: err.message });
      }
    });
  }

  if (config.plan) {
```

- [ ] **Step 4: Smoke-test the routes without Ollama**

These checks exercise validation/config without reaching Ollama (so no live model needed). Create a throwaway config and run the server:

```bash
cat > /tmp/st-config.js <<'EOF'
module.exports = {
  machines: [],
  spanishTrainer: { ollamaUrl: 'http://127.0.0.1:11434', model: 'llama3.1' },
};
EOF
cp config.js /tmp/config.bak 2>/dev/null || true
cp /tmp/st-config.js config.js
node server.js &
SRV=$!; sleep 1
echo "--- config endpoint (expect voice) ---"
curl -s localhost:3000/api/espanol/config
echo; echo "--- bad body (expect 400) ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/espanol -H 'Content-Type: application/json' -d '{"messages":[]}'
echo "--- page (expect 200) ---"
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/espanol
kill $SRV
cp /tmp/config.bak config.js 2>/dev/null || rm -f config.js
```

Expected: `{"voice":"es-ES"}`, then `400`, then `200`. (`espanol.html` is created in Task 7; if running Task 6 first, the `/espanol` page check returns 404 until then — that's fine.)

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(trainer): mount /espanol routes (config-gated)"
```

---

### Task 7: Create `public/espanol.html`

**Files:**
- Create: `public/espanol.html` (from `public/chat.html`)

- [ ] **Step 1: Copy the chat shell**

```bash
cp public/chat.html public/espanol.html
```

- [ ] **Step 2: Title** — in `public/espanol.html` replace:

```html
<title>chat — burkii.home</title>
```
with:
```html
<title>español — burkii.home</title>
```

- [ ] **Step 3: Brand sub-label** — replace:

```html
    <span class="brand-mark">burkii</span><span class="brand-sub">/chat</span>
```
with:
```html
    <span class="brand-mark">burkii</span><span class="brand-sub">/español</span>
```

- [ ] **Step 4: Add trainer CSS** — find this block (the `@media (max-width: 520px)` rule) and insert the new rules immediately BEFORE it:

```css
@media (max-width: 520px) {
  main { padding: 1rem 1rem 0; }
```
Insert before it:
```css
.tts-btn {
  margin-left: 0.5ch;
  vertical-align: middle;
  display: inline-flex;
  background: transparent;
  border: 0;
  padding: 0.1rem;
  color: var(--cyan);
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 160ms var(--ease-out);
}
.tts-btn:hover { opacity: 1; }
.tts-btn svg { width: 16px; height: 16px; display: block; }
.msg-translation {
  margin-top: 0.35rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  color: var(--comment);
  padding-left: 0.2rem;
}
.msg-correction {
  margin-top: 0.35rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.74rem;
  line-height: 1.4;
  color: var(--yellow);
  border-left: 2px solid rgba(var(--yellow-rgb), 0.5);
  background: rgba(var(--yellow-rgb), 0.07);
  padding: 0.3rem 0.6rem;
  border-radius: 0 4px 4px 0;
}
.autospeak { display: inline-flex; align-items: center; gap: 0.4ch; cursor: pointer; }

@media (max-width: 520px) {
  main { padding: 1rem 1rem 0; }
```

- [ ] **Step 5: Simplify the sub-bar** — replace:

```html
<div class="page-subbar">
  <div class="status-chip" id="statusChip" data-status="ready"><span class="dot"></span><span id="statusLabel">ready</span></div>
</div>
```
with:
```html
<div class="page-subbar">
  <span>práctica · B1–B2</span>
</div>
```

- [ ] **Step 6: Spanish empty state** — replace:

```html
    <div class="empty-state" id="emptyState">
      <div class="heading">talk to <span class="accent">nabu</span></div>
      <div>connected to home assistant</div>
      <div class="examples">
        <button class="example" data-example="turn off all the lights">turn off all the lights</button>
        <button class="example" data-example="what's the temperature in the living room?">what's the temperature in the living room?</button>
        <button class="example" data-example="set the bedroom lights to 30%">set the bedroom lights to 30%</button>
      </div>
    </div>
```
with:
```html
    <div class="empty-state" id="emptyState">
      <div class="heading">entrenador de <span class="accent">español</span></div>
      <div>conversación · nivel B1–B2</div>
      <div class="examples">
        <button class="example" data-example="practiquemos pedir comida en un restaurante">practiquemos pedir comida en un restaurante</button>
        <button class="example" data-example="corrígeme cuando me equivoque">corrígeme cuando me equivoque</button>
        <button class="example" data-example="¿cómo se dice 'I am looking forward to it'?">¿cómo se dice "I am looking forward to it"?</button>
      </div>
    </div>
```

- [ ] **Step 7: Spanish-friendly textarea** — replace:

```html
      <textarea id="input" rows="1" placeholder="type a command or question…" autocomplete="off" spellcheck="true"></textarea>
```
with:
```html
      <textarea id="input" rows="1" lang="es" placeholder="escribe o dicta en español…" autocomplete="off" spellcheck="true"></textarea>
```

- [ ] **Step 8: Composer foot (reset + auto-speak)** — replace:

```html
    <div class="composer-foot">
      <button type="button" class="reset" id="resetBtn">reset conversation</button>
      <span class="conv-id" id="convIdLabel">no session</span>
    </div>
```
with:
```html
    <div class="composer-foot">
      <button type="button" class="reset" id="resetBtn">reiniciar conversación</button>
      <label class="autospeak"><input type="checkbox" id="autoSpeak"> leer en voz alta</label>
    </div>
```

- [ ] **Step 9: Replace the entire `<script>` body** — replace everything between `<script>` and `</script>` at the bottom of the file (the block that begins `const transcriptEl = document.getElementById('transcript');` and ends `inputEl.focus();`) with:

```js
const transcriptEl = document.getElementById('transcript');
const emptyStateEl = document.getElementById('emptyState');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const resetBtn = document.getElementById('resetBtn');
const autoSpeakEl = document.getElementById('autoSpeak');
const composer = document.getElementById('composer');

let messages = [];        // running transcript: {role, content}
let inFlight = false;
let voiceLang = 'es-ES';
let esVoice = null;

fetch('/api/espanol/config')
  .then((r) => (r.ok ? r.json() : null))
  .then((cfg) => { if (cfg && cfg.voice) voiceLang = cfg.voice; })
  .catch(() => {});

function pickVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const base = voiceLang.slice(0, 2).toLowerCase();
  esVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(base)) || null;
}
if (window.speechSynthesis) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  if (!window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voiceLang;
  if (esVoice) u.voice = esVoice;
  speechSynthesis.speak(u);
}

const SPEAKER_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zm2.5 0a7 7 0 01-2.5 5.36l-1.42-1.42A5 5 0 0017 12a5 5 0 00-1.92-3.94l1.42-1.42A7 7 0 0119 12z"/></svg>';

function hideEmpty() {
  if (emptyStateEl && !emptyStateEl.hidden) emptyStateEl.hidden = true;
}

function appendUser(text) {
  hideEmpty();
  const wrap = document.createElement('div');
  wrap.className = 'msg user';
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = 'tú';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  wrap.appendChild(meta);
  wrap.appendChild(bubble);
  transcriptEl.appendChild(wrap);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function appendAssistant({ reply, correction, translation }) {
  hideEmpty();
  const replyText = (reply && reply.trim()) || '(sin respuesta)';

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = 'tutor';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  const span = document.createElement('span');
  span.textContent = replyText;
  bubble.appendChild(span);

  const tts = document.createElement('button');
  tts.type = 'button';
  tts.className = 'tts-btn';
  tts.setAttribute('aria-label', 'escuchar');
  tts.innerHTML = SPEAKER_SVG;
  tts.addEventListener('click', () => speak(replyText));
  bubble.appendChild(tts);

  wrap.appendChild(meta);
  wrap.appendChild(bubble);

  if (translation && translation.trim()) {
    const tr = document.createElement('div');
    tr.className = 'msg-translation';
    tr.textContent = translation;
    wrap.appendChild(tr);
  }
  if (correction && correction.trim()) {
    const co = document.createElement('div');
    co.className = 'msg-correction';
    co.textContent = correction;
    wrap.appendChild(co);
  }

  transcriptEl.appendChild(wrap);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  if (autoSpeakEl && autoSpeakEl.checked) speak(replyText);
}

function appendError(text) {
  hideEmpty();
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant error';
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = 'tutor';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  wrap.appendChild(meta);
  wrap.appendChild(bubble);
  transcriptEl.appendChild(wrap);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function appendTyping() {
  hideEmpty();
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = 'tutor';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  wrap.appendChild(meta);
  wrap.appendChild(bubble);
  transcriptEl.appendChild(wrap);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return wrap;
}

function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
}
inputEl.addEventListener('input', autosize);

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

document.querySelectorAll('.example').forEach((btn) => {
  btn.addEventListener('click', () => {
    inputEl.value = btn.dataset.example;
    autosize();
    inputEl.focus();
  });
});

resetBtn.addEventListener('click', () => {
  messages = [];
  transcriptEl.querySelectorAll('.msg').forEach((n) => n.remove());
  if (emptyStateEl) emptyStateEl.hidden = false;
  if (window.speechSynthesis) speechSynthesis.cancel();
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (inFlight) return;
  const text = inputEl.value.trim();
  if (!text) return;

  appendUser(text);
  messages.push({ role: 'user', content: text });
  inputEl.value = '';
  autosize();

  inFlight = true;
  sendBtn.disabled = true;
  const typingNode = appendTyping();

  try {
    const res = await fetch('/api/espanol', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    typingNode.remove();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    appendAssistant(data);
    if (data.reply && data.reply.trim()) {
      messages.push({ role: 'assistant', content: data.reply });
    }
  } catch (err) {
    typingNode.remove();
    appendError(err.message);
  } finally {
    inFlight = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
});

inputEl.focus();
```

- [ ] **Step 10: Verify it loads and renders**

With a `spanishTrainer` config present (reuse the Task 6 smoke-test config), start the server and open `http://localhost:3000/espanol`. Confirm: page renders with "entrenador de español" heading, Spanish example chips, the `tú`/`tutor` labels appear after sending, no JS console errors. (A real reply needs a live Ollama; if unavailable, an error bubble is expected and acceptable here.)

- [ ] **Step 11: Commit**

```bash
git add public/espanol.html
git commit -m "feat(trainer): /espanol page — TTS, corrections, translations"
```

---

### Task 8: Add the "ES" button to `/chat`

**Files:**
- Modify: `public/chat.html`

- [ ] **Step 1: Add the gated button to the sub-bar** — replace:

```html
<div class="page-subbar">
  <div class="status-chip" id="statusChip" data-status="ready"><span class="dot"></span><span id="statusLabel">ready</span></div>
</div>
```
with:
```html
<div class="page-subbar">
  <div class="status-chip" id="statusChip" data-status="ready"><span class="dot"></span><span id="statusLabel">ready</span></div>
  <span class="spacer"></span>
  <a class="es-btn" id="esBtn" href="/espanol" title="entrenador de español" hidden>ES</a>
</div>
```

- [ ] **Step 2: Add `.es-btn` CSS** — find the `@media (max-width: 520px)` block in chat.html's `<style>` and insert before it:

```css
.es-btn {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--cyan);
  border: 1px solid rgba(var(--cyan-rgb), 0.35);
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
  text-decoration: none;
  transition: background 160ms var(--ease-out), border-color 160ms var(--ease-out);
}
.es-btn:hover { background: rgba(var(--cyan-rgb), 0.10); }

@media (max-width: 520px) {
```

- [ ] **Step 3: Probe and reveal** — find `inputEl.focus();` near the end of chat.html's script and add immediately after it:

```js
fetch('/api/espanol/config')
  .then((r) => { if (r.ok) document.getElementById('esBtn').hidden = false; })
  .catch(() => {});
```

- [ ] **Step 4: Verify gating both ways**

With `spanishTrainer` configured: open `/chat`, confirm the "ES" button appears top-right of the sub-bar and links to `/espanol`. Remove `spanishTrainer` from config, restart: confirm the button stays hidden (probe returns 404, button stays `hidden`).

- [ ] **Step 5: Commit**

```bash
git add public/chat.html
git commit -m "feat(trainer): gated ES button on /chat -> /espanol"
```

---

### Task 9: Documentation

**Files:**
- Modify: `config.example.js`
- Modify: `README.md`

- [ ] **Step 1: Add config template** — in `config.example.js`, after the commented `tv:` block, add:

```js
  // Spanish trainer — adds an "ES" button to /chat linking to /espanol, a B1–B2
  // Spanish conversation tutor. Talks directly to your Ollama server (the same one
  // Home Assistant uses, on its own machine) with a tutor system prompt — independent
  // of the nabu home-control agent. Voice: replies have a tap-to-hear speaker button
  // (browser speech synthesis); for speaking input, use the iPhone keyboard's Spanish
  // dictation (set a Spanish keyboard — iOS dictation follows the keyboard language).
  // - ollamaUrl: http://<ollama-host>:11434 (must be reachable from the dashboard host)
  // - model: a model pulled on that Ollama (e.g. "llama3.1")
  // - systemPrompt: optional override of the default tutor prompt
  // - voice: optional TTS BCP-47 hint (default "es-ES")
  // - temperature: optional (default 0.7)
  // spanishTrainer: {
  //   ollamaUrl: "http://OLLAMA_HOST:11434",
  //   model: "llama3.1",
  //   // voice: "es-ES",
  //   // temperature: 0.7,
  // },
```

- [ ] **Step 2: Add README section** — in `README.md`, add a "Spanish trainer" subsection under the configuration/feature area documenting: the `spanishTrainer` config block; that Ollama must be reachable from the dashboard host (`OLLAMA_HOST=0.0.0.0` if cross-host — usually already true since HA reaches it); that the entry point is the ES button on `/chat`; and the iPhone tip — add a Spanish keyboard, because iOS dictation language follows the keyboard, not the page. Mirror the existing TV-remote section's length/tone.

- [ ] **Step 3: Commit**

```bash
git add config.example.js README.md
git commit -m "docs(trainer): config template + README section"
```

---

### Task 10: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all suites pass, including the 24 `spanish_trainer` tests. No regressions in existing suites.

- [ ] **Step 2: Manual device verification (real Ollama + iPhone)**

On the deployed dashboard, with `spanishTrainer` configured against the live Ollama:
- `/chat` shows the ES button → tap → lands on `/espanol`.
- Type a Spanish sentence with a deliberate error → tutor replies in Spanish; a `correction` note appears (yellow, not spoken); tapping the speaker reads only the Spanish `reply`.
- Ask "¿cómo se dice 'I'm looking forward to it'?" → a `translation`/explanation appears.
- On iPhone (Spanish keyboard added): tap the field, use keyboard dictation to speak Spanish → text lands in the field → send → hear the reply via the speaker button.
- "reiniciar conversación" clears the transcript and history.
- Stop Ollama → send → an error bubble appears (no crash).

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch to merge/PR `feat/spanish-trainer`.

---

## Self-Review Notes

- **Spec coverage:** route/page (T6/T7), direct-Ollama brain (T5/T6), structured `{reply,correction,translation}` + schema (T2/T3), system prompt (T2), stateless server + 20-msg cap (T4/T6), TTS speaker button + voice config (T7), iOS dictation `lang="es"` (T7), Spanish chips (T7), `spanishTrainer` config + validation (T1/T6/T9), ES-button entry gated like `tv` (T8), tests mirroring `tv.test.js`/`home_assistant.test.js` (T1–T5), README prereqs (T9). No landing tile (correctly absent).
- **Gating note (deviation from spec wording):** the spec said `/api/espanol/config` returns 503 when unconfigured; this plan instead leaves the whole `if (config.spanishTrainer)` block unmounted (probe → 404), matching the established `if (config.tv)` gating pattern. The `/chat` probe treats any non-2xx as "disabled," so behavior is identical. Spec updated to match.
- **Type consistency:** `OllamaClient.chat(messages, { format })` returns string; `parseTrainerReply(string)` → `{reply,correction,translation}`; `validateMessages(messages)` → `{ok, trimmed}` / `{ok:false, error}`. Server composes `[{role:'system',...}, ...trimmed]`. Names consistent across T5/T6.
