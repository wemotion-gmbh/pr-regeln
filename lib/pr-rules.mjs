// PR rules shared by the check program, the Claude Code hook, the pr-anlegen skill and the team cockpit.
// Pure module: no network, no file access, no dependencies. Messages are German because people read them.

export const KINDS = Object.freeze(['feat', 'fix', 'hotfix', 'chore', 'refactor', 'docs', 'test', 'part', 'release', 'revert']);
export const FIXED_BRANCHES = Object.freeze(['main', 'master', 'beta', 'live']);

// Repo names in "Braucht:" and "Paired-with:" mean Bitbucket for these product repos and every "-microservice", GitHub
// for everything else. Customer repos are not listed here; a caller that knows them passes its own list.
export const BITBUCKET_REPOS = Object.freeze(['canou-hub', 'canou-ai', 'canou-platform', 'canou-admin', 'canou-site-template']);

export function forgeOfRepo(name, { bitbucketRepos = [] } = {}) {
  const repo = String(name ?? '');
  return BITBUCKET_REPOS.includes(repo) || bitbucketRepos.includes(repo) || repo.endsWith('-microservice') ? 'bitbucket' : 'github';
}

export const TYPE_LABEL_BY_KIND = Object.freeze({
  hotfix: '🚑 Hotfix',
  part: '🧩 Teilschritt',
  revert: '⏪ Rücksetzen',
  chore: '🔧 Wartung',
  refactor: '🔧 Wartung',
  docs: '🔧 Wartung',
  test: '🔧 Wartung',
});
export const TYPE_LABELS = Object.freeze([...new Set(Object.values(TYPE_LABEL_BY_KIND))]);
export const READY_LABEL_OLD = '✅ Bereit zum Review';
export const RETIRED_LABELS = Object.freeze([READY_LABEL_OLD, '🚧 Überarbeiten', '⛔ Nicht mergen']);
export const MIGRATION_LABEL_MISSING = '🔑 Marcs Ja fehlt';
export const MIGRATION_LABEL_OK = '🔑 Marcs Ja';
export const DESIGN_LABEL_MISSING = '🎨 Marcs Design-Ja fehlt';
export const DESIGN_LABEL_OK = '🎨 Marcs Design-Ja';

// Old prefixes with a sure replacement. Anything else gets no suggestion.
const PREFIX_SUGGESTIONS = Object.freeze({ feature: 'feat', bugfix: 'fix', kb: 'docs', bot: 'chore' });
const TOPIC = /^[a-z0-9][a-z0-9./-]*$/;
const REVERT_BUTTON = /^revert-\d+-./;

export function isBot(author) {
  if (!author || typeof author.login !== 'string') return false;
  if (author.type === 'Bot') return true;
  return author.login.endsWith('[bot]') || author.login.startsWith('app/');
}

/** Checks `<kind>/<topic>`; fixed branches are promotion heads and always pass. */
export function checkBranchName(head) {
  const name = String(head ?? '');
  if (FIXED_BRANCHES.includes(name)) return { ok: true, kind: null, promotion: true };
  if (REVERT_BUTTON.test(name)) return { ok: true, kind: 'revert', promotion: false };
  const slash = name.indexOf('/');
  const kind = slash > 0 ? name.slice(0, slash) : '';
  const topic = slash > 0 ? name.slice(slash + 1) : '';
  if (KINDS.includes(kind) && TOPIC.test(topic)) return { ok: true, kind, promotion: false };

  const fail = { ok: false, kind: null, promotion: false };
  const lowerKind = kind.toLowerCase();
  const mapped = KINDS.includes(lowerKind) ? lowerKind : PREFIX_SUGGESTIONS[lowerKind];
  const lowerTopic = topic.toLowerCase();
  if (mapped && TOPIC.test(lowerTopic)) return { ...fail, suggestion: `${mapped}/${lowerTopic}` };
  return fail;
}

