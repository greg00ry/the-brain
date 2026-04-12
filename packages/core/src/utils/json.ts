export function cleanAndParseJSON(content: string) {
  let clean = content.replace(/```json/g, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');

  if (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < clean.length; i++) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) {
      clean = clean.substring(start, end + 1);
    }
  }

  clean = clean.replace(/,(\s*[}\]])/g, '$1');
  clean = clean.replace(/\/\/.*$/gm, '');
  clean = clean.replace(/\/\*[\s\S]*?\*\//g, '');

  try {
    return JSON.parse(clean);
  } catch {
    console.error("❌ [JSON] Parse failed:", clean);
    return null;
  }
}
