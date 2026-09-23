import test from 'node:test';
import assert from 'node:assert/strict';
import { GOAL,validBoard,solved,legalMoves,moveBoard,shuffle,puzzlePayload,runPuzzle } from '../public/puzzle-core.js';
import { createApp } from '../src/server.js';
test('seeded puzzles remain reachable, deterministic and do not start solved',()=>{
  for(let seed=0;seed<100;seed++){
    const {board}=shuffle(seed,60);
    assert.equal(validBoard(board),true);assert.equal(solved(board),false);
    assert.deepEqual(shuffle(seed,60).board,board);
    const tiles=board.filter(Boolean);let inversions=0;
    tiles.forEach((n,i)=>tiles.slice(i+1).forEach(m=>{if(n>m)inversions++;}));
    assert.equal(inversions%2,0);
  }
  assert.throws(()=>shuffle(NaN,8));assert.throws(()=>shuffle(1,0));
});
test('blank direction, row boundaries, independent boards and legal-only options',()=>{
  assert.deepEqual(legalMoves(GOAL).map(m=>m.direction),['up','left']);
  assert.throws(()=>moveBoard(GOAL,'right'));
  const board=moveBoard(GOAL,'left');assert.equal(board[8],8);assert.equal(board[7],0);
  assert.deepEqual(moveBoard(board,'right'),GOAL);assert.equal(GOAL[8],0);
  const a=[...board],b=[...board];a[0]=99;assert.equal(b[0],1);
  const payload=puzzlePayload(board);assert.equal(payload.state.board.length,3);
  assert.deepEqual(Object.keys(payload.questions.move.criteria),legalMoves(board).map(m=>m.direction));
  assert.equal('solution' in payload.state,false);
});
test('a provider-selected winning move is recorded and invalid responses are never replaced',async()=>{
  const initial=moveBoard(GOAL,'left');let clock=0;
  const result=await runPuzzle({initial,maxSteps:10,maxMs:100,now:()=>clock,request:async()=>{clock+=12;return {choice:'right'};}});
  assert.equal(result.status,'solved');assert.equal(result.moves.length,1);assert.equal(result.moves[0].request_ms,12);
  assert.deepEqual(result.moves[0].before,initial);assert.deepEqual(result.board,GOAL);
  const failed=await runPuzzle({initial,maxSteps:10,maxMs:100,request:async()=>({choice:'teleport'})});
  assert.equal(failed.status,'error');assert.equal(failed.requests,1);assert.equal(failed.moves.length,0);assert.deepEqual(failed.board,initial);
});
test('looping models obey budgets; cancellation and late responses cannot move a board',async()=>{
  const initial=moveBoard(GOAL,'up');let calls=0;
  const loop=await runPuzzle({initial,maxSteps:4,maxMs:1000,request:async()=>({choice:calls++%2===0?'left':'right'})});
  assert.ok(['step_limit','cycle_limit'].includes(loop.status));assert.ok(loop.requests<=4);assert.ok(loop.repeats>0);
  let clock=0;
  const late=await runPuzzle({initial,maxSteps:4,maxMs:10,now:()=>clock,request:async()=>{clock=11;return {choice:'down'};}});
  assert.equal(late.status,'time_limit');assert.equal(late.moves.length,0);
  const controller=new AbortController();
  const stopped=await runPuzzle({initial,maxSteps:4,maxMs:1000,signal:controller.signal,request:async()=>{controller.abort();return {choice:'down'};}});
  assert.equal(stopped.status,'stopped');assert.equal(stopped.moves.length,0);
});
test('two races use the same first state and can progress independently',async()=>{
  const initial=moveBoard(GOAL,'up');const payloads=[];
  const run=(choice)=>runPuzzle({initial:[...initial],maxSteps:1,maxMs:1000,started:0,now:()=>1,request:async p=>{payloads.push(p);return {choice};}});
  const [a,b]=await Promise.all([run('down'),run('left')]);
  assert.deepEqual(payloads[0],payloads[1]);assert.equal(a.status,'solved');assert.equal(b.status,'step_limit');assert.notDeepEqual(a.board,b.board);
});
test('puzzle route and assets load without API calls',async t=>{
  let calls=0;const server=createApp({}, {jevFetch:async()=>{calls++;throw Error('unexpected API');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  for(const path of ['/puzzle','/puzzle.js','/puzzle-core.js','/puzzle.css']){
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`);assert.equal(response.status,200);assert.ok((await response.text()).length>100);
  }
  assert.equal(calls,0);
});
