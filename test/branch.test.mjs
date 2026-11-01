import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBranchName, isBot, typeLabelFor, KINDS } from '../lib/pr-rules.mjs';

test('ten kinds', () => {
  assert.deepEqual([...KINDS], ['feat', 'fix', 'hotfix', 'chore', 'refactor', 'docs', 'test', 'part', 'release', 'revert']);
});

test('valid branch names', () => {
  for (const name of ['feat/x', 'fix/contact-delete', 'release/2026.11', 'revert/foo', 'part/a/b-2', 'docs/kb.page']) {
    assert.equal(checkBranchName(name).ok, true, name);
  }
  assert.equal(checkBranchName('feat/x').kind, 'feat');
});

test('fixed branches are promotions', () => {
  for (const name of ['main', 'master', 'beta', 'live']) {
    const r = checkBranchName(name);
    assert.equal(r.ok, true, name);
    assert.equal(r.promotion, true, name);
  }
});

test('revert button branches count as revert', () => {
  const r = checkBranchName('revert-12-feat/x');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'revert');
});

test('invalid names with suggestions', () => {
  assert.deepEqual(checkBranchName('feature/x'), { ok: false, kind: null, promotion: false, suggestion: 'feat/x' });
  assert.equal(checkBranchName('kb/x').suggestion, 'docs/x');
  assert.equal(checkBranchName('bot/x').suggestion, 'chore/x');
  assert.equal(checkBranchName('bugfix/x').suggestion, 'fix/x');
  assert.equal(checkBranchName('Feat/X').suggestion, 'feat/x');
});

test('invalid names without a sure suggestion', () => {
  for (const name of ['claude/abc', 'ccr-1', 'feat/', 'feat/-x', 'feat', 'sync/x', 'feat/a b']) {
    assert.equal(checkBranchName(name).ok, false, name);
  }
});

test('type labels from the branch kind', () => {
  assert.equal(typeLabelFor('hotfix/a'), '🚑 Hotfix');
  assert.equal(typeLabelFor('part/a'), '🧩 Teilschritt');
  assert.equal(typeLabelFor('revert/a'), '⏪ Rücksetzen');
  assert.equal(typeLabelFor('revert-3-fix/a'), '⏪ Rücksetzen');
  assert.equal(typeLabelFor('chore/a'), '🔧 Wartung');
  assert.equal(typeLabelFor('test/a'), '🔧 Wartung');
  assert.equal(typeLabelFor('feat/a'), null);
  assert.equal(typeLabelFor('release/a'), null);
  assert.equal(typeLabelFor('main'), null);
  assert.equal(typeLabelFor('feature/a'), null);
});

test('bots', () => {
  assert.equal(isBot({ login: 'dependabot[bot]' }), true);
  assert.equal(isBot({ login: 'app/fusion-api-deploy' }), true);
  assert.equal(isBot({ login: 'someone', type: 'Bot' }), true);
  assert.equal(isBot({ login: 'someone', type: 'User' }), false);
  assert.equal(isBot(null), false);
});
