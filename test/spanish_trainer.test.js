const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTrainerConfig,
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
