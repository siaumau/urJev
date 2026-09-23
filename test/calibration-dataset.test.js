import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareOneForwardProblems } from '../src/systemone.js';

test('four-class synthetic calibration dataset has 100 unique valid labeled tasks', async () => {
  const text = await readFile(new URL('../datasets/feedback-calibration-100-v2.jsonl', import.meta.url), 'utf8');
  const rows = text.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map(row => row.id)).size, 100);
  assert.equal(new Set(rows.map(row => row.state.feedback.text)).size, 100);
  assert.deepEqual(Object.fromEntries(['calibration', 'validation', 'test'].map(split => [split, rows.filter(row => row.split === split).length])), { calibration: 60, validation: 20, test: 20 });
  const allowed = {
    main_topic: new Set(['technical', 'content', 'pricing', 'service', 'other']),
    sentiment: new Set(['positive', 'negative', 'mixed', 'neutral'])
  };
  for (const row of rows) {
    assert.equal(row.source, 'synthetic_seeded_v2');
    assert.equal(row.seed, 20260923);
    assert.equal(prepareOneForwardProblems({ state: row.state, problem: row.problem }).length, 5);
    assert.equal(allowed.main_topic.has(row.expected.main_topic), true);
    assert.equal(allowed.sentiment.has(row.expected.sentiment), true);
    assert.equal(typeof row.expected.refund_requested, 'boolean');
    assert.equal(typeof row.expected.expressed_churn_intent, 'boolean');
    assert.equal(Number.isInteger(row.expected.expressed_frustration) && row.expected.expressed_frustration >= 0 && row.expected.expressed_frustration <= 3, true);
  }
});

test('four-class independent feedback holdout has 40 unique labeled tasks', async () => {
  const text = await readFile(new URL('../datasets/feedback-holdout-40-v2.jsonl', import.meta.url), 'utf8');
  const rows = text.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 40);
  assert.equal(new Set(rows.map(row => row.id)).size, 40);
  assert.equal(new Set(rows.map(row => row.state.feedback.text)).size, 40);
  assert.equal(rows.every(row => row.split === 'holdout' && row.source === 'synthetic_manual_holdout_v2'), true);
  assert.equal(rows.every(row => row.expected.sentiment !== 'unclear'), true);
  assert.equal(rows.every(row => prepareOneForwardProblems({ state: row.state, problem: row.problem }).length === 5), true);
});
