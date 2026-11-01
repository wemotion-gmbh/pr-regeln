// Human-readable (German) report of a checkPr result.

function section(title, findings) {
  const lines = [`${title} (${findings.length}):`];
  for (const f of findings) {
    lines.push(`- ${f.code} ${f.message}`);
    if (f.fix) lines.push(`  Abhilfe: ${f.fix}`);
  }
  return lines.join('\n');
}

export function formatResult(result, pr) {
  const head = `PR-Regeln für ${pr.repo}#${pr.number}${pr.title ? ` „${pr.title}“` : ''} (${pr.head} → ${pr.base})`;
  if (result.skipped === 'bot') return `${head}\nBot-PR, nicht geprüft.`;

  const parts = [head];
  if (result.errors.length) parts.push(section('Fehler', result.errors));
  if (result.warnings.length) parts.push(section('Hinweise', result.warnings));
  if (!result.errors.length && !result.warnings.length) parts.push('Keine Funde.');
  if (result.migration?.deleting) parts.push(`Löschende Migrationen: ${result.migration.files.join(', ')}`);
  if (!result.isNew && result.warnings.some((f) => f.code !== 'M1' && !f.code.startsWith('W'))) {
    parts.push('Der PR gilt nicht als neu (vor T1 angelegt oder T1 noch nicht gesetzt). Regelverstöße sind deshalb nur Hinweise.');
  }
  const verdict = result.errors.length ? 'rot' : result.warnings.length ? 'grün, mit Hinweisen' : 'grün';
  parts.push(`Ergebnis: ${verdict}`);
  return parts.join('\n\n');
}
