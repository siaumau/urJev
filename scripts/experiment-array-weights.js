// Experimental only: keep production inference unchanged until quality is checked.
import Ajv from 'ajv';
import {createEngine} from '../src/engine.js';
import {systemOne} from '../src/systemone.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('../examples/feedback-systemone.json',import.meta.url)));
const integer=process.argv.includes('--integer');
const regex=process.argv.includes('--regex');
const base=createEngine({backend:'vllm'});
const constrained=createEngine({backend:'vllm',fetchImpl:(url,options)=>{
 const body=JSON.parse(options.body);
 const n=body.response_format.json_schema.schema.minItems;
 delete body.response_format;
 const number='(100|[1-9][0-9]?|0)';
 body.structured_outputs={regex:'\\['+number+(','+number).repeat(n-1)+'\\]'};
 return fetch(url,{...options,body:JSON.stringify(body)});
}});
const candidate={backend:'vllm',async infer(prepared){
 const keys=prepared.schema.required;
 const schema={type:'array',items:{type:integer?'integer':'number',minimum:0,maximum:100},minItems:keys.length,maxItems:keys.length};
 const messages=structuredClone(prepared.messages);
 messages[0].content=messages[0].content.split('\nOutput schema:')[0]
  .replace('直接輸出選項與權重的 JSON 物件（不要額外包 weights 欄位）','輸出 JSON 數字陣列')
  + '\n陣列位置依序對應這些選項：'+JSON.stringify(keys)+'。每一格為對應選項的權重。\nOutput schema: '+JSON.stringify(schema)+'\n使用緊湊 JSON，不要空白或換行。';
 if(integer) messages[0].content+='\n權重只能是 0 到 100 的整數，不要小數。';
 const out=await (regex?constrained:base).infer({schema,messages,validate:new Ajv().compile(schema)});
 return {...out,result:Object.fromEntries(keys.map((k,i)=>[k,out.result[i]]))};
}};
const rows=[];
await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
async function run(input,label,round,expected){
 const result=await systemOne(label==='array'?candidate:base,input);
 const a=result.answers;
 const actual=[a.sentiment.choice,a.refund_requested.noul>=.6,a.expressed_churn_intent.noul>=.6];
 const checks=expected?.map((x,i)=>x===actual[i]);
 rows.push({round,label,result,expected,actual,checks});
 result.meta.output_format=label==='array'?(regex?'experimental_regex_integer_array':integer?'experimental_integer_array':'experimental_number_array'):'flat_named_weights';
 console.log(JSON.stringify({round,label,ms:result.meta.latency_ms,tokens:result.usage.output_tokens,actual,checks}));
 await writeFile(new URL(regex?'../reports/regex-array-weights.json':integer?'../reports/integer-array-weights.json':'../reports/array-weights.json',import.meta.url),JSON.stringify(rows,null,2));
}
for(let i=-2;i<10;i++) for(const label of i%2===0?['named','array']:['array','named']) await run(fixture,label,i);
for(const label of ['named','array']) {
 const times=rows.filter(r=>r.round>=0&&r.label===label).map(r=>r.result.meta.latency_ms).sort((a,b)=>a-b);
 console.log(JSON.stringify({label,min:times[0],median:(times[4]+times[5])/2,max:times.at(-1),under400:times.filter(t=>t<400).length}));
}
const cases=[
 ['課程內容很實用，影片播放順暢，我會繼續訂閱。','positive',false,false],
 ['影片無法播放，請退款，我不再續訂。','negative',true,true],
 ['請問下個月會新增哪些課程？','neutral',false,false],
 ['月費太貴，我決定不續訂，但不需要退款。','negative',false,true],
 ['客服很有耐心，已解決我的問題，謝謝。','positive',false,false],
 ['內容很實用，但影片一直卡住，請改善。','mixed',false,false],
];
for(const [text,...expected] of cases){
 const input=structuredClone(fixture);input.state.feedback.text=text;
 for(const label of ['named','array']) await run(input,label,'quality',expected);
}


