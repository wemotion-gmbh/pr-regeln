#!/usr/bin/env node
// Script of the skill pr-anlegen. create|update|ready: writes the head block, sets labels, checks the PR and only
// then creates or changes it. Exit 0: done, 1: the check is red (nothing changed), 2: usage or access problem.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  FIXED_BRANCHES, MIGRATION_LABEL_MISSING, MIGRATION_LABEL_OK, checkBranchName, checkPr, deletesData, splitUnifiedDiff, typeLabelFor,
} from '../lib/pr-rules.mjs';
import { addGithubLabel, bitbucketAuth, bitbucketPr, bitbucketPrUrl, bitbucketSend, exec, fetchPr, parseRemote } from '../lib/forges.mjs';
import { FROM_TEXT, buildBody, carriedStops } from '../lib/body.mjs';
import { formatFindings } from '../lib/format.mjs';

const USAGE = `Aufruf:
  create-pr.mjs create --repo-dir <pfad> --base <branch> --title <titel> --body-file <datei> (--ready|--draft)
      [--head <branch>] [--rename-to <art>/<thema>] [--needs <repo>#<nr>]... [--stop "<grund>"]...
      [--paired-with <repo> <url>]... [--after "<schritt>"]... [--dry-run]
  create-pr.mjs update --repo-dir <pfad> --number <nr> --body-file <datei> [--title <titel>] [--ready|--draft]
      [--needs ...] [--stop ...] [--remove-stop "<grund>"]... [--paired-with ...] [--after ...] [--dry-run]
  create-pr.mjs ready --repo-dir <pfad> --number <nr> [--dry-run]
Optionen mit Wert gehen auch als --name=wert, ein leerer Wert als --name=.`;

const BITBUCKET_MIGRATION_STOP = 'Marcs Ja fehlt (Migration löscht Daten)';
const CLOUD_BRANCH = /^(claude\/|ccr-)/;
// A branch name, never a ref expression: HEAD, refs/..., a refspec (":", "+") or a revision ("~", "^", "@{") would
// make the push go elsewhere than the checked name.
const PLAIN_BRANCH = /^(?!HEAD$|refs\/|-)(?!.*\.\.)[\w.\/-]+$/;
const SINGLE = new Set(['--repo-dir', '--base', '--title', '--body-file', '--head', '--rename-to', '--number']);
const MULTI = { '--needs': 'needs', '--stop': 'stops', '--remove-stop': 'removeStops', '--after': 'after' };
const FLAGS = new Set(['--ready', '--draft', '--dry-run']);

class UsageError extends Error {}

