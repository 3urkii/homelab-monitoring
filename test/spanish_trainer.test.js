const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTrainerConfig,
  buildSystemPrompt,
  TRAINER_SCHEMA,
  parseTrainerReply,
  validateMessages,
  OllamaClient,
} = require('../lib/spanish_trainer.js');

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
  assert.ok(validateTrainerConfig({ ollamaUrl: 'http://OLLAMA_HOST:11434', model: 'x' }).some((e) => /ollamaUrl/.test(e)));
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

test('validateMessages: valid passes through', () => {
  const msgs = [{ role: 'user', content: 'hola' }];
  assert.deepEqual(validateMessages(msgs), { ok: true, trimmed: msgs });
});
test('validateMessages: empty/non-array rejected', () => {
  assert.equal(validateMessages([]).ok, false);
  assert.equal(validateMessages(undefined).ok, false);
});
test('validateMessages: bad role rejected', () => {
  const out = validateMessages([{ role: 'system', content: 'x' }]);
  assert.equal(out.ok, false);
  assert.match(out.error, /user\|assistant/);
});
test('validateMessages: empty content rejected', () => {
  const out = validateMessages([{ role: 'user', content: '   ' }]);
  assert.equal(out.ok, false);
  assert.match(out.error, /content/);
});
test('validateMessages: over-long content rejected', () => {
  const out = validateMessages([{ role: 'user', content: 'a'.repeat(4001) }]);
  assert.equal(out.ok, false);
  assert.match(out.error, /4000/);
});
test('validateMessages: trims to last 20', () => {
  const msgs = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const out = validateMessages(msgs);
  assert.equal(out.ok, true);
  assert.equal(out.trimmed.length, 20);
  assert.equal(out.trimmed[0].content, 'm5');
});

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
test('OllamaClient: rejects missing ollamaUrl', () => {
  assert.throws(() => new OllamaClient({ model: 'm' }), /ollamaUrl/);
});
