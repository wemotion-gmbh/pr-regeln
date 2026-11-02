#!/usr/bin/env node
// Conversion run of the PR rules. plan reads every open PR of the GitHub organisation and the Bitbucket workspace
// and writes proposals; it changes nothing. apply carries out the decided entries of a plan.
// Exit 0: done, 1: something was not done (see the output), 2: usage or access problem.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyPlan, buildPlan, renderMarkdown } from '../lib/conversion.mjs';
import { bitbucketAuth, bitbucketGet, bitbucketPr, bitbucketPrUrl, bitbucketSend, exec, removeGithubLabel } from '../lib/forges.mjs';

const USAGE = `Aufruf:
  convert-open-prs.mjs plan --out <datei.json> --owner-bitbucket <Anzeigename> [--md <datei.md>] [--owner-github <login>]
      [--github-org <org>] [--bitbucket-workspace <workspace>]
  convert-open-prs.mjs apply --plan <datei.json> --yes
„plan“ liest nur. „apply“ führt nur Einträge mit Entscheidung aus und braucht --yes.`;

const SINGLE = new Set(['--out', '--md', '--owner-github', '--github-org', '--bitbucket-workspace', '--plan']);
const BITBUCKET_API = 'https://api.bitbucket.org/2.0';

class UsageError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const o = { command, ownerBitbucket: [], yes: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const value = () => {
      const v = rest[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} braucht einen Wert.`);
      return v;
    };
    if (SINGLE.has(a)) o[a.slice(2)] = value();
    else if (a === '--owner-bitbucket') o.ownerBitbucket.push(value());
    else if (a === '--yes') o.yes = true;
    else throw new UsageError(`Unbekannte Angabe: ${a}`);
  }
  if (command === 'plan') {
    if (!o.out) throw new UsageError('--out fehlt.');
    // Without it the owner's Bitbucket PRs would be proposed for draft like everybody else's.
    if (!o.ownerBitbucket.length) throw new UsageError('--owner-bitbucket fehlt: der Anzeigename, unter dem der Lauf in Bitbucket schreibt.');
  } else if (command === 'apply') {
    if (!o.yes) throw new UsageError('apply ändert PRs und läuft nur mit --yes.');
    if (!o.plan) throw new UsageError('--plan fehlt.');
  } else {
    throw new UsageError(`Unbekannter Befehl: ${command ?? '(keiner)'}`);
  }
  return o;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// GitHub

const QUERY = `query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number url title body isDraft createdAt updatedAt headRefName headRefOid baseRefName
        author { login __typename }
        repository { name owner { login } }
        labels(first: 30) { nodes { name } }
        commits(last: 1) { nodes { commit { committedDate } } }
        comments(first: 100) { totalCount nodes { author { login __typename } body createdAt url } }
        reviews(first: 50) { totalCount nodes { author { login __typename } body submittedAt url } }
        timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) { nodes { ... on ReadyForReviewEvent { createdAt } } }
      }
    }
  }
}`;

function fromGithub(n) {
  const actor = (a) => ({ author: a?.login ?? null, isBot: a?.__typename === 'Bot' });
  const comments = [
    ...n.comments.nodes.map((c) => ({ ...actor(c.author), at: c.createdAt, url: c.url, body: c.body ?? '' })),
    ...n.reviews.nodes.filter((r) => (r.body ?? '').trim()).map((r) => ({ ...actor(r.author), at: r.submittedAt, url: r.url, body: r.body })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return {
    forge: 'github', owner: n.repository.owner.login, repo: n.repository.name, number: n.number, url: n.url, title: n.title,
    body: n.body ?? '', draft: Boolean(n.isDraft), head: n.headRefName, base: n.baseRefName, headSha: n.headRefOid,
    author: n.author ? { login: n.author.login, type: n.author.__typename === 'Bot' ? 'Bot' : 'User' } : null,
    createdAt: n.createdAt, updatedAt: n.updatedAt, labels: n.labels.nodes.map((l) => l.name),
    lastCommitAt: n.commits.nodes[0]?.commit.committedDate ?? null,
    readyEventAt: n.timelineItems.nodes[0]?.createdAt ?? null,
    comments,
    commentsTruncated: n.comments.totalCount > n.comments.nodes.length || n.reviews.totalCount > n.reviews.nodes.length,
    aheadBy: null,
  };
}

async function listGithub(org) {
  const prs = [];
  let cursor = null;
  do {
    const args = ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=org:${org} is:pr is:open archived:false`];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const { search } = JSON.parse(await exec('gh', args)).data;
    for (const n of search.nodes) if (n?.number) prs.push(fromGithub(n));
    cursor = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null;
  } while (cursor);
  // A PR whose head adds nothing to its base anymore was merged some other way or replaced.
  await pool(prs, 6, async (p) => {
    try {
      p.aheadBy = Number((await exec('gh', ['api', `repos/${p.owner}/${p.repo}/compare/${p.base}...${p.headSha}`, '--jq', '.ahead_by'])).trim());
    } catch {
      p.aheadBy = null;
    }
  });
  return prs;
}

