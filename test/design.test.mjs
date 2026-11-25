import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESIGN_APPROVAL, DESIGN_CUTOFFS, DESIGN_LABEL_MISSING, DESIGN_LABEL_OK, DESIGN_RULES, checkPr, designApprovalNote, designEnforced,
  designRuleFor, isDesignUiPath, parseDesignValue, parseHeadBlock,
} from '../lib/pr-rules.mjs';
import { buildBody } from '../lib/body.mjs';

const GOOD_BODY = '## Abhängigkeiten und Reihenfolge\nKeine.\n\n## Worum es geht\nText.';
const hub = {
  forge: 'github', owner: 'wemotion-gmbh', repo: 'canou-hub', head: 'feat/kalender', base: 'beta', title: 't', body: GOOD_BODY,
  draft: false, labels: [], author: { login: 'someone', type: 'User' }, createdAt: '2026-11-26T09:00:00Z',
  files: [{ path: 'components/modules/calendar/calendar-bar.tsx' }, { path: 'lib/calendar/range.ts' }],
};
const NOW = { now: '2026-11-26T10:00:00Z' };
const codes = (list) => list.map((f) => f.code);
const withDesign = (value, extra = {}) => ({ ...hub, body: `Design: ${value}\n\n${GOOD_BODY}`, ...extra });
const rule = DESIGN_RULES['wemotion-gmbh/canou-hub'];

test('the design rule covers canou-hub on GitHub only', () => {
  assert.equal(designRuleFor({ forge: 'github', owner: 'wemotion-gmbh', repo: 'canou-hub' }), rule);
  assert.equal(designRuleFor({ forge: 'github', owner: 'Wemotion-GmbH', repo: 'Canou-Hub' }), rule);
  assert.equal(designRuleFor({ forge: 'bitbucket', owner: 'wemotion-gmbh', repo: 'canou-hub' }), null);
  assert.equal(designRuleFor({ forge: 'github', owner: 'wemotion-gmbh', repo: 'fusion-api-v3' }), null);
  assert.equal(designRuleFor({ forge: 'github', repo: 'canou-hub' }), null);
});

test('UI paths: what the hub shows, never tests, test support, declarations or API routes', () => {
  for (const p of ['app/(app-shell)/layout.tsx', 'components/ui/button.tsx', 'components/modules/forum/forum-words.ts', 'config/modules/blog.ts',
    'lib/timeline/config.ts', 'lib/resource/config/fields.ts', 'lib/x.config.ts', 'styles/components/prose.css', 'app/globals.css']) {
    assert.equal(isDesignUiPath(p, rule), true, p);
  }
  for (const p of ['components/ui/button.test.tsx', 'components/modules/resource/bulk-run.ts', 'app/api/health/route.ts', 'lib/api-client.ts',
    'hooks/media-upload-queue-state.ts', 'lib/test-support/read-source.ts', 'components/__tests__/x.tsx', 'types/x.d.ts', '.claude/hooks/x.mjs',
    'package.json', 'docs/x.md']) {
    assert.equal(isDesignUiPath(p, rule), false, p);
  }
  assert.equal(isDesignUiPath('app/page.tsx', null), false);
});

test('the three forms of the value', () => {
  assert.deepEqual(parseDesignValue('HM12, HM24'), { ok: true, cards: ['HM12', 'HM24'], isNew: false, none: false, newText: '' });
  assert.deepEqual(parseDesignValue('HM17b,FO2').cards, ['HM17b', 'FO2']);
  assert.deepEqual(parseDesignValue('HM12, neu – Leiste mit Tabs, Filter und Suche'),
    { ok: true, cards: ['HM12'], isNew: true, none: false, newText: 'Leiste mit Tabs, Filter und Suche' });
  assert.equal(parseDesignValue('neu - Kalenderleiste').newText, 'Kalenderleiste');
  assert.equal(parseDesignValue('Neu: Kalenderleiste').isNew, true);
  assert.equal(parseDesignValue('keine UI-Änderung').none, true);
  assert.equal(parseDesignValue('Keine UI-Änderung.').none, true);
  for (const bad of ['', 'neu', 'neu –', 'HM12 HM24', 'neue Leiste', 'HM12,', 'Kalender', 'hm12x9']) {
    assert.equal(parseDesignValue(bad).ok, false, bad);
  }
});

