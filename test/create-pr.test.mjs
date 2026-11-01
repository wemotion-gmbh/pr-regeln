import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/create-pr.mjs', import.meta.url));

// A repository without commits on a cloud branch, with a GitHub origin that is never contacted.
function repo(branch) {
  const dir = mkdtempSync(join(tmpdir(), 'create-pr-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('checkout', '-q', '-b', branch);
  git('remote', 'add', 'origin', 'https://github.com/example-org/example-repo.git');
  writeFileSync(join(dir, 'body.md'), '## Abhängigkeiten und Reihenfolge\nKeine.\n');
  return dir;
}

const createPr = (dir, ...extra) => spawnSync(process.execPath, [SCRIPT, 'create', '--repo-dir', dir, '--base', 'live', '--title', 't',
  '--body-file', join(dir, 'body.md'), '--ready', '--dry-run', ...extra], { encoding: 'utf8' });

test('--rename-to never takes a fixed branch name', () => {
  const dir = repo('claude/x');
  for (const fixed of ['main', 'master', 'beta', 'live']) {
    const r = createPr(dir, '--rename-to', fixed);
    assert.equal(r.status, 2, fixed);
    assert.match(r.stderr, /fest/, fixed);
  }
});
