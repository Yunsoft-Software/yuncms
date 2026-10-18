// URL shortcuts only. No provider/model is selected or locked by the runtime.
export const AI_PROVIDERS = Object.freeze([
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'zai', name: 'Z.AI / GLM', baseUrl: 'https://api.z.ai/api/paas/v4' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
].map(Object.freeze));

const canonical = value => String(value || '').trim().replace(/\/+$/, '');
export function aiProviderPreset(baseUrl) {
  return AI_PROVIDERS.find(provider => provider.baseUrl === canonical(baseUrl))?.id || 'custom';
}

export function changeAiProviderEndpoint(form, baseUrl, preset = 'custom') {
  if (canonical(baseUrl) === canonical(form.baseUrl)) return { ...form, baseUrl, preset };
  return { ...form, baseUrl, preset, provider: null, apiKey: '', clearApiKey: true, enabled: false, endpointChanged: true };
}
