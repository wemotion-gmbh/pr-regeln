import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPr, CUTOFFS, isNewPr, MIGRATION_LABEL_OK } from '../lib/pr-rules.mjs';

const GOOD_BODY = '## Abhängigkeiten und Reihenfolge\nKeine.\n\n## Worum es geht\nText.';
const base = {
  forge: 'github', repo: 'example-api', head: 'feat/example', base: 'beta', title: 't', body: GOOD_BODY, draft: false,
  labels: [], author: { login: 'someone', type: 'User' }, createdAt: '2026-01-10T10:00:00Z', files: [],
};
const past = { T0: '2026-01-01T00:00:00Z', T1: '2026-01-05T00:00:00Z', T2: '2026-01-08T00:00:00Z' };
const unset = { T0: null, T1: null, T2: null };
const codes = (list) => list.map((f) => f.code);
const DELETING = [{ path: 'database/migrations/x.php', patch: "@@ -1 +1,2 @@\n+        $table->dropColumn('a');" }];

test('isNewPr needs a T1', () => {
  assert.equal(isNewPr('2030-01-01T00:00:00Z', unset), false);
  assert.equal(isNewPr('2026-01-05T00:00:00Z', past), true);
  assert.equal(isNewPr('2026-01-04T23:59:59Z', past), false);
});

test('the cutoffs are set, all at 02.11.2026 15:00 Berlin', () => {
  assert.deepEqual(CUTOFFS, { T0: '2026-11-02T14:00:00Z', T1: '2026-11-02T14:00:00Z', T2: '2026-11-02T14:00:00Z' });
  assert.equal(isNewPr('2026-11-02T13:59:59Z'), false);
  assert.equal(isNewPr('2026-11-02T14:00:00Z'), true);
});

test('a clean PR has no findings', () => {
  const r = checkPr(base, { cutoffs: past });
  assert.deepEqual(r, { errors: [], warnings: [], isNew: true, migration: { deleting: false, files: [] } });
});

test('without cutoffs every finding is a warning', () => {
  const r = checkPr({ ...base, head: 'feature/x', body: 'Merge-Stopp: keiner\n\nBitte nicht mergen.' }, { cutoffs: unset });
  assert.deepEqual(r.errors, []);
  assert.equal(r.isNew, false);
  assert.deepEqual(codes(r.warnings).sort(), ['K2', 'K7', 'W1']);
});

test('a new PR gets errors, warnings stay warnings', () => {
  const r = checkPr({ ...base, head: 'feature/x', body: 'Bitte nicht mergen.' }, { cutoffs: past });
  assert.deepEqual(codes(r.errors).sort(), ['K5', 'K7']);
  assert.deepEqual(codes(r.warnings), ['W1']);
  assert.match(r.errors.find((f) => f.code === 'K7').fix, /feat\/x/);
});

test('an old PR is never red, apart from the migration rule', () => {
  const r = checkPr({ ...base, createdAt: '2026-01-02T00:00:00Z', head: 'feature/x' }, { cutoffs: past });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(codes(r.warnings), ['K7']);
});

test('bots are skipped', () => {
  assert.deepEqual(checkPr({ ...base, author: { login: 'dependabot[bot]' }, head: 'dependabot/npm/x' }), { errors: [], warnings: [], isNew: false, skipped: 'bot' });
});

test('github migration without the yes label is always an error', () => {
  const old = checkPr({ ...base, files: DELETING });
  assert.deepEqual(codes(old.errors), ['M1']);
  assert.equal(old.migration.deleting, true);
  assert.deepEqual(checkPr({ ...base, files: DELETING, labels: [MIGRATION_LABEL_OK] }).errors, []);
});

test('bitbucket migration is only a warning', () => {
  const r = checkPr({ ...base, forge: 'bitbucket', repo: 'canou-hub', files: DELETING }, { cutoffs: past });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(codes(r.warnings), ['M1']);
});

test('no files means the migration rule was not checked', () => {
  const { files, ...noFiles } = base;
  assert.equal(checkPr(noFiles).migration, null);
});

test('type labels on GitHub', () => {
  assert.deepEqual(codes(checkPr({ ...base, head: 'hotfix/x' }, { cutoffs: past }).errors), ['K8']);
  assert.deepEqual(checkPr({ ...base, head: 'hotfix/x', labels: ['🚑 Hotfix'] }, { cutoffs: past }).errors, []);
  assert.deepEqual(codes(checkPr({ ...base, labels: ['🔧 Wartung'] }, { cutoffs: past }).errors), ['K8']);
  assert.deepEqual(checkPr({ ...base, head: 'release/2026.11', base: 'main' }, { cutoffs: past }).errors, []);
  assert.deepEqual(checkPr({ ...base, head: 'beta', base: 'live' }, { cutoffs: past }).errors, []);
  assert.deepEqual(checkPr({ ...base, forge: 'bitbucket', head: 'hotfix/x' }, { cutoffs: past }).errors, []);
});

test('retired labels on a new PR are K9', () => {
  assert.deepEqual(codes(checkPr({ ...base, labels: ['✅ Bereit zum Review'] }, { cutoffs: past }).errors), ['K9']);
});

test('a stop line or a dependency line answers the phrases', () => {
  const body = `Merge-Stopp: wait\n\n${GOOD_BODY}\nBitte nicht mergen.`;
  assert.deepEqual(checkPr({ ...base, body }, { cutoffs: past }).errors, []);
  const dep = `Braucht: example-web#3\n\n${GOOD_BODY}\nNur zusammen mit dem Web-PR.`;
  assert.deepEqual(checkPr({ ...base, body: dep }, { cutoffs: past }).errors, []);
  const depNoLine = `${GOOD_BODY}\nNur zusammen mit dem Web-PR.`;
  assert.deepEqual(codes(checkPr({ ...base, body: depNoLine }, { cutoffs: past }).errors), ['K5']);
});

test('Paired-with with the same branch name is a warning', () => {
  const body = `Paired-with: example-web https://github.com/example/example-web/tree/feat/example\n\n${GOOD_BODY}`;
  assert.deepEqual(codes(checkPr({ ...base, body }, { cutoffs: past }).warnings), ['W2']);
});

test('bitbucket escapes are removed before checking', () => {
  const body = `Merge\\-Stopp: wait\n\n${GOOD_BODY}`;
  assert.deepEqual(checkPr({ ...base, forge: 'bitbucket', repo: 'canou-hub', body }, { cutoffs: past }).errors, []);
});
