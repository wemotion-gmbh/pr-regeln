// PR rules shared by the check program, the Claude Code hook, the pr-anlegen skill and the team cockpit.
// Pure module: no network, no file access, no dependencies. Messages are German because people read them.

export const KINDS = Object.freeze(['feat', 'fix', 'hotfix', 'chore', 'refactor', 'docs', 'test', 'part', 'release', 'revert']);
export const FIXED_BRANCHES = Object.freeze(['main', 'master', 'beta', 'live']);

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

export const HEAD_KEYS = Object.freeze(['Paired-with', 'Braucht', 'Merge-Stopp', 'Nach dem Merge']);
const HEAD_LINE = /^(Paired-with|Braucht|Merge-Stopp|Nach dem Merge):(.*)$/;
// A key-like start of a line: list markers, quotes, bold, backslashes, then a key in any spelling and a colon.
const LOOSE_KEY = /^(?:[\s>*+-]|\*\*|__|\\)*(merge[\s_\\-]*stopp?|braucht|paired[\s_\\-]*with|nach\s+dem\s+merge)\s*(?:\*\*|__)?\s*:/i;
const NEGATED_STOP = /^(keiner|kein|keine|nein|none|nichts|n\/a|-|—|–)[.!]?$/i;
const NEGATED_NEEDS = /^(nichts|keine|kein|nein|none|n\/a|-|—|–)[.!]?$/i;
const NEEDS_VALUE = /^([A-Za-z0-9._-]+)#(\d+)(?:\s+(.*))?$/;
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
function firstContentLine(lines) {
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

/**
 * The head block is the run of lines that start with a key in column 0, after optional leading blank lines and
 * HTML comments. `end` is the index of the first line after the block.
 */
export function parseHeadBlock(body) {
  const lines = String(body ?? '').split('\n');
  const out = { entries: [], end: 0, needs: [], stops: [], pairedWith: [], after: [], findings: [] };
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
    } else {
      out.after.push(value);
    }
  }
  out.end = out.entries.length ? i : 0;

  // K1: key-like lines anywhere else, outside code blocks.
  let fenced = false;
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j];
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced || out.entries.some((e) => e.line === j)) continue;
    const m = LOOSE_KEY.exec(line);
    if (!m) continue;
    const exact = HEAD_LINE.test(line);
    out.findings.push(exact
      ? finding('K1', `„${line.trim().slice(0, 80)}“ steht nicht oben.`, 'Kopfzeilen gehören ganz oben in den PR-Text, eine je Zeile.')
      : finding('K1', `„${line.trim().slice(0, 80)}“ ist falsch geschrieben oder formatiert.`,
        `Genau so schreiben, am Zeilenanfang und ohne Formatierung: ${HEAD_KEYS.map((k) => `„${k}:“`).join(', ')}.`));
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
  /(?<!\bkein(?:en)?\s+)\bMerge-Stopp\b/i,
];
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

/** Readable text below the head block: no code, no HTML comments, no dependency section, no key-like lines. */
function readableText(body, headEnd) {
  const lines = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '').split('\n').slice(headEnd);
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
      if (!skipLevel && DEPENDENCY_SECTION.test(h[2].trim())) { skipLevel = level; continue; }
    }
    if (skipLevel || LOOSE_KEY.test(line)) continue;
    kept.push(line.replace(/`[^`\n]*`/g, ''));
  }
  return kept.join('\n');
}

// ---------------------------------------------------------------------------
// Data-deleting migrations

const MIGRATION_PATH = /(^|\/)database\/migrations\//;
const DELETING = [/dropColumn/, /dropIfExists/, /Schema::drop/, /->delete\(\)/, /truncate/i, /DROP\s+TABLE/i, /DROP\s+COLUMN/i, /DELETE\s+FROM/i];
const FUNCTION_START = /\bfunction\s+(up|down)\s*\(/;

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

/** True when an added line inside `up()` of a migration matches a deleting pattern; unknown counts as deleting. */
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
  return out;
}

// ---------------------------------------------------------------------------
// Whole PR

// ISO timestamps, set when the rules start to bite. While T1 is null no PR is "new" and every finding is a hint.
export const CUTOFFS = Object.freeze({ T0: null, T1: null, T2: null });

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

/**
 * Checks one PR. Findings of a new PR are errors; for older PRs they are warnings. The migration rule is the
 * exception: on GitHub a data-deleting migration without the yes label is always an error.
 */
export function checkPr(pr, opts = {}) {
  const cutoffs = opts.cutoffs ?? CUTOFFS;
  if (isBot(pr.author)) return { errors: [], warnings: [], isNew: false, skipped: 'bot' };
  const isNew = isNewPr(pr.createdAt, cutoffs);
  const body = normalizeBody(pr.body, pr.forge);
  const headBlock = parseHeadBlock(body);
  const rules = [...headBlock.findings];
  const warnings = [];
  const errors = [];

  for (const p of findStopPhrases(body, headBlock.end)) {
    if (p.kind === 'stop' && headBlock.stops.length === 0) {
      rules.push(finding('K5', `Der Text klingt nach einem Stopp: „${p.quote}“`, 'Oben die Zeile „Merge-Stopp: <Grund>“ eintragen.'));
    }
    if (p.kind === 'dependency' && !headBlock.stops.length && !headBlock.needs.length && !headBlock.pairedWith.length) {
      rules.push(finding('K5', `Der Text nennt eine Abhängigkeit: „${p.quote}“`,
        'Oben „Braucht: <repo>#<nr>“ eintragen, oder „Merge-Stopp: <Grund>“, wenn es keinen PR dafür gibt.'));
    }
  }

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

  if (!hasDependencySection(body)) {
    warnings.push(finding('W1', 'Der Abschnitt „## Abhängigkeiten und Reihenfolge“ fehlt.'));
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

  return isNew
    ? { errors: [...rules, ...errors], warnings, isNew, migration }
    : { errors, warnings: [...rules, ...warnings], isNew, migration };
}
