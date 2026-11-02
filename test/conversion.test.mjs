import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allStopPhrases } from '../lib/pr-rules.mjs';
import { DRAFT_COMMENT, applyPlan, bodySha, buildPlan, insertHeadLines, renderMarkdown, stopLine } from '../lib/conversion.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/convert-open-prs.mjs', import.meta.url));
const NOW = '2026-11-02T09:00:00Z';
const OWNERS = { github: ['owner-login'], bitbucket: ['Owner Name'] };
const SECTION = '## Abhängigkeiten und Reihenfolge\nKeine.\n';

let next = 1;
const pr = (over = {}) => {
  const number = over.number ?? next++;
  const forge = over.forge ?? 'github';
  const repo = over.repo ?? 'example-api';
  return {
    forge, owner: forge === 'github' ? 'example-org' : 'example-ws', repo, number,
    url: forge === 'github' ? `https://github.com/example-org/${repo}/pull/${number}` : `https://bitbucket.org/example-ws/${repo}/pull-requests/${number}`,
    title: 't', body: SECTION, draft: false, head: `feat/topic-${number}`, base: 'beta', headSha: 'a'.repeat(40),
    author: { login: 'dev-a', type: 'User' }, createdAt: '2026-10-20T08:00:00Z', updatedAt: '2026-10-30T08:00:00Z',
    labels: ['✅ Bereit zum Review'], lastCommitAt: '2026-10-30T07:00:00Z', readyEventAt: null, comments: [], aheadBy: 3,
    ...over,
  };
};
const plan = (prs, opts = {}) => buildPlan(prs, { now: NOW, owners: OWNERS, bitbucketRepos: ['example-hub'], ...opts });
const entry = (p, prs) => plan(prs ?? [p]).prs.find((e) => e.key === `${p.forge}:${p.repo}#${p.number}`);

test('allStopPhrases returns every hit, and reads the dependency section only when asked', () => {
  const body = 'Bitte nicht mergen, bis X da ist. Danach ja.\n\nDo not merge before Y.\n\n## Abhängigkeiten und Reihenfolge\nErst mergen, wenn Z live ist.\n';
  assert.deepEqual(allStopPhrases(body).map((p) => p.quote), ['Bitte nicht mergen, bis X da ist.', 'Do not merge before Y.']);
  assert.deepEqual(allStopPhrases(body, 0, { keepDependencySection: true }).map((p) => p.quote),
    ['Bitte nicht mergen, bis X da ist.', 'Do not merge before Y.', 'Erst mergen, wenn Z live ist.']);
  const extra = [{ kind: 'soft', patterns: [/\bhält\b[^.\n]{0,80}\bzurück\b/i] }];
  assert.deepEqual(allStopPhrases('Der PR hält die API zurück, bis #3 durch ist.', 0, { extra }), [{ kind: 'soft', quote: 'Der PR hält die API zurück, bis #3 durch ist.' }]);
});

test('a quote keeps its inline code, so the stop line repeats the sentence word for word', () => {
  assert.deepEqual(allStopPhrases('Bitte nicht mergen, bis `class live` gesetzt ist. Danach ja.').map((p) => p.quote), ['Bitte nicht mergen, bis `class live` gesetzt ist.']);
  assert.deepEqual(allStopPhrases('Use `do not merge` as the label text.'), []);
});

test('"erst nach" is a candidate only near merging, live or beta', () => {
  const quotes = (body) => entry(pr({ body: `${body}\n\n${SECTION}` })).stops.map((s) => s.quote);
  assert.deepEqual(quotes('Anlegen geht erst nach dem Kürzen.'), []);
  assert.deepEqual(quotes('Erst nach Validierung auf Beta.'), ['Erst nach Validierung auf Beta.']);
  assert.deepEqual(quotes('Gemergt wird erst nach dem Gespräch.'), ['Gemergt wird erst nach dem Gespräch.']);
});

