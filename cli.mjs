#!/usr/bin/env node
// pr-regeln check <PR-URL> [--mark-migration] [--mark-design] [--json]
// Exit 0: no errors, 1: errors, 2: usage or access problem.
import { checkPr, DESIGN_LABEL_MISSING, DESIGN_LABEL_OK, MIGRATION_LABEL_MISSING, MIGRATION_LABEL_OK } from './lib/pr-rules.mjs';
import { parsePrUrl, fetchPr, addGithubLabel, removeGithubLabel } from './lib/forges.mjs';
import { formatResult } from './lib/format.mjs';

const USAGE = 'Aufruf: pr-regeln check <PR-URL> [--mark-migration] [--mark-design] [--json]';
const FLAGS = ['--mark-migration', '--mark-design', '--json'];

// GitHub only, never the yes label: "Design: neu" gets the missing label; a yes that no longer counts (D4) is taken
// off again; the missing label goes once the yes is there or the PR has no new pattern.
async function markDesign(ref, pr, result) {
  if (pr.forge !== 'github' || result.skipped || !result.design || result.design.exempt) return [];
  const has = (l) => pr.labels.includes(l);
  const done = [];
  const voided = [...result.errors, ...result.warnings].some((f) => f.code === 'D4');
  if (voided && has(DESIGN_LABEL_OK)) {
    await removeGithubLabel(ref, DESIGN_LABEL_OK);
    done.push(`Label „${DESIGN_LABEL_OK}“ entfernt: Das Ja gilt nicht mehr.`);
  }
  const ok = has(DESIGN_LABEL_OK) && !voided;
  if (result.design.isNew && !ok && !has(DESIGN_LABEL_MISSING)) {
    await addGithubLabel(ref, DESIGN_LABEL_MISSING);
    done.push(`Label „${DESIGN_LABEL_MISSING}“ gesetzt.`);
  } else if (has(DESIGN_LABEL_MISSING) && (ok || !result.design.isNew)) {
    await removeGithubLabel(ref, DESIGN_LABEL_MISSING);
    done.push(`Label „${DESIGN_LABEL_MISSING}“ entfernt.`);
  }
  return done;
}

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

  const done = [];
  let markError = null;
  try {
    if (flags.includes('--mark-migration')) done.push(await markMigration(ref, pr, result));
    if (flags.includes('--mark-design')) done.push(...await markDesign(ref, pr, result));
  } catch (e) {
    markError = `Label nicht geändert: ${e.message}`;
  }
  const marked = done.filter(Boolean).join('\n') || null;

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
