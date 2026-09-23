const $ = id => document.getElementById(id);
const fields = ['main_topic', 'sentiment', 'refund_requested', 'expressed_churn_intent', 'expressed_frustration'];
let dataset = [];
let controllers = [];
let running = false;
let exportData = null;
const cells = new Map();

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};
const formatMs = value => Number.isFinite(value) ? Math.round(value) + ' ms' : '—';
const prediction = answer => {
  if (answer.type === 'choice') return String(answer.choice);
  if (answer.type === 'noul') return String(answer.noul >= .5);
  if (answer.type === 'score' && answer.probabilities) return Object.entries(answer.probabilities).reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];
  if (answer.type === 'score') return String(Math.round(answer.score));
  return '';
};
const evaluate = (result, expected) => {
  const checks = Object.fromEntries(fields.map(field => [field, prediction(result.answers[field]) === String(expected[field])]));
  return { correct: Object.values(checks).filter(Boolean).length, total: fields.length, checks };
};
const freshStats = name => ({ name, completed: 0, correct: 0, decisions: 0, latencies: [], providerLatencies: [], inputTokens: 0, outputTokens: 0, started: null, ended: null, error: null, rows: [] });

function setState(provider, value, kind) {
  const node = $(provider + '-state');
  node.textContent = value;
  node.className = 'state-pill' + (kind ? ' ' + kind : '');
}
function renderStats(provider, stats) {
  const elapsed = stats.started ? (stats.ended || performance.now()) - stats.started : null;
  const mean = stats.latencies.length ? stats.latencies.reduce((sum, value) => sum + value, 0) / stats.latencies.length : null;
  const providerMean = stats.providerLatencies.length ? stats.providerLatencies.reduce((sum, value) => sum + value, 0) / stats.providerLatencies.length : null;
  $(provider + '-progress').textContent = stats.completed + ' / ' + dataset.length;
  $(provider + '-bar').max = dataset.length || 100;
  $(provider + '-bar').value = stats.completed;
  $(provider + '-decisions').textContent = stats.decisions + ' / ' + (dataset.length * fields.length || 500);
  $(provider + '-accuracy').textContent = stats.decisions ? (stats.correct / stats.decisions * 100).toFixed(1) + '%' : '—';
  $(provider + '-last').textContent = formatMs(stats.latencies.at(-1));
  $(provider + '-mean').textContent = formatMs(mean);
  $(provider + '-percentiles').textContent = stats.latencies.length ? formatMs(percentile(stats.latencies, .5)) + ' / ' + formatMs(percentile(stats.latencies, .95)) : '—';
  $(provider + '-total').textContent = formatMs(elapsed);
  $(provider + '-provider').textContent = formatMs(providerMean);
  $(provider + '-tokens').textContent = stats.completed ? stats.inputTokens + ' / ' + stats.outputTokens : '—';
}
function renderCell(index, provider, text, className) {
  const cell = cells.get(index)[provider];
  cell.result.textContent = text;
  cell.result.className = className || '';
}
function renderLatencyCell(index, provider, browserMs, providerMs) {
  cells.get(index)[provider].latency.textContent = formatMs(browserMs) + (Number.isFinite(providerMs) ? ' / ' + formatMs(providerMs) : '');
}
function buildRows() {
  $('records-body').replaceChildren();
  cells.clear();
  dataset.forEach((row, index) => {
    const tr = document.createElement('tr');
    const number = document.createElement('td'); number.textContent = String(index + 1);
    const id = document.createElement('td'); id.textContent = row.id;
    const urjevResult = document.createElement('td'), urjevLatency = document.createElement('td');
    const jevResult = document.createElement('td'), jevLatency = document.createElement('td');
    urjevResult.textContent = jevResult.textContent = '等待';
    urjevLatency.textContent = jevLatency.textContent = '—';
    tr.append(number, id, urjevResult, urjevLatency, jevResult, jevLatency);
    $('records-body').append(tr);
    cells.set(index, { urjev: { result: urjevResult, latency: urjevLatency }, jev: { result: jevResult, latency: jevLatency } });
  });
}
function resetProvider(provider) {
  const stats = freshStats(provider);
  renderStats(provider, stats);
  setState(provider, '等待');
  for (let index = 0; index < dataset.length; index++) {
    renderCell(index, provider, '等待');
    renderLatencyCell(index, provider, null, null);
  }
  return stats;
}

