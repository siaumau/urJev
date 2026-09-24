const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function getGmailToken(interactive = false) {
  const result = await chrome.identity.getAuthToken({ interactive });
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('尚未取得 Gmail 授權。請按「連接 Gmail」。');
  return token;
}

async function gmailFetch(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  if (response.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    throw new Error('Gmail 授權已過期，請重新連接。');
  }
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(body?.error?.message || `Gmail API HTTP ${response.status}`);
  return body;
}

export async function listMessages(token, query, maxResults) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const body = await gmailFetch(`/messages?${params}`, token);
  return body.messages ?? [];
}

export async function getProfile(token) {
  return gmailFetch('/profile', token);
}

export function headerValue(message, name) {
  return message.payload?.headers?.find(item => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export async function getMessage(token, id, format = 'full') {
  const params = new URLSearchParams({ format });
  if (format === 'metadata') for (const name of ['Subject', 'From', 'Date']) params.append('metadataHeaders', name);
  return gmailFetch(`/messages/${encodeURIComponent(id)}?${params}`, token);
}

export async function loadMessageSummaries(token, refs) {
  const summaries = new Array(refs.length); let cursor = 0;
  const workers = Array.from({ length: Math.min(8, refs.length) }, async () => {
    while (cursor < refs.length) {
      const index = cursor++; const ref = refs[index];
      const message = await getMessage(token, ref.id, 'metadata');
      summaries[index] = { id: ref.id, threadId: ref.threadId, subject: headerValue(message, 'Subject') || '（無主旨）', from: headerValue(message, 'From') || '（未知寄件者）', date: headerValue(message, 'Date'), snippet: message.snippet ?? '' };
    }
  });
  await Promise.all(workers);
  return summaries;
}

function decodeBase64Url(data = '') {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

const decodeHtmlAttribute = value => String(value ?? '')
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');

export function extractLinks(plainParts = [], htmlParts = []) {
  const links = [];
  const add = (url, text = '') => {
    const value = decodeHtmlAttribute(url).trim();
    if (!/^https?:\/\//i.test(value)) return;
    if (!links.some(item => item.url === value)) links.push({ url: value, text: stripHtml(text).slice(0, 120) });
  };
  for (const html of htmlParts) {
    for (const match of String(html).matchAll(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) add(match[2], match[3]);
  }
  for (const plain of plainParts) {
    for (const match of String(plain).matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) add(match[0].replace(/[.,;:!?]+$/, ''));
  }
  return links.slice(0, 20);
}

export function truncateUtf8(text, maxBytes) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  const suffix = '\n[內容已截短]';
  const contentBudget = Math.max(0, maxBytes - encoder.encode(suffix).length);
  let low = 0, high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, middle)).length <= contentBudget) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low)}${suffix}`;
}

async function partText(token, messageId, part) {
  let data = part.body?.data;
  if (!data && part.body?.attachmentId) data = (await gmailFetch(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, token)).data;
  return data ? decodeBase64Url(data) : '';
}

async function collectParts(token, messageId, part, output) {
  if (part.mimeType === 'text/plain') output.plain.push(await partText(token, messageId, part));
  else if (part.mimeType === 'text/html') output.html.push(await partText(token, messageId, part));
  for (const child of part.parts ?? []) await collectParts(token, messageId, child, output);
}

export async function extractEmail(token, message) {
  const output = { plain: [], html: [] };
  await collectParts(token, message.id, message.payload ?? {}, output);
  const text = output.plain.find(Boolean) || stripHtml(output.html.find(Boolean) || '') || message.snippet || '';
  return {
    id: message.id,
    threadId: message.threadId,
    subject: truncateUtf8(headerValue(message, 'Subject') || '（無主旨）', 500),
    from: truncateUtf8(headerValue(message, 'From') || '（未知寄件者）', 500),
    to: truncateUtf8(headerValue(message, 'To'), 700),
    cc: truncateUtf8(headerValue(message, 'Cc'), 700),
    deliveredTo: truncateUtf8(headerValue(message, 'Delivered-To'), 500),
    originalTo: truncateUtf8(headerValue(message, 'X-Original-To'), 500),
    replyTo: truncateUtf8(headerValue(message, 'Reply-To'), 500),
    receivedAt: headerValue(message, 'Date'),
    authenticationResults: truncateUtf8(headerValue(message, 'Authentication-Results'), 1200),
    returnPath: truncateUtf8(headerValue(message, 'Return-Path'), 500),
    snippet: truncateUtf8(message.snippet ?? '', 500),
    body: truncateUtf8(text, 2000),
    links: extractLinks(output.plain, output.html)
  };
}

export const AI_LABELS = Object.freeze({
  suspected_fraud: 'AI/可能詐騙',
  possible_spam: 'AI/可能垃圾',
  important_urgent: 'AI/重要/緊急',
  important_not_urgent: 'AI/重要/不緊急',
  marketing: 'AI/行銷',
  knowledge: 'AI/新知',
  secondary: 'AI/次要',
  time_related: 'AI/時間相關',
  uncategorized: 'AI/未分類'
});

export function excludeAiLabeled(query) {
  const exclusions = Object.values(AI_LABELS).map(name => `-label:"${name}"`).join(' ');
  return `${String(query ?? '').trim()} ${exclusions}`.trim();
}

export function addGmailTextSearch(query, mode, term) {
  const phrase = String(term ?? '').trim().replace(/["\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!phrase) return String(query ?? '').trim();
  const filter = mode === 'subject' ? `subject:"${phrase}"` : `"${phrase}"`;
  return `${String(query ?? '').trim()} ${filter}`.trim();
}

export function onlyAiLabeled(query = '') {
  const alternatives = Object.values(AI_LABELS).map(name => `label:"${name}"`).join(' ');
  return `${String(query ?? '').trim()} {${alternatives}}`.trim();
}

export async function archiveMessages(token, messageIds) {
  const ids = [...new Set(messageIds)].filter(Boolean);
  if (!ids.length) return null;
  return gmailFetch('/messages/batchModify', token, {
    method: 'POST', body: JSON.stringify({ ids, removeLabelIds: ['INBOX'] })
  });
}

const LABEL_TREE = Object.freeze(['AI', 'AI/重要', ...Object.values(AI_LABELS)]);
const LEGACY_LABELS = Object.freeze(['urJev/可能垃圾', 'urJev/重要-緊急', 'urJev/重要-不緊急', 'urJev/次要', 'urJev/時間相關', 'urJev/未分類']);

async function ensureLabels(token) {
  const existing = (await gmailFetch('/labels', token)).labels ?? [];
  const byName = new Map(existing.map(label => [label.name, label.id]));
  for (const name of LABEL_TREE) {
    if (byName.has(name)) continue;
    const created = await gmailFetch('/labels', token, { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
    byName.set(name, created.id);
  }
  return byName;
}

let labelsPromise;
export async function applyAiLabel(token, messageId, category, { archive = false } = {}) {
  labelsPromise ??= ensureLabels(token).catch(error => { labelsPromise = null; throw error; });
  const labels = await labelsPromise;
  const targetName = AI_LABELS[category] ?? AI_LABELS.uncategorized;
  const allIds = [...Object.values(AI_LABELS), ...LEGACY_LABELS].map(name => labels.get(name)).filter(Boolean);
  const removeLabelIds = allIds.filter(id => id !== labels.get(targetName));
  if (archive) removeLabelIds.push('INBOX');
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, token, {
    method: 'POST', body: JSON.stringify({ addLabelIds: [labels.get(targetName)], removeLabelIds })
  });
}

export const applyUrjevLabel = applyAiLabel;