function value(v, name) {
  if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} braucht einen Wert.`);
  return v;
}

// "--name=value" keeps an empty value, which Windows PowerShell 5.1 drops as a separate "" argument.
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const o = { command, needs: [], stops: [], removeStops: [], after: [], pairedWith: [], flags: new Set() };
  for (let i = 0; i < rest.length; i++) {
    const eq = rest[i].startsWith('--') ? rest[i].indexOf('=') : -1;
    const a = eq > 0 ? rest[i].slice(0, eq) : rest[i];
    const next = () => (eq > 0 ? rest[i].slice(eq + 1) : value(rest[++i], a));
    if (eq > 0 && !SINGLE.has(a) && !MULTI[a]) throw new UsageError(`${a} nimmt keinen Wert mit „=“.`);
    if (SINGLE.has(a)) o[a.slice(2)] = next();
    else if (MULTI[a]) o[MULTI[a]].push(next());
    else if (a === '--paired-with') o.pairedWith.push({ repo: value(rest[++i], a), url: value(rest[++i], a) });
    else if (FLAGS.has(a)) o.flags.add(a);
    else throw new UsageError(`Unbekannte Angabe: ${a}`);
  }
  const required = { create: ['base', 'title', 'body-file'], update: ['number', 'body-file'], ready: ['number'] }[command];
  if (!required) throw new UsageError(`Unbekannter Befehl: ${command ?? '(keiner)'}`);
  for (const r of required) if (!o[r]) throw new UsageError(`--${r} fehlt.`);
  const both = o.flags.has('--ready') && o.flags.has('--draft');
  if (both || (command === 'create' && !o.flags.has('--ready') && !o.flags.has('--draft'))) {
    throw new UsageError('Genau eins von --ready (fertig) oder --draft (Entwurf) angeben.');
  }
  return o;
}

function git(dir, args, { raw = false } = {}) {
  const out = execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return raw ? out : out.trim();
}

function tryGit(dir, args, opts) {
  try {
    return git(dir, args, opts);
  } catch {
    return null;
  }
}

function repoOf(dir) {
  const remote = parseRemote(tryGit(dir, ['remote', 'get-url', 'origin']));
  if (!remote) throw new UsageError(`Im Ordner ${dir} zeigt origin weder auf GitHub noch auf Bitbucket.`);
  return remote;
}

// Only migrations matter for the data-deleting check, at any depth (fusion keeps them in a subfolder); null when the
// diff cannot be read. A fixed head is never pushed, so the PR shows origin/<head>, not the local branch.
function migrationFiles(dir, base, head) {
  const fixed = FIXED_BRANCHES.includes(head);
  tryGit(dir, ['fetch', '-q', 'origin', base, ...(fixed ? [head] : [])]);
  const tip = fixed ? `origin/${head}` : head;
  const diff = tryGit(dir, ['diff', '--unified=3', `origin/${base}...${tip}`, '--', ':(glob)**/database/migrations/**'], { raw: true });
  return diff === null ? null : splitUnifiedDiff(diff);
}

function readText(path) {
  return readFileSync(resolve(path), 'utf8').replace(/^﻿/, '');
}

const blocking = (result) => result.errors.filter((f) => f.code !== 'M1');

function summary(result) {
  const parts = [];
  const blockers = blocking(result);
  if (blockers.length) parts.push(`Fehler (${blockers.length}), deshalb wurde nichts angelegt oder geändert:\n${formatFindings(blockers)}`);
  const hints = [...result.errors.filter((f) => f.code === 'M1'), ...result.warnings];
  if (hints.length) parts.push(`Hinweise (${hints.length}):\n${formatFindings(hints)}`);
  return parts.join('\n\n');
}

function dryRun(plan, result) {
  console.log([
    `Plattform: ${plan.forge} ${plan.owner}/${plan.repo}${plan.number ? ` #${plan.number}` : ''}`,
    `Kopf: ${plan.head} -> ${plan.base}${plan.draft ? ' (Entwurf)' : ''}`,
    `Titel: ${plan.title}`,
    `Labels: ${plan.labels.join(', ') || 'keine'}`,
    `Migrationen: ${plan.files === null ? 'nicht geprüft' : plan.deleting ? 'löschen Daten' : 'löschen nichts'}`,
    '',
    '--- Text ---',
    plan.body.trimEnd(),
    '--- Ende ---',
    summary(result) || 'Keine Funde.',
    '',
    'Nichts angelegt oder geändert (--dry-run).',
  ].join('\n'));
  return blocking(result).length ? 1 : 0;
}

function headLines(o, forge, deleting) {
  return {
    needs: o.needs,
    stops: forge === 'bitbucket' && deleting ? [...o.stops, BITBUCKET_MIGRATION_STOP] : o.stops,
    pairedWith: o.pairedWith,
    after: o.after,
  };
}

async function create(o) {
  const dir = resolve(o['repo-dir'] ?? '.');
  const { forge, owner, repo } = repoOf(dir);
  const head = o.head ?? tryGit(dir, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!head) throw new UsageError('Kein Branch ausgecheckt; --head angeben.');
  if (!PLAIN_BRANCH.test(head)) throw new UsageError(`--head nimmt nur Branch-Namen, keinen Ausdruck wie „${head}“.`);
  const fixedHead = FIXED_BRANCHES.includes(head);
  if (o['rename-to']) {
    if (fixedHead) throw new UsageError(`Den festen Branch „${head}“ benenne ich nicht um.`);
    if (FIXED_BRANCHES.includes(o['rename-to'])) throw new UsageError(`Auf den festen Branch „${o['rename-to']}“ benenne ich nicht um.`);
    if (!checkBranchName(o['rename-to']).ok) throw new UsageError(`„${o['rename-to']}“ hat nicht die Form <art>/<thema>.`);
  } else if (CLOUD_BRANCH.test(head)) {
    throw new UsageError(`Der Branch „${head}“ kommt aus einer Cloud-Sitzung. Mit --rename-to <art>/<thema> unter neuem Namen anlegen.`);
  }
  const prHead = o['rename-to'] ?? head;
  const files = migrationFiles(dir, o.base, head);
  const deleting = files ? deletesData(files).deleting : false;
  const body = buildBody({ text: readText(o['body-file']), ...headLines(o, forge, deleting) });
  const labels = forge === 'github' ? [typeLabelFor(prHead), deleting ? MIGRATION_LABEL_MISSING : null].filter(Boolean) : [];
  const draft = o.flags.has('--draft');
  const result = checkPr({ forge, repo, head: prHead, base: o.base, title: o.title, body, draft, labels, author: null,
    createdAt: new Date().toISOString(), files: files ?? undefined });

  if (o.flags.has('--dry-run')) return dryRun({ forge, owner, repo, head: prHead, base: o.base, draft, title: o.title, labels, files, deleting, body }, result);
  if (blocking(result).length) {
    console.error(summary(result));
    return 1;
  }

  if (o['rename-to']) git(dir, ['branch', '-m', head, prHead]);
  if (!FIXED_BRANCHES.includes(prHead)) git(dir, ['push', '-u', 'origin', prHead]);

  let url;
  if (forge === 'github') {
    const tmp = mkdtempSync(join(tmpdir(), 'create-pr-'));
    try {
      writeFileSync(join(tmp, 'body.md'), body);
      const args = ['pr', 'create', '--repo', `${owner}/${repo}`, '--base', o.base, '--head', prHead, '--title', o.title, '--body-file', join(tmp, 'body.md')];
      if (draft) args.push('--draft');
      url = (await exec('gh', args)).trim().split('\n').pop();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
    for (const l of labels) await addGithubLabel({ owner, repo, number }, l);
  } else {
    const auth = await bitbucketAuth();
    const pr = await bitbucketSend('POST', bitbucketPrUrl(owner, repo), auth, {
      title: o.title, description: body, source: { branch: { name: prHead } }, destination: { branch: { name: o.base } }, draft,
    });
    url = pr?.links?.html?.href ?? `${owner}/${repo}#${pr?.id}`;
  }
  const s = [
    files === null
      ? `Migrationen nicht geprüft: Der Diff gegen origin/${o.base} war nicht lesbar. ${forge === 'github'
        ? 'Mit „update“ prüft das Skript sie über die API.'
        : 'Die Merge-KI prüft sie vor dem Merge.'}`
      : '',
    summary(result),
  ].filter(Boolean).join('\n\n');
  console.log(s ? `${s}\n\n${url}` : url);
  return 0;
}

