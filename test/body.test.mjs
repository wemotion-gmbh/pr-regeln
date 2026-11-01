import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBody, carriedStops } from '../lib/body.mjs';
import { parseRemote } from '../lib/forges.mjs';

const SECTION = '## Abhängigkeiten und Reihenfolge\nKeine.';

test('head lines come in table order, then a blank line, then the text', () => {
  const body = buildBody({
    text: SECTION,
    needs: ['example-api#12'],
    stops: ['wait for the release'],
    pairedWith: [{ repo: 'example-web', url: 'https://example.org/pr/3' }],
    after: ['save the KB page'],
  });
  assert.equal(body, [
    'Paired-with: example-web https://example.org/pr/3',
    'Braucht: example-api#12',
    'Merge-Stopp: wait for the release',
    'Nach dem Merge: save the KB page',
    '',
    SECTION,
    '',
  ].join('\n'));
});

test('an existing head block is rewritten, keeping its lines', () => {
  const text = 'Merge-Stopp: old reason\r\nBraucht: example-api#1\r\n\r\n\r\nText';
  assert.equal(buildBody({ text, needs: ['example-web#2'] }), 'Braucht: example-api#1\nBraucht: example-web#2\nMerge-Stopp: old reason\n\nText\n');
});

test('no head lines means no leading blank line', () => {
  assert.equal(buildBody({ text: '\n\nText\n\n' }), 'Text\n');
});

test('a line given twice is written once', () => {
  assert.equal(buildBody({ text: 'Braucht: example-api#1\n\nText', needs: ['example-api#1'] }), 'Braucht: example-api#1\n\nText\n');
});

test('a stop is only dropped when it is named', () => {
  assert.equal(buildBody({ text: 'Merge-Stopp: a\nMerge-Stopp: b\n\nText', stops: ['c'], removeStops: ['a'] }), 'Merge-Stopp: b\nMerge-Stopp: c\n\nText\n');
});

test('a leading HTML comment stays in the text below the block', () => {
  assert.equal(buildBody({ text: '<!-- note -->\nMerge-Stopp: x\n\nText' }), 'Merge-Stopp: x\n\n<!-- note -->\n\nText\n');
});

test('carriedStops keeps every stop on the old text, in any form', () => {
  assert.deepEqual(carriedStops('Merge-Stopp: a\n\nText\n**Merge-Stopp:** b\nMerge-Stopp:', 'github'), ['a', 'b', '']);
  assert.deepEqual(carriedStops('Text\n  Merge\\-Stopp: escaped', 'bitbucket'), ['escaped']);
  assert.deepEqual(carriedStops('Intro.\n\nBitte nicht mergen, bis X live ist.', 'github'), ['Bitte nicht mergen, bis X live ist. (übernommen aus dem Text)']);
  assert.deepEqual(carriedStops('Merge-Stopp: a\n\nBitte nicht mergen.', 'github'), ['a']);
  assert.deepEqual(carriedStops('Die Liste zeigt PRs mit Merge-Stopp oben.', 'github'), []);
  assert.deepEqual(carriedStops('## Merge-Stopp-Logik\n\nText', 'github'), []);
});

test('an empty carried stop can be removed with an empty --remove-stop', () => {
  assert.equal(buildBody({ text: 'Text', stops: carriedStops('Merge-Stopp:\n\nx', 'github'), removeStops: [''] }), 'Text\n');
});

test('parseRemote reads GitHub and Bitbucket origins', () => {
  assert.deepEqual(parseRemote('https://github.com/example-org/example-api.git'), { forge: 'github', owner: 'example-org', repo: 'example-api' });
  assert.deepEqual(parseRemote('git@github.com:example-org/example-api.git'), { forge: 'github', owner: 'example-org', repo: 'example-api' });
  assert.deepEqual(parseRemote('https://someone@bitbucket.org/example-ws/example-hub.git'), { forge: 'bitbucket', owner: 'example-ws', repo: 'example-hub' });
  assert.deepEqual(parseRemote('https://bitbucket.org/example-ws/example-hub'), { forge: 'bitbucket', owner: 'example-ws', repo: 'example-hub' });
  assert.equal(parseRemote('https://example.com/a/b.git'), null);
});
