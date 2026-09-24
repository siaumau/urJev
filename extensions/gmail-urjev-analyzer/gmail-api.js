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

export function headerValue(message, name) {
  return message.payload?.headers?.find(item => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export async function getMessage(token, id, format = 'full') {
  const params = new URLSearchParams({ format });
  if (format === 'metadata') for (const name of ['Subject', 'From', 'Date']) params.append('metadataHeaders', name);
  return gmailFetch(`/messages/${encodeURIComponent(id)}?${params}`, token);
}

export async function loadMessageSummaries(token, refs) {
  return Promise.all(refs.map(async ref => {
    const message = await getMessage(token, ref.id, 'metadata');
    return { id: ref.id, threadId: ref.threadId, subject: headerValue(message, 'Subject') || '（無主旨）', from: headerValue(message, 'From') || '（未知寄件者）', date: headerValue(message, 'Date'), snippet: message.snippet ?? '' };
  }));
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
    to: headerValue(message, 'To'),
    receivedAt: headerValue(message, 'Date'),
    snippet: truncateUtf8(message.snippet ?? '', 500),
    body: truncateUtf8(text, 3500)
  };
}

export const GMAIL_LABELS = Object.freeze({
  possible_spam: 'urJev/可能垃圾',
  important_urgent: 'urJev/重要-緊急',
  important_not_urgent: 'urJev/重要-不緊急',
  secondary: 'urJev/次要',
  time_related: 'urJev/時間相關',
  uncategorized: 'urJev/未分類'
});

async function ensureLabels(token) {
  const existing = (await gmailFetch('/labels', token)).labels ?? [];
  const byName = new Map(existing.map(label => [label.name, label.id]));
  for (const name of Object.values(GMAIL_LABELS)) {
    if (byName.has(name)) continue;
    const created = await gmailFetch('/labels', token, { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
    byName.set(name, created.id);
  }
  return byName;
}

let labelsPromise;
export async function applyUrjevLabel(token, messageId, category) {
  labelsPromise ??= ensureLabels(token).catch(error => { labelsPromise = null; throw error; });
  const labels = await labelsPromise;
  const targetName = GMAIL_LABELS[category] ?? GMAIL_LABELS.uncategorized;
  const allIds = Object.values(GMAIL_LABELS).map(name => labels.get(name)).filter(Boolean);
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, token, {
    method: 'POST', body: JSON.stringify({ addLabelIds: [labels.get(targetName)], removeLabelIds: allIds.filter(id => id !== labels.get(targetName)) })
  });
}
