import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createEngine } from '../src/engine.js';
import { systemOne, systemOneOneForward } from '../src/systemone.js';

const datasetArgument = process.argv.find(argument => argument.startsWith('--dataset='))?.slice('--dataset='.length);
const datasetPath = datasetArgument ? resolve(datasetArgument) : new URL('../datasets/feedback-calibration-100-v2.jsonl', import.meta.url);
const datasetLabel = datasetArgument ?? 'datasets/feedback-calibration-100-v2.jsonl';
const allRows = (await readFile(datasetPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const split = process.argv.find(argument => argument.startsWith('--split='))?.slice('--split='.length);
if (split && !['calibration', 'validation', 'test'].includes(split)) throw new Error('--split must be calibration, validation, or test.');
const dataset = split ? allRows.filter(row => row.split === split) : allRows;
const fields = ['main_topic', 'sentiment', 'refund_requested', 'expressed_churn_intent', 'expressed_frustration'];
const requested = process.argv.includes('--oneforward-only') ? ['oneforward'] : process.argv.includes('--generated-only') ? ['generated'] : ['oneforward', 'generated'];
const engine = createEngine({ backend: 'vllm', url: process.env.VLLM_URL, model: process.env.MODEL });

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
};
const probabilitiesFor = answer => {
  if (answer.type === 'noul') return { false: 1 - answer.noul, true: answer.noul };
  return answer.probabilities;
};
const expectedKey = value => String(value);
const predictionFor = answer => {
  const probabilities = probabilitiesFor(answer);
  return Object.entries(probabilities).reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];
};
const ece = samples => {
  const bins = Array.from({ length: 10 }, () => ({ count: 0, confidence: 0, correct: 0 }));
  for (const sample of samples) {
    const confidence = Math.max(...Object.values(sample.probabilities));
    const bin = bins[Math.min(9, Math.floor(confidence * 10))];
    bin.count++; bin.confidence += confidence; bin.correct += sample.correct ? 1 : 0;
  }
  return bins.reduce((sum, bin) => bin.count ? sum + bin.count / samples.length * Math.abs(bin.correct / bin.count - bin.confidence / bin.count) : sum, 0);
};
const summarizeSamples = samples => ({
  correct: samples.filter(sample => sample.correct).length,
  total: samples.length,
  accuracy: samples.filter(sample => sample.correct).length / samples.length,
  nll: samples.reduce((sum, sample) => sum - Math.log(Math.max(1e-15, sample.probabilities[sample.expected] ?? 0)), 0) / samples.length,
  brier: samples.reduce((sum, sample) => sum + Object.entries(sample.probabilities).reduce((score, [key, probability]) => score + (probability - (key === sample.expected ? 1 : 0)) ** 2, 0), 0) / samples.length,
  ece_10_bin: ece(samples),
  confusion: samples.reduce((matrix, sample) => {
    matrix[sample.expected] ??= {};
    matrix[sample.expected][sample.predicted] = (matrix[sample.expected][sample.predicted] ?? 0) + 1;
    return matrix;
  }, {})
});

