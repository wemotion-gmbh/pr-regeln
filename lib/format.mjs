// Human-readable (German) report of a checkPr result.

export function formatFindings(findings) {
  return findings.map((f) => `- ${f.code} ${f.message}${f.fix ? `\n  Abhilfe: ${f.fix}` : ''}`).join('\n');
}

function section(title, findings) {
  return `${title} (${findings.length}):\n${formatFindings(findings)}`;
}

export function formatResult(result, pr) {
  const head = `PR-Regeln für ${pr.repo}#${pr.number}${pr.title ? ` „${pr.title}“` : ''} (${pr.head} → ${pr.base})`;
  if (result.skipped === 'bot') return `${head}\nBot-PR, nicht geprüft.`;

  const parts = [head];
  if (result.errors.length) parts.push(section('Fehler', result.errors));
  if (result.warnings.length) parts.push(section('Hinweise', result.warnings));
  if (!result.errors.length && !result.warnings.length) parts.push('Keine Funde.');
  if (result.migration?.deleting) parts.push(`Löschende Migrationen: ${result.migration.files.join(', ')}`);
  if (result.design?.uiFiles?.length) parts.push(`UI-Dateien (Design-Regel): ${result.design.uiFiles.length}`);
  if (!result.isNew && result.warnings.some((f) => f.code !== 'M1' && !/^[WD]/.test(f.code))) {
    parts.push('Der PR gilt nicht als neu (vor T1 angelegt oder T1 noch nicht gesetzt). Regelverstöße sind deshalb nur Hinweise.');
  }
  if (result.design && !result.design.enforced && result.warnings.some((f) => /^D[1-4]$/.test(f.code))) {
    parts.push('Die Design-Regel gilt für diesen PR noch nicht (vor dem 26.11.2026 angelegt). Ab dem 03.12.2026 sind ihre Funde Fehler.');
  }
  const verdict = result.errors.length ? 'rot' : result.warnings.length ? 'grün, mit Hinweisen' : 'grün';
  parts.push(`Ergebnis: ${verdict}`);
  return parts.join('\n\n');
}