// ---------------------------------------------------------------------------
// Bitbucket

async function paged(url, auth) {
  const out = [];
  for (let next = url; next;) {
    const d = await bitbucketGet(next, auth, 'json');
    out.push(...(d.values ?? []));
    next = d.next ?? null;
  }
  return out;
}

const bitbucketBody = (p) => p.description ?? p.summary?.raw ?? '';

function fromBitbucket(workspace, slug, p, comments, lastCommitAt) {
  return {
    forge: 'bitbucket', owner: workspace, repo: slug, number: p.id, url: p.links?.html?.href ?? null, title: p.title ?? '',
    body: bitbucketBody(p), draft: Boolean(p.draft), head: p.source?.branch?.name ?? '', base: p.destination?.branch?.name ?? '',
    headSha: p.source?.commit?.hash ?? null,
    author: p.author ? { login: p.author.display_name ?? p.author.nickname ?? '', type: p.author.type === 'app_user' ? 'Bot' : 'User' } : null,
    createdAt: p.created_on, updatedAt: p.updated_on, labels: [], lastCommitAt, readyEventAt: null,
    comments: comments.filter((c) => !c.deleted).map((c) => ({
      author: c.user?.display_name ?? null, isBot: c.user?.type === 'app_user', at: c.created_on, url: c.links?.html?.href ?? null,
      body: c.content?.raw ?? '', inline: Boolean(c.inline),
    })),
    commentsTruncated: false,
    aheadBy: null,
  };
}

async function listBitbucket(workspace, auth) {
  const repos = (await paged(`${BITBUCKET_API}/repositories/${workspace}?pagelen=100&fields=next,values.slug`, auth)).map((r) => r.slug);
  const unreadable = [];
  const ids = (await pool(repos, 8, async (slug) => {
    try {
      return (await paged(`${BITBUCKET_API}/repositories/${workspace}/${slug}/pullrequests?state=OPEN&pagelen=50&fields=next,values.id`, auth))
        .map((p) => ({ slug, id: p.id }));
    } catch (e) {
      unreadable.push(`${slug}: ${e.message}`);
      return [];
    }
  })).flat();
  const prs = await pool(ids, 6, async ({ slug, id }) => {
    const p = await bitbucketPr(workspace, slug, id, auth);
    const comments = await paged(`${bitbucketPrUrl(workspace, slug, id)}/comments?pagelen=100`, auth);
    const commits = await bitbucketGet(`${bitbucketPrUrl(workspace, slug, id)}/commits?pagelen=1`, auth, 'json');
    return fromBitbucket(workspace, slug, p, comments, commits.values?.[0]?.date ?? null);
  });
  return { prs, repos, unreadable };
}

// ---------------------------------------------------------------------------
// Writes, only through apply

// Bitbucket replaces the fields it is sent; reviewers are sent back unchanged so they stay.
async function bitbucketUpdate(e, fields, auth) {
  const current = await bitbucketPr(e.owner, e.repo, e.number, auth);
  await bitbucketSend('PUT', bitbucketPrUrl(e.owner, e.repo, e.number), auth, {
    title: current.title, description: bitbucketBody(current), reviewers: (current.reviewers ?? []).map((r) => ({ uuid: r.uuid })), ...fields,
  });
}

