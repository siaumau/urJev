import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, prepare } from '../src/engine.js';
import { createApp } from '../src/server.js';
const input = { mode: 'classify', text: 'Where is my package?', labels: ['shipping', 'refund'] };
function mock(content, extra = {}) { return async () => new Response(JSON.stringify({ done: true, message: { content }, ...extra })); }
test('sends enum constraints to decoder; validates output and timing', async () => {
  let request;
  const engine = createEngine({ fetchImpl: async (url, opts) => { request = JSON.parse(opts.body); return mock('{"label":"shipping"}', { eval_count: 5, total_duration: 1000000 })(); } });
  const result = await engine.decide(input);
  assert.equal(result.result.label, 'shipping');
  assert.equal(result.meta.model_ms, 1);
  assert.deepEqual(request.format.properties.label.enum, ['shipping', 'refund', '__unknown__']);
  assert.equal(request.stream, false);
});
test('rejects invented labels, extra fields, malformed JSON and truncated output', async () => {
  for (const content of ['{"label":"invented"}', '{"label":"shipping","extra":1}', 'not json']) {
    await assert.rejects(createEngine({ fetchImpl: mock(content) }).decide(input), e => e.status === 502);
  }
  await assert.rejects(createEngine({ fetchImpl: mock('{"label":"shipping"}', { done_reason: 'length' }) }).decide(input), e => e.code === 'TRUNCATED_OUTPUT');
});
test('abstention is explicit and no invented confidence is returned', async () => {
  const result = await createEngine({ fetchImpl: mock('{"label":"__unknown__"}') }).decide(input);
  assert.equal(result.meta.abstained, true); assert.equal(result.result.confidence, undefined);
});
test('rejects invalid input and examples before inference', () => {
  for (const value of [null, {}, { ...input, text: '' }, { ...input, labels: ['one'] }, { ...input, labels: ['x', 'x'] }, { ...input, labels: ['x', '__unknown__'] }, { ...input, examples: [{ text: 'hi', output: { label: 'bad' } }] }]) assert.throws(() => prepare(value), e => e.status === 400);
  assert.throws(() => prepare({ ...input, text: '字'.repeat(3000) }), e => e.status === 400);
});
test('extraction supports nested nullable fields and rejects unsupported schema', async () => {
  const schema = { type: 'object', properties: { count: { type: ['integer', 'null'] } }, required: ['count'], additionalProperties: false };
  const request = { mode: 'extract', text: 'Unknown count', schema };
  assert.deepEqual((await createEngine({ fetchImpl: mock('{"count":null}') }).decide(request)).result, { count: null });
  await assert.rejects(createEngine({ fetchImpl: mock('{"count":"3"}') }).decide(request), e => e.code === 'SCHEMA_MISMATCH');
  assert.throws(() => prepare({ ...request, schema: { ...schema, $ref: 'https://example.com' } }));
});
test('offline and timeout are explicit errors, never fake predictions', async () => {
  await assert.rejects(createEngine({ fetchImpl: async () => { throw new TypeError('offline'); } }).decide(input), e => e.status === 503);
  await assert.rejects(createEngine({ fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError'); } }).decide(input), e => e.status === 504);
});
test('HTTP validates content type, JSON, origins and returns structured results', async t => {
  const server = createApp(createEngine({ fetchImpl: mock('{"label":"shipping"}') }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = { 'Content-Type': 'application/json' }) => fetch(base + '/api/decide', { method: 'POST', headers, body });
  assert.equal((await post('{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('{}', { 'Content-Type': 'application/json', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(JSON.stringify(input))).status, 200);
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.match(await (await fetch(base)).text(), /urJev/);
});
test('health distinguishes installed model from reachable empty backend', async () => {
  const engine = models => createEngine({ fetchImpl: async () => new Response(JSON.stringify({ models })) });
  assert.equal((await engine([]).health()).ready, false);
  assert.equal((await engine([{ name: 'qwen2.5:3b' }]).health()).ready, true);
});
test('HTTP serializes inference and recovers from a failed request', async t => {
  let unblock, signalStarted;
  const started = new Promise(resolve => signalStarted = resolve);
  const blocked = new Promise(resolve => unblock = resolve);
  let first = true;
  const server = createApp({ health: async () => ({}), decide: async () => {
    if (first) { first = false; signalStarted(); await blocked; throw new Error('test failure'); }
    return { result: { label: 'shipping' } };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { unblock(); return new Promise(resolve => server.close(resolve)); });
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const pending = post(); await started;
  assert.equal((await post()).status, 429);
  unblock(); assert.equal((await pending).status, 500);
  assert.equal((await post()).status, 200);
});
test('HTTP rejects oversized bodies', async t => {
  const server = createApp({ decide: () => assert.fail('must not call model') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(70000) }) });
  assert.equal(response.status, 413);
});
