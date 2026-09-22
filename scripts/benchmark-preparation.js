import {performance} from 'node:perf_hooks';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createEngine} from '../src/engine.js';
import {systemOne} from '../src/systemone.js';
const name=process.argv[2];
if(!/^[a-z0-9-]+$/.test(name||'')) throw Error('Provide a report name');
const input=JSON.parse(await readFile(new URL('../examples/feedback-systemone.json',import.meta.url)));
const engine=createEngine({backend:'vllm'}),rows=[];
for(let i=-2;i<12;i++){
 const start=performance.now();const result=await systemOne(engine,input);
 const wall=performance.now()-start;
 rows.push({round:i,wall_ms:wall,preparation_ms:wall-result.meta.latency_ms,result});
 console.log(JSON.stringify({round:i,wall_ms:Math.round(wall),preparation_ms:Math.round(wall-result.meta.latency_ms)}));
}
await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
await writeFile(new URL(`../reports/${name}.json`,import.meta.url),JSON.stringify(rows,null,2));
const times=rows.filter(r=>r.round>=0).map(r=>r.wall_ms).sort((a,b)=>a-b);
console.log(JSON.stringify({name,min:times[0],median:(times[5]+times[6])/2,max:times.at(-1)}));
