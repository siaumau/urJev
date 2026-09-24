export const DEFAULT_SETTINGS = Object.freeze({
  endpoint: 'http://127.0.0.1:15413/v1/systemone/oneforward',
  query: 'in:inbox newer_than:30d',
  maxMessages: 20,
  applyLabels: false
});

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...await chrome.storage.local.get(DEFAULT_SETTINGS) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...settings });
}

export function validateEndpoint(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
  if (!local) throw new Error('為保護郵件內容，端點只接受 127.0.0.1 或 localhost。');
  if (!url.pathname.endsWith('/v1/systemone/oneforward')) throw new Error('端點路徑必須以 /v1/systemone/oneforward 結尾。');
  return url.href;
}