export function typeLabelFor(head) {
  const r = checkBranchName(head);
  return r.ok && r.kind ? (TYPE_LABEL_BY_KIND[r.kind] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Head block

export const HEAD_KEYS = Object.freeze(['Paired-with', 'Braucht', 'Merge-Stopp', 'Nach dem Merge', 'Design']);
const HEAD_LINE = /^(Paired-with|Braucht|Merge-Stopp|Nach dem Merge|Design):(.*)$/;
// A key-like start of a line: list markers, quotes, bold, backslashes, then a key in any spelling and a colon.
// "Design" is left out on purpose: "- Design: ..." is ordinary text in many PRs; the design rule checks its own key.
const LOOSE_KEY = /^(?:[\s>*+-]|\*\*|__|\\)*(merge[\s_\\-]*stopp?|braucht|paired[\s_\\-]*with|nach\s+dem\s+merge)\s*(?:\*\*|__)?\s*:/i;
const NEGATED_STOP = /^(keiner|kein|keine|nein|none|nichts|n\/a|-|—|–)[.!]?$/i;
const NEGATED_NEEDS = /^(nichts|keine|kein|nein|none|n\/a|-|—|–)[.!]?$/i;
const NEEDS_VALUE = /^([A-Za-z0-9._-]+)#(\d+)[,;:.]?(?:\s+(.*))?$/;
const PR_REF = /(?:^|[\s,;(])(?:[A-Za-z0-9._-]+)?#\d+/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const DEPENDENCY_SECTION = /^(abhängigkeiten und reihenfolge|dependencies and release order)\b/i;

const finding = (code, message, fix) => (fix ? { code, message, fix } : { code, message });

/** CRLF to LF; on Bitbucket also the backslashes its editor puts before Markdown characters. */
export function normalizeBody(body, forge) {
  let text = String(body ?? '').replace(/\r\n?/g, '\n');
  if (forge === 'bitbucket') text = text.replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, '$1');
  return text;
}

/** Index of the first line after leading blank lines and HTML comments. */
export function firstContentLine(lines) {
  let i = 0;
  let inComment = false;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (inComment) {
      if (t.includes('-->')) inComment = false;
      i++;
      continue;
    }
    if (t === '') { i++; continue; }
    if (t.startsWith('<!--')) {
      if (!t.includes('-->')) inComment = true;
      i++;
      continue;
    }
    break;
  }
  return i;
}

/** Same text with HTML comments blanked out; line numbers stay the same. */
function blankComments(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ''));
}

/** Lines outside code fences, with HTML comments blanked out: { index, text }. */
function proseLines(lines) {
  const blanked = blankComments(lines.join('\n')).split('\n');
  const out = [];
  let fenced = false;
  for (let j = 0; j < lines.length; j++) {
    if (FENCE.test(lines[j])) { fenced = !fenced; continue; }
    if (!fenced) out.push({ index: j, text: blanked[j] });
  }
  return out;
}

/**
 * Every stop-like line of a normalized text, in the head block or not, also bold, indented, misspelled or empty.
 * The values are what follows the colon. Code blocks and HTML comments do not count.
 */
export function stopLines(body) {
  const out = [];
  for (const { text } of proseLines(String(body ?? '').split('\n'))) {
    const m = LOOSE_KEY.exec(text);
    if (!m || !/^merge/i.test(m[1])) continue;
    out.push(text.slice(m[0].length).replace(/^\s*(?:\*\*|__)?/, '').replace(/(?:\*\*|__)?\s*$/, '').trim());
  }
  return out;
}

/**
 * The head block is the run of lines that start with a key in column 0, after optional leading blank lines and
 * HTML comments. `end` is the index of the first line after the block.
 */
