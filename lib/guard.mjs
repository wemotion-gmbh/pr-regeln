// Decides what the PreToolUse hook says about one tool call. No I/O: git and files come in through ctx.
import path from 'node:path';
import { CUTOFFS, KINDS, RETIRED_LABELS, READY_LABEL_OLD, checkBody, checkBranchName, checkPr, isNewPr } from './pr-rules.mjs';
import { splitCommands } from './shell.mjs';
import { formatFindings } from './format.mjs';

const UNKNOWN = /\$[\w{(]/;
const known = (w) => typeof w === 'string' && w !== '' && !UNKNOWN.test(w);
const NAVIGATE = new Set(['cd', 'pushd', 'popd', 'chdir', 'push-location', 'pop-location', 'set-location', 'sl']);
const NOT_RUN = new Set(['echo', 'printf', 'write-host', 'write-output', 'grep', 'rg', 'select-string', 'sls', 'cat', 'type', 'get-content']);
const MCP_PR_TOOL = /^mcp__.*__(create|update)_pull_request$/i;
const SKILL_SCRIPT = 'create-pr.mjs';
const BB_CREATE = /\/pullrequests\/?(?:\?.*)?$/;
const BB_UPDATE = /\/pullrequests\/\d+\/?(?:\?.*)?$/;
const GH_CREATE = /^\/?repos\/[^/]+\/[^/]+\/pulls\/?$/;
const GH_UPDATE = /^\/?repos\/[^/]+\/[^/]+\/pulls\/\d+\/?$/;
const TAG_LIKE = /^v\d/;

const finding = (code, message, fix) => (fix ? { code, message, fix } : { code, message });
const kindsHint = `Arten: ${KINDS.join(', ')}. Thema klein, mit a-z, 0-9, - und .`;

// The rules cover only the GitHub organization and the Bitbucket workspace of wemotion.
const OUR_OWNERS = new Set(['wemotion-gmbh', 'wemotion-bucket']);
const FORGE_REMOTE = /(?:github\.com|bitbucket\.org)(?::\d+)?[:/]([^/]+)\//i;

// true for a wemotion repository, false for any other, null when it cannot be told.
// A placeholder like {owner} or :owner, which gh fills in from the working directory, cannot be told.
const oursByOwner = (owner) => (known(owner) && !/^[{:]/.test(owner) ? OUR_OWNERS.has(owner.toLowerCase()) : null);
function oursByRemote(dir, ctx) {
  const url = dir == null || !ctx.remoteUrl ? null : ctx.remoteUrl(dir);
  const owner = url == null ? null : FORGE_REMOTE.exec(url)?.[1];
  return owner ? OUR_OWNERS.has(owner.toLowerCase()) : null;
}
const ownerInUrl = (words) => words.map((w) => /(?:^|\/)(?:repos|repositories)\/([^/\s"']+)\//.exec(w)?.[1]).find(Boolean);

function commandWord(words) {
  let i = 0;
  while (i < words.length && (words[i] === '&' || words[i] === '.' || /^[A-Za-z_]\w*=/.test(words[i]))) i++;
  const name = (words[i] ?? '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  return { name, args: words.slice(i + 1) };
}

// Git Bash writes drives as /f/...; on Windows that is F:\...
let platform = process.platform;
function joinDir(dir, p) {
  if (dir == null || !known(p)) return null;
  if (platform !== 'win32') return path.posix.resolve(dir, p);
  const drive = (s) => s.replace(/^\/([A-Za-z])(?=\/|$)/, (m, d) => `${d.toUpperCase()}:`);
  return path.win32.resolve(drive(dir), drive(p));
}

// Long options with a value, by short alias. "--x=v" is split first.
function parseOptions(args, valueOpts, aliases = {}) {
  const opts = new Map();
  const flags = new Set();
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    let inline;
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) [a, inline] = [a.slice(0, eq), a.slice(eq + 1)];
    a = aliases[a] ?? a;
    if (valueOpts.has(a)) {
      const v = inline ?? args[++i];
      opts.set(a, [...(opts.get(a) ?? []), v]);
    } else if (a.startsWith('-') && a.length > 1) {
      flags.add(a);
    } else {
      positionals.push(a);
    }
  }
  return { opts, flags, positionals };
}

function gitCall(args, cwd) {
  let dir = cwd;
  let i = 0;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    if (args[i] === '-C') dir = joinDir(dir, args[++i]);
    else if (['-c', '--git-dir', '--work-tree', '--namespace'].includes(args[i])) i++;
  }
  return { dir, sub: args[i], rest: args.slice(i + 1) };
}

function optionAfter(args, names) {
  const i = args.findIndex((a) => names.includes(a));
  if (i >= 0) return args[i + 1];
  for (const n of names.filter((x) => x.startsWith('--'))) {
    const a = args.find((x) => x.startsWith(`${n}=`));
    if (a) return a.slice(n.length + 1);
  }
  return undefined;
}

const BRANCH_CREATE_OK = new Set(['-f', '--force', '-t', '--track', '--no-track']);
const BRANCH_RENAME = new Set(['-m', '-M', '--move', '-c', '-C', '--copy']);

function newBranchName(sub, rest) {
  if (sub === 'checkout') return optionAfter(rest, ['-b', '-B', '--orphan']);
  if (sub === 'switch') return optionAfter(rest, ['-c', '-C', '--create', '--force-create', '--orphan']);
  if (sub === 'worktree') return rest[0] === 'add' ? optionAfter(rest, ['-b', '-B']) : undefined;
  if (sub !== 'branch') return undefined;
  const flags = rest.filter((a) => a.startsWith('-'));
  const pos = rest.filter((a) => !a.startsWith('-'));
  if (flags.some((f) => BRANCH_RENAME.has(f))) return pos.at(-1);
  if (flags.every((f) => BRANCH_CREATE_OK.has(f) || f.startsWith('--track=')) && pos.length >= 1 && pos.length <= 2) return pos[0];
  return undefined;
}

// Only a branch that is surely not on the remote counts; when git cannot tell (null), the hook stays quiet.
function branchFinding(name, dir, ctx, pushed) {
  if (!known(name) || checkBranchName(name).ok || dir == null || ctx.remoteHasBranch(dir, name) !== false) return null;
  const { suggestion } = checkBranchName(name);
  return pushed
    ? finding('K7', `Der Branch „${name}“ ist neu auf dem Remote und hat nicht die Form <art>/<thema>.`,
      suggestion ? `Vor dem Push umbenennen: git branch -m ${name} ${suggestion}` : kindsHint)
    : finding('K7', `Der neue Branch „${name}“ hat nicht die Form <art>/<thema>.`,
      suggestion ? `Stattdessen „${suggestion}“ nehmen.` : kindsHint);
}

const PUSH_VALUES = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
const PUSH_SKIP = ['--delete', '-d', '--tags', '--all', '--mirror', '--prune'];

function pushedBranches(rest, dir, ctx) {
  const { flags, positionals } = parseOptions(rest, PUSH_VALUES);
  if (PUSH_SKIP.some((f) => flags.has(f))) return [];
  const [remote, ...specs] = positionals;
  if (remote != null && !known(remote)) return [];
  const out = [];
  for (let spec of specs.length ? specs : ['HEAD']) {
    if (!known(spec) || spec.startsWith(':')) continue;
    spec = spec.replace(/^\+/, '');
    let dst = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
    if (dst === 'HEAD') dst = dir == null ? null : ctx.currentBranch(dir);
    if (!dst) continue;
    dst = dst.replace(/^refs\/heads\//, '');
    if (dst.startsWith('refs/') || TAG_LIKE.test(dst)) continue;
    out.push(dst);
  }
  return out;
}

const GH_PR_VALUES = new Set(['--head', '--base', '--title', '--body', '--body-file', '--label', '--repo', '--assignee', '--reviewer',
  '--milestone', '--project', '--template', '--recover', '--add-label', '--remove-label', '--add-reviewer', '--remove-reviewer',
  '--add-assignee', '--remove-assignee', '--add-project', '--remove-project']);
const GH_PR_ALIASES = { '-H': '--head', '-B': '--base', '-t': '--title', '-b': '--body', '-F': '--body-file', '-l': '--label', '-R': '--repo', '-d': '--draft', '-a': '--assignee', '-r': '--reviewer', '-m': '--milestone', '-p': '--project', '-T': '--template', '-f': '--fill' };
const GH_PR_UNREADABLE = ['--fill', '--fill-first', '--fill-verbose', '--web', '--template', '--recover'];

// Body text from --body or a literal --body-file; undefined when it cannot be read safely.
function ghBody(opts, dir, ctx) {
  if (opts.has('--body')) {
    const b = opts.get('--body').at(-1);
    return known(b) ? b : undefined;
  }
  const file = opts.get('--body-file')?.at(-1);
  if (!known(file) || file === '-') return undefined;
  const path = joinDir(dir ?? '.', file);
  return (path && ctx.readFile(path)) ?? undefined;
}

function labelsOf(values) {
  const list = (values ?? []).flatMap((v) => String(v).split(',')).map((l) => l.trim()).filter(Boolean);
  return list.every(known) ? list : undefined;
}

function retiredLabelFindings(labels) {
  return labels.filter((l) => RETIRED_LABELS.includes(l)).map((l) => finding('K9', `Das Label „${l}“ gibt es nicht mehr.`,
    l === READY_LABEL_OLD ? 'Label weglassen: Bereit heißt jetzt „kein Entwurf“.' : 'Label weglassen und oben „Merge-Stopp: <Grund>“ eintragen.'));
}

function ghPrCreate(args, dir, ctx) {
  const { opts, flags } = parseOptions(args, GH_PR_VALUES, GH_PR_ALIASES);
  if (GH_PR_UNREADABLE.some((f) => flags.has(f) || opts.has(f))) return null;
  const body = ghBody(opts, dir, ctx);
  let head = opts.get('--head')?.at(-1) ?? (dir == null ? null : ctx.currentBranch(dir));
  const labels = labelsOf(opts.get('--label'));
  if (body === undefined || !known(head) || !labels) return null;
  head = head.replace(/^[^:]+:/, '');
  const base = opts.get('--base')?.at(-1) ?? '';
  const repoOpt = opts.get('--repo')?.at(-1) ?? '';
  const ours = repoOpt.includes('/') ? oursByOwner(repoOpt.split('/').at(-2)) : oursByRemote(dir, ctx);
  if (ours === false) return null;
  const r = checkPr({ forge: 'github', repo: repoOpt.split('/').pop(), head, base: known(base) ? base : '', title: opts.get('--title')?.at(-1) ?? '', body,
    draft: flags.has('--draft'), labels, author: null, createdAt: ctx.now }, { cutoffs: ctx.cutoffs ?? CUTOFFS });
  return { findings: [...r.errors, ...r.warnings], deny: ours === true && r.errors.length > 0 };
}

function ghPrEdit(args, dir, ctx) {
  const { opts } = parseOptions(args, GH_PR_VALUES, GH_PR_ALIASES);
  const repoOpt = opts.get('--repo')?.at(-1) ?? '';
  if ((repoOpt.includes('/') ? oursByOwner(repoOpt.split('/').at(-2)) : oursByRemote(dir, ctx)) === false) return null;
  const findings = [];
  if (opts.has('--body') || opts.has('--body-file')) {
    const body = ghBody(opts, dir, ctx);
    if (body !== undefined) {
      const r = checkBody(body, 'github');
      findings.push(...r.rules, ...r.warnings);
    }
  }
  findings.push(...retiredLabelFindings(labelsOf(opts.get('--add-label')) ?? []));
  return { findings, deny: false };
}

const GH_API_VALUES = new Set(['-X', '--method', '-f', '-F', '--field', '--raw-field', '-H', '--header', '--input', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview']);

function apiMethod(name, words) {
  const i = words.findIndex((w) => /^(-X|--request|--method|-Method)$/i.test(w));
  if (i >= 0) return String(words[i + 1] ?? '').toUpperCase();
  const attached = words.map((w) => /^-X([A-Za-z]+)$/.exec(w) ?? /^--(?:request|method)=(\w+)$/i.exec(w)).find(Boolean);
  if (attached) return attached[1].toUpperCase();
  const data = name === 'gh'
    ? /^(-f|-F|--field|--raw-field|--input)$/
    : name === 'curl' ? /^(-d|-F|--form|--json|--data(-\w+)?)$/ : null;
  return data && words.some((w) => data.test(w)) ? 'POST' : 'GET';
}

// A PR created through the API may be denied; a change to an existing PR only gets a hint, as old PRs are never blocked.
function apiFinding(name, args, dir, ctx) {
  let creates = false;
  let updates = false;
  if (name === 'gh' && args[0] === 'api') {
    const endpoint = parseOptions(args.slice(1), GH_API_VALUES).positionals[0] ?? '';
    const method = apiMethod('gh', args);
    creates = method === 'POST' && GH_CREATE.test(endpoint);
    updates = method === 'PATCH' && GH_UPDATE.test(endpoint);
  } else if (!NOT_RUN.has(name)) {
    const method = apiMethod(name, args);
    creates = method === 'POST' && args.some((w) => BB_CREATE.test(w));
    updates = method === 'PUT' && args.some((w) => BB_UPDATE.test(w));
  }
  if (!creates && !updates) return null;
  let ours = oursByOwner(ownerInUrl(args));
  if (ours === null && name === 'gh') ours = oursByRemote(dir, ctx);
  if (ours === false) return null;
  return {
    creates,
    ours,
    finding: creates
      ? finding('P1', 'PRs werden mit dem Skill „pr-anlegen“ angelegt, nicht direkt über die API.',
        'Skill pr-anlegen nutzen: scripts/create-pr.mjs create (schreibt Kopfblock und Labels und prüft vorher).')
      : finding('P1', 'PRs werden mit dem Skill „pr-anlegen“ geändert, nicht direkt über die API.',
        'Skill pr-anlegen nutzen: scripts/create-pr.mjs update (schreibt Kopfblock und Labels und prüft vorher).'),
  };
}

function mcpCall(toolName, input, ctx) {
  const forge = /bitbucket/i.test(toolName) ? 'bitbucket' : 'github';
  const ours = oursByOwner(input?.owner ?? input?.workspace);
  if (ours === false) return { findings: [], deny: false };
  if (/update_pull_request$/i.test(toolName)) {
    if (typeof input?.body !== 'string') return { findings: [], deny: false };
    const r = checkBody(input.body, forge);
    return { findings: [...r.rules, ...r.warnings], deny: false };
  }
  if (typeof input?.head !== 'string') return { findings: [], deny: false };
  const r = checkPr({ forge, repo: String(input.repo ?? ''), head: input.head, base: String(input.base ?? ''), title: String(input.title ?? ''),
    body: String(input.body ?? ''), draft: Boolean(input.draft), labels: [], author: null, createdAt: ctx.now }, { cutoffs: ctx.cutoffs ?? CUTOFFS });
  return { findings: [...r.errors, ...r.warnings], deny: ours === true && r.errors.length > 0 };
}

export function evaluate(toolName, toolInput, ctx) {
  const out = { findings: [], deny: false };
  const add = (list, denies) => {
    const fresh = list.filter((f) => f && !out.findings.some((g) => g.code === f.code && g.message === f.message));
    out.findings.push(...fresh);
    if (denies && fresh.length) out.deny = true;
  };
  const enforcing = isNewPr(ctx.now, ctx.cutoffs ?? CUTOFFS);
  platform = ctx.platform ?? process.platform;

  if (MCP_PR_TOOL.test(toolName)) {
    const r = mcpCall(toolName, toolInput, ctx);
    add(r.findings, r.deny);
    return out;
  }
  if (toolName !== 'Bash' && toolName !== 'PowerShell') return out;
  const command = String(toolInput?.command ?? '');
  if (!/git|gh|pullrequests/.test(command)) return out;
  const usesSkillScript = command.includes(SKILL_SCRIPT);

  let dir = ctx.cwd ?? null;
  for (const words of splitCommands(command)) {
    const { name, args } = commandWord(words);
    if (NAVIGATE.has(name)) {
      dir = name.startsWith('pop') || args.length !== 1 ? null : joinDir(dir, args[0]);
      continue;
    }
    // Branch names matter only for PRs: a branch or push gets a hint, so session branches (claude/...) can still be pushed
    // and pr-anlegen renames them before the PR.
    if (name === 'git') {
      const { dir: gitDir, sub, rest } = gitCall(args, dir);
      const found = (sub === 'push'
        ? pushedBranches(rest, gitDir, ctx).map((b) => branchFinding(b, gitDir, ctx, true))
        : [branchFinding(newBranchName(sub, rest), gitDir, ctx, false)]).filter(Boolean);
      if (found.length && oursByRemote(gitDir, ctx) !== false) add(found, false);
    } else if (name === 'gh' && args[0] === 'pr' && ['create', 'new', 'edit'].includes(args[1])) {
      const r = args[1] === 'edit' ? ghPrEdit(args.slice(2), dir, ctx) : ghPrCreate(args.slice(2), dir, ctx);
      if (r) add(r.findings, r.deny);
    }
    const api = usesSkillScript ? null : apiFinding(name, args, dir, ctx);
    if (api) add([api.finding], enforcing && api.creates && api.ours === true);
  }
  return out;
}

export function hookMessage({ findings, deny }) {
  const intro = deny
    ? 'PR-Regeln: Der Aufruf wurde nicht ausgeführt, weil er gegen die PR-Regeln verstößt.'
    : 'PR-Regeln (Hinweis, keine Sperre):';
  return `${intro}\n${formatFindings(findings)}\nPRs am besten mit dem Skill „pr-anlegen“ anlegen. Regeln: https://github.com/wemotion-gmbh/pr-regeln`;
}
