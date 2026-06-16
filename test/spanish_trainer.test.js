const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTrainerConfig,
  buildSystemPrompt,
  TRAINER_SCHEMA,
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