async function request(provider, row, signal) {
  const started = performance.now();
  if (provider === 'urjev') {
    const response = await fetch('/v1/systemone/oneforward', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ state: row.state, questions: row.problem })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'urJev 請求失敗');
    return { result, browserMs: performance.now() - started, providerMs: result.meta?.server_ms };
  }
  const apiKey = $('jev-key').value;
  const model = $('jev-model').value.trim() || 'jev-latest';
  const response = await fetch('/api/benchmark/jev', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ api_key: apiKey, payload: { model, state: row.state, questions: row.problem } })
  });
  const wrapped = await response.json();
  if (!response.ok) throw new Error(wrapped.error?.message || 'Jev 請求失敗');
  return { result: wrapped.result, browserMs: performance.now() - started, providerMs: wrapped.upstream_ms };
}

async function runProvider(provider, stats, controller) {
  stats.started = performance.now();
  setState(provider, '執行中', 'running');
  renderStats(provider, stats);
  try {
    for (const [index, row] of dataset.entries()) {
      if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      renderCell(index, provider, '處理中…', 'cell-running');
      const response = await request(provider, row, controller.signal);
      const check = evaluate(response.result, row.expected);
      stats.completed++;
      stats.decisions += check.total;
      stats.correct += check.correct;
      stats.latencies.push(response.browserMs);
      if (Number.isFinite(response.providerMs)) stats.providerLatencies.push(response.providerMs);
      stats.inputTokens += response.result.usage?.input_tokens || 0;
      stats.outputTokens += response.result.usage?.output_tokens || 0;
      stats.rows.push({ id: row.id, browser_ms: response.browserMs, provider_ms: response.providerMs, correct: check.correct, total: check.total, checks: check.checks, answers: response.result.answers });
      renderCell(index, provider, check.correct + ' / ' + check.total + ' 正確', check.correct === check.total ? 'cell-pass' : 'cell-partial');
      renderLatencyCell(index, provider, response.browserMs, response.providerMs);
      renderStats(provider, stats);
    }
    stats.ended = performance.now();
    setState(provider, '完成');
  } catch (error) {
    stats.ended = performance.now();
    if (error.name === 'AbortError') setState(provider, '已停止');
    else {
      stats.error = error.message;
      setState(provider, '失敗', 'failed');
      const index = stats.completed;
      if (index < dataset.length) renderCell(index, provider, error.message, 'cell-error');
      throw error;
    }
  } finally {
    renderStats(provider, stats);
  }
}

function controls(value) {
  running = value;
  $('run-both').disabled = value || !dataset.length;
  $('run-local').disabled = value || !dataset.length;
  $('stop').disabled = !value;
  $('jev-key').disabled = value;
  $('jev-model').disabled = value;
}
async function start(providers) {
  if (running) return;
  $('benchmark-error').hidden = true;
  if (providers.includes('jev') && !$('jev-key').value.trim()) {
    $('benchmark-error').textContent = '請先輸入 Jev API key。';
    $('benchmark-error').hidden = false;
    $('jev-key').focus();
    return;
  }
  controls(true);
  $('export-results').disabled = true;
  const fresh = {
    urjev: resetProvider('urjev'),
    jev: resetProvider('jev')
  };
  const stats = Object.fromEntries(providers.map(provider => [provider, fresh[provider]]));
  controllers = providers.map(() => new AbortController());
  const settled = await Promise.allSettled(providers.map((provider, index) => runProvider(provider, stats[provider], controllers[index])));
  const errors = settled.filter(item => item.status === 'rejected').map(item => item.reason.message);
  if (errors.length) {
    $('benchmark-error').textContent = errors.join('；');
    $('benchmark-error').hidden = false;
  }
  exportData = { created_at: new Date().toISOString(), dataset: 'feedback-calibration-100-v2', model: $('jev-model').value.trim() || 'jev-latest', providers: stats };
  $('export-results').disabled = false;
  controls(false);
}

$('run-local').onclick = () => start(['urjev']);
$('run-both').onclick = () => start(['urjev', 'jev']);
$('stop').onclick = () => controllers.forEach(controller => controller.abort());
$('export-results').onclick = () => {
  if (!exportData) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'urjev-vs-jev-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

try {
  const response = await fetch('/api/benchmark/dataset');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || '資料集載入失敗');
  dataset = body.rows;
  $('dataset-status').textContent = body.version + ' · ' + dataset.length + ' 筆 · ' + (dataset.length * fields.length) + ' 個判斷';
  buildRows();
  resetProvider('urjev');
  resetProvider('jev');
  controls(false);
} catch (error) {
  $('dataset-status').textContent = '資料集載入失敗';
  $('benchmark-error').textContent = error.message;
  $('benchmark-error').hidden = false;
}