export function parseHeadBlock(body) {
  const lines = String(body ?? '').split('\n');
  const out = { entries: [], end: 0, needs: [], stops: [], pairedWith: [], after: [], design: [], findings: [] };
  let i = firstContentLine(lines);
  for (; i < lines.length; i++) {
    const m = HEAD_LINE.exec(lines[i]);
    if (!m) break;
    const key = m[1];
    const value = m[2].trim();
    out.entries.push({ key, value, line: i });
    if (key === 'Merge-Stopp') {
      if (value === '') {
        out.findings.push(finding('K6', 'Merge-Stopp ohne Grund.', 'Den Grund hinter „Merge-Stopp:“ schreiben.'));
        out.stops.push('');
      } else {
        if (NEGATED_STOP.test(value)) {
          out.findings.push(finding('K2', `Verneinte Zeile „Merge-Stopp: ${value}“.`, 'Zeile weglassen: Fehlt sie, gilt nichts.'));
        }
        out.stops.push(value);
      }
    } else if (key === 'Braucht') {
      if (NEGATED_NEEDS.test(value)) {
        out.findings.push(finding('K2', `Verneinte Zeile „Braucht: ${value}“.`, 'Zeile weglassen: Fehlt sie, gilt nichts.'));
        continue;
      }
      const n = NEEDS_VALUE.exec(value);
      if (!n || (n[3] && PR_REF.test(` ${n[3]}`))) {
        out.findings.push(finding('K3', `„Braucht: ${value}“ hat nicht die Form „Braucht: <repo>#<nr>“.`,
          'Eine Zeile je Abhängigkeit, mit Repo-Namen und PR-Nummer, z. B. „Braucht: fusion-api-v3#123“.'));
        continue;
      }
      out.needs.push({ repo: n[1], number: Number(n[2]), note: n[3]?.trim() ?? '' });
    } else if (key === 'Paired-with') {
      const words = value.split(/\s+/).filter(Boolean);
      const url = words.at(-1) ?? '';
      if (words.length < 2 || !/^https:\/\/\S+$/.test(url)) {
        out.findings.push(finding('K4', `„Paired-with: ${value}“ endet nicht mit einem https-Link.`,
          'Form „Paired-with: <repo> <https-Link>“.'));
        continue;
      }
      out.pairedWith.push({ repo: words[0], url });
    } else if (key === 'Design') {
      out.design.push(value);
    } else {
      out.after.push(value);
    }
  }
  out.end = out.entries.length ? i : 0;

  // K1: key-like lines anywhere else, outside code blocks and HTML comments.
  for (const { index, text: line } of proseLines(lines)) {
    if (out.entries.some((e) => e.line === index)) continue;
    const m = LOOSE_KEY.exec(line);
    if (!m) continue;
    const exact = HEAD_LINE.test(line);
    out.findings.push(exact
      ? finding('K1', `„${line.trim().slice(0, 80)}“ steht nicht oben.`, 'Kopfzeilen gehören ganz oben in den PR-Text, eine je Zeile.')
      : finding('K1', `„${line.trim().slice(0, 80)}“ ist falsch geschrieben oder formatiert.`,
        `Genau so schreiben, am Zeilenanfang und ohne Formatierung: ${HEAD_KEYS.filter((k) => k !== 'Design').map((k) => `„${k}:“`).join(', ')}.`));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stop and dependency phrases in free text

const STOP_PHRASES = [
  /nicht\s+mergen/i,
  /\bdo\s+not\s+merge\b/i,
  /\bdon'?t\s+merge\b/i,
  /\bmerge\s+frühestens/i,
  /\bmerge\s+only\b/i,
  /\[blocked\]/i,
  // The stop word used as a label: at the start of a line, or followed by ":" or "bis"/"until". Inside a compound
  // word ("Merge-Stopp-Zeile") it names the concept, not a stop.
  /^[ \t]*(?:(?:[-*+>]|\d+[.)])[ \t]+)*(?:#{1,6}[ \t]+)?(?:\*\*|__|\*|_)?Merge-Stopp(?![-\w])/im,
  /(?<!\bkein(?:en)?\s+)\bMerge-Stopp(?![-\w])(?:\*\*|__|\*|_)?[ \t]*(?::|\bbis\b|\buntil\b)/i,
];
// The stop word anywhere else describes stops rather than setting one; it only gets a warning.
const STOP_MENTION = /(?<!\bkein(?:en)?\s+)\bMerge-Stopp(?![-\w])/i;
const DEPENDENCY_PHRASES = [
  /#\d+\s+zuerst/i,
  /\berst\s+nach\s+#\d+/i,
  /\berst\s+mergen,?\s+wenn\b/i,
  /\bnur\s+zusammen\s+mit\b/i,
  /\bonly\s+together\s+with\b/i,
];

/** The sentence around `index`, without Markdown emphasis, at most 240 characters. */
function quoteAround(text, index) {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '));
  const rest = text.slice(index);
  const ends = [rest.indexOf('\n'), rest.indexOf('. '), rest.indexOf('! '), rest.indexOf('? ')].filter((n) => n >= 0);
  const end = ends.length ? index + Math.min(...ends) + 1 : text.length;
  return text.slice(start < 0 ? 0 : start + 1, end).replace(/\*\*|__/g, '').trim().slice(0, 240);
}

/** Lines below the head block that a reader sees as text: no code blocks, no HTML comments, no key-like lines. */
function readableLines(body, headEnd, { keepDependencySection = false } = {}) {
  const lines = blankComments(body).split('\n').slice(headEnd);
  const kept = [];
  let fenced = false;
  let skipLevel = 0;
  for (const line of lines) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && !keepDependencySection && DEPENDENCY_SECTION.test(h[2].trim())) { skipLevel = level; continue; }
    }
    if (skipLevel || LOOSE_KEY.test(line)) continue;
    kept.push(line);
  }
  return kept;
}

