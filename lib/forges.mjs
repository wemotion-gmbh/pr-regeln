// Network access to GitHub (through gh) and Bitbucket (REST). The only module here that talks to a forge.
// Credentials are read from the environment and never printed.
import { spawn } from 'node:child_process';
import { splitUnifiedDiff } from './pr-rules.mjs';

const GITHUB_PR = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const BITBUCKET_PR = /^https:\/\/bitbucket\.org\/([\w.-]+)\/([\w.-]+)\/pull-requests\/(\d+)(?:[/?#].*)?$/;
const BITBUCKET_API = 'https://api.bitbucket.org/2.0/repositories';

export function parsePrUrl(url) {
  const s = String(url ?? '').trim();
  for (const [forge, re] of [['github', GITHUB_PR], ['bitbucket', BITBUCKET_PR]]) {
    const m = s.match(re);
    if (m) return { forge, owner: m[1], repo: m[2], number: Number(m[3]) };
  }
  return null;
}

export function parseRemote(url) {
  const m = /(github\.com|bitbucket\.org)[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return m ? { forge: m[1] === 'github.com' ? 'github' : 'bitbucket', owner: m[2], repo: m[3] } : null;
}

export function exec(cmd, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args[0]}: ${err.trim() || `exit ${code}`}`))));
    child.stdin.end(input);
  });
}

async function fetchGithub({ owner, repo, number }) {
  const base = `repos/${owner}/${repo}/pulls/${number}`;
  const p = JSON.parse(await exec('gh', ['api', base]));
  const lines = await exec('gh', ['api', '--paginate', `${base}/files?per_page=100`, '--jq', '.[] | {path: .filename, patch: (.patch // null)}']);
  return {
    forge: 'github', owner, repo, number, url: p.html_url,
    head: p.head.ref, base: p.base.ref, headSha: p.head.sha,
    title: p.title, body: p.body ?? '', draft: Boolean(p.draft),
    labels: (p.labels ?? []).map((l) => l.name),
    author: p.user ? { login: p.user.login, type: p.user.type } : null,
    createdAt: p.created_at,
    files: lines.split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}

async function readWindowsUserEnv(name) {
  try {
    const out = await exec('reg', ['query', 'HKCU\\Environment', '/v', name]);
    return out.match(new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)$`, 'm'))?.[1].trim() || null;
  } catch {
    return null;
  }
}

export async function bitbucketAuth() {
  const env = async (name) => process.env[name] || (process.platform === 'win32' ? await readWindowsUserEnv(name) : null);
  const user = await env('BITBUCKET_USER');
  const token = await env('BITBUCKET_API_TOKEN');
  if (!user || !token) throw new Error('Bitbucket-Zugang fehlt: BITBUCKET_USER und BITBUCKET_API_TOKEN setzen.');
  return `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
}

async function bitbucketGet(url, auth, as) {
  // fetch keeps the Authorization header on same-origin redirects, which /diff uses.
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`Bitbucket antwortet ${res.status} auf ${new URL(url).pathname}`);
  return as === 'text' ? res.text() : res.json();
}

export function bitbucketPrUrl(owner, repo, number) {
  return `${BITBUCKET_API}/${owner}/${repo}/pullrequests${number ? `/${number}` : ''}`;
}

export async function bitbucketSend(method, url, auth, payload) {
  const res = await fetch(url, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Bitbucket antwortet ${res.status}: ${data?.error?.message ?? new URL(url).pathname}`);
  return data;
}

export async function bitbucketPr(owner, repo, number, auth) {
  return bitbucketGet(bitbucketPrUrl(owner, repo, number), auth, 'json');
}

async function fetchBitbucket({ owner, repo, number }) {
  const auth = await bitbucketAuth();
  const base = bitbucketPrUrl(owner, repo, number);
  const p = await bitbucketGet(base, auth, 'json');
  const diff = await bitbucketGet(`${base}/diff`, auth, 'text');
  return {
    forge: 'bitbucket', owner, repo, number, url: p.links?.html?.href ?? null,
    head: p.source?.branch?.name ?? '', base: p.destination?.branch?.name ?? '', headSha: p.source?.commit?.hash ?? null,
    title: p.title ?? '', body: p.description ?? p.summary?.raw ?? '', draft: Boolean(p.draft),
    labels: [],
    author: p.author ? { login: p.author.nickname ?? p.author.display_name ?? '', type: p.author.type === 'app_user' ? 'Bot' : 'User' } : null,
    createdAt: p.created_on,
    files: splitUnifiedDiff(diff),
  };
}

export function fetchPr(ref) {
  return ref.forge === 'github' ? fetchGithub(ref) : fetchBitbucket(ref);
}

export async function addGithubLabel({ owner, repo, number }, name) {
  await exec('gh', ['api', '-X', 'POST', `repos/${owner}/${repo}/issues/${number}/labels`, '--input', '-'], JSON.stringify({ labels: [name] }));
}

export async function removeGithubLabel({ owner, repo, number }, name) {
  await exec('gh', ['api', '-X', 'DELETE', `repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`]);
}
