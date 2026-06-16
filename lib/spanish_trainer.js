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

// NOTE: the JSON shape in DEFAULT_SYSTEM_PROMPT, TRAINER_SCHEMA, and the field reads in parseTrainerReply must stay in sync (reply/correction/translation).
const TRAINER_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    correction: { type: 'string' },
    translation: { type: 'string' },
  },
  required: ['reply'],
};

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

/**
 * Trims to the last 20 messages (sliding window) BEFORE validating, so messages
 * older than the last 20 are silently dropped rather than rejected.
 * Returns { ok: true, trimmed } on success, or { ok: false, error } on the first invalid message.
 */
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

class OllamaClient {
  #ollamaUrl;
  #model;
  #temperature;

  constructor({ ollamaUrl, model, temperature = 0.7 }) {
    if (typeof ollamaUrl !== 'string' || !ollamaUrl) {
      throw new TypeError('OllamaClient requires a non-empty ollamaUrl string');
    }
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

module.exports = {
  validateTrainerConfig,
  buildSystemPrompt,
  TRAINER_SCHEMA,
  parseTrainerReply,
  validateMessages,
  OllamaClient,
};
