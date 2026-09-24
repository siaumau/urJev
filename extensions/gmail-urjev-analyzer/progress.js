export function summarizeProgress({ loadedCount, runIds, completedIds, results, categories }) {
  const scopedIds = runIds.length ? completedIds : new Set(results.keys());
  const target = runIds.length || scopedIds.size;
  const done = scopedIds.size;
  const counts = Object.fromEntries(categories.map(category => [category, 0]));
  for (const id of scopedIds) {
    const result = results.get(id); if (!result) continue;
    counts[result.category in counts ? result.category : 'uncategorized']++;
  }
  return { loaded: loadedCount, target, done, percent: target ? Math.min(100, Math.round(done / target * 100)) : 0, counts };
}
