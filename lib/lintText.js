/**
 * The text "Copy for agent" puts on the clipboard from a sketch's token
 * check, and the labels the panel shows. Plain JS so the wording the agent
 * reads can be tested without a browser.
 *
 * @typedef {{ class: string, kind: 'palette' | 'arbitrary' | 'scale', namespace: string, candidates: number, verdict?: 'replace' | 'maybe' | 'keep', suggestion?: { token: string, replacement: string, confidence: number } | null }} Finding
 * @typedef {{ projectId: string, nodeId: string, name: string, findings: Finding[], tokens: Record<string, number>, truncated?: boolean, jev: { asked: boolean, error?: string } }} LintResult
 */

const KIND_LABEL = { palette: 'stock palette colour', arbitrary: 'arbitrary value', scale: 'stock step' };

/** "stock palette colour", "arbitrary value", "stock step". */
export function findingKindLabel(kind) {
  return KIND_LABEL[kind] || kind;
}

/** One line per finding: the class, and what to do about it. */
export function findingLine(f) {
  const pct = f.suggestion ? `${Math.round(f.suggestion.confidence * 100)}%` : '';
  if (f.verdict === 'replace' && f.suggestion) return `${f.class} → ${f.suggestion.replacement} (${f.suggestion.token}, ${pct})`;
  if (f.verdict === 'maybe' && f.suggestion) return `${f.class} → maybe ${f.suggestion.replacement} (${f.suggestion.token}, ${pct}); check it`;
  if (f.verdict === 'keep') return `${f.class}: no repo token fits; keep it`;
  const n = f.candidates;
  return `${f.class}: ${findingKindLabel(f.kind)}, ${n} ${f.namespace} token${n === 1 ? '' : 's'} in the repo could replace it`;
}

/**
 * The clipboard text for a sketch's token check.
 * @param {LintResult} result
 */
export function buildLintText(result) {
  const { name, projectId, nodeId, findings } = result;
  const lines = [];
  const n = findings.length;
  lines.push(`Token check for the "${name || 'Untitled sketch'}" sketch (project ${projectId}, node ${nodeId}): ${n} literal value${n === 1 ? '' : 's'} where this repo has design tokens.`);
  lines.push('');
  if (!n) lines.push('(nothing to change: every colour, radius and shadow already uses the repo\'s tokens or Tailwind defaults the repo has no token for)');
  for (const f of findings) lines.push(`- ${findingLine(f)}`);
  if (result.truncated) lines.push('- … and more; re-run after fixing these');
  lines.push('');
  if (result.jev?.asked && !result.jev.error) {
    lines.push('Replacements marked → were suggested by Jev from the repo\'s tokens; the percentage is its confidence.');
  }
  lines.push(
    `Please update the preview code to use the repo's tokens for the flagged classes (\`npx klose project get ${projectId}\` to read it, ` +
      `\`npx klose project update-node ${projectId} ${nodeId}\` to write it), then re-run \`npx klose project lint ${projectId} ${nodeId}\`.`
  );
  return lines.join('\n');
}