// Bitbucket replaces fields it is sent; reviewers are sent back unchanged so they stay.
async function bitbucketUpdate(ref, fields) {
  const auth = await bitbucketAuth();
  const current = await bitbucketPr(ref.owner, ref.repo, ref.number, auth);
  await bitbucketSend('PUT', bitbucketPrUrl(ref.owner, ref.repo, ref.number), auth, {
    title: current.title, description: current.description ?? current.summary?.raw ?? '', reviewers: (current.reviewers ?? []).map((r) => ({ uuid: r.uuid })), ...fields,
  });
}

async function update(o) {
  const dir = resolve(o['repo-dir'] ?? '.');
  const { forge, owner, repo } = repoOf(dir);
  const ref = { forge, owner, repo, number: Number(o.number) };
  const pr = await fetchPr(ref);
  const deleting = deletesData(pr.files).deleting;
  // Every stop on the PR stays unless named in --remove-stop. The Bitbucket migration stop is not set again:
  // the merge AI removes it once the yes is given.
  const lines = headLines(o, forge, false);
  const carried = carriedStops(pr.body, forge);
  const body = buildBody({ text: readText(o['body-file']), ...lines, stops: [...carried, ...lines.stops], removeStops: o.removeStops });
  const fromText = carried.filter((s) => s.endsWith(FROM_TEXT) && !o.removeStops.includes(s))
    .map((s) => `Aus dem alten Text als Stopp übernommen: „Merge-Stopp: ${s}“. Ist es keiner, mit --remove-stop "${s}" aufheben.`);
  const title = o.title ?? pr.title;
  const draft = o.flags.has('--draft') ? true : o.flags.has('--ready') ? false : pr.draft;
  const add = forge === 'github'
    ? [typeLabelFor(pr.head), deleting && !pr.labels.includes(MIGRATION_LABEL_OK) ? MIGRATION_LABEL_MISSING : null].filter((l) => l && !pr.labels.includes(l))
    : [];
  const labels = [...pr.labels, ...add];
  const result = checkPr({ ...pr, title, body, draft, labels });

  if (o.flags.has('--dry-run')) {
    if (fromText.length) console.log(`${fromText.join('\n')}\n`);
    return dryRun({ ...pr, draft, title, labels, files: pr.files, deleting, body }, result);
  }
  if (blocking(result).length) {
    console.error(summary(result));
    return 1;
  }

  if (forge === 'github') {
    await exec('gh', ['api', '-X', 'PATCH', `repos/${owner}/${repo}/pulls/${ref.number}`, '--input', '-'], JSON.stringify({ title, body }));
    if (draft !== pr.draft) await exec('gh', ['pr', 'ready', String(ref.number), '--repo', `${owner}/${repo}`, ...(draft ? ['--undo'] : [])]);
    for (const l of add) await addGithubLabel(ref, l);
  } else {
    await bitbucketUpdate(ref, { title, description: body, draft });
  }
  const s = [...fromText, summary(result)].filter(Boolean).join('\n\n');
  console.log(s ? `${s}\n\n${pr.url}` : pr.url);
  return 0;
}

async function ready(o) {
  const dir = resolve(o['repo-dir'] ?? '.');
  const { forge, owner, repo } = repoOf(dir);
  const ref = { forge, owner, repo, number: Number(o.number) };
  const pr = await fetchPr(ref);
  const result = checkPr({ ...pr, draft: false });
  if (o.flags.has('--dry-run')) return dryRun({ ...pr, draft: false, deleting: Boolean(result.migration?.deleting) }, result);
  if (blocking(result).length) {
    console.error(summary(result));
    return 1;
  }
  if (pr.draft) {
    if (forge === 'github') await exec('gh', ['pr', 'ready', String(ref.number), '--repo', `${owner}/${repo}`]);
    else await bitbucketUpdate(ref, { draft: false });
  }
  const s = summary(result);
  console.log(s ? `${s}\n\n${pr.url}` : pr.url);
  return 0;
}

async function main(argv) {
  try {
    const o = parseArgs(argv);
    return await { create, update, ready }[o.command](o);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n\n${USAGE}`);
    } else {
      console.error(`Fehlgeschlagen: ${e.message}`);
    }
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
