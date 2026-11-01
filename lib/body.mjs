// Writes the head block in front of a PR text. Lines already in the text are kept: dropping a stop by accident is
// the dangerous direction.
import { HEAD_KEYS, parseHeadBlock } from './pr-rules.mjs';

const line = (key, value) => (value ? `${key}: ${value}` : `${key}:`);

export function buildBody({ text = '', needs = [], stops = [], pairedWith = [], after = [], removeStops = [] }) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const head = parseHeadBlock(lines.join('\n'));
  const rest = head.entries.length ? [...lines.slice(0, head.entries[0].line), ...lines.slice(head.end)] : lines;

  const given = {
    'Paired-with': pairedWith.map((p) => `${p.repo} ${p.url}`),
    Braucht: needs,
    'Merge-Stopp': stops,
    'Nach dem Merge': after,
  };
  const block = [];
  for (const key of HEAD_KEYS) {
    for (const value of [...head.entries.filter((e) => e.key === key).map((e) => e.value), ...given[key].map((v) => String(v).trim())]) {
      const l = line(key, value);
      if (key === 'Merge-Stopp' && removeStops.includes(value)) continue;
      if (!block.includes(l)) block.push(l);
    }
  }

  const restText = rest.join('\n').replace(/^\s*\n/, '').trimEnd();
  return block.length ? `${block.join('\n')}\n\n${restText}\n` : `${restText}\n`;
}
