// The one-time conversion of open PRs to the PR rules. The plan only proposes: whether a sentence is a stop is
// judged by a session per PR, and apply carries out the decided entries, only in the safe direction (lines are
// added, never removed or reworded; a stop label goes only once its stop line stands).
import { createHash } from 'node:crypto';
import {
  FIXED_BRANCHES, READY_LABEL_OLD, allStopPhrases, firstContentLine, forgeOfRepo, isBot, normalizeBody, parseHeadBlock, stopLines,
} from './pr-rules.mjs';

export const DRAFT_COMMENT = '🤖 *Geschrieben von der KI im Auftrag von Marc.*\n\nIch habe diesen PR auf Entwurf gestellt, weil weder ✅ noch ein Kommentar „bereit“ daran stand; ist er fertig, nimm ihn aus dem Entwurf, das heißt nach den neuen PR-Regeln „bereit“: https://github.com/wemotion-gmbh/pr-regeln';

const STOP_LABELS = Object.freeze(['⛔ Nicht mergen', '🚧 Überarbeiten']);
// Only the rework label goes at the conversion; the stop and ready labels stay until the old labels are deleted after T2.
const REWORK_LABEL = '🚧 Überarbeiten';
const FROZEN = Object.freeze([{ forge: 'bitbucket', repo: 'fusion-api-v3' }]);
const IDLE_DAYS = 21;
const SOURCE_WORD = Object.freeze({ text: 'Text', label: 'Label', comment: 'Kommentar' });
// Wordings the check leaves out because they also describe things. Here they only make a candidate for the session.
const SOFT = Object.freeze([{
  kind: 'soft',
  patterns: [
    /\bnie\s+(?:ge)?merg\w*/i,
    /\bnicht\s+gemergt\b/i,
    /\bhält\b[^.\n]{0,80}\bzurück\b/i,
    /\bzurückhalten\b/i,
    // "erst nach" alone is mostly about order in the code; it counts near merging, live, beta or a release.
    /\berst\s+(?:nach|wenn|sobald)\b[^.\n]{0,120}\b(?:merg\w*|gemergt|live|beta|freigegeben|freigabe|ausgerollt)\b/i,
    /\b(?:merg\w*|gemergt)\b[^.\n]{0,60}\berst\s+(?:nach|wenn|sobald)\b/i,
    /\bbevor\b[^.\n]{0,80}\b(?:live|gemergt|ausgerollt)\b/i,
    /\bnot\s+(?:be\s+)?merged\b/i,
    /\bon\s+hold\b/i,
  ],
}]);
// Title and footer of a pr-pruefen report; earlier reports never count as a stop source.
const REPORT_MARKS = Object.freeze(['PR-Prüfung · Runde', 'pr-pruefen · Runde']);
const STOP_DECISIONS = Object.freeze(['stop', 'no-stop', null]);
const YES_NO = Object.freeze(['yes', 'no', null]);
const DAY = 24 * 60 * 60 * 1000;

