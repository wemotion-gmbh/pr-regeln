import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/create-pr.mjs', import.meta.url));
// Fetching from the GitHub origin fails at once, so the script works on the refs the test sets.
const ENV = { ...process.env, GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' };

const MIGRATION = [
  '<?php',
  'return new class extends Migration {',
  '    public function up()',
  '    {',
  "        Schema::table('t', function (Blueprint $table) {",
  "            $table->dropColumn('x');",
  '        });',
  '    }',
  '};',
  '',
].join('\n');

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', env: ENV });

function commit(dir, file, content) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
  git(dir, 'add', file);
  git(dir, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', file);
}

// A repository on the given branch, with a GitHub origin that is never contacted.
function repo(branch) {
  const dir = mkdtempSync(join(tmpdir(), 'create-pr-'));
  git(dir, 'init', '-q');
  git(dir, 'checkout', '-q', '-b', branch);
  git(dir, 'remote', 'add', 'origin', 'https://github.com/example-org/example-repo.git');
  writeFileSync(join(dir, 'body.md'), '## Abhängigkeiten und Reihenfolge\nKeine.\n');
  return dir;
}

const createPr = (dir, ...extra) => spawnSync(process.execPath, [SCRIPT, 'create', '--repo-dir', dir, '--base', 'live', '--title', 't',
  '--body-file', join(dir, 'body.md'), '--ready', '--dry-run', ...extra], { encoding: 'utf8', env: ENV });

test('--rename-to never takes a fixed branch name', () => {
  const dir = repo('claude/x');
  for (const fixed of ['main', 'master', 'beta', 'live']) {
    const r = createPr(dir, '--rename-to', fixed);
    assert.equal(r.status, 2, fixed);
    assert.match(r.stderr, /fest/, fixed);
  }
});

test('options also take the form --name=value', () => {
  const r = createPr(repo('claude/x'), '--rename-to=beta');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /fest/);
});

test('--head takes a plain branch name only, never a ref expression', () => {
  const dir = repo('beta');
  for (const head of ['HEAD', 'refs/heads/beta', 'feat/x:beta', '+beta', 'beta~1', '@{-1}']) {
    const r = createPr(dir, '--head', head);
    assert.equal(r.status, 2, head);
    assert.match(r.stderr, /Branch-Namen/, head);
  }
});

test('a short ref name never pushes a fixed branch', () => {
  const dir = repo('beta');
  commit(dir, 'README.md', 'x');
  const remote = mkdtempSync(join(tmpdir(), 'create-pr-remote-'));
  git(remote, 'init', '-q', '--bare');
  git(dir, 'remote', 'set-url', '--push', 'origin', remote);
  git(dir, 'push', '-q', 'origin', 'beta', 'beta:live');
  const before = execFileSync('git', ['-C', remote, 'rev-parse', 'beta', 'live'], { encoding: 'utf8', env: ENV });
  commit(dir, 'later.md', 'y');
  git(dir, 'branch', '-f', 'live', 'beta');
  for (const head of ['heads/beta', 'heads/live']) {
    const r = spawnSync(process.execPath, [SCRIPT, 'create', '--repo-dir', dir, '--base', 'main', '--head', head, '--title', 't',
      '--body-file', join(dir, 'body.md'), '--ready'], { encoding: 'utf8', env: ENV });
    assert.notEqual(r.status, 0, head);
  }
  assert.equal(execFileSync('git', ['-C', remote, 'rev-parse', 'beta', 'live'], { encoding: 'utf8', env: ENV }), before);
});

test('migrations in a subfolder are found', () => {
  const dir = repo('feat/x');
  commit(dir, 'README.md', 'x');
  git(dir, 'update-ref', 'refs/remotes/origin/live', 'HEAD');
  commit(dir, 'api-resource/database/migrations/2026_01_01_000000_drop_x.php', MIGRATION);
  const r = createPr(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Migrationen: löschen Daten/);
  assert.match(r.stdout, /🔑 Marcs Ja fehlt/);
});

test('a fixed head is read as origin/<head>, the branch the PR shows', () => {
  const dir = repo('beta');
  commit(dir, 'README.md', 'x');
  git(dir, 'update-ref', 'refs/remotes/origin/live', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'newer');
  commit(dir, 'api-resource/database/migrations/2026_01_01_000000_drop_x.php', MIGRATION);
  git(dir, 'update-ref', 'refs/remotes/origin/beta', 'HEAD');
  git(dir, 'checkout', '-q', 'beta');
  const r = createPr(dir, '--head', 'beta');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Migrationen: löschen Daten/);
  assert.match(r.stdout, /🔑 Marcs Ja fehlt/);
});
