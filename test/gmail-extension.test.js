import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeEmail, buildEmailPayload, clipUtf8Prefix, deriveClassification, deriveIdentitySignals, deriveOrganizationSignals, EMAIL_PROBLEM } from '../extensions/gmail-urjev-analyzer/urjev.js';
import { addGmailTextSearch, AI_LABELS, applyAiLabel, archiveMessages, excludeAiLabeled, extractEmail, extractLinks, loadMessageSummaries, onlyAiLabeled, truncateUtf8 } from '../extensions/gmail-urjev-analyzer/gmail-api.js';
import { summarizeProgress } from '../extensions/gmail-urjev-analyzer/progress.js';
import { createFeedbackRecord, matchFeedback, senderIdentity, subjectFeatures } from '../extensions/gmail-urjev-analyzer/feedback.js';
import { prepareOneForwardProblems } from '../src/systemone.js';

test('Gmail classifier applies spam, importance, marketing, knowledge and fallback priority', () => {
  const answer = (spam, importance, urgency, mentionsTime, contentPurpose = 'other', fraud = 'not_fraud') => ({
    fraud_likelihood: { type: 'choice', choice: fraud },
    spam_likelihood: { type: 'choice', choice: spam }, importance: { type: 'choice', choice: importance },
    urgency: { type: 'choice', choice: urgency }, mentions_time: { type: 'noul', noul: mentionsTime },
    content_purpose: { type: 'choice', choice: contentPurpose }
  });
  assert.equal(deriveClassification(answer('not_spam', 'important', 'urgent', 1, 'other', 'likely_fraud')).category, 'suspected_fraud');
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

test('Gmail payload keeps identity, recipient, link and authentication data and defines six bounded decisions', () => {
  const payload = buildEmailPayload({ subject: 'Meeting tomorrow', from: 'a@example.com', to: 'me@example.com', recipientAccount: 'me@example.com', receivedAt: 'today', authenticationResults: 'dkim=pass header.i=@example.com', returnPath: '<bounce@example.com>', snippet: 'At 10', body: 'Please join at 10:00.' }, new Date('2026-09-24T00:00:00Z'));
  assert.equal(payload.model, 'urjev');
  assert.equal(payload.state.email.subject, 'Meeting tomorrow');
  assert.equal(payload.state.analysis_date, '2026-09-24T00:00:00.000Z');
  assert.match(payload.state.email.authentication_results, /dkim=pass/);
  assert.equal(payload.state.email.recipient_match, 'matched');
  assert.equal(payload.state.email.sender_authenticated, 'true');
  assert.equal(payload.state.email.link_alignment, 'no_claim');
  assert.deepEqual(Object.keys(payload.problem), ['fraud_likelihood', 'spam_likelihood', 'content_purpose', 'importance', 'urgency', 'mentions_time']);
  assert.match(EMAIL_PROBLEM.fraud_likelihood.instructions, /sender_authenticated=true/);
  assert.equal(EMAIL_PROBLEM.mentions_time.type, 'noul');
  assert.equal(EMAIL_PROBLEM.importance.criteria.important.includes('需要本人'), true);
});

test('Gmail prompt keeps only the first 2,000 body bytes and stays below every OneForward limit', () => {
  const body = `開頭內容${'測'.repeat(2500)}不應保留的結尾`;
  const payload = buildEmailPayload({ subject: '很長的郵件', from: 'sender@example.com', receivedAt: 'today', authenticationResults: `dkim=pass header.i=@example.com; ${'x'.repeat(3000)}`, returnPath: '<bounce@example.com>', snippet: '摘要', body });
  assert.ok(new TextEncoder().encode(payload.state.email.body).length <= 2000);
  assert.match(payload.state.email.body, /^開頭內容/);
  assert.match(payload.state.email.body, /內容已截短/);
  assert.doesNotMatch(payload.state.email.body, /不應保留的結尾/);
  assert.equal(clipUtf8Prefix('短內容', 2000), '短內容');
  const plans = prepareOneForwardProblems(payload);
  for (const plan of plans) assert.ok(Buffer.byteLength(JSON.stringify(plan.prepared.messages), 'utf8') <= 7000);
});

test('Gmail worst-case populated state leaves room for every question under 7,000 bytes', () => {
  const email = {
    subject: '測'.repeat(300), from: `品牌 <sender@${'a'.repeat(40)}.example>`, replyTo: `reply@${'b'.repeat(40)}.example`,
    to: 'recipient@example.com', cc: 'copy@example.com', deliveredTo: 'recipient@example.com', originalTo: 'recipient@example.com', recipientAccount: 'recipient@example.com',
    receivedAt: 'Wed, 24 Sep 2026 10:00:00 +0800', authenticationResults: `dkim=pass header.i=@example.com; ${'驗證'.repeat(800)}`,
    returnPath: `<bounce@${'c'.repeat(40)}.example>`, snippet: '摘要'.repeat(300), body: '本文'.repeat(3000),
    links: Array.from({ length: 20 }, (_, index) => ({ url: `https://suspicious-${index}.example/path`, text: `玉山銀行連結 ${index}` }))
  };
  const plans = prepareOneForwardProblems(buildEmailPayload(email));
  for (const plan of plans) assert.ok(Buffer.byteLength(JSON.stringify(plan.prepared.messages), 'utf8') <= 7000, plan.id);
});

test('Gmail extraction includes authentication headers for spoofing assessment', async () => {
  const message = { id: 'm1', threadId: 't1', snippet: 'Security alert', payload: { mimeType: 'text/plain', body: { data: Buffer.from('Review account activity').toString('base64url') }, headers: [
    { name: 'Subject', value: 'Security alert' }, { name: 'From', value: 'Google <no-reply@accounts.google.com>' }, { name: 'To', value: 'Me <me@example.com>' },
    { name: 'Delivered-To', value: 'me@example.com' }, { name: 'Reply-To', value: 'no-reply@accounts.google.com' },
    { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.i=@accounts.google.com; dmarc=pass header.from=accounts.google.com' },
    { name: 'Return-Path', value: '<bounce@accounts.google.com>' }
  ] } };
  const email = await extractEmail('token', message);
  assert.match(email.authenticationResults, /dmarc=pass/);
  assert.equal(email.returnPath, '<bounce@accounts.google.com>');
  assert.equal(email.deliveredTo, 'me@example.com');
  assert.equal(email.replyTo, 'no-reply@accounts.google.com');
});

test('Gmail extracts the actual destinations behind HTML link labels', () => {
  const links = extractLinks(
    ['備用網址 https://www.esunbank.com/zh-tw/personal'],
    ['<a href="https://fake-bank.example/login?next=esun">玉山銀行安全登入</a>']
  );
  assert.deepEqual(links, [
    { url: 'https://fake-bank.example/login?next=esun', text: '玉山銀行安全登入' },
    { url: 'https://www.esunbank.com/zh-tw/personal', text: '' }
  ]);
});

test('Gmail identity signals compare sender routes and the signed-in recipient', () => {
  const legitimate = deriveIdentitySignals({ from: 'Google <no-reply@accounts.google.com>', replyTo: 'support@accounts.google.com', returnPath: '<bounce@accounts.google.com>', to: 'me@example.com', recipientAccount: 'me@example.com', authenticationResults: 'dkim=pass header.i=@accounts.google.com; dmarc=pass header.from=accounts.google.com' });
  assert.deepEqual(legitimate, { recipientAccount: 'me@example.com', recipientMatch: 'matched', senderDomain: 'accounts.google.com', senderAuthenticated: true, senderAlignment: 'aligned' });
  const suspicious = deriveIdentitySignals({ from: 'Bank <notice@bank.example>', replyTo: 'steal@evil.example', returnPath: '<bounce@evil.example>', to: 'victim@example.com', recipientAccount: 'me@example.com', authenticationResults: 'dkim=fail; dmarc=fail' });
  assert.equal(suspicious.recipientMatch, 'mismatch');
  assert.equal(suspicious.senderAlignment, 'mismatch');
  assert.equal(suspicious.senderAuthenticated, false);
});

test('Gmail distinguishes a visible wrong recipient from BCC or group delivery', () => {
  assert.equal(deriveIdentitySignals({ to: 'other@example.com', recipientAccount: 'me@example.com' }).recipientMatch, 'mismatch');
  assert.equal(deriveIdentitySignals({ recipientAccount: 'me@example.com' }).recipientMatch, 'not_visible');
});

test('Gmail compares a claimed E.SUN identity with official sender and link domains', () => {
  const official = deriveOrganizationSignals({
    subject: '玉山銀行信用卡通知', from: 'service@esunbank.com', body: '請查看帳務',
    authenticationResults: 'dkim=pass header.i=@esunbank.com; dmarc=pass header.from=esunbank.com',
    links: [{ url: 'https://ebank.esunbank.com.tw/login', text: '登入' }, { url: 'https://esun.co/notice', text: '說明' }]
  });
  assert.deepEqual(official.claimedOrganizations, ['玉山銀行']);
  assert.equal(official.organizationSenderAlignment, 'official_authenticated');
  assert.equal(official.linkAlignment, 'official');
  const fake = deriveOrganizationSignals({
    subject: '玉山銀行帳戶遭停用', from: 'service@notice-example.com', body: '立即驗證',
    authenticationResults: 'dkim=pass header.i=@notice-example.com',
    links: [{ url: 'https://esun-secure.example/login', text: '玉山銀行登入' }]
  });
  assert.equal(fake.organizationSenderAlignment, 'mismatch');
  assert.equal(fake.linkAlignment, 'mismatch');
  assert.deepEqual(fake.suspiciousLinkDomains, ['esun-secure.example']);
});

test('Gmail recognises authenticated iKala newsletters as the claimed official sender', () => {
  const signals = deriveOrganizationSignals({
    subject: '【iKala 9月報】AI Agent 產業落地實戰解析', from: 'iKala <contact@ikala.ai>',
    body: 'iKala AI Service 月報：5 大趨勢掌握最新 AI 動態',
    authenticationResults: 'dkim=pass header.i=@mailer.example; dmarc=pass header.from=ikala.ai',
    returnPath: '<bounce@mailer.example>', links: [{ url: 'https://ikala.ai/news/', text: '閱讀全文' }]
  });
  assert.equal(signals.organizationSenderAlignment, 'official_authenticated');
  assert.equal(signals.linkAlignment, 'official');
});

test('Gmail forces suspected fraud when a claimed institution has both sender and link mismatches', async () => {
  const response = { answers: {
    fraud_likelihood: { type: 'choice', choice: 'not_fraud' }, spam_likelihood: { type: 'choice', choice: 'not_spam' },
    content_purpose: { type: 'choice', choice: 'other' }, importance: { type: 'choice', choice: 'important' },
    urgency: { type: 'choice', choice: 'urgent' }, mentions_time: { type: 'noul', noul: 0 }
  } };
  const result = await analyzeEmail({ subject: '玉山銀行帳戶驗證', from: 'alert@evil.example', body: '請登入確認', links: [{ url: 'https://esun-login.evil.example', text: '登入' }] }, 'http://localhost/test', async () => new Response(JSON.stringify(response)));
  assert.equal(result.fraud, 'likely_fraud');
  assert.equal(result.category, 'suspected_fraud');
  assert.equal(result.linkAlignment, 'mismatch');
});

test('Gmail does not let mailing-provider routes turn a verified iKala newsletter into fraud', async () => {
  const response = { answers: {
    fraud_likelihood: { type: 'choice', choice: 'likely_fraud' }, spam_likelihood: { type: 'choice', choice: 'not_spam' },
    content_purpose: { type: 'choice', choice: 'marketing' }, importance: { type: 'choice', choice: 'secondary' },
    urgency: { type: 'choice', choice: 'not_urgent' }, mentions_time: { type: 'noul', noul: 1 }
  } };
  const result = await analyzeEmail({
    subject: '【iKala 9月報】AI Agent 產業落地實戰解析', from: 'iKala <contact@ikala.ai>',
    to: 'me@example.com', recipientAccount: 'me@example.com', returnPath: '<bounce@mailer.example>',
    authenticationResults: 'dkim=pass header.i=@mailer.example; dmarc=pass header.from=ikala.ai',
    body: 'iKala AI Service 月報：5 大趨勢掌握最新 AI 動態',
    links: [{ url: 'https://ikala.ai/news/', text: '閱讀全文' }, { url: 'https://mailer.example/unsubscribe', text: '取消訂閱' }]
  }, 'http://localhost/test', async () => new Response(JSON.stringify(response)));
  assert.equal(result.fraud, 'not_fraud');
  assert.equal(result.category, 'marketing');
  assert.equal(result.linkAlignment, 'mixed');
});

test('Gmail requires an aligned passing DKIM or DMARC result for sender authentication', () => {
  const misleading = deriveIdentitySignals({ from: 'iKala <contact@ikala.ai>', authenticationResults: 'dkim=pass header.i=@mailer.example; dmarc=fail header.from=ikala.ai' });
  assert.equal(misleading.senderAuthenticated, false);
  const aligned = deriveIdentitySignals({ from: 'iKala <contact@ikala.ai>', authenticationResults: 'dkim=pass header.i=@mailer.example; dmarc=pass header.from=ikala.ai' });
  assert.equal(aligned.senderAuthenticated, true);
});

test('Gmail body truncation uses UTF-8 bytes and preserves valid text', () => {
  const shortened = truncateUtf8('測'.repeat(2000), 3500);
  assert.ok(new TextEncoder().encode(shortened).length <= 3500);
  assert.match(shortened, /內容已截短/);
  assert.equal(truncateUtf8('short', 3500), 'short');
});

test('Gmail categories map to the AI nested label tree', () => {
  assert.equal(AI_LABELS.possible_spam, 'AI/可能垃圾');
  assert.equal(AI_LABELS.suspected_fraud, 'AI/可能詐騙');
  assert.equal(AI_LABELS.important_urgent, 'AI/重要/緊急');
  assert.equal(AI_LABELS.important_not_urgent, 'AI/重要/不緊急');
  assert.equal(AI_LABELS.marketing, 'AI/行銷');
  assert.equal(AI_LABELS.knowledge, 'AI/新知');
  assert.equal(AI_LABELS.secondary, 'AI/次要');
  assert.equal(AI_LABELS.time_related, 'AI/時間相關');
  assert.equal(AI_LABELS.uncategorized, 'AI/未分類');
});

test('Gmail loading query excludes every message already carrying an AI classification', () => {
  const query = excludeAiLabeled('in:inbox newer_than:30d');
  assert.match(query, /^in:inbox newer_than:30d /);
  for (const label of Object.values(AI_LABELS)) assert.ok(query.includes(`-label:"${label}"`));
  const cleanupQuery = onlyAiLabeled('in:inbox');
  assert.match(cleanupQuery, /^in:inbox \{/);
  for (const label of Object.values(AI_LABELS)) assert.ok(cleanupQuery.includes(`label:"${label}"`));
});

test('Gmail search can target the subject or search subject and body text', () => {
  assert.equal(addGmailTextSearch('in:inbox', 'subject', 'AI Agent'), 'in:inbox subject:"AI Agent"');
  assert.equal(addGmailTextSearch('in:inbox', 'all', 'AI Agent'), 'in:inbox "AI Agent"');
  assert.equal(addGmailTextSearch('in:inbox', 'all', '  '), 'in:inbox');
  assert.equal(addGmailTextSearch('in:inbox', 'subject', '"危險" \\ 測試'), 'in:inbox subject:"危險 測試"');
});

test('Gmail can archive previously classified messages in one batch', async () => {
  const originalFetch = globalThis.fetch; let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response('{}', { status: 200 });
  };
  try {
    await archiveMessages('token', ['m1', 'm2', 'm1']);
    assert.match(request.url, /messages\/batchModify$/);
    assert.deepEqual(request.body, { ids: ['m1', 'm2'], removeLabelIds: ['INBOX'] });
  } finally { globalThis.fetch = originalFetch; }
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
  const settings = await readFile(new URL('../extensions/gmail-urjev-analyzer/settings.js', import.meta.url), 'utf8');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.side_panel.default_path, 'popup.html');
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.background.service_worker, 'service-worker.js');
  assert.match(worker, /openPanelOnActionClick:\s*true/);
  assert.match(panel, /chrome\.storage\.session\.set/);
  assert.match(panel, /chrome\.storage\.session\.get/);
  assert.match(panel, /function updateProgress\(\)/);
  assert.match(markup, /id="analysis-progress"/);
  assert.match(markup, /id="fraud-alert"/);
  assert.match(markup, /id="llm-input-tokens"/);
  assert.match(markup, /id="llm-output-tokens"/);
  assert.match(markup, /class="correction-select"/);
  assert.match(markup, /id="search-term"/);
  assert.match(markup, /id="search-mode"/);
  assert.match(markup, /class="sticky-controls"/);
  assert.equal((markup.match(/class="pagination hidden"/g) ?? []).length, 2);
  assert.equal((markup.match(/data-category-count=/g) ?? []).length, 9);
  assert.match(progressStyle, /position:fixed/);
  assert.match(progressStyle, /cursor:grab/);
  assert.match(progressStyle, /@keyframes fraud-alert-pulse/);
  assert.match(panel, /summary\.counts\.suspected_fraud/);
  const popupStyle = await readFile(new URL('../extensions/gmail-urjev-analyzer/popup.css', import.meta.url), 'utf8');
  assert.match(popupStyle, /\.sticky-controls\{position:sticky;top:0/);
  assert.match(settings, /archiveAfterApply:\s*true/);
  assert.match(panel, /excludeAiLabeled/);
  assert.match(panel, /state\.messages = state\.messages\.filter/);
  assert.match(panel, /const PAGE_SIZE = 5/);
  assert.match(panel, /function updatePagination\(\)/);
  assert.match(panel, /function pendingSelectedIds\(\)/);
  assert.match(panel, /const ids = pendingSelectedIds\(\)/);
});

test('Gmail progress reaches 100 percent for five selected messages out of 100 loaded', () => {
  const runIds = ['1', '2', '3', '4', '5'];
  const results = new Map(runIds.map((id, index) => [id, { category: index < 2 ? 'marketing' : 'knowledge', meta: { latency_ms: 100 + index * 10 }, usage: { input_tokens: 200, output_tokens: 6 } }]));
  const summary = summarizeProgress({ loadedCount: 100, runIds, completedIds: new Set(runIds), results, categories: ['marketing', 'knowledge', 'uncategorized'] });
  assert.deepEqual({ loaded: summary.loaded, target: summary.target, done: summary.done, percent: summary.percent }, { loaded: 100, target: 5, done: 5, percent: 100 });
  assert.deepEqual(summary.counts, { marketing: 2, knowledge: 3, uncategorized: 0 });
  assert.deepEqual({ latency: summary.averageLatencyMs, input: summary.inputTokens, output: summary.outputTokens }, { latency: 120, input: 1000, output: 30 });
});

test('Gmail feedback learns similar subjects but will not bypass spam without authentication', () => {
  const correctedEmail = { subject: '安全性快訊', from: 'Google <no-reply@accounts.google.com>', authenticated: true };
  const record = createFeedbackRecord(correctedEmail, 'possible_spam', 'important_urgent', new Date('2026-09-24T00:00:00Z'));
  const authenticated = { subject: '安全性快訊：新的登入活動', from: 'no-reply@accounts.google.com', authenticationResults: 'dkim=pass header.i=@accounts.google.com; dmarc=pass header.from=accounts.google.com' };
  assert.equal(matchFeedback([record], authenticated, 'possible_spam').category, 'important_urgent');
  assert.equal(matchFeedback([record], { ...authenticated, authenticationResults: '' }, 'possible_spam'), null);
  assert.equal(senderIdentity(authenticated.from).domain, 'accounts.google.com');
  assert.ok(subjectFeatures(authenticated.subject).length > 2);
});