test('a stop sentence in the text becomes a candidate with its line, and nothing is decided', () => {
  const e = entry(pr({ body: `Intro.\n\nBitte nicht mergen, bevor das Update durch ist.\n\n${SECTION}` }));
  assert.deepEqual(e.stops.map(({ id, source, strength, quote, line, decision }) => ({ id, source, strength, quote, line, decision })), [{
    id: 'S1', source: 'text', strength: 'rule', quote: 'Bitte nicht mergen, bevor das Update durch ist.',
    line: 'Merge-Stopp: Bitte nicht mergen, bevor das Update durch ist. (übernommen aus Text)', decision: null,
  }]);
});

test('stop sentences in the dependency section and softer wordings are candidates too', () => {
  const body = `Der PR hält die Freigabe zurück, bis #9 durch ist.\n\n## Abhängigkeiten und Reihenfolge\nErst mergen, wenn die API live ist.\n`;
  const e = entry(pr({ body }));
  assert.deepEqual(e.stops.map((s) => [s.strength, s.quote]), [
    ['rule', 'Erst mergen, wenn die API live ist.'],
    ['soft', 'Der PR hält die Freigabe zurück, bis #9 durch ist.'],
  ]);
});

test('a misplaced stop line is a candidate; a stop already in the head block is not repeated', () => {
  const body = `Merge-Stopp: wait for the release\n\nText\n**Merge-Stopp:** after the audit\n\n${SECTION}`;
  const e = entry(pr({ body, forge: 'bitbucket', repo: 'example-hub', labels: [] }));
  assert.deepEqual(e.stops.map((s) => [s.strength, s.quote, s.line]), [['line', 'after the audit', 'Merge-Stopp: after the audit (übernommen aus Text)']]);
  assert.deepEqual(e.headBlock.stops, ['wait for the release']);
});

test('stop labels become candidates; only 🚧 gets removed, tied to its stop; ✅ stays', () => {
  const e = entry(pr({ labels: ['⛔ Nicht mergen', '🚧 Überarbeiten', '✅ Bereit zum Review'] }));
  assert.deepEqual(e.stops.map((s) => [s.id, s.source, s.quote, s.line]), [
    ['S1', 'label', '⛔ Nicht mergen', 'Merge-Stopp: ⛔ Nicht mergen (übernommen aus Label)'],
    ['S2', 'label', '🚧 Überarbeiten', 'Merge-Stopp: 🚧 Überarbeiten (übernommen aus Label)'],
  ]);
  assert.deepEqual(e.labels, [{ id: 'L1', action: 'remove', label: '🚧 Überarbeiten', afterStop: 'S2', decision: null }]);
});

test('comments count, but not pr-pruefen reports, bots or the run\'s own comment', () => {
  const comments = [
    { author: 'dev-b', at: '2026-10-29T08:00:00Z', url: 'u1', body: 'Bitte nicht mergen, bis Carol zugestimmt hat.' },
    { author: 'dev-b', at: '2026-10-29T09:00:00Z', url: 'u2', body: '## PR-Prüfung · Runde 1\n\nDo not merge.\n\npr-pruefen · Runde 1 · Head abc1234 · Kritisch offen: 1' },
    { author: 'ci-bot', isBot: true, at: '2026-10-29T10:00:00Z', url: 'u3', body: 'do not merge' },
    { author: 'owner-login', at: '2026-10-29T11:00:00Z', url: 'u4', body: DRAFT_COMMENT },
    { author: 'dev-b', at: '2026-10-29T12:00:00Z', url: 'u5', body: 'Merge-Stopp: until the migration ran' },
  ];
  const e = entry(pr({ comments }));
  assert.deepEqual(e.stops.map((s) => [s.source, s.quote, s.comment?.url]), [
    ['comment', 'Bitte nicht mergen, bis Carol zugestimmt hat.', 'u1'],
    ['comment', 'until the migration ran', 'u5'],
  ]);
  assert.equal(e.stops[0].line, 'Merge-Stopp: Bitte nicht mergen, bis Carol zugestimmt hat. (übernommen aus Kommentar)');
});

