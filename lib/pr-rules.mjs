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
