/**
 * Cheap, real API tests for the deployment's keys. Never prints secrets.
 *
 *   node --env-file=.env scripts/test-provider-keys.mjs
 *
 * - OpenRouter: GET /key (validity + credits) and a 1-token chat completion on
 *   the configured chat model.
 * - OpenAI: GET /models (validity) and a tiny TTS synthesis on gpt-4o-mini-tts.
 * - Tavily: a 1-result search (1 credit).
 */
const models = {
  chat: process.env.OPENROUTER_MODELS || 'deepseek/deepseek-v4.1-flash',
  image: 'google/gemini-3-pro-image',
  video: 'google/veo-3.1',
};
const out = {};
const orKey = process.env.OPENROUTER_API_KEY;
const orBase = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');

// --- OpenRouter key metadata -------------------------------------------------
try {
  const res = await fetch(`${orBase}/key`, { headers: { Authorization: `Bearer ${orKey}` } });
  const body = await res.json().catch(() => ({}));
  out.openrouterKey = res.ok
    ? {
        ok: true,
        label: body.data?.label,
        usage: body.data?.usage,
        limit: body.data?.limit,
        isFreeTier: body.data?.is_free_tier,
      }
    : { ok: false, status: res.status, error: body.error?.message || 'unknown' };
} catch (e) {
  out.openrouterKey = { ok: false, error: String(e) };
}

// --- OpenRouter chat completion (max 5 tokens) --------------------------------
try {
  const res = await fetch(`${orBase}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: models.chat,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      max_tokens: 16,
    }),
  });
  const body = await res.json().catch(() => ({}));
  out.openrouterChat = res.ok
    ? { ok: true, model: body.model, reply: body.choices?.[0]?.message?.content?.slice(0, 40) }
    : { ok: false, status: res.status, error: body.error?.message || 'unknown' };
} catch (e) {
  out.openrouterChat = { ok: false, error: String(e) };
}

// --- OpenAI key: models list --------------------------------------------------
const oaKey = process.env.OPENAI_API_KEY;
if (oaKey) {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${oaKey}` },
    });
    const body = await res.json().catch(() => ({}));
    out.openaiKey = res.ok
      ? { ok: true, hasTts: (body.data || []).some((m) => m.id === 'gpt-4o-mini-tts'), hasWhisper: (body.data || []).some((m) => m.id === 'whisper-1') }
      : { ok: false, status: res.status, error: body.error?.message || 'unknown' };
  } catch (e) {
    out.openaiKey = { ok: false, error: String(e) };
  }

  // --- OpenAI TTS: tiny synthesis -------------------------------------------
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${oaKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        input: 'مرحبا، هذا اختبار.',
      }),
    });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      out.openaiTts = { ok: true, bytes: buf.byteLength, contentType: res.headers.get('content-type') };
    } else {
      const body = await res.json().catch(() => ({}));
      out.openaiTts = { ok: false, status: res.status, error: body.error?.message || 'unknown' };
    }
  } catch (e) {
    out.openaiTts = { ok: false, error: String(e) };
  }
} else {
  out.openaiKey = { ok: false, error: 'OPENAI_API_KEY not set' };
}

// --- Tavily: 1-result search ---------------------------------------------------
const tavily = process.env.TAVILY_API_KEY;
if (tavily) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tavily}` },
      body: JSON.stringify({ query: 'openrouter', max_results: 1 }),
    });
    const body = await res.json().catch(() => ({}));
    out.tavily = res.ok
      ? { ok: true, results: (body.results || []).length }
      : { ok: false, status: res.status, error: body.detail?.error || body.message || 'unknown' };
  } catch (e) {
    out.tavily = { ok: false, error: String(e) };
  }
}

console.log(JSON.stringify(out, null, 2));