test('Braucht candidates come from open PRs named in the text, never from closed ones or the PR itself', () => {
  const other = pr({ repo: 'example-web', head: 'feat/web' });
  const body = `Siehe example-web#${other.number}, example-web#999 und #424242.\n\n${SECTION}`;
  const me = pr({ body });
  const e = entry(me, [me, other]);
  assert.deepEqual(e.needs.map(({ id, repo, number, line, decision }) => ({ id, repo, number, line, decision })),
    [{ id: 'N1', repo: 'example-web', number: other.number, line: `Braucht: example-web#${other.number}`, decision: null }]);
});

test('links to Bitbucket and GitHub PRs resolve; a Braucht line already there is not repeated', () => {
  const hub = pr({ forge: 'bitbucket', repo: 'example-hub', labels: [] });
  const api = pr({ repo: 'example-api' });
  const body = `Braucht: example-hub#${hub.number}\n\nHub: ${hub.url}\nAPI: ${api.url}\n\n${SECTION}`;
  const me = pr({ repo: 'example-web', body });
  assert.deepEqual(entry(me, [me, hub, api]).needs.map((n) => n.line), [`Braucht: example-api#${api.number}`]);
});

test('repo#n finds the open PR on the platform that has it, also when the name exists on both', () => {
  const api = pr({ repo: 'example-api' });
  const archived = pr({ forge: 'bitbucket', repo: 'example-api', number: 2600, labels: [] });
  const me = pr({ forge: 'bitbucket', repo: 'example-hub', labels: [], body: `API: example-api#${api.number}, alt: example-api#2600.\n\n${SECTION}` });
  const p = plan([me, api, archived], { bitbucketRepos: ['example-hub', 'example-api'] });
  assert.deepEqual(p.prs.find((e) => e.key === `bitbucket:example-hub#${me.number}`).needs.map((n) => n.key),
    [`github:example-api#${api.number}`, 'bitbucket:example-api#2600']);
});

test('a counterpart with a different branch name gets Paired-with on both sides; the same name gets none', () => {
  const hub = pr({ forge: 'bitbucket', repo: 'example-hub', head: 'feat/hub-side', labels: [] });
  const api = pr({ repo: 'example-api', head: 'feat/api-side', body: `Hub-Teil: ${hub.url}\n\n${SECTION}` });
  const p = plan([hub, api]);
  const byKey = (x) => p.prs.find((e) => e.key === `${x.forge}:${x.repo}#${x.number}`);
  assert.deepEqual(byKey(api).pairedWith.map((x) => x.line), [`Paired-with: example-hub ${hub.url}`]);
  assert.deepEqual(byKey(hub).pairedWith.map((x) => x.line), [`Paired-with: example-api ${api.url}`]);

  const same = pr({ repo: 'example-web', head: 'feat/api-side', body: `API: ${api.url}\n\n${SECTION}` });
  assert.deepEqual(entry(same, [same, api]).pairedWith, []);
});

test('a PR without any ready sign goes back to draft with the fixed comment', () => {
  const e = entry(pr({ labels: [] }));
  assert.deepEqual(e.draft, { id: 'D1', comment: DRAFT_COMMENT, stop: null, stale: false, hints: [], decision: null });
  assert.equal(DRAFT_COMMENT, '🤖 *Geschrieben von der KI im Auftrag von Marc.*\n\nIch habe diesen PR auf Entwurf gestellt, weil weder ✅ noch ein Kommentar „bereit“ daran stand; ist er fertig, nimm ihn aus dem Entwurf, das heißt nach den neuen PR-Regeln „bereit“: https://github.com/wemotion-gmbh/pr-regeln');
});

