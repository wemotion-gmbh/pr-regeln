import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgeOfRepo, normalizeBody, parseHeadBlock, stopLines } from '../lib/pr-rules.mjs';

const codes = (r) => r.findings.map((f) => f.code);

test('clean head block with all four keys', () => {
  const body = [
    'Paired-with: example-api https://github.com/example/example-api/tree/feat/other-name',
    'Braucht: example-api#12 erst live',
    'Merge-Stopp: waits for the data fix',
    'Nach dem Merge: save the KB page',
    '',
    '## Abhängigkeiten und Reihenfolge',
    'API first.',
  ].join('\n');
  const r = parseHeadBlock(body);
  assert.deepEqual(codes(r), []);
  assert.equal(r.end, 4);
  assert.deepEqual(r.needs, [{ repo: 'example-api', number: 12, note: 'erst live' }]);
  assert.deepEqual(r.stops, ['waits for the data fix']);
  assert.deepEqual(r.pairedWith, [{ repo: 'example-api', url: 'https://github.com/example/example-api/tree/feat/other-name' }]);
});

test('leading blank lines and html comments before the block are allowed', () => {
  const r = parseHeadBlock('<!-- explain the head lines -->\n\nMerge-Stopp: x\n\ntext');
  assert.deepEqual(r.stops, ['x']);
  assert.deepEqual(codes(r), []);
});

test('negated lines are K2 and a negated stop still counts as a stop', () => {
  const r = parseHeadBlock('Merge-Stopp: keiner.\nBraucht: nichts\n\ntext');
  assert.deepEqual(codes(r), ['K2', 'K2']);
  assert.deepEqual(r.stops, ['keiner.']);
  assert.deepEqual(r.needs, []);
});

test('Braucht in the wrong form is K3', () => {
  assert.deepEqual(codes(parseHeadBlock('Braucht: #12')), ['K3']);
  assert.deepEqual(codes(parseHeadBlock('Braucht: example-api#1 und #2')), ['K3']);
  assert.deepEqual(codes(parseHeadBlock('Braucht: example-api#1, example-web#2')), ['K3']);
  assert.deepEqual(codes(parseHeadBlock('Braucht: example-api feat/some-branch (PR folgt)')), ['K3']);
  assert.deepEqual(codes(parseHeadBlock('Braucht: example-api#12abc')), ['K3']);
});

test('keys explained in an HTML comment are no K1', () => {
  const template = '<!--\nMerge-Stopp: <Grund>\nBraucht: <repo>#<nr>\n-->\n\n## Abhängigkeiten und Reihenfolge\nKeine.';
  assert.deepEqual(codes(parseHeadBlock(template)), []);
  assert.deepEqual(codes(parseHeadBlock('Text\n<!-- Merge-Stopp: x\n  Braucht: y -->\n**Merge-Stopp:** z')), ['K1']);
});

test('stopLines finds every stop-like line, also misplaced and malformed ones', () => {
  const body = ['Merge-Stopp: oben', '', 'Merge-Stopp: nach der Leerzeile', 'Text', '**Merge-Stopp:** fett', '  Merge-Stopp: eingerückt',
    'Merge-Stop: falsch', 'Merge-Stopp:', '```', 'Merge-Stopp: im Code', '```', '<!--', 'Merge-Stopp: im Kommentar', '-->', 'Braucht: example-api#1'].join('\n');
  assert.deepEqual(stopLines(body), ['oben', 'nach der Leerzeile', 'fett', 'eingerückt', 'falsch', '']);
});

test('forgeOfRepo knows the Bitbucket product repos and takes a longer list', () => {
  assert.equal(forgeOfRepo('canou-hub'), 'bitbucket');
  assert.equal(forgeOfRepo('canou-forms-microservice'), 'bitbucket');
  assert.equal(forgeOfRepo('fusion-api-v3'), 'github');
  assert.equal(forgeOfRepo('example-site'), 'github');
  assert.equal(forgeOfRepo('example-site', { bitbucketRepos: ['example-site'] }), 'bitbucket');
});

test('a comma or period right after the number starts the free text', () => {
  const r = parseHeadBlock('Braucht: example-api#12, nur für die Zahlen der Karte\nBraucht: example-web#3.');
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.needs.map((n) => [n.repo, n.number, n.note]), [['example-api', 12, 'nur für die Zahlen der Karte'], ['example-web', 3, '']]);
});

test('Paired-with without a link is K4', () => {
  assert.deepEqual(codes(parseHeadBlock('Paired-with: example-web feat/x')), ['K4']);
});

test('empty stop is K6', () => {
  assert.deepEqual(codes(parseHeadBlock('Merge-Stopp:\n\ntext')), ['K6']);
});

test('keys further down, indented, bold or misspelled are K1', () => {
  assert.deepEqual(codes(parseHeadBlock('Intro\n\nMerge-Stopp: x')), ['K1']);
  assert.deepEqual(codes(parseHeadBlock('  Merge-Stopp: x')), ['K1']);
  assert.deepEqual(codes(parseHeadBlock('**Merge-Stopp:** x')), ['K1']);
  assert.deepEqual(codes(parseHeadBlock('Merge-Stop: x')), ['K1']);
  assert.deepEqual(codes(parseHeadBlock('Braucht : example-api#1')), ['K1']);
  assert.deepEqual(codes(parseHeadBlock('Paired with: example-api https://x.test/a')), ['K1']);
});

test('bitbucket escapes are removed before reading', () => {
  const raw = 'Text\n\n  Merge\\-Stopp: wait for meal\\_main';
  const body = normalizeBody(raw, 'bitbucket');
  assert.equal(body, 'Text\n\n  Merge-Stopp: wait for meal_main');
  assert.deepEqual(codes(parseHeadBlock(body)), ['K1']);
  assert.equal(normalizeBody('a\r\nb', 'github'), 'a\nb');
});

test('a sentence that only mentions the word is not K1', () => {
  assert.deepEqual(codes(parseHeadBlock('Text\n\nKein Merge-Stopp mehr: the fix is live.')), []);
});

test('keys inside code blocks are ignored', () => {
  assert.deepEqual(codes(parseHeadBlock('Text\n\n```\nMerge-Stopp: example\n```\n')), []);
});