const GITHUB_PR_URL = /https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/g;
const BITBUCKET_PR_URL = /https:\/\/bitbucket\.org\/[\w.-]+\/([\w.-]+)\/pull-requests\/(\d+)/g;
const REPO_REF = /(?<![\w./-])([A-Za-z][\w.-]*)#(\d+)\b/g;
const BARE_REF = /(?<![\w#&/-])#(\d+)\b/g;

export const bodySha = (body) => createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex');

// A quoted heading or list item would otherwise read "Merge-Stopp: ## …" or "Merge-Stopp: - …".
const LEADING_MARKS = /^(?:#{1,6}\s+|[-*+>](?:\s+|$))+/;

export function stopLine(quote, source) {
  const text = String(quote ?? '').replace(/\s+/g, ' ').trim().replace(LEADING_MARKS, '') || '(ohne Grund)';
  return `Merge-Stopp: ${text} (übernommen aus ${SOURCE_WORD[source] ?? source})`;
}

const keyOf = (forge, repo, number) => `${forge}:${repo}#${number}`;
const heading = (level, text) => `${'#'.repeat(level)} ${text}`;

function headEntry(line) {
  const e = parseHeadBlock(line).entries[0];
  return e ? { key: e.key, value: e.value } : null;
}

function hasHeadLine(headBlock, line) {
  const x = headEntry(line);
  return Boolean(x) && headBlock.entries.some((e) => e.key === x.key && e.value === x.value);
}

/**
 * Adds head lines at the end of the head block, or on top of the text (after leading blank lines and HTML comments)
 * with a blank line after them. Everything else stays as it was, Bitbucket escapes and line endings included.
 */
export function insertHeadLines(raw, forge, lines) {
  const text = String(raw ?? '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rawLines = text.split(/\r\n|\r|\n/);
  const norm = normalizeBody(text, forge);
  const headBlock = parseHeadBlock(norm);
  const add = [...new Set(lines)].filter((l) => !hasHeadLine(headBlock, l));
  if (!add.length) return text;
  if (text.trim() === '') return `${add.join(eol)}${eol}`;
  if (headBlock.entries.length) return [...rawLines.slice(0, headBlock.end), ...add, ...rawLines.slice(headBlock.end)].join(eol);
  const at = firstContentLine(norm.split('\n'));
  const blankAfter = at < rawLines.length && rawLines[at].trim() !== '';
  return [...rawLines.slice(0, at), ...add, ...(blankAfter ? [''] : []), ...rawLines.slice(at)].join(eol);
}

const isReviewReport = (body) => REPORT_MARKS.some((m) => String(body ?? '').includes(m));
const isConversionComment = (body) => String(body ?? '').trim() === DRAFT_COMMENT;

// Comments that count as a stop source: no bots, no pr-pruefen reports, not the run's own sentence.
function readableComments(pr) {
  return (pr.comments ?? []).filter((c) => !c.isBot && !isReviewReport(c.body) && !isConversionComment(c.body));
}

const strengthOf = (kind) => (kind === 'soft' ? 'soft' : kind === 'mention' ? 'mention' : 'rule');

function stopsInText(text, headBlock) {
  const headLines = new Set(headBlock.entries.map((e) => e.line));
  const rest = text.split('\n').filter((_, i) => !headLines.has(i)).join('\n');
  const found = [];
  for (const value of stopLines(rest)) {
    if (!headBlock.stops.includes(value)) found.push({ strength: 'line', quote: value });
  }
  for (const p of allStopPhrases(text, headBlock.end, { keepDependencySection: true, extra: SOFT })) {
    found.push({ strength: strengthOf(p.kind), quote: p.quote });
  }
  return found;
}

function stopCandidates(pr, headBlock) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    const k = `${c.source}|${c.quote}`;
    if (seen.has(k) || headBlock.stops.includes(c.quote)) return;
    seen.add(k);
    out.push({ id: `S${out.length + 1}`, ...c, line: stopLine(c.quote, c.source), decision: null });
  };
  for (const c of stopsInText(normalizeBody(pr.body, pr.forge), headBlock)) add({ source: 'text', ...c });
  for (const label of STOP_LABELS.filter((l) => (pr.labels ?? []).includes(l))) add({ source: 'label', strength: 'label', quote: label });
  const none = parseHeadBlock('');
  for (const c of readableComments(pr)) {
    for (const hit of stopsInText(normalizeBody(c.body, pr.forge), none)) {
      add({ source: 'comment', ...hit, comment: { author: c.author, at: c.at, url: c.url } });
    }
  }
  return out;
}

/** Text that may name other PRs: the PR text without its head block and HTML comments, code included. */
function refText(pr, headBlock) {
  const headLines = new Set(headBlock.entries.map((e) => e.line));
  return normalizeBody(pr.body, pr.forge).split('\n').filter((_, i) => !headLines.has(i)).join('\n').replace(/<!--[\s\S]*?-->/g, '');
}

function referencedKeys(pr, headBlock, bitbucketRepos, known) {
  let text = refText(pr, headBlock);
  const keys = [];
  for (const [re, forge] of [[GITHUB_PR_URL, 'github'], [BITBUCKET_PR_URL, 'bitbucket']]) {
    for (const m of text.matchAll(re)) keys.push(keyOf(forge, m[1], Number(m[2])));
    text = text.replace(re, ' ');
  }
  // A name can exist on both platforms (an archived copy on the other side); the open PR decides which one is meant.
  for (const m of text.matchAll(REPO_REF)) {
    const forge = forgeOfRepo(m[1], { bitbucketRepos });
    const first = keyOf(forge, m[1], Number(m[2]));
    const second = keyOf(forge === 'github' ? 'bitbucket' : 'github', m[1], Number(m[2]));
    keys.push(known.has(first) || !known.has(second) ? first : second);
  }
  text = text.replace(REPO_REF, ' ');
  for (const m of text.matchAll(BARE_REF)) keys.push(keyOf(pr.forge, pr.repo, Number(m[1])));
  return [...new Set(keys)];
}

// "bereit" or "ready" as the first word, also below the attribution line of an AI comment.
function isReadyComment(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const text = lines.filter((l) => !l.trim().startsWith('🤖')).join('\n').trim();
  return /^(bereit|ready)\b/i.test(text.replace(/^[„“"'*_\s]+/, ''));
}

function readySigns(pr) {
  const signs = [];
  if ((pr.labels ?? []).includes(READY_LABEL_OLD)) signs.push('label');
  if (pr.readyEventAt) signs.push('event');
  const after = pr.lastCommitAt ? Date.parse(pr.lastCommitAt) : null;
  if ((pr.comments ?? []).some((c) => c.author === pr.author?.login && isReadyComment(c.body) && (after === null || Date.parse(c.at) > after))) {
    signs.push('comment');
  }
  return signs;
}

// The author's comments that name "bereit" or "ready" without counting as a ready sign, for the session to weigh.
function readyHints(pr) {
  const after = pr.lastCommitAt ? Date.parse(pr.lastCommitAt) : null;
  return (pr.comments ?? [])
    .filter((c) => c.author === pr.author?.login && /\b(bereit|ready)\b/i.test(c.body ?? ''))
    .map((c) => ({ at: c.at, url: c.url, afterLastPush: after === null || Date.parse(c.at) > after }));
}

function draftEntry(pr, isOwner, { headBlock, stops, stale }) {
  if (pr.draft || isOwner) return null;
  // Release and promotion PRs are merged once green, without a ready sign.
  if (FIXED_BRANCHES.includes(pr.head) || String(pr.head).startsWith('release/')) return null;
  if (readySigns(pr).length) return null;
  const candidate = stops.some((s) => s.strength !== 'mention' && s.strength !== 'soft');
  return {
    id: 'D1', comment: DRAFT_COMMENT,
    stop: headBlock.stops.length ? 'head' : candidate ? 'candidate' : null,
    stale: Boolean(stale), hints: readyHints(pr), decision: null,
  };
}

function staleEntry(pr, now) {
  const reasons = [];
  if (FROZEN.some((f) => f.forge === pr.forge && f.repo === pr.repo)) reasons.push('Repo eingefroren');
  const idle = pr.updatedAt ? Math.floor((now - Date.parse(pr.updatedAt)) / DAY) : null;
  if (idle !== null && idle >= IDLE_DAYS) reasons.push(`seit ${idle} Tagen ohne Bewegung`);
  if (pr.aheadBy === 0) reasons.push('nichts mehr vor der Basis');
  return reasons.length ? { id: 'X1', reasons, decision: null } : null;
}

/**
 * Plans the conversion of the given open PRs. `owners` lists the author names whose PRs never go back to draft
 * ({ github: [login], bitbucket: [display name] }); `bitbucketRepos` tells which `repo#n` references mean Bitbucket.
 */
export function buildPlan(prs, { now = new Date().toISOString(), owners = { github: [], bitbucket: [] }, bitbucketRepos = [] } = {}) {
  const nowMs = Date.parse(now);
  const known = new Set(prs.map((p) => keyOf(p.forge, p.repo, p.number)));
  const entries = prs.map((pr) => {
    const key = keyOf(pr.forge, pr.repo, pr.number);
    const headBlock = parseHeadBlock(normalizeBody(pr.body, pr.forge));
    const isOwner = (owners[pr.forge] ?? []).includes(pr.author?.login);
    const base = {
      key, forge: pr.forge, owner: pr.owner, repo: pr.repo, number: pr.number, url: pr.url, title: pr.title,
      author: pr.author?.login ?? null, isOwner, isDraft: Boolean(pr.draft), head: pr.head, base: pr.base,
      headSha: pr.headSha, bodySha: bodySha(pr.body), createdAt: pr.createdAt, updatedAt: pr.updatedAt, prLabels: pr.labels ?? [], aheadBy: pr.aheadBy ?? null,
      headBlock: { stops: headBlock.stops, needs: headBlock.needs, pairedWith: headBlock.pairedWith },
      body: pr.body ?? '', comments: pr.comments ?? [], commentsTruncated: Boolean(pr.commentsTruncated),
    };
    if (isBot(pr.author)) return { ...base, skipped: 'bot', stops: [], needs: [], pairedWith: [], labels: [], draft: null, stale: null, refs: [] };
    const stops = stopCandidates(pr, headBlock);
    const rework = stops.find((s) => s.source === 'label' && s.quote === REWORK_LABEL);
    const stale = staleEntry(pr, nowMs);
    return {
      ...base,
      draft: draftEntry(pr, isOwner, { headBlock, stops, stale }),
      stale,
      stops,
      labels: rework ? [{ id: 'L1', action: 'remove', label: REWORK_LABEL, afterStop: rework.id, decision: null }] : [],
      refs: referencedKeys(pr, headBlock, bitbucketRepos, known).filter((k) => k !== key && known.has(k)),
      needs: [],
      pairedWith: [],
      headNeeds: headBlock.needs,
      headPairs: headBlock.pairedWith,
    };
  });

  const byKey = new Map(entries.map((e) => [e.key, e]));
  const addPair = (from, to) => {
    if (from.skipped || from.head === to.head || (from.forge === to.forge && from.repo === to.repo)) return;
    if ((from.headPairs ?? []).some((p) => p.url === to.url || p.repo === to.repo)) return;
    if (from.pairedWith.some((p) => p.key === to.key)) return;
    from.pairedWith.push({
      id: `P${from.pairedWith.length + 1}`, key: to.key, repo: to.repo, number: to.number, url: to.url, otherHead: to.head,
      line: `Paired-with: ${to.repo} ${to.url}`, decision: null,
    });
  };
  for (const e of entries) {
    for (const k of e.refs) {
      const other = byKey.get(k);
      if (!e.skipped && !e.headNeeds.some((n) => n.repo === other.repo && n.number === other.number)) {
        e.needs.push({
          id: `N${e.needs.length + 1}`, key: other.key, repo: other.repo, number: other.number, url: other.url,
          line: `Braucht: ${other.repo}#${other.number}`, decision: null,
        });
      }
      addPair(e, other);
      addPair(other, e);
    }
  }
  for (const e of entries) {
    delete e.headNeeds;
    delete e.headPairs;
  }

  const staleByAuthor = {};
  for (const e of entries.filter((x) => x.stale)) (staleByAuthor[e.author] ??= []).push(e.key);
  const stops = entries.flatMap((e) => e.stops);
  const counts = {
    prs: entries.length,
    github: entries.filter((e) => e.forge === 'github').length,
    bitbucket: entries.filter((e) => e.forge === 'bitbucket').length,
    bots: entries.filter((e) => e.skipped === 'bot').length,
    stops: {
      total: stops.length,
      text: stops.filter((s) => s.source === 'text').length,
      label: stops.filter((s) => s.source === 'label').length,
      comment: stops.filter((s) => s.source === 'comment').length,
    },
    stopStrengths: Object.fromEntries(['rule', 'soft', 'line', 'mention', 'label'].map((k) => [k, stops.filter((s) => s.strength === k).length])),
    prsWithStops: entries.filter((e) => e.stops.length).length,
    needs: entries.flatMap((e) => e.needs).length,
    pairedWith: entries.flatMap((e) => e.pairedWith).length,
    labelRemovals: entries.flatMap((e) => e.labels).length,
    drafts: entries.filter((e) => e.draft).length,
    draftsPlain: entries.filter((e) => e.draft && !e.draft.stop && !e.draft.stale).length,
    stale: entries.filter((e) => e.stale).length,
    staleAuthors: Object.keys(staleByAuthor).length,
  };
  return { version: 1, createdAt: now, owners, counts, staleByAuthor, prs: entries };
}

// ---------------------------------------------------------------------------
// Markdown for the cockpit page

const cell = (s, max = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return (t.length > max ? `${t.slice(0, max - 1)}…` : t).replace(/\|/g, '\\|');
};

export function renderMarkdown(plan) {
  const c = plan.counts;
  const out = [
    heading(1, 'Umstellungslauf PR-Regeln: Probelauf'),
    '',
    `Stand ${plan.createdAt}. Nur gelesen, nichts geändert. Jede Zeile ist ein Vorschlag; entschieden wird je PR.`,
    '',
    heading(2, 'Zahlen'),
    '',
    `- Offene PRs: ${c.prs} (GitHub ${c.github}, Bitbucket ${c.bitbucket}), davon Bots ${c.bots}`,
    `- Stopp-Kandidaten: ${c.stops.total} in ${c.prsWithStops} PRs (Text ${c.stops.text}, Label ${c.stops.label}, Kommentar ${c.stops.comment}); `
      + `Wendung der Prüfung ${c.stopStrengths.rule}, weichere Wendung ${c.stopStrengths.soft}, Zeile an falscher Stelle ${c.stopStrengths.line}, `
      + `Erwähnung ${c.stopStrengths.mention}, Label ${c.stopStrengths.label}`,
    `- Braucht: ${c.needs}`,
    `- Paired-with: ${c.pairedWith}`,
    `- 🚧 entfernen: ${c.labelRemovals}`,
    `- Zurück auf Entwurf: ${c.drafts}, davon ohne Stopp und nicht veraltet ${c.draftsPlain}`,
    `- Veraltet: ${c.stale} PRs von ${c.staleAuthors} Autoren`,
    '',
    heading(2, 'PRs mit Vorschlägen'),
    '',
    '| PR | Autor | Stopps | Braucht / Paired-with | 🚧 | Entwurf | veraltet |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const e of plan.prs) {
    if (!(e.stops.length || e.needs.length || e.pairedWith.length || e.labels.length || e.draft || e.stale)) continue;
    const stops = e.stops.map((s) => `${s.id} ${SOURCE_WORD[s.source]} (${s.strength}): „${cell(s.quote)}“`).join('<br>');
    const deps = [...e.needs.map((n) => `${n.id} ${n.line}`), ...e.pairedWith.map((p) => `${p.id} Paired-with: ${p.repo}#${p.number}`)]
      .map((x) => cell(x)).join('<br>');
    const pr = `[${e.repo}#${e.number}](${e.url})`;
    const draft = e.draft ? ['ja', e.draft.stop ? `Stopp (${e.draft.stop === 'head' ? 'Kopfzeile' : 'Kandidat'})` : '', e.draft.hints.length ? `${e.draft.hints.length}× „bereit“ erwähnt` : '']
      .filter(Boolean).join(', ') : '';
    out.push(`| ${pr} | ${cell(e.author)} | ${stops} | ${deps} | ${e.labels.map((l) => l.id).join(' ')} | ${draft} | ${cell(e.stale?.reasons.join(', ') ?? '')} |`);
  }
  out.push('', heading(2, 'Veraltet, nach Autor'), '');
  for (const [author, keys] of Object.entries(plan.staleByAuthor)) {
    const items = keys.map((k) => {
      const e = plan.prs.find((x) => x.key === k);
      return `[${e.repo}#${e.number}](${e.url}) (${e.stale.reasons.join(', ')})`;
    });
    out.push(`- **${cell(author)}**: ${items.join('; ')}`);
  }
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Apply

const yes = (x) => x?.decision === 'yes';

function validate(plan) {
  for (const e of plan.prs ?? []) {
    for (const s of e.stops ?? []) {
      if (!STOP_DECISIONS.includes(s.decision ?? null)) throw new Error(`${e.key} ${s.id}: Entscheidung „${s.decision}“ ist weder „stop“ noch „no-stop“.`);
    }
    for (const x of [...(e.needs ?? []), ...(e.pairedWith ?? []), ...(e.labels ?? []), ...(e.draft ? [e.draft] : [])]) {
      if (!YES_NO.includes(x.decision ?? null)) throw new Error(`${e.key} ${x.id}: Entscheidung „${x.decision}“ ist weder „yes“ noch „no“.`);
    }
  }
}

const hasWork = (e) => (e.stops ?? []).some((s) => s.decision === 'stop')
  || [...(e.needs ?? []), ...(e.pairedWith ?? []), ...(e.labels ?? [])].some(yes) || yes(e.draft);

const sameLabels = (a = [], b = []) => [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Carries out the decided entries. Every PR with work is read first; if any moved since the plan (head, text,
 * draft state or labels, so a ready label set since then keeps the PR out of draft), nothing is changed. Per PR
 * the order is fixed: head lines, then the rework label once its stop line stands, then back to draft with the
 * comment.
 */
export async function applyPlan(plan, client, { log = () => {} } = {}) {
  validate(plan);
  const work = (plan.prs ?? []).filter(hasWork);
  const problems = [];
  for (const e of work) {
    const s = await client.fetchState(e);
    if (s.headSha !== e.headSha || bodySha(s.body) !== e.bodySha || Boolean(s.draft) !== e.isDraft || !sameLabels(s.labels, e.prLabels)) {
      problems.push(`${e.key}: neuer Stand seit dem Plan (Head, Text, Entwurf oder Labels). Neu planen.`);
    }
  }
  if (problems.length) return { ok: false, problems, done: [] };

  const done = [];
  for (const e of work) {
    try {
      let state = await client.fetchState(e);
      const lines = [
        ...e.pairedWith.filter(yes).map((p) => `Paired-with: ${p.repo} ${p.url}`),
        ...e.needs.filter(yes).map((n) => `Braucht: ${n.repo}#${n.number}`),
        ...e.stops.filter((s) => s.decision === 'stop').map((s) => stopLine(s.quote, s.source)),
      ];
      if (lines.length) {
        const body = insertHeadLines(state.body, e.forge, lines);
        if (body !== state.body) {
          await client.setBody(e, body);
          state = await client.fetchState(e);
        }
        const written = parseHeadBlock(normalizeBody(state.body, e.forge));
        const missing = lines.filter((l) => !hasHeadLine(written, l));
        if (missing.length) {
          problems.push(`${e.key}: Nach dem Schreiben fehlt oben: ${missing.join(' | ')}. Den Rest dieses PRs habe ich ausgelassen.`);
          continue;
        }
        done.push(`${e.key}: ${lines.length} Kopfzeile(n)`);
        log(`${e.key}: ${lines.join(' | ')}`);
      }
      const headBlock = parseHeadBlock(normalizeBody(state.body, e.forge));
      for (const l of e.labels.filter(yes)) {
        const stop = e.stops.find((s) => s.id === l.afterStop);
        if (stop?.decision !== 'stop' || !hasHeadLine(headBlock, stopLine(stop.quote, stop.source))) {
          problems.push(`${e.key}: ${l.label} bleibt, weil seine Merge-Stopp-Zeile nicht oben steht.`);
          continue;
        }
        await client.removeLabel(e, l.label);
        done.push(`${e.key}: ${l.label} entfernt`);
      }
      if (yes(e.draft)) {
        await client.setDraft(e);
        await client.comment(e, DRAFT_COMMENT);
        done.push(`${e.key}: auf Entwurf`);
      }
    } catch (err) {
      problems.push(`${e.key}: ${err.message}. Den Rest dieses PRs habe ich ausgelassen.`);
    }
  }
  return { ok: problems.length === 0, problems, done };
}