test('ready signs keep a PR out of draft: ✅, the ready event, or "bereit" by the author after the last push', () => {
  assert.equal(entry(pr({ labels: ['✅ Bereit zum Review'] })).draft, null);
  assert.equal(entry(pr({ labels: [], readyEventAt: '2026-10-25T08:00:00Z' })).draft, null);
  const after = { author: 'dev-a', at: '2026-10-30T08:00:00Z', url: 'c', body: '🤖 *Geschrieben von der KI im Auftrag von Dev.*\n\nbereit' };
  assert.equal(entry(pr({ labels: [], comments: [after] })).draft, null);
  const before = { ...after, at: '2026-10-29T08:00:00Z' };
  assert.notEqual(entry(pr({ labels: [], comments: [before] })).draft, null);
  const byOther = { ...after, author: 'dev-b' };
  assert.notEqual(entry(pr({ labels: [], comments: [byOther] })).draft, null);
});

test('a draft proposal tells the session about stops, staleness and ready words that did not count', () => {
  const late = { author: 'dev-a', at: '2026-10-30T09:00:00Z', url: 'c2', body: 'Nachtrag zu „bereit“: beta eingemergt.' };
  const e = entry(pr({ labels: [], comments: [late], updatedAt: '2026-10-01T08:00:00Z', body: `Merge-Stopp: x\n\n${SECTION}` }));
  assert.deepEqual([e.draft.stop, e.draft.stale, e.draft.hints], ['head', true, [{ at: late.at, url: 'c2', afterLastPush: true }]]);
  assert.equal(entry(pr({ labels: [], body: `Bitte nicht mergen.\n\n${SECTION}` })).draft.stop, 'candidate');
  assert.equal(entry(pr({ labels: [], body: `Die Liste zeigt PRs mit Merge-Stopp oben.\n\n${SECTION}` })).draft.stop, null);
});

test('no draft step for the owner, drafts, release and promotion PRs; bots are skipped entirely', () => {
  assert.equal(entry(pr({ labels: [], author: { login: 'owner-login' } })).draft, null);
  assert.equal(entry(pr({ labels: [], forge: 'bitbucket', repo: 'example-hub', author: { login: 'Owner Name' } })).draft, null);
  assert.equal(entry(pr({ labels: [], draft: true })).draft, null);
  assert.equal(entry(pr({ labels: [], head: 'release/2026-11-02' })).draft, null);
  assert.equal(entry(pr({ labels: [], head: 'beta', base: 'live' })).draft, null);
  const bot = entry(pr({ labels: [], author: { login: 'dependabot[bot]', type: 'Bot' }, body: 'do not merge' }));
  assert.equal(bot.skipped, 'bot');
  assert.deepEqual([bot.stops, bot.needs, bot.pairedWith, bot.labels, bot.draft, bot.stale], [[], [], [], [], null, null]);
});

test('stale candidates name their reasons and are grouped by author', () => {
  const idle = pr({ updatedAt: '2026-10-01T08:00:00Z', author: { login: 'dev-c' } });
  const merged = pr({ aheadBy: 0, author: { login: 'dev-c' } });
  const frozen = pr({ forge: 'bitbucket', repo: 'fusion-api-v3', labels: [], author: { login: 'Dev D' } });
  const fresh = pr({});
  const p = plan([idle, merged, frozen, fresh]);
  const reasons = (x) => p.prs.find((e) => e.key === `${x.forge}:${x.repo}#${x.number}`).stale?.reasons ?? null;
  assert.deepEqual(reasons(idle), ['seit 32 Tagen ohne Bewegung']);
  assert.deepEqual(reasons(merged), ['nichts mehr vor der Basis']);
  assert.deepEqual(reasons(frozen), ['Repo eingefroren']);
  assert.equal(reasons(fresh), null);
  assert.deepEqual(p.staleByAuthor, { 'dev-c': [`github:example-api#${idle.number}`, `github:example-api#${merged.number}`], 'Dev D': [`bitbucket:fusion-api-v3#${frozen.number}`] });
});

test('the plan keeps what apply checks and counts every step', () => {
  const p = plan([pr({ labels: ['🚧 Überarbeiten'], body: `Bitte nicht mergen.\n\n${SECTION}` })]);
  const [e] = p.prs;
  assert.equal(e.bodySha, bodySha(e.body));
  assert.equal(e.headSha, 'a'.repeat(40));
  assert.equal(e.aheadBy, 3);
  assert.deepEqual(p.counts.stops, { total: 2, text: 1, label: 1, comment: 0 });
  assert.equal(p.counts.labelRemovals, 1);
  assert.equal(p.counts.drafts, 1);
  assert.equal(p.counts.draftsPlain, 0);
  assert.match(renderMarkdown(p), /Bitte nicht mergen\./);
});