test('Design is a head line, written last and only once', () => {
  const h = parseHeadBlock('Braucht: pr-regeln#3\nDesign: HM12\n\nText');
  assert.deepEqual(h.design, ['HM12']);
  assert.equal(h.end, 2);
  assert.equal(buildBody({ text: 'Text', needs: ['x#1'], design: 'HM12, HM24' }), 'Braucht: x#1\nDesign: HM12, HM24\n\nText\n');
  assert.equal(buildBody({ text: 'Design: HM1\n\nText', design: 'HM12' }), 'Design: HM12\n\nText\n');
  assert.equal(buildBody({ text: 'Design: HM1\n\nText' }), 'Design: HM1\n\nText\n');
});

test('"- Design: ..." lower down is ordinary text, no K1', () => {
  const r = checkPr({ ...hub, repo: 'fusion-api-v3', body: `${GOOD_BODY}\n- Design: wie bisher` }, NOW);
  assert.deepEqual(r.errors, []);
  assert.equal(r.design, undefined);
});

test('D1: a new UI PR without the line is red, with the fix', () => {
  const r = checkPr(hub, NOW);
  assert.deepEqual(codes(r.errors), ['D1']);
  assert.match(r.errors[0].message, /calendar-bar\.tsx/);
  assert.match(r.errors[0].fix, /hub-design-lesen/);
  assert.match(r.errors[0].fix, /--design/);
  assert.match(r.errors[0].fix, /keine UI-Änderung/);
  assert.deepEqual(r.design.uiFiles, ['components/modules/calendar/calendar-bar.tsx']);
  assert.equal(r.design.enforced, true);
});

test('no UI files, no line needed; unknown files, D1 not checked', () => {
  assert.deepEqual(checkPr({ ...hub, files: [{ path: 'lib/calendar/range.ts' }] }, NOW).errors, []);
  const { files, ...noFiles } = hub;
  const r = checkPr(noFiles, NOW);
  assert.deepEqual(r.errors, []);
  assert.equal(r.design.uiFiles, null);
});

test('cards make the PR green', () => {
  const r = checkPr(withDesign('HM12, HM24'), NOW);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.design.cards, ['HM12', 'HM24']);
});

test('D2: wrong form, twice, or lower down', () => {
  assert.deepEqual(codes(checkPr(withDesign('HM12 HM24'), NOW).errors), ['D2']);
  assert.deepEqual(codes(checkPr({ ...hub, body: `Design: HM12\nDesign: HM24\n\n${GOOD_BODY}` }, NOW).errors), ['D2']);
  const below = checkPr({ ...hub, body: `${GOOD_BODY}\nDesign: HM12` }, NOW);
  assert.deepEqual(codes(below.errors).sort(), ['D1', 'D2']);
  assert.match(below.errors.find((f) => f.code === 'D2').message, /nicht oben/);
  assert.deepEqual(checkPr({ ...hub, body: `Design: HM12\n\n${GOOD_BODY}\n\`\`\`\nDesign: x\n\`\`\`` }, NOW).errors, []);
});

test('D2 in a repo without the rule too, D1 never', () => {
  const other = { ...hub, repo: 'fusion-api-v3' };
  assert.deepEqual(codes(checkPr({ ...other, body: `Design: hübsch\n\n${GOOD_BODY}` }, NOW).errors), ['D2']);
  assert.deepEqual(checkPr(other, NOW).errors, []);
  assert.deepEqual(checkPr({ ...other, body: `Design: HM12\n\n${GOOD_BODY}` }, NOW).errors, []);
});

