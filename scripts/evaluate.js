import { readFile, mkdir, writeFile } from 'node:fs/promises';
const base = process.env.URJEV_URL || 'http://127.0.0.1:15413';
const cases = (await readFile(process.argv[2] || 'examples/eval.jsonl', 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const task = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : { mode: 'classify', labels: ['退款申請', '物流查詢', '產品問題'] };
if (task.mode !== 'classify') throw new Error('Evaluation currently supports classification tasks only.');
if (!cases.length) throw new Error('No evaluation cases.');
const rows = [];
for (const item of cases) {
  try {
    const response = await fetch(`${base}/api/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...task, text: item.text }), signal: AbortSignal.timeout(180000) });
    const result = await response.json();
    rows.push({ ...item, ok: response.ok && result.result?.label === item.expected, ...result });
  } catch (error) { rows.push({ ...item, ok: false, error: { message: error.message } }); }
  console.log(`${rows.at(-1).ok ? 'PASS' : 'FAIL'} ${item.text}`);
}
const times = rows.filter(r => r.meta).map(r => r.meta.latency_ms).sort((a, b) => a - b);
const percentile = p => times.length ? times[Math.max(0, Math.ceil(times.length * p) - 1)] : null;
const report = { created_at: new Date().toISOString(), cases: rows.length, correct: rows.filter(r => r.ok).length, accuracy: rows.filter(r => r.ok).length / rows.length, errors: rows.filter(r => r.error).length, p50_ms: percentile(.5), p95_ms: percentile(.95), note: 'Small smoke-test set, not a production accuracy estimate. Includes first-request model load; no application result cache.', rows };
await mkdir('reports', { recursive: true });
await writeFile('reports/evaluation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
if (report.errors) process.exitCode = 1;