test('stopLine names the source', () => {
  assert.equal(stopLine('x', 'comment'), 'Merge-Stopp: x (übernommen aus Kommentar)');
  assert.equal(stopLine(' y \n z', 'text'), 'Merge-Stopp: y z (übernommen aus Text)');
});

test('stopLine leaves out the heading or list marker a quoted line starts with', () => {
  assert.equal(stopLine('## ⚠️ Vor dem Release nicht mergen', 'text'), 'Merge-Stopp: ⚠️ Vor dem Release nicht mergen (übernommen aus Text)');
  assert.equal(stopLine('- Erst nach dem Beta-Lauf.', 'text'), 'Merge-Stopp: Erst nach dem Beta-Lauf. (übernommen aus Text)');
  assert.equal(stopLine('> * Bitte nicht mergen.', 'comment'), 'Merge-Stopp: Bitte nicht mergen. (übernommen aus Kommentar)');
  assert.equal(stopLine('#12 zuerst.', 'text'), 'Merge-Stopp: #12 zuerst. (übernommen aus Text)');
  assert.equal(stopLine('-', 'text'), 'Merge-Stopp: (ohne Grund) (übernommen aus Text)');
});

test('insertHeadLines puts new lines on top and leaves the rest of the text as it was', () => {
  assert.equal(insertHeadLines('Text\nmore\n', 'github', ['Merge-Stopp: a']), 'Merge-Stopp: a\n\nText\nmore\n');
  assert.equal(insertHeadLines('Braucht: x#1\n\nText', 'github', ['Merge-Stopp: a']), 'Braucht: x#1\nMerge-Stopp: a\n\nText');
  assert.equal(insertHeadLines('<!--\nnote\n-->\n## Worum\nText', 'github', ['Merge-Stopp: a']), '<!--\nnote\n-->\nMerge-Stopp: a\n\n## Worum\nText');
  assert.equal(insertHeadLines('Text\r\nmore', 'github', ['Merge-Stopp: a']), 'Merge-Stopp: a\r\n\r\nText\r\nmore');
  assert.equal(insertHeadLines('Merge\\-Stopp: old\n\nText \\*kept\\*', 'bitbucket', ['Merge-Stopp: a']), 'Merge\\-Stopp: old\nMerge-Stopp: a\n\nText \\*kept\\*');
  assert.equal(insertHeadLines('', 'github', ['Merge-Stopp: a']), 'Merge-Stopp: a\n');
  assert.equal(insertHeadLines('Merge-Stopp: a\n\nText', 'github', ['Merge-Stopp: a']), 'Merge-Stopp: a\n\nText');
});

// A client that records every call and serves the state it was given.
function fakeClient(states) {
  const calls = [];
  const state = new Map(Object.entries(states));
  return {
    calls,
    state,
    async fetchState(p) { calls.push(['fetch', p.key]); return structuredClone(state.get(p.key)); },
    async setBody(p, body) { calls.push(['body', p.key]); state.get(p.key).body = body; },
    async removeLabel(p, label) { calls.push(['label', p.key, label]); },
    async setDraft(p) { calls.push(['draft', p.key]); },
    async comment(p, text) { calls.push(['comment', p.key, text]); },
  };
}

function decided(over = {}) {
  const p = plan([pr({ number: 7, labels: ['🚧 Überarbeiten'], body: `Bitte nicht mergen.\n\n${SECTION}`, ...over })]);
  const [e] = p.prs;
  return { p, e, states: { [e.key]: { headSha: e.headSha, body: e.body, draft: false, labels: e.prLabels } } };
}

