export function parseEditor(text, name) {
  try { return JSON.parse(text); }
  catch { throw new Error(`${name} 不是合法 JSON；若含 &#x20; 或反斜線底線，請按「清理貼上轉義」。`); }
}
export function cleanEscapes(text) {
  // Never rewrite a valid JSON document, including literal entities in its strings.
  try { JSON.parse(text); return text; } catch {}
  return text.replace(/&#x20;|&#32;/gi, ' ').replace(/\\_/g, '_');
}