function forgeClient() {
  let auth = null;
  const bb = async () => (auth ??= await bitbucketAuth());
  const ghPath = (e) => `repos/${e.owner}/${e.repo}`;
  return {
    async fetchState(e) {
      if (e.forge === 'github') {
        const p = JSON.parse(await exec('gh', ['api', `${ghPath(e)}/pulls/${e.number}`]));
        return { headSha: p.head.sha, body: p.body ?? '', draft: Boolean(p.draft), labels: (p.labels ?? []).map((l) => l.name) };
      }
      const p = await bitbucketPr(e.owner, e.repo, e.number, await bb());
      return { headSha: p.source?.commit?.hash ?? null, body: bitbucketBody(p), draft: Boolean(p.draft), labels: [] };
    },
    async setBody(e, body) {
      if (e.forge === 'github') await exec('gh', ['api', '-X', 'PATCH', `${ghPath(e)}/pulls/${e.number}`, '--input', '-'], JSON.stringify({ body }));
      else await bitbucketUpdate(e, { description: body }, await bb());
    },
    async removeLabel(e, label) {
      if (e.forge !== 'github') throw new Error('Bitbucket hat keine Labels');
      await removeGithubLabel(e, label);
    },
    async setDraft(e) {
      if (e.forge === 'github') await exec('gh', ['pr', 'ready', String(e.number), '--repo', `${e.owner}/${e.repo}`, '--undo']);
      else await bitbucketUpdate(e, { draft: true }, await bb());
    },
    async comment(e, text) {
      if (e.forge === 'github') await exec('gh', ['api', '-X', 'POST', `${ghPath(e)}/issues/${e.number}/comments`, '--input', '-'], JSON.stringify({ body: text }));
      else await bitbucketSend('POST', `${bitbucketPrUrl(e.owner, e.repo, e.number)}/comments`, await bb(), { content: { raw: text } });
    },
  };
}

// ---------------------------------------------------------------------------

async function plan(o) {
  const org = o['github-org'] ?? 'wemotion-gmbh';
  const workspace = o['bitbucket-workspace'] ?? 'wemotion-bucket';
  const githubOwner = o['owner-github'] ?? (await exec('gh', ['api', 'user', '--jq', '.login'])).trim();
  const auth = await bitbucketAuth();
  const github = await listGithub(org);
  const bitbucket = await listBitbucket(workspace, auth);
  const result = buildPlan([...github, ...bitbucket.prs], {
    owners: { github: [githubOwner], bitbucket: o.ownerBitbucket },
    bitbucketRepos: bitbucket.repos,
  });
  result.sources = { githubOrg: org, bitbucketWorkspace: workspace, bitbucketRepos: bitbucket.repos.length, unreadableBitbucketRepos: bitbucket.unreadable };
  writeFileSync(resolve(o.out), `${JSON.stringify(result, null, 1)}\n`);
  if (o.md) writeFileSync(resolve(o.md), renderMarkdown(result));
  const c = result.counts;
  console.log([
    `Offene PRs: ${c.prs} (GitHub ${c.github}, Bitbucket ${c.bitbucket}, Bots ${c.bots})`,
    `Stopp-Kandidaten: ${c.stops.total} (Text ${c.stops.text}, Label ${c.stops.label}, Kommentar ${c.stops.comment}) in ${c.prsWithStops} PRs`,
    `Braucht: ${c.needs}, Paired-with: ${c.pairedWith}, 🚧 entfernen: ${c.labelRemovals}, Entwurf: ${c.drafts}, veraltet: ${c.stale}`,
    bitbucket.unreadable.length ? `Nicht lesbare Bitbucket-Repos: ${bitbucket.unreadable.length}` : '',
    `Plan: ${resolve(o.out)}${o.md ? `, ${resolve(o.md)}` : ''}. Nichts geändert.`,
  ].filter(Boolean).join('\n'));
  return 0;
}

async function apply(o) {
  const data = JSON.parse(readFileSync(resolve(o.plan), 'utf8').replace(/^﻿/, ''));
  const r = await applyPlan(data, forgeClient(), { log: (line) => console.log(line) });
  if (r.done.length) console.log(`Erledigt:\n${r.done.map((d) => `- ${d}`).join('\n')}`);
  if (r.problems.length) console.error(`Nicht erledigt:\n${r.problems.map((p) => `- ${p}`).join('\n')}`);
  if (!r.done.length && !r.problems.length) console.log('Keine entschiedenen Einträge, nichts geändert.');
  return r.ok ? 0 : 1;
}

async function main(argv) {
  try {
    const o = parseArgs(argv);
    return await { plan, apply }[o.command](o);
  } catch (e) {
    if (e instanceof UsageError) console.error(`${e.message}\n\n${USAGE}`);
    else console.error(`Fehlgeschlagen: ${e.message}`);
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
