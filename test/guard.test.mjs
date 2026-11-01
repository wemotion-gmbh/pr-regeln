import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitCommands } from '../lib/shell.mjs';
import { evaluate } from '../lib/guard.mjs';

const past = { T0: '2026-01-01T00:00:00Z', T1: '2026-01-05T00:00:00Z', T2: '2026-01-08T00:00:00Z' };
const SECTION = '## Abhängigkeiten und Reihenfolge\nKeine.';
const ctx = (over = {}) => ({
  cutoffs: { T0: null, T1: null, T2: null },
  now: '2026-01-10T10:00:00Z',
  cwd: '/repo',
  remoteHasBranch: (dir, branch) => (over.remote ?? []).includes(branch),
  currentBranch: () => over.current ?? 'feat/current',
  readFile: (p) => (over.files ?? {})[p] ?? null,
  ...over,
});
const run = (command, over) => evaluate('Bash', { command }, ctx(over));
const codes = (r) => r.findings.map((f) => f.code);

// splitCommands

test('splits at separators outside quotes', () => {
  assert.deepEqual(splitCommands('git add . && git commit -m "a; b" | cat'), [['git', 'add', '.'], ['git', 'commit', '-m', 'a; b'], ['cat']]);
  assert.deepEqual(splitCommands("cd x\ngit push; echo 'x && y' || true"), [['cd', 'x'], ['git', 'push'], ['echo', 'x && y'], ['true']]);
});

test('drops heredoc and here-string bodies', () => {
  const heredoc = splitCommands("cat <<'EOF' > b.md\ngh pr create --title x\nEOF\ngit status");
  assert.ok(!heredoc.some((s) => s.includes('gh')));
  assert.deepEqual(heredoc.at(-1), ['git', 'status']);
  const here = splitCommands("$b = @'\ngh pr create --title x\n'@\ngit status");
  assert.ok(!here.some((s) => s.includes('gh')));
  assert.deepEqual(here.at(-1), ['git', 'status']);
});

test('resolves simple literal assignments in later segments', () => {
  assert.deepEqual(splitCommands("$b='feature/y'; git checkout -b $b").at(-1), ['git', 'checkout', '-b', 'feature/y']);
  assert.deepEqual(splitCommands('b="feature/y"; git checkout -b "$b"').at(-1), ['git', 'checkout', '-b', 'feature/y']);
  assert.deepEqual(splitCommands('$sp = "C:\\tmp"; gh pr create --body-file "$sp\\body.md"').at(-1), ['gh', 'pr', 'create', '--body-file', 'C:\\tmp\\body.md']);
  assert.deepEqual(splitCommands("$x='a'; echo '$x' $y").at(-1), ['echo', '$x', '$y']);
});

test('joins continued lines', () => {
  assert.deepEqual(splitCommands('git push `\n  origin feat/x'), [['git', 'push', 'origin', 'feat/x']]);
  assert.deepEqual(splitCommands('git push \\\n  origin feat/x'), [['git', 'push', 'origin', 'feat/x']]);
});

// new branches

test('a new branch with a wrong name gets a suggestion', () => {
  const r = run('git checkout -b feature/x');
  assert.deepEqual(codes(r), ['K7']);
  assert.match(r.findings[0].fix, /feat\/x/);
  assert.equal(r.deny, false);
});

test('good names and non-creating branch commands stay quiet', () => {
  for (const c of ['git switch -c feat/x', 'git branch -d feature/x', 'git branch --show-current', 'git branch', 'git checkout feature/x']) {
    assert.deepEqual(run(c).findings, [], c);
  }
});

test('other ways to create or rename a branch', () => {
  for (const c of ['git branch feature/x', 'git branch -m old feature/x', 'git worktree add -b feature/x ../wt', 'git -C ../wt switch --create feature/x']) {
    assert.deepEqual(codes(run(c)), ['K7'], c);
  }
});

