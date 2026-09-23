import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createEngine} from '../src/engine.js';
import {systemOne,systemOneOneForward} from '../src/systemone.js';
const fixture=JSON.parse(await readFile(new URL('../examples/feedback-systemone.json',import.meta.url)));
const cases=[
 [fixture.state.feedback.text,'mixed',true,true],
 ['內容很實用，但影片一直卡住，請改善。','mixed',false,false],
 ['影片常常卡住，不過老師的講解非常清楚。','mixed',false,false],
 ['客服很親切，但是問題到現在都沒解決。','mixed',false,false],
 ['課程內容很實用，影片播放順暢，我會繼續訂閱。','positive',false,false],
 ['影片無法播放，請退款，我不再續訂。','negative',true,true],
 ['請問下個月會新增哪些課程？','neutral',false,false],
 ['月費太貴，我決定不續訂，但不需要退款。','negative',false,true],
 ['客服很有耐心，已解決我的問題，謝謝。','positive',false,false],
 ['我沒有要取消訂閱，只想詢問退款政策。','neutral',false,false],
 ['如果明天還不能播放，我就取消訂閱。','negative',false,true],
 ['問題已經修好了，我不退費，也會繼續使用。','positive',false,false],
 ['不是說課程很好，內容其實很差。','negative',false,false],
 ['雖然有十堂課，但我尚未觀看。','neutral',false,false],
 ['我可以申請退費嗎？訂閱我仍想保留。','neutral',true,false],
 ['內容不錯，沒有播放問題，也不打算取消。','positive',false,false],
];
if(process.argv.includes('--holdout')) cases.splice(0,cases.length,
 ['教材條理清楚，可是字幕錯字很多。','mixed',false,false],
 ['我很喜歡老師的教法，但客服的態度令人失望。','mixed',false,false],
 ['雖然我用手機上課，但操作一切正常，非常滿意。','positive',false,false],
 ['我並不覺得內容實用，影片也很難看。','negative',false,false],
 ['我只是查詢取消訂閱的步驟，還沒有決定要取消。','neutral',false,false],
 ['請把這期費用退還給我，我仍然會續訂下個月。','neutral',true,false],
 ['老師教得很好，如果播放故障繼續發生，我將停止使用。','mixed',false,true],
 ['The lessons are excellent, but the player keeps freezing.','mixed',false,false],
 );
const name=process.argv[2]||'accuracy';
if(!/^[a-z0-9-]+$/.test(name))throw Error('Invalid report name');
const engine=createEngine({backend:'vllm'}),rows=[];
const run=process.argv.includes('--oneforward')?systemOneOneForward:systemOne;
for(const [text,...expected] of cases){
 const input=structuredClone(fixture);input.state.feedback.text=text;
 const result=await run(engine,input);
 const a=result.answers,actual=[a.sentiment.choice,a.refund_requested.noul>=.6,a.expressed_churn_intent.noul>=.6];
 const checks=expected.map((v,i)=>v===actual[i]);
 rows.push({text,expected,actual,checks,result});
 console.log(JSON.stringify({actual,expected,ms:result.meta.latency_ms}));
}
await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
await writeFile(new URL(`../reports/${name}.json`,import.meta.url),JSON.stringify(rows,null,2));
console.log({passed:rows.flatMap(r=>r.checks).filter(Boolean).length,total:rows.length*3});
