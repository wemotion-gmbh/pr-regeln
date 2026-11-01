import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrUrl } from '../lib/forges.mjs';
import { formatResult } from '../lib/format.mjs';

test('parsePrUrl reads GitHub pull URLs', () => {
  const want = { forge: 'github', owner: 'example-org', repo: 'example-api', number: 12 };
  assert.deepEqual(parsePrUrl('https://github.com/example-org/example-api/pull/12'), want);
  assert.deepEqual(parsePrUrl('https://github.com/example-org/example-api/pull/12/files#diff-1'), want);
  assert.deepEqual(parsePrUrl('  https://github.com/example-org/example-api/pull/12?w=1 '), want);
});

test('parsePrUrl reads Bitbucket pull-request URLs', () => {
  const want = { forge: 'bitbucket', owner: 'example-ws', repo: 'example-hub', number: 7 };
  assert.deepEqual(parsePrUrl('https://bitbucket.org/example-ws/example-hub/pull-requests/7'), want);
  assert.deepEqual(parsePrUrl('https://bitbucket.org/example-ws/example-hub/pull-requests/7/diff'), want);
});

test('parsePrUrl rejects everything else', () => {
  for (const url of [
    'https://example.com/a/b/pull/1',
    'https://github.com/a/b/issues/1',
    'https://github.com/a/b/pull/abc',
    'https://bitbucket.org/a/b/pull/1',
    'not a url',
    '',
  ]) assert.equal(parsePrUrl(url), null, url);
});

const pr = { forge: 'github', repo: 'example-api', number: 12, title: 'Example', head: 'feature/x', base: 'beta' };

test('formatResult without findings', () => {
  const out = formatResult({ errors: [], warnings: [], isNew: true, migration: { deleting: false, files: [] } }, pr);
  assert.match(out, /example-api#12/);
  assert.match(out, /Keine Funde\./);
  assert.match(out, /Ergebnis: grün$/m);
  assert.doesNotMatch(out, /Fehler|Hinweise/);
});

test('formatResult lists errors and warnings with code, sentence and fix', () => {
  const result = {
    errors: [{ code: 'K7', message: 'Der Branch passt nicht.', fix: 'Branch umbenennen: feat/x' }],
    warnings: [{ code: 'W1', message: 'Abschnitt fehlt.' }],
    isNew: true,
    migration: { deleting: false, files: [] },
  };
  const out = formatResult(result, pr);
  assert.match(out, /Fehler \(1\):\n- K7 Der Branch passt nicht\.\n  Abhilfe: Branch umbenennen: feat\/x/);
  assert.match(out, /Hinweise \(1\):\n- W1 Abschnitt fehlt\./);
  assert.match(out, /Ergebnis: rot$/m);
  assert.ok(out.indexOf('Fehler') < out.indexOf('Hinweise'));
});

test('formatResult says why an old PR only gets hints', () => {
  const out = formatResult({ errors: [], warnings: [{ code: 'K7', message: 'x' }], isNew: false, migration: null }, pr);
  assert.match(out, /Ergebnis: grün, mit Hinweisen$/m);
  assert.match(out, /nicht als neu/);
});

test('formatResult names the deleting migrations', () => {
  const result = {
    errors: [{ code: 'M1', message: 'Migration löscht Daten.' }],
    warnings: [],
    isNew: false,
    migration: { deleting: true, files: ['database/migrations/a.php'] },
  };
  assert.match(formatResult(result, pr), /database\/migrations\/a\.php/);
});

test('formatResult for a bot PR', () => {
  const out = formatResult({ errors: [], warnings: [], isNew: false, skipped: 'bot' }, pr);
  assert.match(out, /Bot/);
  assert.doesNotMatch(out, /Keine Funde/);
});
