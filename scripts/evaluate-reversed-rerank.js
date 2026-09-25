import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createEngine } from '../src/engine.js';
import { prepareOneForwardProblems } from '../src/systemone.js';

const datasetPath = process.argv[2] ?? 'datasets/feedback-calibration-100-v2.jsonl';
const baselinePath = process.argv[3] ?? 'docs/benchmarks/accuracy/qwen3-8b-bf16-100-oneforward.json';
const outputPath = process.argv[4] ?? 'reports/reversed-option-order-rerank-100.json';
const concurrency = Math.max(1, Math.min(8, Number(process.env.RERANK_CONCURRENCY ?? 8)));

const records = (await readFile(datasetPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const baselineReport = JSON.parse(await readFile(baselinePath, 'utf8'));
const baselineRows = baselineReport.methods?.oneforward?.rows;
if (!Array.isArray(baselineRows)) throw new Error('Baseline report does not contain methods.oneforward.rows.');
const baselineById = new Map(baselineRows.map(row => [row.id, row]));
for (const record of records) {
  if (!baselineById.has(record.id)) throw new Error(`Baseline is missing ${record.id}.`);
}

const engine = createEngine({ backend: 'vllm', url: process.env.VLLM_URL, model: process.env.MODEL });
const jobs = [];
for (const record of records) {
  const plans = prepareOneForwardProblems({ state: record.state, problem: record.problem });
  for (const plan of plans) jobs.push({ record, plan });
}

let next = 0;
let completed = 0;
const reversedById = new Map(records.map(record => [record.id, { id: record.id, split: record.split, fields: {} }]));
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const mapping = await engine.candidateLabels(job.plan.keys);
    const prepared = job.plan.buildPrepared(mapping.labels);
    const prefix = '候選標籤、答案 key 與定義: ';
    const messages = structuredClone(prepared.messages);
    const lines = messages[0].content.split('\n');
    const candidateLine = lines.findIndex(line => line.startsWith(prefix));
    if (candidateLine < 0) throw new Error(`Cannot find candidate list for ${job.plan.id}.`);
    const candidates = JSON.parse(lines[candidateLine].slice(prefix.length));
    lines[candidateLine] = prefix + JSON.stringify(candidates.reverse());
    messages[0].content = lines.join('\n');
    // Only reverse the presentation order. Labels, definitions and token IDs
    // keep their original semantic mapping.
    const output = await engine.inferLabels({ ...prepared, messages, tokenIds: mapping.tokenIds });
    const probabilities = Object.fromEntries(job.plan.keys.map((key, index) => [key, output.probabilities[mapping.labels[index]]]));
    reversedById.get(job.record.id).fields[job.plan.id] = { probabilities, meta: output.meta };
    completed += 1;
    if (completed % 25 === 0 || completed === jobs.length) console.log(`reversed inference ${completed}/${jobs.length}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

const fields = Object.keys(records[0].expected);
const scalar = value => typeof value === 'boolean' ? String(value) : String(value);
const argmax = probabilities => Object.entries(probabilities).reduce((best, item) => item[1] > best[1] ? item : best)[0];
const blend = (left, right, originalWeight) => Object.fromEntries(Object.keys(left).map(key => [key, originalWeight * left[key] + (1 - originalWeight) * right[key]]));
const margin = probabilities => {
  const values = Object.values(probabilities).sort((a, b) => b - a);
  return values[0] - values[1];
};

function evaluate(strategy) {
  const splits = ['calibration', 'validation', 'test', 'all'];
  return Object.fromEntries(splits.map(split => {
    const selected = records.filter(record => split === 'all' || record.split === split);
    const byField = {};
    let correct = 0;
    let total = 0;
    let changed = 0;
    let corrected = 0;
    let broken = 0;
    for (const field of fields) {
      let fieldCorrect = 0;
      let fieldChanged = 0;
      let fieldCorrected = 0;
      let fieldBroken = 0;
      for (const record of selected) {
        const original = baselineById.get(record.id).probabilities[field];
        const reversed = reversedById.get(record.id).fields[field].probabilities;
        const before = argmax(original);
        const after = argmax(strategy({ original, reversed, field, record }));
        const expected = scalar(record.expected[field]);
        fieldCorrect += Number(after === expected);
        if (after !== before) {
          fieldChanged += 1;
          fieldCorrected += Number(after === expected && before !== expected);
          fieldBroken += Number(after !== expected && before === expected);
        }
      }
      byField[field] = { correct: fieldCorrect, total: selected.length, accuracy: fieldCorrect / selected.length, changed: fieldChanged, corrected: fieldCorrected, broken: fieldBroken };
      correct += fieldCorrect;
      total += selected.length;
      changed += fieldChanged;
      corrected += fieldCorrected;
      broken += fieldBroken;
    }
    return [split, { correct, total, accuracy: correct / total, changed, corrected, broken, by_field: byField }];
  }));
}

const strategies = {
  baseline: evaluate(({ original }) => original),
  reversed_only: evaluate(({ reversed }) => reversed),
  equal_weight_always: evaluate(({ original, reversed }) => blend(original, reversed, 0.5)),
  main_topic_equal_weight: evaluate(({ original, reversed, field }) => field === 'main_topic' ? blend(original, reversed, 0.5) : original),
  main_topic_and_sentiment_equal_weight: evaluate(({ original, reversed, field }) => ['main_topic', 'sentiment'].includes(field) ? blend(original, reversed, 0.5) : original),
};

const grid = [];
for (const threshold of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
  for (const originalWeight of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const metrics = evaluate(({ original, reversed }) => margin(original) <= threshold ? blend(original, reversed, originalWeight) : original);
    grid.push({ threshold, original_weight: originalWeight, metrics });
  }
}
grid.sort((a, b) =>
  b.metrics.calibration.accuracy - a.metrics.calibration.accuracy ||
  b.metrics.validation.accuracy - a.metrics.validation.accuracy ||
  a.metrics.calibration.changed - b.metrics.calibration.changed ||
  Math.abs(a.original_weight - 0.5) - Math.abs(b.original_weight - 0.5) ||
  a.threshold - b.threshold
);
const tuned = grid[0];
strategies.calibration_tuned = tuned.metrics;

let eitherCorrect = 0;
let bothWrong = 0;
let disagreements = 0;
let originalWins = 0;
let reversedWins = 0;
for (const record of records) for (const field of fields) {
  const expected = scalar(record.expected[field]);
  const original = argmax(baselineById.get(record.id).probabilities[field]);
  const reversed = argmax(reversedById.get(record.id).fields[field].probabilities);
  eitherCorrect += Number(original === expected || reversed === expected);
  bothWrong += Number(original !== expected && reversed !== expected);
  disagreements += Number(original !== reversed);
  originalWins += Number(original === expected && reversed !== expected);
  reversedWins += Number(reversed === expected && original !== expected);
}

const latency = [...reversedById.values()].flatMap(row => Object.values(row.fields).map(field => field.meta.latency_ms)).sort((a, b) => a - b);
const percentile = p => latency[Math.min(latency.length - 1, Math.floor((latency.length - 1) * p))];
const report = {
  created_at: new Date().toISOString(),
  model: process.env.MODEL,
  dataset: datasetPath,
  baseline: baselinePath,
  method: 'Reverse only the candidate presentation order, rerun once, then linearly blend semantic probabilities only when the original top-two margin is below a threshold.',
  selection_rule: 'Tune threshold and original weight on calibration; validation is only reported as a gate; test is untouched by selection.',
  tuned_parameters: { threshold: tuned.threshold, original_weight: tuned.original_weight, reversed_weight: 1 - tuned.original_weight },
  strategies,
  disagreement_analysis: { total_decisions: records.length * fields.length, disagreements, original_only_correct: originalWins, reversed_only_correct: reversedWins, either_correct: eitherCorrect, both_wrong: bothWrong, oracle_accuracy: eitherCorrect / (records.length * fields.length) },
  reversed_request_latency_ms: { count: latency.length, p50: percentile(0.5), p95: percentile(0.95), mean: latency.reduce((sum, value) => sum + value, 0) / latency.length },
  grid: grid.map(item => ({ threshold: item.threshold, original_weight: item.original_weight, calibration_accuracy: item.metrics.calibration.accuracy, validation_accuracy: item.metrics.validation.accuracy, test_accuracy: item.metrics.test.accuracy, all_accuracy: item.metrics.all.accuracy, changed_all: item.metrics.all.changed, corrected_all: item.metrics.all.corrected, broken_all: item.metrics.all.broken })),
  rows: [...reversedById.values()],
};
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: outputPath, tuned_parameters: report.tuned_parameters, strategies: Object.fromEntries(Object.entries(strategies).map(([name, metrics]) => [name, Object.fromEntries(Object.entries(metrics).map(([split, value]) => [split, { accuracy: value.accuracy, changed: value.changed, corrected: value.corrected, broken: value.broken }]))])), disagreement_analysis: report.disagreement_analysis, reversed_request_latency_ms: report.reversed_request_latency_ms }, null, 2));
