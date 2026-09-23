import { feedbackExample } from './feedback-example.js';
import { parseEditor, cleanEscapes } from './json-input.js';
const $ = id => document.getElementById(id);
let lastResult = null;
const titles = {main_topic:'主要問題',sentiment:'回饋情緒',refund_requested:'退款意圖',expressed_churn_intent:'停止續訂意圖',expressed_frustration:'表達的不滿程度'};
const labels = {technical:'技術問題',content:'內容問題',pricing:'價格方案',service:'客服處理',other:'其他',positive:'正面',negative:'負面',mixed:'肯定與不滿並存',neutral:'中性／沒有明確評價'};
const describe = x => typeof x === 'string' ? x : x == null ? '' : JSON.stringify(x);
function task(){return {state:parseEditor($('state').value,'State'),questions:parseEditor($('problem').value,'Problem')};}
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function bar(value,label){const row=el('div',undefined,'bar-row');row.append(el('span',label),el('span',`${Math.round(value*100)}%`));const p=document.createElement('progress');p.max=1;p.value=value;p.setAttribute('aria-label',label);row.append(p);return row;}
function render(data,questions){
 $('cards').replaceChildren(el('p','以下是模型判斷，可能誤判。百分比是未校準的模型估計，不代表正確率。','estimate-note'));
 for(const [id,a] of Object.entries(data.answers)){
  const q=questions[id]||{}, card=el('details',undefined,'answer-card');
  const summary=el('summary',undefined,'answer-summary');
  const value=a.type==='choice'?(labels[a.choice]||a.choice):a.type==='noul'?(a.noul>=.6?'傾向是':a.noul<=.4?'傾向否':'不確定'):`${Number(a.score.toFixed(2))} / ${Object.keys(a.legend).length-1}`;
  summary.append(el('span',titles[id]||id,'answer-title'),el('strong',value,'answer-inline'));
  card.append(summary);
  const body=el('div',undefined,'answer-body');body.append(el('p',describe(q.instructions),'question-caption'));
  const decision=data.meta.profile?.per_question?.find(item=>item.question_id===id);
  if(decision?.decision_method==='sentiment_binary_factors')body.append(el('p','分別檢查明確肯定與明確不滿，再合併判斷。下方比例是組合估計，尚未校準。','question-caption'));
  if(a.type==='choice'){
   body.append(el('p',describe(q.criteria?.[a.choice]),'answer-description'));
   for(const [k,v] of Object.entries(a.probabilities))body.append(bar(v,labels[k]||k));
  }else if(a.type==='noul'){
   body.append(bar(a.noul,'「是」的估計值'),el('p','顯示規則：≥60% 傾向是，≤40% 傾向否；僅為介面分組。','question-caption'));
  }else if(a.type==='score'){
   const max=Object.keys(a.legend).length-1;body.append(el('p','依各等級估計權重計算的加權分數','question-caption'));
   const meter=document.createElement('meter');meter.min=0;meter.max=max;meter.value=a.score;meter.setAttribute('aria-label',titles[id]||id);body.append(meter);
   const list=el('ol',undefined,'score-levels');list.start=0;for(const [k,v] of Object.entries(a.legend))list.append(el('li',`${describe(v)} · ${Math.round(a.probabilities[k]*100)}%`));body.append(list);
  }
  card.append(body);
  $('cards').append(card);
 }
 $('cards').hidden=false;
}
function reset(){lastResult=null;$('copy').disabled=true;for(const id of ['error','cards','raw','metrics','abstain','profile'])$(id).hidden=true;$('raw').open=false;$('profile').open=false;$('empty').hidden=false;$('badge').textContent='等待輸入';}
const endpoint=()=>$('mode').value==='oneforward'?'/v1/systemone/oneforward':'/v1/systemone';
function update(){try{$('api').textContent=`POST ${endpoint()}\nContent-Type: application/json\n\n`+JSON.stringify(task(),null,2);}catch{$('api').textContent='請先修正 State／Problem 的 JSON 格式。';}}
function load(){ $('state').value=JSON.stringify(feedbackExample.state,null,2);$('problem').value=JSON.stringify(feedbackExample.questions,null,2);reset();update();}
function error(message){$('error').textContent=message;$('error').hidden=false;}
for(const id of ['state','problem'])$(id).oninput=()=>{reset();update();};
$('mode').onchange=()=>{reset();update();};
$('clean').onclick=()=>{for(const id of ['state','problem'])$(id).value=cleanEscapes($(id).value);reset();update();};
$('preset').onclick=load;
async function health(){try{const data=await(await fetch('/api/health')).json();$('model').textContent=data.model||'服務未就緒';$('status').textContent=data.message||data.error?.message;}catch{$('status').textContent='無法連線至 urJev 服務。';}}
$('run').onclick=async()=>{
 const controls=['preset','import','state','problem','clean','mode'];controls.forEach(id=>$(id).disabled=true);reset();$('empty').hidden=true;$('run').disabled=true;$('run').textContent='判斷中…';$('badge').textContent='模型推論中';
 try{const request=task();const payload=JSON.stringify(request);const path=endpoint();const requestStarted=performance.now();const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:payload});const data=await response.json();const totalMs=performance.now()-requestStarted;if(!response.ok)throw new Error(data.error?.message||'請求失敗');lastResult=data;render(data,request.questions);renderProfile(data,totalMs,new TextEncoder().encode(payload).length);$('result').textContent=JSON.stringify(data,null,2);$('raw').hidden=false;$('metrics').hidden=false;const serverMs=data.meta.server_ms;const hasServer=Number.isFinite(serverMs);$('server-time').textContent=hasServer?Math.round(serverMs)+' ms':'—';$('overhead-time').textContent=hasServer?Math.max(0,Math.round(totalMs)-Math.round(serverMs))+' ms':'—';$('latency').textContent='≈ '+Math.round(totalMs)+' ms 總等待';$('load').textContent=Number.isFinite(data.meta.load_ms)?data.meta.load_ms.toFixed(1)+' ms':'—';$('tokens').textContent=data.meta.output_tokens??'—';$('badge').textContent=`${data.meta.experimental?'OneForward · ':''}已完成 ${Object.keys(data.answers).length} 題`;$('copy').disabled=false;}catch(e){error(e.message);$('badge').textContent='未取得結果';}finally{controls.forEach(id=>$(id).disabled=false);$('run').disabled=false;$('run').textContent='執行判斷 ↗';}
};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(lastResult,null,2));$('copy').textContent='已複製';setTimeout(()=>$('copy').textContent='複製 JSON',1500);}catch{error('無法使用剪貼簿，請手動選取結果。');}};
$('export').onclick=()=>{try{const url=URL.createObjectURL(new Blob([JSON.stringify(task(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='urjev-task.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){error(e.message);}};
$('import').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>65536)throw new Error('設定檔上限為 64 KB。');const data=JSON.parse(await file.text());if(!data||!Object.hasOwn(data,'state')||(!Object.hasOwn(data,'questions')&&!Object.hasOwn(data,'problem')))throw new Error('請匯入含 State 與 questions／problem 的設定。');if(Object.hasOwn(data,'questions')&&Object.hasOwn(data,'problem'))throw new Error('questions 與 problem 請擇一。');$('state').value=JSON.stringify(data.state,null,2);$('problem').value=JSON.stringify(data.questions??data.problem,null,2);reset();update();}catch(e){error(e.message);}finally{event.target.value='';}};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!$('run').disabled)$('run').click();});
$('refresh').onclick=health;load();health();

const fmt=(v,unit=' ms')=>Number.isFinite(v)?v.toFixed(2)+unit:'未提供';
function tableRows(rows){const table=el('table',undefined,'profile-table');for(const [label,value] of rows){const row=el('tr');row.append(el('th',label),el('td',value));table.append(row);}return table;}
function renderProfile(data,totalMs,requestBytes){
 const p=data.meta.profile||{}, server=data.meta.server_ms;
 const residual=(whole,parts)=>Number.isFinite(whole)&&parts.every(Number.isFinite)?Math.max(0,whole-parts.reduce((a,b)=>a+b,0)):null;
 const rows=[['瀏覽器總等待（含回應解析）',fmt(totalMs)],['傳輸／瀏覽器額外耗時（差值）',fmt(residual(totalMs,[server]))],['伺服器處理總時間',fmt(server)],['應用層與本地通訊（差值）',fmt(residual(server,[p.model_ms]))],['推論引擎各題總耗時合計',fmt(p.model_ms)],['↳ 模型載入合計',fmt(p.load_ms)],['↳ 輸入處理／Prefill 合計',fmt(p.prompt_ms)],['↳ 輸出生成／Decode 合計',fmt(p.generation_ms)],['↳ 推論引擎其餘時間（差值）',fmt(residual(p.model_ms,[p.load_ms,p.prompt_ms,p.generation_ms]))],['輸入 tokens 合計',p.input_tokens??'未提供'],['其中快取輸入 tokens',p.cached_input_tokens??'未提供'],['輸出 tokens 合計',p.output_tokens??'未提供'],['生成速度（總 tokens ÷ 總生成秒數）',fmt(p.output_tokens_per_second,' tokens/s')],['送出 JSON 大小（UTF-8）',requestBytes+' bytes']];
 $('profile-content').replaceChildren(tableRows(rows),el('p',(data.meta.execution==='independent_parallel'?'各題最多 '+data.meta.concurrency+' 題並行，逐題時間重疊，不能相加當成實際等待時間。':'各題循序執行。')+'縮排階段包含在上層總時間內，請勿重複相加。輸入處理可能重用快取；生成速度不含載入與 Prefill。差值含計時誤差，最低顯示 0。','note'));
 const scroll=el('div',undefined,'profile-scroll'),table=el('table',undefined,'profile-table');const header=el('tr');for(const title of ['問題','載入 ms','輸入 ms','生成 ms','引擎 ms','輸入 tokens','快取 tokens','輸出 tokens','tokens/s'])header.append(el('th',title));table.append(header);
 for(const q of p.per_question||[]){const row=el('tr');for(const value of [titles[q.question_id]||q.question_id,fmt(q.load_ms,''),fmt(q.prompt_ms,''),fmt(q.generation_ms,''),fmt(q.model_ms,''),q.input_tokens??'—',q.cached_input_tokens??'—',q.output_tokens??'—',fmt(q.output_tokens_per_second,'')])row.append(el('td',String(value)));table.append(row);}scroll.append(table);$('profile-content').append(scroll);$('profile').hidden=false;
 if(data.meta.backend==='vllm'){
  $('profile-content').append(el('p','vLLM 階段計時如下；首 token 時間包含輸入處理，與 Ollama 的 Prefill 定義不同。模型在服務啟動時載入，API 未提供逐題載入時間或記憶體配置量。','note'));
  const timingQuestions=(p.per_question||[]).flatMap(q=>q.subrequests?q.subrequests.map(s=>({...s,question_id:(titles[q.question_id]||q.question_id)+' · '+(s.factor==='positive'?'肯定判斷':'不滿判斷')})):[q]);
  for(const q of timingQuestions){const m=q.vllm_metrics||{};$('profile-content').append(el('h3',titles[q.question_id]||q.question_id),tableRows([['排隊',fmt(m.queue_time_ms)],['排程至首 token',fmt(m.time_to_first_token_ms)],['首至末 token 生成',fmt(m.generation_time_ms)],['平均 token 間隔',fmt(m.mean_itl_ms)],['含輸入處理的輸出吞吐',fmt(m.tokens_per_second,' tokens/s')]]));}
 }
 $('runtime-content').textContent='讀取推論後快照…';
 fetch('/api/runtime').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(r=>{if(lastResult!==data)return;lastResult.meta.runtime_snapshot=r;$('result').textContent=JSON.stringify(lastResult,null,2);$('runtime-content').replaceChildren(tableRows([['快照時間',r.sampled_at||'未提供'],['模型',r.model],['模型記憶體配置量',fmt(r.memory_bytes==null?null:r.memory_bytes/1073741824,' GiB')],['其中 GPU VRAM 配置',fmt(r.vram_bytes==null?null:r.vram_bytes/1073741824,' GiB')],['Context 容量',r.context_length??'未提供'],['模型參數量',r.parameters??'未提供'],['量化',r.quantization??'未提供'],['實際記憶體頻寬','未提供（不是容量，也不能從 tokens/s 直接換算）']]));}).catch(()=>{if(lastResult===data)$('runtime-content').textContent='無法讀取記憶體快照；推論結果不受影響。';});
}