test('a local branch for an existing remote branch is not new', () => {
  assert.deepEqual(run('git checkout -b feature/old origin/feature/old', { remote: ['feature/old'] }).findings, []);
});

test('a resolved variable is checked, an unknown one is not', () => {
  assert.deepEqual(codes(run("$b='feature/y'; git checkout -b $b")), ['K7']);
  assert.deepEqual(run('git checkout -b $b').findings, []);
});

test('commands inside echo, grep or heredocs are not run', () => {
  assert.deepEqual(run('echo "gh pr create --title x --head feature/x"').findings, []);
  assert.deepEqual(run('grep -r "git checkout -b feature/x" .').findings, []);
  assert.deepEqual(run("cat <<'EOF' > b.md\ngit checkout -b feature/x\nEOF").findings, []);
});

// push

test('push of a new branch with a wrong name', () => {
  assert.deepEqual(codes(run('git push -u origin feature/old')), ['K7']);
  assert.deepEqual(run('git push -u origin feature/old', { remote: ['feature/old'] }).findings, []);
  assert.deepEqual(codes(run('git push origin HEAD', { current: 'feature/cur' })), ['K7']);
  assert.deepEqual(codes(run('git push', { current: 'feature/cur' })), ['K7']);
  assert.deepEqual(codes(run('git push origin feat/x:feature/x')), ['K7']);
});

test('deletions, fixed branches, tags and unknown directories stay quiet', () => {
  for (const c of ['git push origin --delete feature/x', 'git push origin :feature/x', 'git push origin main', 'git push origin v1.0.0 --tags', 'git push --tags', 'git -C $repo push', 'git push origin $b']) {
    assert.deepEqual(run(c).findings, [], c);
  }
});

// gh pr create / edit

test('gh pr create checks title, body, head and labels', () => {
  const r = run('gh pr create --head feat/x --base main --title t --body "Merge-Stopp: keiner"');
  assert.ok(codes(r).includes('K2'));
  assert.equal(r.deny, false);
  assert.deepEqual(run(`gh pr create --head feat/x --base main --title t --body "${SECTION}"`).findings, []);
  assert.deepEqual(codes(run(`gh pr create --head hotfix/x --base live --title t --body "${SECTION}"`)), ['K8']);
  assert.deepEqual(run(`gh pr create --head hotfix/x --base live --title t --label "🚑 Hotfix" --body "${SECTION}"`).findings, []);
});

test('gh pr create takes the current branch and reads a literal body file', () => {
  const files = { 'C:\\tmp\\b.md': 'Bitte nicht mergen.\n\n' + SECTION };
  const r = run('$sp = "C:\\tmp"; gh pr create --base main --title t --body-file "$sp\\b.md"', { current: 'feature/z', files });
  assert.deepEqual(codes(r).sort(), ['K5', 'K7']);
});

test('gh pr create with an unreadable body stays quiet', () => {
  assert.deepEqual(run('gh pr create --head feat/x --base main --title t --body-file $f').findings, []);
  assert.deepEqual(run('gh pr create --head feat/x --base main --title t --body-file missing.md').findings, []);
  assert.deepEqual(run('gh pr create --head feat/x --base main --title t --body "$(cat <<\'EOF\'\nBitte nicht mergen\nEOF\n)"').findings, []);
});

test('gh pr edit checks the text and added labels, but never denies', () => {
  const r = run('gh pr edit 12 --body "Merge-Stopp: keiner"', { cutoffs: past });
  assert.ok(codes(r).includes('K2'));
  assert.equal(r.deny, false);
  assert.deepEqual(codes(run('gh pr edit 12 --add-label "✅ Bereit zum Review"')), ['K9']);
  assert.deepEqual(run('gh pr edit 12 --add-reviewer x').findings, []);
});

// API calls

