import { createEngine } from '../src/engine.js';
import { systemOne } from '../src/systemone.js';
import { readFile,writeFile } from 'node:fs/promises';
const url = process.argv[2] || 'http://127.0.0.1:18001';
const engine = createEngine({backend:'vllm',url,timeout:30000});
const fixture = JSON.parse(await readFile(new URL('../examples/feedback-systemone.json',import.meta.url)));
const rows=[];
for(let i=0;i<15;i++) {
 const input=structuredClone(fixture);
 input.state.feedback.id=`STABILITY-${i}`;
 const concurrency=[1,2,4][i%3];
 const result=await systemOne(engine,input,{concurrency});
 const a=result.answers;
 const passed=a.main_topic.choice==='technical' && a.refund_requested.noul>=.6 && a.expressed_churn_intent.noul>=.6 && a.expressed_frustration.score>=1.5 && a.expressed_frustration.score<=2.5;
 rows.push({round:i,concurrency,passed,result});
 console.log(JSON.stringify({round:i,concurrency,passed,ms:result.meta.latency_ms}));
 await writeFile(new URL('../reports/xpu-stability.json',import.meta.url),JSON.stringify(rows,null,2));
}
// Distinct short inputs ensure reused caches do not substitute previous answers.
for(const [text,expected] of [['I want my money back.','refund'],['Where is my parcel?','shipping'],['The package has not arrived.','shipping'],['Please refund this purchase.','refund']]) {
 const result=await engine.decide({mode:'classify',text,labels:['refund','shipping']});
 const passed=result.result.label===expected;
 rows.push({text,expected,passed,result});
 console.log(JSON.stringify({text,passed,result:result.result}));
 await writeFile(new URL('../reports/xpu-stability.json',import.meta.url),JSON.stringify(rows,null,2));
}
if(rows.some(r=>!r.passed)) process.exitCode=1;
