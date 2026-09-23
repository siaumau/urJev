import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsSentimentFactors, sentimentDistribution } from '../src/sentiment.js';
import { systemOneOneForward } from '../src/systemone.js';
import { feedbackExample } from '../public/feedback-example.js';

const question = feedbackExample.questions.sentiment;
const mockEngine = (inferLabels) => ({
  backend: 'vllm', sentimentStrategy: 'decomposed', inferLabels,
  candidateLabels: async keys => ({ labels: keys, tokenIds: keys.map((_,i)=>i) })
});
test('sentiment adapter only accepts the validated definition, independent of field name and key order', () => {
  assert.equal(supportsSentimentFactors(question), true);
  assert.equal(supportsSentimentFactors({ ...question, criteria: Object.fromEntries(Object.entries(question.criteria).reverse()) }), true);
  assert.equal(supportsSentimentFactors({ ...question, instructions: '請推測顧客隱藏的情緒' }), false);
  assert.equal(supportsSentimentFactors({ ...question, criteria: { ...question.criteria, positive: 'positive means unhappy' } }), false);
  assert.equal(supportsSentimentFactors({ ...question, criteria: { ...question.criteria, unclear: 'unknown' } }), false);
});

test('binary truth table and uncertain product scores preserve all four classes without calibrated confidence', async () => {
  for (const [positive,negative,expected] of [[.9,.1,'positive'],[.1,.9,'negative'],[.9,.9,'mixed'],[.1,.1,'neutral']]) {
    const engine = mockEngine(async prepared => {
      const p = prepared.messages[0].content.includes('此次只判斷：回饋者有沒有明確肯定') ? positive : negative;
      assert.equal(JSON.parse(prepared.messages.at(-1).content).state.feedback.text, 'fresh input');
      return { probabilities: { false: 1-p, true:p }, meta: { model: 'test', backend: 'vllm', input_tokens: 50, output_tokens:1 } };
    });
    const output = await systemOneOneForward(engine, { state: { feedback: { text:'fresh input' } }, problem: { renamed: question } });
    assert.equal(output.answers.renamed.choice, expected);
    assert.equal(output.answers.renamed.confidence, null);
    assert.equal(output.meta.calibrated, false);
    assert.equal(output.usage.input_tokens, 100);
    assert.equal(output.usage.output_tokens, 2);
    assert.equal(output.meta.questions, 1);
    assert.equal(output.meta.inference_requests, 2);
    assert.equal(output.meta.profile.per_question[0].subrequests.length, 2);
    assert.ok(Math.abs(Object.values(output.answers.renamed.probabilities).reduce((s,v)=>s+v,0)-1)<1e-10);
  }
  assert.deepEqual(sentimentDistribution(.5,.5), { positive:.25,negative:.25,mixed:.25,neutral:.25 });
});

test('decomposed subrequests share the concurrency limit and drain on failure', async () => {
  let active=0,peak=0,calls=0;
  const engine=mockEngine(async () => {
    active++; peak=Math.max(peak,active); calls++;
    await new Promise(resolve=>setTimeout(resolve,3)); active--;
    return { probabilities:{false:.2,true:.8},meta:{model:'test',backend:'vllm',output_tokens:1} };
  });
  const input={state:'sample',problem:Object.fromEntries(Array.from({length:16},(_,i)=>['field'+i,question]))};
  const output=await systemOneOneForward(engine,input,{concurrency:3});
  assert.equal(peak,3); assert.equal(calls,32); assert.equal(active,0);
  assert.equal(output.usage.output_tokens,32);
  calls=0;
  engine.inferLabels=async()=>{
    const first=calls++===0;
    active++;
    await new Promise(resolve=>setTimeout(resolve,first?1:10));active--;
    if(first)throw Error('model failed');
    return { probabilities:{false:.2,true:.8},meta:{model:'test'} };
  };
  await assert.rejects(systemOneOneForward(engine,input,{concurrency:2}),/model failed/);
  assert.equal(active,0);assert.equal(calls,2);
});

test('invalid binary output fails and direct rollback uses a single request', async () => {
  const input={state:'x',problem:{sentiment:question}};
  const engine=mockEngine(async()=>({probabilities:{false:.8,true:.8},meta:{model:'test'}}));
  await assert.rejects(systemOneOneForward(engine,input),e=>e.code==='INVALID_DISTRIBUTION');
  let calls=0;
  engine.inferLabels=async p=>{calls++;assert.equal(p.labels.length,4);return { probabilities:{positive:.9,negative:.02,mixed:.03,neutral:.05},meta:{model:'test',output_tokens:1} };};
  const result=await systemOneOneForward(engine,input,{sentimentStrategy:'direct'});
  assert.equal(calls,1);assert.equal(result.answers.sentiment.choice,'positive');
  assert.equal(result.meta.probability_method,'conditional_label_token_logits');
});
