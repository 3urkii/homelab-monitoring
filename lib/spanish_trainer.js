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

module.exports = {
  validateTrainerConfig,
};
