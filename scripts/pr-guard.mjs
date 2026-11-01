// PreToolUse hook. Prints a hint before T1 and a deny from T1 on; prints nothing when a call passes or anything fails.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, hookMessage } from '../lib/guard.mjs';

const MAX_BODY_BYTES = 1_000_000;

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const remoteBranches = new Map();
const ctx = {
  now: new Date().toISOString(),
  remoteHasBranch(dir, branch) {
    if (!remoteBranches.has(dir)) remoteBranches.set(dir, new Set((git(dir, ['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes']) ?? '').split('\n')));
    return remoteBranches.get(dir).has(branch);
  },
  currentBranch: (dir) => git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']) || null,
  readFile(path) {
    try {
      return statSync(path).size > MAX_BODY_BYTES ? null : readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
};

function countHits(result) {
  const dir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'hits.json');
    let hits = { total: 0, denied: 0, byCode: {} };
    try {
      hits = { ...hits, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      // first hit
    }
    hits.total += 1;
    if (result.deny) hits.denied += 1;
    for (const f of result.findings) hits.byCode[f.code] = (hits.byCode[f.code] ?? 0) + 1;
    hits.last = ctx.now;
    writeFileSync(file, JSON.stringify(hits, null, 2));
  } catch {
    // counting must never break the hook
  }
}

function main(raw) {
  const input = JSON.parse(raw);
  if (!input?.tool_name) return;
  const result = evaluate(input.tool_name, input.tool_input ?? {}, { ...ctx, cwd: input.cwd ?? process.cwd() });
  if (!result.findings.length) return;
  countHits(result);
  const message = hookMessage(result);
  const hookSpecificOutput = result.deny
    ? { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: message }
    : { hookEventName: 'PreToolUse', additionalContext: message };
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try {
    main(raw);
  } catch {
    // a broken guard lets the call through
  }
});
