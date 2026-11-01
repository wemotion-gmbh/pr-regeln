#!/usr/bin/env node
// pr-regeln check <PR-URL> [--mark-migration] [--json]
// Exit 0: no errors, 1: errors, 2: usage or access problem.
import { checkPr, MIGRATION_LABEL_MISSING, MIGRATION_LABEL_OK } from './lib/pr-rules.mjs';
import { parsePrUrl, fetchPr, addGithubLabel, removeGithubLabel } from './lib/forges.mjs';
import { formatResult } from './lib/format.mjs';

const USAGE = 'Aufruf: pr-regeln check <PR-URL> [--mark-migration] [--json]';
const FLAGS = ['--mark-migration', '--json'];

// GitHub only: sets the missing label, never the yes label; drops the missing label once the yes label is there.
async function markMigration(ref, pr, result) {
  if (pr.forge !== 'github' || result.skipped) return null;
  const has = (l) => pr.labels.includes(l);
  if (has(MIGRATION_LABEL_OK) && has(MIGRATION_LABEL_MISSING)) {
    await removeGithubLabel(ref, MIGRATION_LABEL_MISSING);
    return `Label „${MIGRATION_LABEL_MISSING}“ entfernt, „${MIGRATION_LABEL_OK}“ ist dran.`;
  }
  if (result.migration?.deleting && !has(MIGRATION_LABEL_OK) && !has(MIGRATION_LABEL_MISSING)) {
    await addGithubLabel(ref, MIGRATION_LABEL_MISSING);
    return `Label „${MIGRATION_LABEL_MISSING}“ gesetzt.`;
  }
  return null;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (['help', '--help', '-h'].includes(command)) {
    console.log(USAGE);
    return 0;
  }
  const flags = rest.filter((a) => a.startsWith('--'));
  const args = rest.filter((a) => !a.startsWith('--'));
  if (command !== 'check' || args.length !== 1 || flags.some((f) => !FLAGS.includes(f))) {
    console.error(USAGE);
    return 2;
  }
  const ref = parsePrUrl(args[0]);
  if (!ref) {
    console.error(`Keine PR-Adresse von GitHub oder Bitbucket: ${args[0]}\n${USAGE}`);
    return 2;
  }

  let pr;
  try {
    pr = await fetchPr(ref);
  } catch (e) {
    console.error(`PR nicht lesbar: ${e.message}`);
    return 2;
  }
  const result = checkPr(pr);

  let marked = null;
  let markError = null;
  if (flags.includes('--mark-migration')) {
    try {
      marked = await markMigration(ref, pr, result);
    } catch (e) {
      markError = `Label nicht geändert: ${e.message}`;
    }
  }

  if (flags.includes('--json')) {
    const { forge, owner, repo, number, url, title, head, base, headSha, draft, createdAt } = pr;
    console.log(JSON.stringify({ pr: { forge, owner, repo, number, url, title, head, base, headSha, draft, createdAt }, ...result, marked }, null, 2));
  } else {
    console.log(formatResult(result, pr) + (marked ? `\n\n${marked}` : ''));
  }
  if (markError) {
    console.error(markError);
    return 2;
  }
  return result.errors.length ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { console.error(e.message); process.exitCode = 2; },
);
