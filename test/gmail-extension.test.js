import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildEmailPayload, deriveClassification, EMAIL_PROBLEM } from '../extensions/gmail-urjev-analyzer/urjev.js';
import { AI_LABELS, applyAiLabel, loadMessageSummaries, truncateUtf8 } from '../extensions/gmail-urjev-analyzer/gmail-api.js';

test('Gmail classifier applies spam, importance, marketing, knowledge and fallback priority', () => {
  const answer = (spam, importance, urgency, mentionsTime, contentPurpose = 'other') => ({
    spam_likelihood: { type: 'choice', choice: spam }, importance: { type: 'choice', choice: importance },
    urgency: { type: 'choice', choice: urgency }, mentions_time: { type: 'noul', noul: mentionsTime },
    content_purpose: { type: 'choice', choice: contentPurpose }
  });
  assert.equal(deriveClassification(answer('likely_spam', 'important', 'urgent', 1, 'marketing')).category, 'possible_spam');
  assert.equal(deriveClassification(answer('not_spam', 'important', 'urgent', 0, 'marketing')).category, 'marketing');
  assert.equal(deriveClassification(answer('not_spam', 'important', 'urgent', 0, 'knowledge')).category, 'knowledge');
  assert.equal(deriveClassification(answer('not_spam', 'important', 'urgent', 0)).category, 'important_urgent');
  assert.equal(deriveClassification(answer('not_spam', 'important', 'not_urgent', 1)).category, 'important_not_urgent');
  assert.equal(deriveClassification(answer('not_spam', 'secondary', 'not_urgent', 0, 'marketing')).category, 'marketing');
  assert.equal(deriveClassification(answer('not_spam', 'secondary', 'not_urgent', 0, 'knowledge')).category, 'knowledge');
  assert.equal(deriveClassification(answer('not_spam', 'secondary', 'urgent', 1)).category, 'secondary');
  assert.equal(deriveClassification(answer('unclear', 'uncategorized', 'not_urgent', .5)).category, 'time_related');
  assert.equal(deriveClassification(answer('not_spam', 'uncategorized', 'not_urgent', .49)).category, 'uncategorized');
});

test('Gmail payload keeps email as State data and defines five bounded decisions', () => {
  const payload = buildEmailPayload({ subject: 'Meeting tomorrow', from: 'a@example.com', receivedAt: 'today', snippet: 'At 10', body: 'Please join at 10:00.' }, new Date('2026-09-24T00:00:00Z'));
  assert.equal(payload.model, 'urjev');
  assert.equal(payload.state.email.subject, 'Meeting tomorrow');
  assert.equal(payload.state.analysis_date, '2026-09-24T00:00:00.000Z');
  assert.deepEqual(Object.keys(payload.problem), ['spam_likelihood', 'content_purpose', 'importance', 'urgency', 'mentions_time']);
  assert.equal(EMAIL_PROBLEM.mentions_time.type, 'noul');
  assert.equal(EMAIL_PROBLEM.importance.criteria.important.includes('需要本人'), true);
});

test('Gmail body truncation uses UTF-8 bytes and preserves valid text', () => {
  const shortened = truncateUtf8('測'.repeat(2000), 3500);
  assert.ok(new TextEncoder().encode(shortened).length <= 3500);
  assert.match(shortened, /內容已截短/);
  assert.equal(truncateUtf8('short', 3500), 'short');
});

test('Gmail categories map to the AI nested label tree', () => {
  assert.equal(AI_LABELS.possible_spam, 'AI/可能垃圾');
  assert.equal(AI_LABELS.important_urgent, 'AI/重要/緊急');
  assert.equal(AI_LABELS.important_not_urgent, 'AI/重要/不緊急');
  assert.equal(AI_LABELS.marketing, 'AI/行銷');
  assert.equal(AI_LABELS.knowledge, 'AI/新知');
  assert.equal(AI_LABELS.secondary, 'AI/次要');
  assert.equal(AI_LABELS.time_related, 'AI/時間相關');
  assert.equal(AI_LABELS.uncategorized, 'AI/未分類');
});

test('Gmail execute classification applies one AI label and can archive', async () => {
  const originalFetch = globalThis.fetch;
  const labels = ['AI', 'AI/重要', ...Object.values(AI_LABELS)].map((name, index) => ({ name, id: `label-${index}` }));
  let modifyRequest;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/labels')) return new Response(JSON.stringify({ labels }), { status: 200 });
    if (String(url).includes('/messages/message-1/modify')) {
      modifyRequest = JSON.parse(options.body);
      return new Response('{}', { status: 200 });
    }
    throw new Error(`Unexpected Gmail request: ${url}`);
  };
  try {
    await applyAiLabel('token', 'message-1', 'important_urgent', { archive: true });
    const target = labels.find(label => label.name === 'AI/重要/緊急').id;
    assert.deepEqual(modifyRequest.addLabelIds, [target]);
    assert.ok(modifyRequest.removeLabelIds.includes('INBOX'));
    assert.equal(modifyRequest.removeLabelIds.includes(target), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('Gmail summary loading preserves order and limits request concurrency', async () => {
  const originalFetch = globalThis.fetch; let active = 0, peak = 0;
  const refs = Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, threadId: `t${index}` }));
  globalThis.fetch = async url => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    const id = decodeURIComponent(String(url).match(/messages\/([^?]+)/)[1]);
    return new Response(JSON.stringify({ id, snippet: id, payload: { headers: [{ name: 'Subject', value: id }] } }), { status: 200 });
  };
  try {
    const summaries = await loadMessageSummaries('token', refs);
    assert.deepEqual(summaries.map(item => item.id), refs.map(item => item.id));
    assert.ok(peak <= 8);
  } finally { globalThis.fetch = originalFetch; }
});

test('Gmail extension opens from the toolbar as a persistent side panel', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extensions/gmail-urjev-analyzer/manifest.json', import.meta.url), 'utf8'));
  const worker = await readFile(new URL('../extensions/gmail-urjev-analyzer/service-worker.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../extensions/gmail-urjev-analyzer/popup.js', import.meta.url), 'utf8');
  const markup = await readFile(new URL('../extensions/gmail-urjev-analyzer/popup.html', import.meta.url), 'utf8');
  const progressStyle = await readFile(new URL('../extensions/gmail-urjev-analyzer/progress.css', import.meta.url), 'utf8');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.side_panel.default_path, 'popup.html');
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.background.service_worker, 'service-worker.js');
  assert.match(worker, /openPanelOnActionClick:\s*true/);
  assert.match(panel, /chrome\.storage\.session\.set/);
  assert.match(panel, /chrome\.storage\.session\.get/);
  assert.match(panel, /function updateProgress\(\)/);
  assert.match(markup, /id="analysis-progress"/);
  assert.equal((markup.match(/data-category-count=/g) ?? []).length, 8);
  assert.match(progressStyle, /position:fixed/);
});