test('D5: "keine UI-Änderung" with UI files is a hint for the reviewer', () => {
  const r = checkPr(withDesign('keine UI-Änderung'), NOW);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(codes(r.warnings), ['D5']);
  assert.deepEqual(checkPr(withDesign('keine UI-Änderung', { files: [{ path: '.claude/hooks/x.mjs' }] }), NOW).warnings, []);
});

test('D3: a new pattern stays red until the yes label', () => {
  const r = checkPr(withDesign('HM12, neu – Kalenderleiste'), NOW);
  assert.deepEqual(codes(r.errors), ['D3']);
  assert.match(r.errors[0].fix, /redesign-entwurf/);
  assert.match(r.errors[0].fix, /design-ja/);
  assert.equal(r.design.isNew, true);
  const missing = checkPr(withDesign('neu – Kalenderleiste', { labels: [DESIGN_LABEL_MISSING] }), NOW);
  assert.deepEqual(codes(missing.errors), ['D3']);
});

test('D4: the yes counts only with its note and without UI changes since', () => {
  const yes = (designApproval) => checkPr(withDesign('neu – Kalenderleiste', { labels: [DESIGN_LABEL_OK], designApproval }), NOW);
  assert.deepEqual(yes({ cockpit: 'E2170', sha: 'abc1234', changedUi: [] }).errors, []);
  assert.deepEqual(codes(yes(null).errors), ['D4']);
  assert.match(yes(null).errors[0].message, /Vermerk/);
  const changed = yes({ cockpit: 'E2170', sha: 'abc1234def', changedUi: ['components/x.tsx'] });
  assert.deepEqual(codes(changed.errors), ['D4']);
  assert.match(changed.errors[0].message, /Cockpit E2170, Head abc1234\).*components\/x\.tsx.*gilt nicht mehr/);
  assert.deepEqual(codes(yes({ cockpit: 'E2170', sha: 'abc1234', changedUi: null }).errors), ['D4']);
  // Not read (hook, create): no D4.
  assert.deepEqual(yes(undefined).errors, []);
});

test('the note is what the check reads', () => {
  const sha = '3d782a1670aa3d782a1670aa3d782a1670aa3d78';
  const m = DESIGN_APPROVAL.exec(`${designApprovalNote('E2170', sha)}\n\nGilt für …`);
  assert.deepEqual([m[1], m[2]], ['E2170', sha]);
  assert.equal(DESIGN_APPROVAL.exec('🎨 Marcs Design-Ja für Head abc1234'), null);
});

test('release, promotion, revert and bots are exempt', () => {
  for (const head of ['release/2026.11.4', 'beta', 'revert/kalender', 'revert-12-feat/x']) {
    const r = checkPr({ ...hub, head, base: 'main' }, NOW);
    assert.deepEqual(codes(r.errors).filter((c) => c.startsWith('D')), [], head);
    assert.ok(r.design.exempt, head);
  }
  assert.equal(checkPr({ ...hub, author: { login: 'dependabot[bot]' } }, NOW).skipped, 'bot');
});

test('cutoffs: before T1 only hints, from T2 old PRs too', () => {
  assert.deepEqual(DESIGN_CUTOFFS, { T1: '2026-11-25T23:00:00Z', T2: '2026-12-02T23:00:00Z' });
  const old = { ...hub, createdAt: '2026-11-25T22:59:59Z' };
  const before = checkPr(old, NOW);
  assert.deepEqual(before.errors, []);
  assert.deepEqual(codes(before.warnings), ['D1']);
  assert.equal(before.design.enforced, false);
  assert.deepEqual(codes(checkPr(old, { now: '2026-12-02T23:00:00Z' }).errors), ['D1']);
  assert.equal(designEnforced('2026-11-25T23:00:00Z', '2026-11-25T23:00:00Z'), true);
  assert.equal(designEnforced(null, '2026-11-26T00:00:00Z'), false);
  assert.equal(designEnforced('2026-11-27T00:00:00Z', null, { T1: null, T2: null }), false);
  assert.deepEqual(codes(checkPr(hub, { ...NOW, designCutoffs: { T1: null, T2: null } }).warnings), ['D1']);
});