test('apply runs only decided entries, in the fixed order, and removes 🚧 only after its stop line is on the PR', async () => {
  const { p, e, states } = decided();
  for (const s of e.stops) s.decision = 'stop';
  e.labels[0].decision = 'yes';
  e.draft.decision = 'yes';
  const client = fakeClient(states);
  const r = await applyPlan(p, client);
  assert.equal(r.ok, true);
  assert.deepEqual(client.calls.map((c) => c.slice(0, 2).join(' ')), [
    `fetch ${e.key}`, `fetch ${e.key}`, `body ${e.key}`, `fetch ${e.key}`, `label ${e.key}`, `draft ${e.key}`, `comment ${e.key}`,
  ]);
  assert.equal(client.calls.find((c) => c[0] === 'comment')[2], DRAFT_COMMENT);
  assert.match(client.state.get(e.key).body, /^Merge-Stopp: Bitte nicht mergen\. \(übernommen aus Text\)\nMerge-Stopp: 🚧 Überarbeiten \(übernommen aus Label\)\n\nBitte nicht mergen\./);
});

test('apply leaves 🚧 on when its stop was judged no stop, and does nothing undecided', async () => {
  const { p, e, states } = decided();
  e.stops[0].decision = 'stop';
  e.stops[1].decision = 'no-stop';
  e.labels[0].decision = 'yes';
  const client = fakeClient(states);
  const r = await applyPlan(p, client);
  assert.equal(r.ok, false);
  assert.ok(!client.calls.some((c) => c[0] === 'label' || c[0] === 'draft' || c[0] === 'comment'));
  assert.match(r.problems.join('\n'), /🚧/);
});

test('apply changes nothing when a PR moved since the plan: head, text, draft or labels', async () => {
  const moves = {
    head: (s) => { s.headSha = 'b'.repeat(40); },
    text: (s) => { s.body = `${s.body}\nNachtrag`; },
    draft: (s) => { s.draft = true; },
    labels: (s) => { s.labels = [...s.labels, '✅ Bereit zum Review']; },
  };
  for (const [name, move] of Object.entries(moves)) {
    const { p, e, states } = decided();
    e.stops[0].decision = 'stop';
    move(states[e.key]);
    const client = fakeClient(states);
    const r = await applyPlan(p, client);
    assert.equal(r.ok, false, name);
    assert.deepEqual(client.calls.map((c) => c[0]), ['fetch'], name);
    assert.match(r.problems[0], /neuer Stand/, name);
  }
});

test('apply refuses unknown decisions before it reads anything', async () => {
  const { p, e, states } = decided();
  e.stops[0].decision = 'maybe';
  const client = fakeClient(states);
  await assert.rejects(applyPlan(p, client), /maybe/);
  assert.deepEqual(client.calls, []);
});

test('apply stops a PR when the written stop line is not on it afterwards', async () => {
  const { p, e, states } = decided();
  e.stops[0].decision = 'stop';
  e.draft.decision = 'yes';
  const client = fakeClient(states);
  client.setBody = async (x) => { client.calls.push(['body', x.key]); };
  const r = await applyPlan(p, client);
  assert.equal(r.ok, false);
  assert.ok(!client.calls.some((c) => c[0] === 'draft'));
});

test('the script: apply without --yes and plan without the Bitbucket owner end with 2 before any access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'convert-'));
  const file = join(dir, 'plan.json');
  writeFileSync(file, JSON.stringify({ version: 1, prs: [] }));
  const env = { ...process.env, GH_TOKEN: 'invalid', BITBUCKET_USER: '', BITBUCKET_API_TOKEN: '' };
  const apply = spawnSync(process.execPath, [SCRIPT, 'apply', '--plan', file], { encoding: 'utf8', env });
  assert.equal(apply.status, 2);
  assert.match(apply.stderr, /--yes/);
  const planRun = spawnSync(process.execPath, [SCRIPT, 'plan', '--out', join(dir, 'out.json')], { encoding: 'utf8', env });
  assert.equal(planRun.status, 2);
  assert.match(planRun.stderr, /--owner-bitbucket/);
});
