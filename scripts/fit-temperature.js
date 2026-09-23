import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const reportArgument = process.argv.find(argument => argument.startsWith('--report='))?.slice('--report='.length);
const reportUrl = reportArgument ? resolve(reportArgument) : new URL('../reports/feedback-calibration-100-v2-evaluation.json', import.meta.url);
const report = JSON.parse(await readFile(reportUrl, 'utf8'));
const fields = ['main_topic', 'sentiment', 'refund_requested', 'expressed_churn_intent', 'expressed_frustration'];
const key = value => String(value);

function scale(probabilities, temperature) {
  const entries = Object.entries(probabilities);
  const logits = entries.map(([, probability]) => Math.log(Math.max(1e-15, probability)) / temperature);
  const peak = Math.max(...logits);
  const weights = logits.map(logit => Math.exp(logit - peak));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(entries.map(([label], index) => [label, weights[index] / total]));
}
function samples(rows, field, temperature) {
  return rows.map(row => {
    const probabilities = scale(row.probabilities[field], temperature);
    const predicted = Object.entries(probabilities).reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];
    const expected = key(row.expected[field]);
    return { probabilities, predicted, expected, correct: predicted === expected };
  });
}
const nll = values => values.reduce((sum, sample) => sum - Math.log(Math.max(1e-15, sample.probabilities[sample.expected] ?? 0)), 0) / values.length;
function fitTemperature(rows, field) {
  let left = -5, right = 5;
  for (let iteration = 0; iteration < 100; iteration++) {
    const first = left + (right - left) / 3;
    const second = right - (right - left) / 3;
    if (nll(samples(rows, field, Math.exp(first))) < nll(samples(rows, field, Math.exp(second)))) right = second;
    else left = first;
  }
  return Math.exp((left + right) / 2);
}
function summarize(values) {
  const bins = Array.from({ length: 10 }, () => ({ count: 0, confidence: 0, correct: 0 }));
  let brier = 0;
  for (const sample of values) {
    const confidence = Math.max(...Object.values(sample.probabilities));
    const bin = bins[Math.min(9, Math.floor(confidence * 10))];
    bin.count++; bin.confidence += confidence; bin.correct += sample.correct ? 1 : 0;
    brier += Object.entries(sample.probabilities).reduce((sum, [label, probability]) => sum + (probability - (label === sample.expected ? 1 : 0)) ** 2, 0);
  }
  return {
    correct: values.filter(sample => sample.correct).length, total: values.length,
    accuracy: values.filter(sample => sample.correct).length / values.length,
    nll: nll(values), brier: brier / values.length,
    ece_10_bin: bins.reduce((sum, bin) => bin.count ? sum + bin.count / values.length * Math.abs(bin.correct / bin.count - bin.confidence / bin.count) : sum, 0)
  };
}

for (const [method, result] of Object.entries(report.methods)) {
  const calibrationRows = result.rows.filter(row => row.split === 'calibration');
  const temperatures = Object.fromEntries(fields.map(field => [field, fitTemperature(calibrationRows, field)]));
  const bySplit = {};
  for (const split of ['calibration', 'validation', 'test']) {
    const rows = result.rows.filter(row => row.split === split);
    bySplit[split] = {
      before: summarize(fields.flatMap(field => samples(rows, field, 1))),
      after: summarize(fields.flatMap(field => samples(rows, field, temperatures[field]))),
      by_field: Object.fromEntries(fields.map(field => [field, { before: summarize(samples(rows, field, 1)), after: summarize(samples(rows, field, temperatures[field])) }]))
    };
  }
  result.temperature_scaling = { fitted_on: 'calibration', temperatures, by_split: bySplit };
  console.log(JSON.stringify({ method, temperatures, validation: bySplit.validation, test: bySplit.test }, null, 2));
}
await writeFile(reportUrl, JSON.stringify(report, null, 2));