const report = { created_at: new Date().toISOString(), model: engine.model, sentiment_strategy: engine.sentimentStrategy, dataset: datasetLabel, split: split ?? 'all', rows: dataset.length, note: 'Synthetic-data evaluation, not a real-world accuracy guarantee. Accuracy uses argmax; NLL, Brier, and 10-bin ECE use uncalibrated scores. latency_ms is systemOne elapsed time, not browser roundtrip.', methods: {} };
for (const method of requested) {
  const run = method === 'oneforward' ? systemOneOneForward : systemOne;
  const rows = [];
  for (const [index, item] of dataset.entries()) {
    const result = await run(engine, { state: item.state, problem: item.problem });
    const predictions = {}, checks = {}, probabilities = {};
    for (const field of fields) {
      const answer = result.answers[field];
      probabilities[field] = probabilitiesFor(answer);
      const key = predictionFor(answer);
      predictions[field] = answer.type === 'noul' ? key === 'true' : answer.type === 'score' ? Number(key) : key;
      checks[field] = key === expectedKey(item.expected[field]);
    }
    rows.push({ id: item.id, split: item.split, expected: item.expected, predicted: predictions, correct: checks, probabilities, latency_ms: result.meta.latency_ms, output_tokens: result.usage.output_tokens });
    if ((index + 1) % 10 === 0) console.log(`${method}: ${index + 1}/${dataset.length}`);
  }
  const samples = Object.fromEntries(fields.map(field => [field, rows.map(row => ({ expected: expectedKey(row.expected[field]), predicted: expectedKey(row.predicted[field]), probabilities: row.probabilities[field], correct: row.correct[field] }))]));
  const allSamples = fields.flatMap(field => samples[field]);
  const latencies = rows.map(row => row.latency_ms);
  const noulOperational = ['refund_requested', 'expressed_churn_intent'].flatMap(field => rows.map(row => {
    const probability = row.probabilities[field].true;
    const predicted = probability >= .6 ? true : probability <= .4 ? false : null;
    return { decided: predicted !== null, correct: predicted === row.expected[field] };
  }));
  report.methods[method] = {
    overall: summarizeSamples(allSamples),
    by_field: Object.fromEntries(fields.map(field => [field, summarizeSamples(samples[field])])),
    by_split: Object.fromEntries([...new Set(dataset.map(row => row.split))].map(rowSplit => {
      const splitSamples = fields.flatMap(field => rows.filter(row => row.split === rowSplit).map(row => ({ expected: expectedKey(row.expected[field]), predicted: expectedKey(row.predicted[field]), probabilities: row.probabilities[field], correct: row.correct[field] })));
      return [rowSplit, summarizeSamples(splitSamples)];
    })),
    noul_threshold_0_6: { coverage: noulOperational.filter(item => item.decided).length / noulOperational.length, decided: noulOperational.filter(item => item.decided).length, correct_when_decided: noulOperational.filter(item => item.decided && item.correct).length, accuracy_when_decided: noulOperational.filter(item => item.decided && item.correct).length / Math.max(1, noulOperational.filter(item => item.decided).length) },
    latency_ms: { min: Math.min(...latencies), p50: percentile(latencies, .5), p95: percentile(latencies, .95), max: Math.max(...latencies), mean: latencies.reduce((sum, value) => sum + value, 0) / latencies.length },
    output_tokens: rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
    failures: rows.filter(row => !fields.every(field => row.correct[field])).map(row => ({ id: row.id, split: row.split, expected: row.expected, predicted: row.predicted, correct: row.correct })),
    rows
  };
  console.log(JSON.stringify({ method, overall: report.methods[method].overall, by_field: Object.fromEntries(fields.map(field => [field, report.methods[method].by_field[field].accuracy])), latency_ms: report.methods[method].latency_ms, failed_rows: report.methods[method].failures.length }, null, 2));
}
if (report.methods.oneforward && report.methods.generated) {
  const one = report.methods.oneforward.rows, generated = report.methods.generated.rows;
  report.comparison = { disagreements: [] };
  for (let index = 0; index < dataset.length; index++) for (const field of fields) if (expectedKey(one[index].predicted[field]) !== expectedKey(generated[index].predicted[field])) report.comparison.disagreements.push({ id: dataset[index].id, field, expected: dataset[index].expected[field], oneforward: one[index].predicted[field], generated: generated[index].predicted[field] });
  report.comparison.disagreement_count = report.comparison.disagreements.length;
}
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
const datasetStem = basename(datasetLabel, '.jsonl').replace(/[^a-zA-Z0-9_-]/g, '-');
const methodSuffix = requested.length === 1 ? `-${requested[0]}` : '';
const reportName = split ? `${datasetStem}-evaluation-${split}${methodSuffix}.json` : `${datasetStem}-evaluation${methodSuffix}.json`;
await writeFile(new URL(`../reports/${reportName}`, import.meta.url), JSON.stringify(report, null, 2));
