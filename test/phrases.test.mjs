import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBody, findStopPhrases } from '../lib/pr-rules.mjs';

const kinds = (body) => findStopPhrases(body, 0).map((p) => p.kind);

test('stop phrases', () => {
  assert.deepEqual(kinds('Bitte nicht mergen, bis die Daten da sind.'), ['stop']);
  assert.deepEqual(kinds('Do not merge yet.'), ['stop']);
  assert.deepEqual(kinds("Don't merge before Monday."), ['stop']);
  assert.deepEqual(kinds('Merge frühestens morgen.'), ['stop']);
  assert.deepEqual(kinds('[blocked] by infra'), ['stop']);
  assert.deepEqual(kinds('Hier gilt ein Merge-Stopp bis Freitag.'), ['stop']);
  assert.deepEqual(kinds('Merge-Stopp (beta → live): erst nach dem Release.'), ['stop']);
  assert.deepEqual(kinds('- **Merge-Stopp** bis die Daten da sind'), ['stop']);
});

test('negated stop word does not count', () => {
  assert.deepEqual(kinds('Kein Merge-Stopp mehr: the fix is live.'), []);
});

test('the stop word inside a description is only a mention', () => {
  assert.deepEqual(kinds('- Der Merge-Stopp eines Release-PRs wartete auf die falsche Person.'), ['mention']);
  assert.deepEqual(kinds('Es gab keinen PR, der mergebar ist und trotzdem einen Merge-Stopp hat.'), ['mention']);
  assert.deepEqual(kinds('Der Merge-Stopp ist neu. Bitte nicht mergen.'), ['stop']);
  const r = checkBody('Die Liste zeigt PRs mit Merge-Stopp oben.\n\n## Abhängigkeiten und Reihenfolge\nKeine.', 'github');
  assert.deepEqual(r.rules, []);
  assert.deepEqual(r.warnings.map((f) => f.code), ['W3']);
  assert.match(r.warnings[0].fix, /Backticks/);
  assert.deepEqual(checkBody('Merge-Stopp: x\n\nDie Liste zeigt PRs mit Merge-Stopp oben.\n\n## Abhängigkeiten und Reihenfolge\nKeine.', 'github').warnings, []);
});

test('the K5 fix says what to do when it is no stop', () => {
  const [k5] = checkBody('Bitte nicht mergen.\n\n## Abhängigkeiten und Reihenfolge\nKeine.', 'github').rules;
  assert.equal(k5.code, 'K5');
  assert.match(k5.fix, /Backticks/);
});

test('dependency phrases', () => {
  assert.deepEqual(kinds('Merge #12 zuerst.'), ['dependency']);
  assert.deepEqual(kinds('Erst nach #12 mergen.'), ['dependency']);
  assert.deepEqual(kinds('Nur zusammen mit dem API-PR.'), ['dependency']);
});

test('code, html comments and the dependency section are not read', () => {
  assert.deepEqual(kinds('Use `do not merge` as the label text.'), []);
  assert.deepEqual(kinds('```\nnicht mergen\n```'), []);
  assert.deepEqual(kinds('<!-- Merge-Stopp: example -->'), []);
  const withSection = ['## Abhängigkeiten und Reihenfolge', 'Erst nach #12 mergen.', '', '## Bitte testen', 'Klick.'].join('\n');
  assert.deepEqual(kinds(withSection), []);
  const after = ['## Dependencies and release order', 'only together with x', '## Other', 'erst nach #3'].join('\n');
  assert.deepEqual(kinds(after), ['dependency']);
});

test('a multi-line comment before the head block does not hide a stop below it', () => {
  const body = '<!--\nexplains\nthe keys\n-->\nBraucht: example-api#1\n\nBitte nicht mergen.\n\n## Abhängigkeiten und Reihenfolge\nKeine.';
  assert.deepEqual(checkBody(body, 'github').rules.map((f) => f.code), ['K5']);
});

test('only text below the head block is read', () => {
  assert.deepEqual(findStopPhrases('Merge-Stopp: nicht mergen\n\ntext', 1), []);
});

test('the quote is the sentence around the match', () => {
  const [p] = findStopPhrases('Intro. Bitte **nicht mergen**, bis X live ist. Danach ja.', 0);
  assert.equal(p.quote, 'Bitte nicht mergen, bis X live ist.');
});
