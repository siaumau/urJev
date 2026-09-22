import { createEngine } from '../src/engine.js';
import { systemOne } from '../src/systemone.js';
import { readFile, writeFile } from 'node:fs/promises';
const name = process.argv[2] || 'baseline';
if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid report name');
const url = process.argv[3] || 'http://127.0.0.1:18001';
const engine = createEngine({ backend: 'vllm', url, timeout: 120000 });
const input = JSON.parse(await readFile(new URL('../examples/feedback-systemone.json', import.meta.url)));
const report = { name, url, checks: [], runs: [] };
for (const [prompt, expected] of [['What is 2+2? Answer with one number.', '4'], ['What is 7 times 8? Answer with one number.', '56']]) {
  const response = await fetch(url + '/v1/chat/completions', { method: 'POST', headers: {'Content-Type':'application/json'}, signal: AbortSignal.timeout(120000), body: JSON.stringify({model:'Qwen/Qwen3-4B-Instruct-2507',messages:[{role:'user',content:prompt}],temperature:0,max_tokens:16}) });
  const body = await response.json();
  const actual = body.choices?.[0]?.message?.content?.trim();
  report.checks.push({prompt,expected,actual,passed:actual===expected});
  if (actual !== expected) throw new Error('Arithmetic check failed: ' + JSON.stringify(body));
}
for (let i=0;i<3;i++) {
  const result = await systemOne(engine, input);
  report.runs.push(result);
  await writeFile(new URL(`../reports/xpu-${name}.json`,import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({name,run:i,ms:result.meta.latency_ms,tokens:result.usage.output_tokens,answers:result.answers}));
}
