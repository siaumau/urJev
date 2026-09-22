import { createEngine } from '../src/engine.js';
import { systemOne } from '../src/systemone.js';
import { readFile, writeFile } from 'node:fs/promises';
const input = JSON.parse(await readFile(new URL('../examples/feedback-systemone.json', import.meta.url), 'utf8'));
const engine = createEngine({ backend: 'vllm', timeout: 180000 });
const reports = [];
for (const [name, concurrency, compact] of [['baseline',1,false], ['parallel',4,false], ['compact',1,true], ['combined-first',4,true], ['combined-warm',4,true]]) {
  const result = await systemOne(engine, input, { concurrency, compact });
  reports.push({ name, result });
  console.log(JSON.stringify({name, ms:result.meta.latency_ms, tokens:result.usage.output_tokens, answers:result.answers}));
  await writeFile(new URL('../reports/systemone-optimization.json', import.meta.url), JSON.stringify(reports, null, 2));
}
