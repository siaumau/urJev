import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmailPayload, deriveClassification, EMAIL_PROBLEM } from '../extensions/gmail-urjev-analyzer/urjev.js';
import { truncateUtf8 } from '../extensions/gmail-urjev-analyzer/gmail-api.js';

test('Gmail classifier maps spam, important urgency, time fallback and uncategorized', () => {
  const answer = (spam, importance, urgency, mentionsTime) => ({
    spam_likelihood: { type: 'choice', choice: spam }, importance: { type: 'choice', choice: importance },
    urgency: { type: 'choice', choice: urgency }, mentions_time: { type: 'noul', noul: mentionsTime }
  });
  assert.equal(deriveClassification(answer('likely_spam', 'important', 'urgent', 1)).category, 'possible_spam');
  assert.equal(deriveClassification(answer('not_spam', 'important', 'urgent', 0)).category, 'important_urgent');
  assert.equal(deriveClassification(answer('not_spam', 'important', 'not_urgent', 1)).category, 'important_not_urgent');
  assert.equal(deriveClassification(answer('not_spam', 'secondary', 'urgent', 1)).category, 'secondary');
  assert.equal(deriveClassification(answer('unclear', 'uncategorized', 'not_urgent', .5)).category, 'time_related');
  assert.equal(deriveClassification(answer('not_spam', 'uncategorized', 'not_urgent', .49)).category, 'uncategorized');
});

test('Gmail payload keeps email as State data and defines four bounded decisions', () => {
  const payload = buildEmailPayload({ subject: 'Meeting tomorrow', from: 'a@example.com', receivedAt: 'today', snippet: 'At 10', body: 'Please join at 10:00.' }, new Date('2026-09-24T00:00:00Z'));
  assert.equal(payload.model, 'urjev');
  assert.equal(payload.state.email.subject, 'Meeting tomorrow');
  assert.equal(payload.state.analysis_date, '2026-09-24T00:00:00.000Z');
  assert.deepEqual(Object.keys(payload.problem), ['spam_likelihood', 'importance', 'urgency', 'mentions_time']);
  assert.equal(EMAIL_PROBLEM.mentions_time.type, 'noul');
  assert.equal(EMAIL_PROBLEM.importance.criteria.important.includes('需要本人'), true);
});

test('Gmail body truncation uses UTF-8 bytes and preserves valid text', () => {
  const shortened = truncateUtf8('測'.repeat(2000), 3500);
  assert.ok(new TextEncoder().encode(shortened).length <= 3500);
  assert.match(shortened, /內容已截短/);
  assert.equal(truncateUtf8('short', 3500), 'short');
});
