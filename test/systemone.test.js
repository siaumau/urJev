import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOneForwardProblems, prepareProblems, systemOne, systemOneOneForward } from '../src/systemone.js';
import { feedbackExample } from '../public/feedback-example.js';
import { cleanEscapes, parseEditor } from '../public/json-input.js';
import { createApp } from '../src/server.js';

test('cached validators keep fresh State and distinguish output schemas', () => {
  const input = { state: 'first', questions: { x: { type: 'choice', instructions: 'Choose', criteria: { a: 'A', b: 'B' } } } };
  const first = prepareProblems(input, { flatWeights: true })[0].prepared;
  input.state = 'second';
  const second = prepareProblems(input, { flatWeights: true })[0].prepared;
  assert.equal(first.validate, second.validate);
  assert.equal(JSON.parse(second.messages[1].content).state, 'second');
  assert.equal(second.validate({ a: 20, b: 80 }), true);
  assert.equal(second.validate({ a: -1, b: 80 }), false);
  input.questions.x.criteria = { c: 'C', d: 'D' };
  const changed = prepareProblems(input, { flatWeights: true })[0].prepared;
  assert.equal(changed.validate({ a: 20, b: 80 }), false);
  assert.equal(changed.validate({ c: 20, d: 80 }), true);
  const wrapped = prepareProblems(input)[0].prepared;
  assert.equal(wrapped.validate({ c: 20, d: 80 }), false);
  assert.equal(wrapped.validate({ weights: { c: 20, d: 80 } }), true);
});

test('user example compiles into five isolated prompts without question IDs', () => {
  const plans = prepareProblems(feedbackExample);
  assert.equal(plans.length, 5);
  assert.deepEqual(plans.map(p => p.type), ['choice', 'choice', 'noul', 'noul', 'score']);
  assert.deepEqual(Object.keys(feedbackExample.questions.sentiment.criteria), ['positive', 'negative', 'mixed', 'neutral']);
  for (const plan of plans) {
    assert.equal(plan.prepared.messages.length, 2);
    assert.equal(plan.prepared.messages[0].content.includes('refund_requested'), false);
    assert.deepEqual(JSON.parse(plan.prepared.messages[1].content).state, feedbackExample.state);
  }
  assert.equal(prepareProblems({ state: [], problem: feedbackExample.questions }).length, 5);
});
test('normalizes weights and computes typed answers without invented confidence', async () => {
  const weights = [[8, 1, 0, 1, 0], [0, 1, 9, 0, 0], [1, 9], [0, 10], [0, 1, 8, 1]];
  let calls = 0;
  const output = await systemOne({ infer: async prepared => {
    const row = weights[calls++];
    return { result: { weights: Object.fromEntries(prepared.schema.properties.weights.required.map((k, i) => [k, row[i]])) }, meta: { model: 'test', input_tokens: 10, output_tokens: 5, load_ms: 1 } };
  } }, feedbackExample);
  assert.equal(output.answers.main_topic.choice, 'technical');
  assert.equal(output.answers.sentiment.choice, 'mixed');
  assert.equal(output.answers.refund_requested.noul, .9);
  assert.equal(output.answers.expressed_frustration.score, 2);
  assert.equal(output.answers.main_topic.confidence, null);
  assert.equal(output.meta.calibrated, false);
  assert.equal(output.usage.output_tokens, 25);
});
test('rejects invalid problems before calling model', async () => {
  for (const input of [null, { state: null, questions: feedbackExample.questions }, { state: {}, questions: {} }, { ...feedbackExample, problem: {} }, { ...feedbackExample, model: 'jev' }, { state: {}, questions: { x: { type: 'score', instructions: 'Rate', criteria: ['one'] } } }]) {
    await assert.rejects(systemOne({ infer: () => assert.fail('must not infer') }, input), e => e.status === 400);
  }
});
test('rejects zero, negative, missing and out of range weights', async () => {
  const input = { state: 'text', questions: { x: { type: 'noul', instructions: 'Is it true?' } } };
  for (const weights of [{ false: 0, true: 0 }, { false: -1, true: 5 }, { false: 5 }, { false: 101, true: 0 }]) await assert.rejects(systemOne({ infer: async () => ({ result: { weights }, meta: {} }) }, input), e => e.status === 502);
});
test('cleans pasted escapes only for invalid JSON', () => {
  assert.deepEqual(parseEditor(cleanEscapes('{&#x20;"main\\_topic":1}'), 'Problem'), { main_topic: 1 });
  assert.equal(cleanEscapes('{"text":"&#x20;"}'), '{"text":"&#x20;"}');
  assert.throws(() => parseEditor('{', 'State'), /State/);
});

