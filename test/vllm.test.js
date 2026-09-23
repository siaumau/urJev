import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine.js';

const input = { mode: 'classify', text: 'refund please', labels: ['refund', 'shipping'] };
const reply = (content, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens: 80, completion_tokens: 6 } }));
test('vLLM uses constrained JSON schema and preserves unavailable timings', async () => {
  let request, endpoint;
  const engine = createEngine({ backend: 'vllm', fetchImpl: async (url, opts) => { endpoint = url; request = JSON.parse(opts.body); return reply('{"label":"refund"}'); } });
  const result = await engine.decide(input);
  assert.equal(endpoint, 'http://127.0.0.1:18000/v1/chat/completions');
  assert.deepEqual(request.response_format.json_schema.schema.properties.label.enum, ['refund', 'shipping', '__unknown__']);
  assert.equal(result.result.label, 'refund');
  assert.equal(result.meta.backend, 'vllm');
  assert.equal(result.meta.input_tokens, 80);
  assert.equal(result.meta.output_tokens, 6);
  assert.equal(result.meta.model_ms, null);
  assert.equal(result.meta.generation_ms, null);
});
test('vLLM rejects invalid and truncated model responses', async () => {
  for (const [content, reason, code] of [['{"label":"fake"}', 'stop', 'SCHEMA_MISMATCH'], ['invalid', 'stop', 'INVALID_MODEL_OUTPUT'], ['{"label":"refund"}', 'length', 'TRUNCATED_OUTPUT']]) {
    await assert.rejects(createEngine({ backend: 'vllm', fetchImpl: async () => reply(content, reason) }).decide(input), e => e.code === code);
  }
});
test('vLLM readiness matches the served model ID', async () => {
  const engine = createEngine({ backend: 'vllm', fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'Qwen/Qwen3-4B-Instruct-2507' }] })) });
  assert.equal((await engine.health()).ready, true);
  assert.equal((await engine.runtime()).vram_bytes, null);
});
test('vLLM keeps per-request metrics separate from Ollama timing definitions', async () => {
  const metrics = { queue_time_ms: 2, time_to_first_token_ms: 20, generation_time_ms: 80, tokens_per_second: 60 };
  const engine = createEngine({ backend: 'vllm', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"label":"refund"}' }, finish_reason: 'stop' }], metrics })) });
  const { meta } = await engine.decide(input);
  assert.deepEqual(meta.vllm_metrics, metrics);
  assert.equal(meta.prompt_ms, null);
  assert.equal(meta.output_tokens_per_second, null);
});

test('vLLM OneForward requests one constrained label and normalizes its logprobs', async () => {
  let request;
  const engine = createEngine({ backend: 'vllm', fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'B' }, finish_reason: 'stop', logprobs: { content: [{ token: 'B', logprob: -0.1, top_logprobs: [{ token: 'B', logprob: -0.1 }, { token: 'A', logprob: -2.1 }] }] } }],
      usage: { prompt_tokens: 20, completion_tokens: 1 }
    }));
  } });
  const output = await engine.inferLabels({ messages: [{ role: 'user', content: 'test' }], labels: ['A', 'B'], tokenIds: [32, 33] });
  assert.equal(request.max_tokens, 1);
  assert.equal(request.logprobs, true);
  assert.equal(request.top_logprobs, 0);
  assert.deepEqual(request.allowed_token_ids, [32, 33]);
  assert.deepEqual(request.logprob_token_ids, [32, 33]);
  assert.ok(Math.abs(output.probabilities.A + output.probabilities.B - 1) < 1e-12);
  assert.ok(output.probabilities.B > output.probabilities.A);
  assert.equal(output.meta.selected_label, 'B');
  assert.equal(output.meta.output_tokens, 1);
});

test('OneForward refuses incomplete label logprobs and non-vLLM backends', async () => {
  const incomplete = createEngine({ backend: 'vllm', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'A' }, logprobs: { content: [{ top_logprobs: [{ token: 'A', logprob: 0 }] }] } }] })) });
  await assert.rejects(incomplete.inferLabels({ messages: [], labels: ['A', 'B'], tokenIds: [32, 33] }), error => error.code === 'INVALID_LABEL_LOGPROBS');
  await assert.rejects(createEngine().inferLabels({ messages: [], labels: ['A', 'B'], tokenIds: [32, 33] }), error => error.code === 'ONEFORWARD_UNSUPPORTED');
});

test('OneForward keeps one-token semantic labels and replaces multi-token candidates', async () => {
  let calls = 0;
  const engine = createEngine({ backend: 'vllm', fetchImpl: async (_url, options) => {
    calls++;
    const prompt = JSON.parse(options.body).prompt;
    return new Response(JSON.stringify(prompt === 'unclear' ? { count: 2, tokens: [1, 2] } : { count: 1, tokens: [prompt === 'positive' ? 10 : prompt === 'A' ? 12 : 11] }));
  } });
  assert.deepEqual(await engine.candidateLabels(['positive', 'unclear']), { labels: ['positive', 'A'], tokenIds: [10, 12] });
  assert.deepEqual(await engine.candidateLabels(['positive', 'unclear']), { labels: ['positive', 'A'], tokenIds: [10, 12] });
  assert.equal(calls, 3);
});
