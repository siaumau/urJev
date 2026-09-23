import { GOAL, goalForSize, shuffle, runPuzzle, distance, planNextMove } from './puzzle-core.js';
const $ = id => document.getElementById(id);
const names = { urjev:'urJev', jev:'Jev' };
const statuses = { waiting:'等待開始',running:'解題中',solved:'完成！',stopped:'已停止',step_limit:'達步數上限',time_limit:'達時間上限',cycle_limit:'模型陷入循環',error:'請求失敗',unused:'未參賽' };
const dirs = {up:'上',down:'下',left:'左',right:'右'};
let initial, generatedSteps, currentGoal=GOAL, running=false, controller, results={}, report=null, localModel='讀取模型中…', started=0;
const ms = n => Number.isFinite(n) ? Math.round(n)+' ms' : '—';
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function paint(board,node){node.style.gridTemplateColumns=`repeat(${Math.sqrt(board.length)},1fr)`;node.replaceChildren(...board.map((n,i)=>{const tile=element('div',n||'',`tile${n===0?' blank':n===currentGoal[i]?' correct':''}`);tile.setAttribute('aria-label',n?'數字 '+n:'空格');return tile;}));}
for(const provider of Object.keys(names)){
  const side=element('article',undefined,'side'), heading=element('div',undefined,'heading');
  const pill=element('span','等待開始','pill');pill.id=provider+'-status';heading.append(element('h2',names[provider]),pill);
  const model=element('p',provider==='urjev'?localModel:'jev-latest','model');model.id=provider+'-model-name';
  const board=element('div',undefined,'board');board.id=provider+'-board';board.setAttribute('aria-label',names[provider]+' 拼圖');
  const metrics=element('div',undefined,'metrics');
  for(const [key,label] of [['steps','已走步數'],['requests','已發請求'],['total','總經過時間'],['last','上一步回應'],['mean','平均回應'],['repeats','重複盤面']]){const box=element('div',undefined,'metric');const value=element('strong','—');value.id=provider+'-'+key;box.append(element('span',label),value);metrics.append(box);}
  const progress=element('p','', 'model');progress.id=provider+'-progress';
  const error=element('p','', 'error');error.id=provider+'-error';
  const detail=element('details');detail.append(element('summary','逐步紀錄'));const log=element('div',undefined,'log');log.id=provider+'-log';detail.append(log);
  side.append(heading,model,board,metrics,progress,error,detail);$('arena').append(side);
}
paint(GOAL,$('goal'));
function render(provider,result){
  paint(result.board,$(provider+'-board'));
  $(provider+'-status').textContent=statuses[result.status];
  $(provider+'-steps').textContent=result.moves.length;
  $(provider+'-requests').textContent=result.requests;
  $(provider+'-total').textContent=((result.status==='running'?performance.now()-started:result.elapsed_ms)/1000).toFixed(2)+' s';
  $(provider+'-last').textContent=ms(result.moves.at(-1)?.request_ms);
  $(provider+'-mean').textContent=ms(result.moves.length?result.moves.reduce((s,m)=>s+m.request_ms,0)/result.moves.length:null);
  $(provider+'-repeats').textContent=result.repeats;
  $(provider+'-progress').textContent=`已歸位 ${result.board.filter((n,i)=>n!==0&&n===currentGoal[i]).length} / ${currentGoal.length-1} · 格距 ${distance(result.board)}（僅供觀察，不作勝負）`;
  $(provider+'-error').textContent=result.error||'';
  $(provider+'-log').replaceChildren(...result.moves.map(m=>element('div',`${m.step}. 空格向${dirs[m.direction]}，交換 ${m.tile} · ${ms(m.request_ms)}${m.repeated?' · 重複盤面':''}`)));
}
function preview(){
  if(running)return;
  try{if(!$('seed').value.trim())throw Error('請輸入盤面編號');const size=Number($('size').value);currentGoal=goalForSize(size);const generated=shuffle(Number($('seed').value),Number($('scramble').value),size);initial=generated.board;generatedSteps=generated.steps;report=null;$('export').disabled=true;paint(currentGoal,$('goal'));
    for(const p of Object.keys(names)){results[p]={board:[...initial],status:'waiting',moves:[],requests:0,repeats:0,elapsed_ms:0};render(p,results[p]);}
    $('notice').textContent=`盤面 ${$('seed').value} · 合法打亂 ${generatedSteps} 次。兩邊起始盤面相同，按開始才送出請求。`;
  }catch(e){initial=null;$('notice').textContent=e.message;}
}
function controls(on){running=on;for(const id of ['start','local','generate','seed','size','planner','scramble','limit','seconds','key','jev-model'])$(id).disabled=on;$('stop').disabled=!on;$('export').disabled=on||!report;}
async function request(provider,payload,timeout,key,model,signal){
  if(provider==='urjev' && $('planner')?.value==='planner'){const board=payload.state.board.flat();return {choice:planNextMove(board),model:'urJev planner',provider_ms:0,usage:null};}
  const response=await fetch(provider==='urjev'?'/v1/systemone/oneforward':'/api/benchmark/jev',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.ceil(timeout)))]),
    body:JSON.stringify(provider==='urjev'?payload:{api_key:key,payload:{...payload,model}})
  });
  if(!response.ok)throw Error(`${names[provider]} HTTP ${response.status}；請檢查模型、API key 或額度`);
  const body=await response.json(),result=provider==='urjev'?body:body.result;
  return {choice:result?.answers?.move?.choice,model:result?.meta?.model??result?.model,provider_ms:provider==='urjev'?result?.meta?.server_ms:body.upstream_ms,usage:result?.usage};
}
function outcome(providers){
  if(providers.length===1){$('notice').textContent=results.urjev.status==='solved'?'urJev 已完成。本次只跑單邊，不判定勝負。':running?'urJev 單邊測試中，不判定勝負。':'單邊測試已結束；尚未完成拼圖。';return;}
  const finished=providers.filter(p=>results[p]?.status==='solved').sort((a,b)=>results[a].elapsed_ms-results[b].elapsed_ms);
  if(finished.length){const p=finished[0];$('notice').textContent=`${names[p]} 先完成！${results[p].moves.length} 步 · ${(results[p].elapsed_ms/1000).toFixed(2)} 秒。${running?'另一邊會繼續到完成或達上限。':''}`;}
  else $('notice').textContent=running?'比賽進行中：兩邊從同一盤面出發，依各自的模型決策移動。':'兩邊都未完成，這一局沒有勝者。請查看停止原因或改用較簡單盤面。';
}
async function start(providers){
  if(running)return;
  const key=$('key').value.trim(), model=$('jev-model').value.trim()||'jev-latest';
  if(providers.includes('jev')&&!key){$('notice').textContent='請先輸入 Jev API key，再按兩邊開始。';$('config').open=true;$('key').focus();return;}
  preview();if(!initial)return;
  controls(true);controller=new AbortController();$('config').open=false;$('config-status').textContent='比賽進行中';
  $('jev-model').value=model;$('jev-model').disabled=true;
  $('jev-model-name').textContent=model;
  const maxSteps=Number($('limit').value),maxMs=Number($('seconds').value)*1000;
  const configuration={size:Math.sqrt(currentGoal.length),seed:Number($('seed').value),scramble_steps:generatedSteps,max_steps:maxSteps,max_ms:maxMs,goal:[...currentGoal],initial:[...initial],providers:[...providers],urjev_model:localModel,jev_model:model};
  for(const p of Object.keys(names))if(!providers.includes(p)){results[p].status='unused';render(p,results[p]);}
  started=performance.now();
  const timer=setInterval(()=>{for(const p of providers)if(results[p]?.status==='running')$(p+'-total').textContent=((performance.now()-started)/1000).toFixed(2)+' s';},100);
  try {
    await Promise.all(providers.map(provider=>runPuzzle({initial:[...initial],maxSteps,maxMs,started,signal:controller.signal,
      request:(payload,timeout)=>request(provider,payload,timeout,key,model,controller.signal),
      onUpdate:result=>{results[provider]=result;render(provider,result);outcome(providers);}
    })));
    report={version:1,created_at:new Date().toISOString(),mode:'model_decides_each_move',...configuration,results:Object.fromEntries(providers.map(p=>[p,results[p]]))};
  }finally{clearInterval(timer);controls(false);$('config-status').textContent='本局已結束';outcome(providers);}
}
$('start').onclick=()=>start(['urjev','jev']);$('local').onclick=()=>start(['urjev']);
$('stop').onclick=()=>{controller?.abort();$('stop').disabled=true;};
$('generate').onclick=()=>{$('seed').value=crypto.getRandomValues(new Uint32Array(1))[0];preview();};
 $('seed').onchange=preview;$('size').onchange=preview;$('scramble').onchange=preview;
$('export').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=element('a');a.href=url;a.download='urjev-puzzle-'+report.seed+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
preview();
fetch('/api/health').then(r=>r.json()).then(h=>{localModel=h.model||'無法讀取';$('urjev-model-name').textContent=localModel+(h.ready?' · 已就緒':' · 尚未就緒');}).catch(()=>{$('urjev-model-name').textContent='模型服務未連線';});
