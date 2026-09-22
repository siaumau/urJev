import {createEngine} from '../src/engine.js';
import {systemOne} from '../src/systemone.js';
import {readFile,writeFile} from 'node:fs/promises';
const input=JSON.parse(await readFile(new URL('../examples/feedback-systemone.json',import.meta.url)));
const name=process.argv[2] || 'comparison';
if(!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid report name');
const engines={baseline:createEngine({backend:'vllm',url:'http://127.0.0.1:18000',timeout:30000}),candidate:createEngine({backend:'vllm',url:'http://127.0.0.1:18001',timeout:30000})};
const rows=[];
for(let round=-2;round<10;round++) {
 for(const label of round%2===0?['baseline','candidate']:['candidate','baseline']) {
  const result=await systemOne(engines[label],input,{flatWeights:label==='candidate' && process.argv[3]==='flat'});
  rows.push({round,label,result});
  console.log(JSON.stringify({round,label,ms:result.meta.latency_ms,tokens:result.usage.output_tokens}));
  await writeFile(new URL(`../reports/${name}.json`,import.meta.url),JSON.stringify(rows,null,2));
 }
}
for(const label of Object.keys(engines)) {
 const times=rows.filter(r=>r.round>=0&&r.label===label).map(r=>r.result.meta.latency_ms).sort((a,b)=>a-b);
 console.log(JSON.stringify({label,min:times[0],median:(times[4]+times[5])/2,max:times.at(-1),under500:times.filter(t=>t<500).length}));
}
