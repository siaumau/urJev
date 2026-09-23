export const SIZE = 3;
export const GOAL = Object.freeze(Array.from({ length: SIZE * SIZE }, (_, i) => (i + 1) % (SIZE * SIZE)));
export const goalForSize = size => {
  if (!Number.isInteger(size) || size < 2 || size > 10) throw Error('拼圖尺寸不合法');
  return Object.freeze(Array.from({ length: size * size }, (_, i) => (i + 1) % (size * size)));
};
export function planNextMove(board) {
  if (!validBoard(board)) throw Error('無效盤面');
  const target = goalForSize(sizeOf(board)), start = board.join(','), queue=[[board,[]]], seen=new Set([start]);
  while(queue.length){const [cur,path]=queue.shift(); if(solved(cur)) return path[0]||null; for(const m of legalMoves(cur)){const next=moveBoard(cur,m.direction), key=next.join(','); if(seen.has(key)) continue; seen.add(key); const p=[...path,m.direction]; if(solved(next)) return p[0]; if(seen.size<200000) queue.push([next,p]);}}
  return null;
}
const sizeOf = board => Math.sqrt(board.length);
export function validBoard(board) {
  const size = Array.isArray(board) ? sizeOf(board) : 0;
  return Number.isInteger(size) && size >= 2 && size <= 10 && new Set(board).size === board.length && board.every(n => Number.isInteger(n) && n >= 0 && n < board.length);
}
export const solved = board => validBoard(board) && board.every((n, i) => n === i + 1 || (i === board.length - 1 && n === 0));
export function legalMoves(board) {
  if (!validBoard(board)) throw Error('無效盤面');
  const size = sizeOf(board), at = board.indexOf(0), row = Math.floor(at / size), col = at % size;
  return [['up',row>0,at-size],['down',row<size-1,at+size],['left',col>0,at-1],['right',col<size-1,at+1]]
    .filter(([, allowed]) => allowed).map(([direction,, to]) => ({ direction, tile: board[to], to }));
}
const opposite = { up:'down', down:'up', left:'right', right:'left' };
function candidateMoves(board, history, seenBoards = new Set()) {
  const moves = legalMoves(board);
  const last = history?.at(-1)?.direction;
  let filtered = moves.filter(m => !seenBoards.has(moveBoard(board, m.direction).join(',')));
  if (last && moves.length > 1) filtered = filtered.filter(m => m.direction !== opposite[last]);
  // The structured choice schema needs at least two alternatives. Prefer
  // unseen/non-reversing moves, but never leave the model with one option.
  return filtered.length >= 2 ? filtered : (moves.filter(m => !last || m.direction !== opposite[last]).length >= 2
    ? moves.filter(m => !last || m.direction !== opposite[last]) : moves);
}
export function moveBoard(board, direction) {
  const move = legalMoves(board).find(m => m.direction === direction);
  if (!move) throw Error('模型選擇了不合法的移動');
  const next = [...board], at = next.indexOf(0);
  [next[at], next[move.to]] = [next[move.to], next[at]];
  return next;
}
export function shuffle(seed, steps, size = SIZE) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295 || !Number.isInteger(steps) || steps < 1 || steps > 500) throw Error('盤面編號或打亂次數不合法');
  const goal = goalForSize(size);
  let random = seed >>> 0, board = [...goal], previous = -1;
  for (let i = 0; i < steps; i++) {
    const choices = legalMoves(board).filter(m => m.to !== previous);
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const move = choices[Math.floor(random / 4294967296 * choices.length)];
    previous = board.indexOf(0); board = moveBoard(board, move.direction);
  }
  if (solved(board)) return { board: moveBoard(board, 'left'), steps: steps + 1 };
  return { board, steps };
}
export const distance = board => { const size=sizeOf(board); return board.reduce((s,n,i) => n ? s + Math.abs(Math.floor(i/size)-Math.floor((n-1)/size)) + Math.abs(i%size-(n-1)%size) : s, 0); };
export function puzzlePayload(board, history = [], seenBoards = new Set()) {
  const directions = { up:'上', down:'下', left:'左', right:'右' };
  const size=sizeOf(board), rows = b => Array.from({length:size},(_,r)=>b.slice(r*size,r*size+size));
  return {
    state: { board:rows(board), goal:rows(goalForSize(sizeOf(board))), blank:0, recent_moves:history.slice(-8), legal_moves:candidateMoves(board,history,seenBoards).map(m=>({direction:m.direction,tile:m.tile})) },
    questions: { move: { type:'choice', instructions:`你正在解 ${size}×${size} 數字滑塊拼圖。0 是唯一空格，一次只能與上下左右相鄰的一格交換。目標是每列由左到右排列，再由上到下，數字 1 到 ${size*size-1}，右下角為 0。選擇有助於完成整個拼圖的下一步，必要時可暫時移開已歸位數字。方向指「空格」移動方向，不是數字移動方向。若有其他合法方向，不要立刻撤銷上一個移動；優先選擇尚未出現過的盤面，避免陷入循環。只依本局盤面做決策。`, criteria:Object.fromEntries(candidateMoves(board,history,seenBoards).map(m=>[m.direction,`空格向${directions[m.direction]}移動，與數字 ${m.tile} 交換。`])) } }
  };
}
// Every accepted move must come from a provider response. No search/solver fallback.
export async function runPuzzle({ initial, maxSteps, maxMs, request, signal, onUpdate = () => {}, now = () => performance.now(), started = now() }) {
  if (!validBoard(initial) || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 500 || !Number.isFinite(maxMs) || maxMs < 1) throw Error('無效比賽設定');
  const result = { initial:[...initial], board:[...initial], status:'running', moves:[], requests:0, repeats:0, elapsed_ms:0, error:null };
  const seen = new Set([initial.join(',')]);
  try {
    while (!solved(result.board)) {
      if (signal?.aborted) { result.status='stopped'; break; }
      if (now()-started >= maxMs) { result.status='time_limit'; break; }
      if (result.moves.length >= maxSteps) { result.status='step_limit'; break; }
      const payload = puzzlePayload(result.board, result.moves.map(m=>({direction:m.direction,tile:m.tile})), seen);
      const before = [...result.board], at = now(); result.requests++; onUpdate(result);
      const response = await request(payload, Math.min(30000, maxMs-(now()-started)));
      const received = now();
      if (signal?.aborted) { result.status='stopped'; break; }
      if (received-started >= maxMs) { result.status='time_limit'; break; }
      const move = legalMoves(before).find(m=>m.direction===response.choice);
      if (!move) throw Error('回應缺少合法的 move.choice；本次已停止');
      result.board = moveBoard(before, move.direction);
      const repeated = seen.has(result.board.join(',')); if(repeated) result.repeats++;
      seen.add(result.board.join(','));
      result.moves.push({ step:result.moves.length+1, direction:move.direction, tile:move.tile, before, after:[...result.board], request_ms:received-at, elapsed_ms:received-started, repeated, model:response.model ?? null, provider_ms:response.provider_ms ?? null, usage:response.usage ?? null });
      result.elapsed_ms=received-started; onUpdate(result);
      if (result.repeats >= 3 && result.moves.slice(-3).every(m => m.repeated)) { result.status='cycle_limit'; break; }
    }
    if(solved(result.board)) result.status='solved';
  } catch(error) {
    result.status=signal?.aborted?'stopped':now()-started>=maxMs?'time_limit':'error';
    if(result.status==='error') result.error=error.message;
  }
  result.elapsed_ms=now()-started;
  onUpdate(result); return result;
}
