import {createEngine} from '../src/engine.js';
import {systemOne} from '../src/systemone.js';
import {readFile,writeFile} from 'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('../examples/feedback-systemone.json',import.meta.url)));
const cases=[
 ['課程內容很實用，影片播放順暢，我會繼續訂閱。','positive',false,false],
 ['影片無法播放，請退款，我不再續訂。','negative',true,true],
 ['請問下個月會新增哪些課程？','neutral',false,false],
 ['月費太貴，我決定不續訂，但不需要退款。','negative',false,true],
 ['客服很有耐心，已解決我的問題，謝謝。','positive',false,false],
 ['內容很實用，但影片一直卡住，請改善。','mixed',false,false],
];
const rows=[];
for(const [text,sentiment,refund,churn] of cases) {
 for(const [label,port] of [['baseline',18000],['candidate',18001]]) {
  const input=structuredClone(fixture);input.state.feedback.text=text;
  const result=await systemOne(createEngine({backend:'vllm',url:`http://127.0.0.1:${port}`}),input,{flatWeights:label==='candidate'&&process.argv[2]==='flat'});
  const a=result.answers;
  const actual=[a.sentiment.choice,a.refund_requested.noul>=.6,a.expressed_churn_intent.noul>=.6];
  const expected=[sentiment,refund,churn];
  const checks=expected.map((x,i)=>x===actual[i]);
  rows.push({text,label,expected,actual,checks,result});
  console.log(JSON.stringify({text,label,actual,checks}));
  await writeFile(new URL(`../reports/quality-${process.argv[2]==='flat'?'flat':'named'}.json`,import.meta.url),JSON.stringify(rows,null,2));
 }
}