test('compact parallel inference preserves question and option order with bounded concurrency', async () => {
  let active = 0, peak = 0, calls = 0;
  const rows = [[90,0,0,10,0],[0,0,100,0,0],[10,90],[0,100],[0,10,80,10]];
  const output = await systemOne({ backend: 'vllm', infer: async prepared => {
    const index = calls++;
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, index === 0 ? 30 : 2));
    active--;
    return { result: Object.fromEntries(prepared.schema.required.map((key, i) => [key, rows[index][i]])), meta: { backend: 'vllm', output_tokens: 10 } };
  } }, feedbackExample);
  assert.equal(peak, 5);
  assert.deepEqual(Object.keys(output.answers), Object.keys(feedbackExample.questions));
  assert.equal(output.answers.sentiment.choice, 'mixed');
  assert.equal(output.answers.refund_requested.noul, .9);
  assert.equal(output.answers.expressed_frustration.score, 2);
  assert.equal(output.meta.execution, 'independent_parallel');
  assert.deepEqual(output.meta.profile.per_question.map(q => q.question_id), Object.keys(feedbackExample.questions));
});

test('parallel failure drains active work and stops scheduling remaining questions', async () => {
  let calls = 0, drained = false;
  await assert.rejects(systemOne({ backend: 'vllm', infer: async () => {
    if (++calls === 1) throw new Error('inference failed');
    await new Promise(resolve => setTimeout(resolve, 15));
    drained = true;
    return { result: { weights: {positive:0,negative:0,mixed:100,neutral:0,unclear:0} }, meta: {} };
  } }, feedbackExample, { concurrency: 2 }), /inference failed/);
  assert.equal(calls, 2);
  assert.equal(drained, true);
});

test('sixteen questions use at most eight workers and retain ordering', async () => {
  let active = 0, peak = 0;
  const questions=Object.fromEntries(Array.from({length:16},(_,i)=>['q'+i,{type:'noul',instructions:'True?'}]));
  const result=await systemOne({backend:'vllm',infer:async()=>{
    peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,2));
    active--;
    return {result:{false:0,true:100},meta:{}};
  }},{state:'test',questions});
  assert.equal(peak,8);
  assert.deepEqual(Object.keys(result.answers),Object.keys(questions));
  for(const concurrency of [0,9,1.5]) await assert.rejects(systemOne({}, {state:'test',questions},{concurrency}),/Concurrency/);
});

