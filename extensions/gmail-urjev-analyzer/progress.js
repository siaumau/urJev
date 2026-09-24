export function summarizeProgress({ loadedCount, runIds, completedIds, results, categories }) {
  const scopedIds = runIds.length ? completedIds : new Set(results.keys());
  const target = runIds.length || scopedIds.size;
  const done = scopedIds.size;
  const counts = Object.fromEntries(categories.map(category => [category, 0]));
  for (const id of scopedIds) {
    const result = results.get(id); if (!result) continue;
    counts[result.category in counts ? result.category : 'uncategorized']++;
  }
  const measured = [...scopedIds].map(id => results.get(id)).filter(Boolean);
  const latencies = measured.map(result => result.meta?.latency_ms).filter(Number.isFinite);
  const tokenTotal = field => {
    const values = measured.map(result => result.usage?.[field]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  return {
    loaded: loadedCount, target, done, percent: target ? Math.min(100, Math.round(done / target * 100)) : 0, counts,
    averageLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
    inputTokens: tokenTotal('input_tokens'), outputTokens: tokenTotal('output_tokens')
  };
}