const INLINE_CODE = /`[^`\n]*`/g;

/** Readable text below the head block without inline code; the dependency section is left out. */
function readableText(body, headEnd) {
  return readableLines(body, headEnd).map((l) => l.replace(INLINE_CODE, '')).join('\n');
}

// ---------------------------------------------------------------------------
// Data-deleting migrations

const MIGRATION_PATH = /(^|\/)database\/migrations\//;
const DELETING = [/dropColumn/, /dropIfExists/, /Schema::drop/, /->delete\(\)/, /truncate/i, /DROP\s+TABLE/i, /DROP\s+COLUMN/i, /DELETE\s+FROM/i];
// Every named method sets the function and only down() is skipped, so a helper that up() calls counts wherever it stands.
const FUNCTION_START = /\bfunction\s+(\w+)\s*\(/;

/** Splits a `git diff` into one patch per file; the patch starts at the first hunk. */
export function splitUnifiedDiff(diff) {
  const files = [];
  let current = null;
  for (const line of String(diff ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      current = { path: m ? m[2] : '', patch: '', inHunks: false };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (!current.inHunks) {
      if (line.startsWith('+++ ') && line !== '+++ /dev/null') current.path = line.slice(4).replace(/^b\//, '');
      else if (line.startsWith('--- ') && line !== '--- /dev/null' && !current.path) current.path = line.slice(4).replace(/^a\//, '');
      if (!line.startsWith('@@')) continue;
      current.inHunks = true;
    }
    current.patch += (current.patch ? '\n' : '') + line;
  }
  return files.map(({ path, patch }) => ({ path, patch }));
}

/** True when an added line of a migration outside `down()` matches a deleting pattern; unknown counts as deleting. */
export function deletesData(files) {
  const hits = [];
  for (const f of files ?? []) {
    if (!MIGRATION_PATH.test(f.path ?? '')) continue;
    if (f.patch == null) { hits.push(f.path); continue; }
    let fn = null;
    for (const line of String(f.patch).split('\n')) {
      if (line.startsWith('@@')) { fn = FUNCTION_START.exec(line)?.[1] ?? null; continue; }
      if (line.startsWith('-')) continue;
      const code = line.slice(1);
      const start = FUNCTION_START.exec(code);
      if (start) { fn = start[1]; continue; }
      if (line.startsWith('+') && fn !== 'down' && DELETING.some((re) => re.test(code))) {
        hits.push(f.path);
        break;
      }
    }
  }
  return { deleting: hits.length > 0, files: hits };
}

export function findStopPhrases(body, headEnd = 0) {
  const text = readableText(body, headEnd);
  const out = [];
  for (const [kind, list] of [['stop', STOP_PHRASES], ['dependency', DEPENDENCY_PHRASES]]) {
    for (const re of list) {
      const m = re.exec(text);
      if (m) {
        out.push({ kind, quote: quoteAround(text, m.index) });
        break;
      }
    }
  }
  if (!out.some((p) => p.kind === 'stop')) {
    const m = STOP_MENTION.exec(text);
    if (m) out.push({ kind: 'mention', quote: quoteAround(text, m.index) });
  }
  return out;
}

/**
 * Every hit, not only the first per list, once per sentence: for a reader who judges each one (the conversion run).
 * `extra` adds pattern lists of its own kind after the rule lists. Code never matches, but the quote keeps it, so a
 * stop line built from the quote repeats the sentence word for word.
 */
export function allStopPhrases(body, headEnd = 0, { keepDependencySection = false, extra = [] } = {}) {
  const shown = readableLines(body, headEnd, { keepDependencySection }).join('\n');
  // Same length as `shown`, so a match index is a position in the shown text too.
  const text = shown.replace(INLINE_CODE, (code) => ' '.repeat(code.length));
  const lists = [['stop', STOP_PHRASES], ['dependency', DEPENDENCY_PHRASES], ['mention', [STOP_MENTION]], ...extra.map((e) => [e.kind, e.patterns])];
  const out = [];
  const seen = new Set();
  for (const [kind, list] of lists) {
    for (const re of list) {
      for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
        const quote = quoteAround(shown, m.index);
        if (!quote || seen.has(quote)) continue;
        seen.add(quote);
        out.push({ kind, quote });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Design cards (Marc, E2170 A): a UI PR names the design cards it builds on; a new pattern waits for Marc's yes.

// Repos with the design rule, and the paths whose change alters what the product shows. The same lists drive the
// hook .claude/hooks/design-pflicht.mjs in canou-hub; change both together.
export const DESIGN_RULES = Object.freeze({
  'wemotion-gmbh/canou-hub': Object.freeze({
    skill: 'hub-design-lesen',
    ui: Object.freeze([
      'app/**/*.{tsx,jsx,css,scss,mdx}',
      'components/**/*.{tsx,jsx,css,scss}',
      'components/**/*{words,wording,labels,texts,copy}*.ts',
      'config/**/*.{ts,tsx,json}',
      'lib/**/config*',
      'lib/**/config*/**',
      'lib/**/*.config.*',
      'styles/**',
    ]),
    notUi: Object.freeze([
      '**/*.test.*',
      '**/*.spec.*',
      '**/__tests__/**',
      '**/__mocks__/**',
      '**/test-support/**',
      '**/*.d.ts',
      'app/api/**',
    ]),
  }),
});

// T1: PRs created from then on follow the design rule. T2: from then on older open PRs too. Before, only hints.
export const DESIGN_CUTOFFS = Object.freeze({ T1: '2026-11-25T23:00:00Z', T2: '2026-12-02T23:00:00Z' });

// The note the AI writes with Marc's yes; the head it names is the state Marc saw.
export const DESIGN_APPROVAL = /🎨 Marcs Design-Ja \(Cockpit (E\d+)\) für Head ([0-9a-f]{7,40})\b/;
export const designApprovalNote = (cockpit, sha) => `${DESIGN_LABEL_OK} (Cockpit ${cockpit}) für Head ${sha}`;

const DESIGN_NONE = /^keine\s+UI-Änderung\.?$/i;
const DESIGN_CARD = /^(?:HM\d{1,3}[a-z]?|FO\d{1,3})$/;
const DESIGN_NEW_START = /^neu(?![\p{L}\p{N}])/iu;
const DESIGN_NEW = /^neu\s*(?:[–—:-]\s*)?([\s\S]*)$/i;
const DESIGN_LINE_BELOW = /^Design\s*:/;
const DESIGN_FORMS = '„Design: HM12, HM24“ (die genutzten Karten), „Design: HM12, neu – <Kurzbeschreibung>“ oder '
  + '„Design: neu – <Kurzbeschreibung>“ (neues Muster, braucht Marcs Design-Ja), „Design: keine UI-Änderung“.';

const escapeRe = (text) => text.replace(/[.+^${}()|[\]\\?]/g, '\\$&');

/** A small glob: `**` spans folders, `*` stays within one, `{a,b}` is a choice. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      out += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      out += `(?:${glob.slice(i + 1, end).split(',').map(escapeRe).join('|')})`;
      i = end;
    } else {
      out += escapeRe(c);
    }
  }
  return new RegExp(`^${out}$`);
}

const compiled = new WeakMap();

/** The design rule of a GitHub repo, or null. */
export function designRuleFor({ forge, owner, repo } = {}) {
  if (forge !== 'github') return null;
  return DESIGN_RULES[`${owner ?? ''}/${repo ?? ''}`.toLowerCase()] ?? null;
}

/** Whether a repo path (forward slashes) changes what the product shows, by the rule's path lists. */
export function isDesignUiPath(path, rule) {
  if (!rule) return false;
  if (!compiled.has(rule)) compiled.set(rule, { ui: rule.ui.map(globToRegExp), notUi: rule.notUi.map(globToRegExp) });
  const { ui, notUi } = compiled.get(rule);
  const p = String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  return ui.some((re) => re.test(p)) && !notUi.some((re) => re.test(p));
}

/**
 * Reads the value of a "Design:" line: cards ("HM12, HM24"), optionally ending in "neu – <text>", only
 * "neu – <text>", or "keine UI-Änderung". The text of a new pattern may contain commas.
 */
export function parseDesignValue(value) {
  const v = String(value ?? '').trim();
  const bad = (reason) => ({ ok: false, reason, cards: [], isNew: false, none: false, newText: '' });
  if (DESIGN_NONE.test(v)) return { ok: true, cards: [], isNew: false, none: true, newText: '' };
  if (!v) return bad('der Wert fehlt');
  const parts = v.split(',');
  const cards = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (DESIGN_NEW_START.test(p)) {
      const text = DESIGN_NEW.exec(parts.slice(i).join(',').trim())[1].trim();
      if (!text) return bad('nach „neu“ fehlt die Kurzbeschreibung');
      return { ok: true, cards, isNew: true, none: false, newText: text };
    }
    if (!DESIGN_CARD.test(p)) return bad(p ? `„${p}“ ist keine Karten-Kennung wie HM12 oder FO1` : 'ein Eintrag ist leer');
    cards.push(p);
  }
  return { ok: true, cards, isNew: false, none: false, newText: '' };
}

const listFiles = (files) => (files.length > 3 ? `${files.slice(0, 3).join(', ')} und ${files.length - 3} weitere` : files.join(', '));

/**
 * The design rule for one PR. `findings` follow the design cutoffs, `hints` are always hints. `design` is null for a
 * repo without the rule. D1 needs `files`, D4 needs `designApproval` (read by forges.mjs); without them those parts
 * are not checked.
 */
function checkDesign(pr, headBlock, body, branch) {
  const out = { findings: [], hints: [], design: null };
  const rule = designRuleFor(pr);
  const values = headBlock.design;
  const parsed = values.length === 1 ? parseDesignValue(values[0]) : null;
  if (values.length > 1) {
    out.findings.push(finding('D2', `„Design:“ steht ${values.length}-mal oben.`, `Genau eine Zeile, die Karten durch Komma getrennt. Formen: ${DESIGN_FORMS}`));
  } else if (parsed && !parsed.ok) {
    out.findings.push(finding('D2', `„Design: ${values[0].slice(0, 80)}“ hat nicht die richtige Form: ${parsed.reason}.`, `Formen: ${DESIGN_FORMS}`));
  }
  if (!rule) return out;

  const exempt = branch.promotion ? 'promotion' : ['release', 'revert'].includes(branch.kind) ? branch.kind : null;
  const uiFiles = pr.files ? pr.files.map((f) => f.path).filter((p) => isDesignUiPath(p, rule)) : null;
  const ok = parsed?.ok ? parsed : null;
  out.design = { exempt, uiFiles, value: values[0] ?? null, cards: ok?.cards ?? [], isNew: Boolean(ok?.isNew), none: Boolean(ok?.none) };
  if (exempt) {
    out.findings = [];
    return out;
  }

  for (const { index, text } of proseLines(body.split('\n'))) {
    if (headBlock.entries.some((e) => e.line === index) || !DESIGN_LINE_BELOW.test(text)) continue;
    out.findings.push(finding('D2', `„${text.trim().slice(0, 80)}“ steht nicht oben.`,
      'Die Zeile „Design: …“ gehört in den Kopfblock ganz oben. Ist es keine Kopfzeile, den Satz anders anfangen (z. B. „Gestaltung: …“).'));
  }

  if (!values.length) {
    if (uiFiles?.length) {
      out.findings.push(finding('D1', `Der PR ändert UI-Dateien (${listFiles(uiFiles)}), nennt aber oben keine Design-Karten.`,
        `Vorher den Skill „${rule.skill}“ laufen lassen, dann oben eintragen (mit pr-anlegen: --design "<wert>"). Formen: ${DESIGN_FORMS}`));
    }
    return out;
  }
  if (ok?.none && uiFiles?.length) {
    out.hints.push(finding('D5', `„Design: keine UI-Änderung“, aber der PR ändert UI-Dateien (${listFiles(uiFiles)}).`,
      'Stimmt die Angabe (z. B. nur Logik in einer Konfigurationsdatei), bleibt sie; pr-pruefen prüft sie. Sonst die genutzten Karten nennen.'));
  }
  if (!ok?.isNew) return out;

  const askAgain = 'Marc im Cockpit erneut fragen. Nach seinem Ja: create-pr.mjs design-ja --repo-dir <repo> --number <nr> --cockpit E<nr>; der Vermerk nennt dann den neuen Head.';
  if (!(pr.labels ?? []).includes(DESIGN_LABEL_OK)) {
    out.findings.push(finding('D3', `„Design: neu – ${ok.newText.slice(0, 80)}“: Ein neues Muster braucht Marcs Design-Ja.`,
      `Entwurf mit dem Skill „redesign-entwurf“, Frage an Marc ins Cockpit. Nach seinem Ja: create-pr.mjs design-ja --repo-dir <repo> --number <nr> --cockpit E<nr> (setzt „${DESIGN_LABEL_OK}“). Bis dahin bleibt „${DESIGN_LABEL_MISSING}“ dran.`));
    return out;
  }
  const a = pr.designApproval;
  if (a === undefined) return out;
  out.design.approval = a;
  if (a === null) {
    out.findings.push(finding('D4', `Das Label „${DESIGN_LABEL_OK}“ ist dran, aber der Vermerk „${DESIGN_LABEL_OK} (Cockpit E…) für Head …“ fehlt.`,
      `Das Label setzt nur die KI nach Marcs Ja, mit create-pr.mjs design-ja --repo-dir <repo> --number <nr> --cockpit E<nr>. Ohne Ja: Label entfernen und „${DESIGN_LABEL_MISSING}“ setzen.`));
  } else if (a.changedUi === null) {
    out.findings.push(finding('D4', `Ob sich seit Marcs Design-Ja (Cockpit ${a.cockpit}, Head ${a.sha.slice(0, 7)}) UI-Dateien geändert haben, war nicht lesbar. Das Ja gilt deshalb nicht.`, askAgain));
  } else if (a.changedUi.length) {
    out.findings.push(finding('D4', `Seit Marcs Design-Ja (Cockpit ${a.cockpit}, Head ${a.sha.slice(0, 7)}) haben sich UI-Dateien geändert: ${listFiles(a.changedUi)}. Das Ja gilt nicht mehr.`, askAgain));
  }
  return out;
}

/** Whether design findings are errors: for PRs created at or after T1, and for every PR once T2 has passed. */
export function designEnforced(createdAt, now, cutoffs = DESIGN_CUTOFFS) {
  if (isNewPr(createdAt, cutoffs)) return true;
  return Boolean(cutoffs?.T2 && now && new Date(now).getTime() >= new Date(cutoffs.T2).getTime());
}

// ---------------------------------------------------------------------------
// Whole PR

// ISO timestamps, set when the rules start to bite. While T1 is null no PR is "new" and every finding is a hint.
// All three are the same moment: the open PRs were converted before, so there is no grace period left to give.
export const CUTOFFS = Object.freeze({ T0: '2026-11-02T14:00:00Z', T1: '2026-11-02T14:00:00Z', T2: '2026-11-02T14:00:00Z' });

export function isNewPr(createdAt, cutoffs = CUTOFFS) {
  if (!cutoffs?.T1 || !createdAt) return false;
  return new Date(createdAt).getTime() >= new Date(cutoffs.T1).getTime();
}

function hasDependencySection(body) {
  return String(body ?? '').split('\n').some((line) => {
    const h = HEADING.exec(line);
    return h && DEPENDENCY_SECTION.test(h[2].trim());
  });
}

/** Rules that only need the PR text: head block (K1-K4, K6), stops in the text (K5), dependency section (W1). */
export function checkBody(text, forge) {
  const body = normalizeBody(text, forge);
  const headBlock = parseHeadBlock(body);
  const rules = [...headBlock.findings];
  const warnings = [];
  const notAStop = 'Ist es kein Stopp, die Stelle umformulieren oder in Backticks setzen.';

  for (const p of findStopPhrases(body, headBlock.end)) {
    if (p.kind === 'stop' && headBlock.stops.length === 0) {
      rules.push(finding('K5', `Der Text klingt nach einem Stopp: „${p.quote}“`, `Oben die Zeile „Merge-Stopp: <Grund>“ eintragen. ${notAStop}`));
    }
    if (p.kind === 'mention' && headBlock.stops.length === 0) {
      warnings.push(finding('W3', `Der Text erwähnt einen Merge-Stopp: „${p.quote}“`, `Gilt er für diesen PR, oben die Zeile „Merge-Stopp: <Grund>“ eintragen. ${notAStop}`));
    }
    if (p.kind === 'dependency' && !headBlock.stops.length && !headBlock.needs.length && !headBlock.pairedWith.length) {
      rules.push(finding('K5', `Der Text nennt eine Abhängigkeit: „${p.quote}“`,
        'Oben „Braucht: <repo>#<nr>“ eintragen, oder „Merge-Stopp: <Grund>“, wenn es keinen PR dafür gibt.'));
    }
  }

  if (!hasDependencySection(body)) warnings.push(finding('W1', 'Der Abschnitt „## Abhängigkeiten und Reihenfolge“ fehlt.'));
  return { rules, warnings, headBlock };
}

/**
 * Checks one PR. Findings of a new PR are errors; for older PRs they are warnings. The migration rule is the
 * exception: on GitHub a data-deleting migration without the yes label is always an error. The design rule has its
 * own cutoffs (DESIGN_CUTOFFS); `opts.now` is the moment of the check.
 */
export function checkPr(pr, opts = {}) {
  const cutoffs = opts.cutoffs ?? CUTOFFS;
  if (isBot(pr.author)) return { errors: [], warnings: [], isNew: false, skipped: 'bot' };
  const isNew = isNewPr(pr.createdAt, cutoffs);
  const { rules, warnings, headBlock } = checkBody(pr.body, pr.forge);
  const errors = [];

  const branch = checkBranchName(pr.head);
  if (!branch.ok) {
    rules.push(finding('K7', `Der Branch „${pr.head}“ hat nicht die Form <art>/<thema>.`,
      branch.suggestion
        ? `Neuen Branch „${branch.suggestion}“ anlegen und den PR von dort öffnen.`
        : `Arten: ${KINDS.join(', ')}. Thema klein, mit a-z, 0-9, - und .`));
  }

  const labels = pr.labels ?? [];
  if (pr.forge === 'github') {
    if (branch.ok) {
      const expected = typeLabelFor(pr.head);
      const present = labels.filter((l) => TYPE_LABELS.includes(l));
      if (expected && !present.includes(expected)) {
        rules.push(finding('K8', `Das Art-Label „${expected}“ fehlt.`, `Label „${expected}“ setzen.`));
      }
      for (const l of present.filter((x) => x !== expected)) {
        rules.push(finding('K8', `Das Art-Label „${l}“ passt nicht zum Branch „${pr.head}“.`, `Label „${l}“ entfernen.`));
      }
    }
    for (const l of labels.filter((x) => RETIRED_LABELS.includes(x))) {
      rules.push(finding('K9', `Das Label „${l}“ gibt es nicht mehr.`,
        l === READY_LABEL_OLD ? 'Label entfernen: Bereit heißt jetzt „kein Entwurf“.' : 'Label entfernen und oben „Merge-Stopp: <Grund>“ eintragen.'));
    }
  }

  for (const p of headBlock.pairedWith) {
    const m = /\/tree\/(.+)$/.exec(p.url);
    if (m && decodeURIComponent(m[1]) === pr.head) {
      warnings.push(finding('W2', `„Paired-with:“ nennt denselben Branch-Namen „${pr.head}“.`, 'Zeile weglassen: Bei gleichem Namen findet man das Gegenstück ohnehin.'));
    }
  }

  const migration = pr.files ? deletesData(pr.files) : null;
  if (migration?.deleting) {
    const m1 = finding('M1', `Eine Migration löscht Daten (${migration.files.join(', ')}).`,
      pr.forge === 'github' ? `Marcs Ja im Cockpit einholen, dann Label „${MIGRATION_LABEL_OK}“.` : 'Die Merge-KI holt vor dem Merge Marcs Ja im Cockpit ein.');
    if (pr.forge === 'github' && !labels.includes(MIGRATION_LABEL_OK)) errors.push(m1);
    else if (pr.forge !== 'github') warnings.push(m1);
  }

  const d = checkDesign(pr, headBlock, normalizeBody(pr.body, pr.forge), branch);
  const enforced = designEnforced(pr.createdAt, opts.now ?? new Date().toISOString(), opts.designCutoffs ?? DESIGN_CUTOFFS);
  const result = isNew
    ? { errors: [...rules, ...errors], warnings, isNew, migration }
    : { errors, warnings: [...rules, ...warnings], isNew, migration };
  if (enforced) result.errors.push(...d.findings);
  else result.warnings.push(...d.findings);
  result.warnings.push(...d.hints);
  if (d.design) result.design = { ...d.design, enforced };
  return result;
}