test('compact output preserves named schema validation', async () => {
  const input = { state: 'text', questions: { x: { type: 'noul', instructions: 'True?' } } };
  for (const weights of [{false:0}, {false:0,true:0}, {false:-1,true:100}, {false:0,true:101}, {false:0,true:100,extra:0}]) {
    await assert.rejects(systemOne({ backend: 'vllm', infer: async () => ({result:weights,meta:{}}) }, input), e => e.status === 502);
  }
});
test('systemone HTTP route accepts problem alias', async t => {
  const server = createApp({ infer: async () => ({ result: { weights: { false: 1, true: 9 } }, meta: { model: 'test' } }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/systemone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'test', problem: { yes: { type: 'noul', instructions: 'Is it true?' } } }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answers.yes.noul, .9);
});

test('OneForward maps opaque labels back to typed answers', async () => {
  const plans = prepareOneForwardProblems(feedbackExample);
  assert.deepEqual(plans[0].prepared.labels, ['A', 'B', 'C', 'D', 'E']);
  assert.equal(plans[0].prepared.messages[0].content.includes('technical'), true);
  assert.equal(plans[0].prepared.messages[0].content.includes('main_topic'), false);
  const rows = [
    { A: .9, B: .025, C: .025, D: .025, E: .025 },
    { A: .02, B: .03, C: .9, D: .05 },
    { A: .1, B: .9 }, { A: .05, B: .95 },
    { A: .01, B: .04, C: .9, D: .05 }
  ];
  let calls = 0;
  const output = await systemOneOneForward({ backend: 'vllm', inferLabels: async () => ({ probabilities: rows[calls++], meta: { model: 'test', backend: 'vllm', input_tokens: 5, output_tokens: 1 } }) }, feedbackExample);
  assert.equal(output.answers.main_topic.choice, 'technical');
  assert.equal(output.answers.sentiment.choice, 'mixed');
  assert.equal(output.answers.refund_requested.noul, .9);
  assert.ok(Math.abs(output.answers.expressed_frustration.score - 1.99) < 1e-12);
  assert.equal(output.usage.output_tokens, 5);
  assert.equal(output.meta.probability_method, 'conditional_label_token_logits');
  assert.equal(output.meta.experimental, true);
});

test('OneForward can average normal and reversed choice order without changing label meanings', async () => {
  const input = { state: 'evidence', problem: { result: { type: 'choice', instructions: 'Choose one', criteria: { first: 'First definition', second: 'Second definition' } } } };
  const prompts = [];
  const engine = {
    backend: 'vllm',
    choiceOrderEnsemble: true,
    candidateLabels: async () => ({ labels: ['A', 'B'], tokenIds: [32, 33] }),
    inferLabels: async prepared => {
      prompts.push(prepared.messages[0].content);
      const reversed = prepared.messages[0].content.indexOf('"key":"second"') < prepared.messages[0].content.indexOf('"key":"first"');
      return { probabilities: reversed ? { A: .2, B: .8 } : { A: .6, B: .4 }, meta: { model: 'test', backend: 'vllm', input_tokens: 5, output_tokens: 1 } };
    }
  };
  const output = await systemOneOneForward(engine, input);
  assert.equal(prompts.length, 2);
  assert.equal(output.answers.result.choice, 'second');
  assert.ok(Math.abs(output.answers.result.probabilities.first - .4) < 1e-12);
  assert.ok(Math.abs(output.answers.result.probabilities.second - .6) < 1e-12);
  assert.equal(output.usage.output_tokens, 2);
  assert.equal(output.meta.inference_requests, 2);
  assert.equal(output.meta.profile.per_question[0].decision_method, 'choice_order_ensemble');
});

test('OneForward HTTP route returns the same public answer shape', async t => {
  const server = createApp({ backend: 'vllm', inferLabels: async () => ({ probabilities: { A: .1, B: .9 }, meta: { model: 'test', backend: 'vllm', output_tokens: 1 } }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/systemone/oneforward`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'test', problem: { yes: { type: 'noul', instructions: 'Is it true?' } } }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.answers.yes.noul, .9);
  assert.equal(body.meta.output_format, 'single_label_logprobs');
});

test('benchmark serves v2 data and proxies Jev without persisting the API key', async t => {
  let forwarded;
  const server = createApp({}, { jevFetch: async (url, options) => {
    forwarded = { url, authorization: options.headers.Authorization, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ model: 'jev-test', answers: { yes: { type: 'noul', noul: .9 } }, usage: { input_tokens: 4, output_tokens: 1 } }));
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const datasetResponse = await fetch(base + '/api/benchmark/dataset');
  const dataset = await datasetResponse.json();
  assert.equal(datasetResponse.status, 200);
  assert.equal(dataset.version, 'feedback-calibration-100-v2');
  assert.equal(dataset.rows.length, 100);
  const payload = { model: 'jev-latest', state: 'test', questions: { yes: { type: 'noul', instructions: 'Is this true?' } } };
  const response = await fetch(base + '/api/benchmark/jev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: 'secret-test-key', payload }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(forwarded.authorization, 'Bearer secret-test-key');
  assert.deepEqual(forwarded.body, payload);
  assert.equal(body.result.answers.yes.noul, .9);
  assert.equal(JSON.stringify(body).includes('secret-test-key'), false);
});