test('PRs created or changed through the API point to pr-anlegen', () => {
  const api = 'https://api.bitbucket.org/2.0/repositories/ws/r/pullrequests';
  assert.deepEqual(codes(run(`curl -s -X POST ${api} -d @x.json`)), ['P1']);
  assert.deepEqual(codes(run(`curl.exe -s -L -X PUT "${api}/12" --data @x.json`)), ['P1']);
  assert.deepEqual(codes(run('& "$sp\\bb-api.ps1" -Method POST -Path "repositories/ws/r/pullrequests" -BodyFile x.json')), ['P1']);
  assert.deepEqual(codes(run('gh api -X POST repos/o/r/pulls -f title=x')), ['P1']);
  assert.deepEqual(codes(run('gh api repos/o/r/pulls --input pr.json')), ['P1']);
});

test('comments, merges and reads through the API stay quiet', () => {
  const api = 'https://api.bitbucket.org/2.0/repositories/ws/r/pullrequests';
  for (const c of [`curl -s -X POST ${api}/12/comments -d @c.json`, `curl -s ${api}?state=OPEN`, `curl -s -X POST ${api}/12/merge`, 'gh api repos/o/r/pulls/3/comments -f body=x', 'gh api repos/o/r/pulls']) {
    assert.deepEqual(run(c).findings, [], c);
  }
});

test('calls through pr-anlegen stay quiet', () => {
  assert.deepEqual(run('node scripts/pr-anlegen.mjs create --repo-dir . --base main --title t --body-file b.md --ready').findings, []);
});

// MCP tools

test('MCP create and update tools are checked on their input', () => {
  const create = evaluate('mcp__github__create_pull_request', { owner: 'o', repo: 'r', title: 't', body: 'Braucht: nichts', head: 'feature/x', base: 'main' }, ctx());
  assert.deepEqual(codes(create).sort(), ['K2', 'K7', 'W1']);
  const update = evaluate('mcp__github__update_pull_request', { owner: 'o', repo: 'r', pullNumber: 3, body: 'Braucht: nichts' }, ctx({ cutoffs: past }));
  assert.deepEqual(codes(update).sort(), ['K2', 'W1']);
  assert.equal(update.deny, false);
});

// deny only from T1 on

test('before T1 nothing is denied, from T1 on new branches and PRs are', () => {
  assert.equal(run('git checkout -b feature/x').deny, false);
  assert.equal(run('git checkout -b feature/x', { cutoffs: past }).deny, true);
  assert.equal(run('gh pr create --head feat/x --base main --title t --body "Merge-Stopp: keiner"', { cutoffs: past }).deny, true);
  assert.equal(run(`gh pr create --head feat/x --base main --title t --body "${SECTION}"`, { cutoffs: past }).deny, false);
  assert.equal(run('curl -X POST https://api.bitbucket.org/2.0/repositories/ws/r/pullrequests -d @x.json', { cutoffs: past }).deny, true);
  assert.equal(run('git checkout -b feat/x', { cutoffs: past }).deny, false);
});

// the hook script

const GUARD = fileURLToPath(new URL('../scripts/pr-guard.mjs', import.meta.url));
const hook = (input, data) => spawnSync(process.execPath, [GUARD], {
  input: typeof input === 'string' ? input : JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PLUGIN_DATA: data },
});

test('the hook prints a hint, counts it and never prints allow', () => {
  const data = mkdtempSync(join(tmpdir(), 'pr-guard-'));
  const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git checkout -b feature/x' }, cwd: data }, data);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.match(out.additionalContext, /feat\/x/);
  assert.equal(out.permissionDecision, undefined);
  assert.doesNotMatch(r.stdout, /allow/);
  assert.equal(JSON.parse(readFileSync(join(data, 'hits.json'), 'utf8')).byCode.K7, 1);
});

test('the hook is silent for clean calls and broken input', () => {
  const data = mkdtempSync(join(tmpdir(), 'pr-guard-'));
  for (const input of [
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' }, cwd: data },
    { hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command: 'git switch -c feat/x' }, cwd: data },
    'not json',
    { tool_name: 'Bash' },
  ]) {
    const r = hook(input, data);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});
