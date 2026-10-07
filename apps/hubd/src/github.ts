import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { GithubStatus, PrChecks, PrState, PullRequest, Task } from '@aynshq/shared';
import { git } from './git.ts';

const exec = promisify(execFile);
const GH = process.env.AYNSHQ_GH_BIN ?? 'gh';

/** Runs gh with an optional stdin payload; rejects with gh's own error text. */
function gh(cwd: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(GH, args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(`Could not run gh: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `gh exited with code ${code}`))));
    child.stdin.end(stdin ?? '');
  });
}

let statusCache: { at: number; value: GithubStatus } | undefined;

export async function githubStatus(): Promise<GithubStatus> {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  let value: GithubStatus;
  try {
    await exec(GH, ['--version']);
    try {
      const { stdout } = await exec(GH, ['api', 'user', '--jq', '.login'], { timeout: 10_000 });
      value = { installed: true, authenticated: true, user: stdout.trim() || null };
    } catch {
      value = { installed: true, authenticated: false, user: null };
    }
  } catch {
    value = { installed: false, authenticated: false, user: null };
  }
  statusCache = { at: Date.now(), value };
  return value;
}

export async function remoteUrl(repoPath: string): Promise<string | null> {
  try {
    return await git(repoPath, ['remote', 'get-url', 'origin']);
  } catch {
    return null;
  }
}

export async function pushBranch(cwd: string, branch: string) {
  await git(cwd, ['push', '--set-upstream', 'origin', `${branch}:${branch}`]);
}

const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex' } as const;

export function defaultPrBody(task: Task, stat: string): string {
  const quoted = task.prompt
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return [
    task.summary?.trim() || '_No summary from the agent._',
    '',
    '<details><summary>Prompt</summary>',
    '',
    quoted,
    '',
    '</details>',
    '',
    stat ? `\`\`\`\n${stat}\n\`\`\`` : '',
    '',
    `---\nOpened from aynshq · ${AGENT_NAMES[task.agent]}${task.model ? ` (${task.model})` : ''} · task \`${task.id}\``,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
}

export async function createPr(
  cwd: string,
  opts: { base: string; head: string; title: string; body: string; draft: boolean },
): Promise<PullRequest> {
  const args = ['pr', 'create', '--base', opts.base, '--head', opts.head, '--title', opts.title, '--body-file', '-'];
  if (opts.draft) args.push('--draft');
  const out = await gh(cwd, args, opts.body);
  const url = out.split('\n').reverse().find((l) => /^https?:\/\//.test(l.trim()))?.trim();
  if (!url) throw new Error(`gh did not return a PR URL: ${out}`);
  return prStatus(cwd, url);
}

interface CheckNode {
  status?: string;
  conclusion?: string;
  state?: string;
}

function summarizeChecks(rollup: CheckNode[] | null | undefined): PrChecks {
  if (!rollup?.length) return 'none';
  let pending = false;
  for (const c of rollup) {
    // CheckRun has status/conclusion; legacy StatusContext has state.
    const result = (c.conclusion || c.state || '').toUpperCase();
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(result)) return 'failing';
    if ((c.status && c.status.toUpperCase() !== 'COMPLETED') || result === 'PENDING' || result === 'EXPECTED') pending = true;
  }
  return pending ? 'pending' : 'passing';
}

export async function prStatus(cwd: string, ref: string): Promise<PullRequest> {
  const json = await gh(cwd, ['pr', 'view', ref, '--json', 'number,url,state,isDraft,reviewDecision,statusCheckRollup']);
  const d = JSON.parse(json) as {
    number: number;
    url: string;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    isDraft: boolean;
    reviewDecision: string | null;
    statusCheckRollup: CheckNode[] | null;
  };
  const state: PrState = d.state === 'MERGED' ? 'merged' : d.state === 'CLOSED' ? 'closed' : d.isDraft ? 'draft' : 'open';
  return {
    url: d.url,
    number: d.number,
    state,
    checks: summarizeChecks(d.statusCheckRollup),
    review: d.reviewDecision || null,
    updatedAt: new Date().toISOString(),
  };
}

/** Finds a PR that already exists for the branch, e.g. one opened by the agent itself. */
export async function findPrForBranch(cwd: string, branch: string): Promise<PullRequest | null> {
  try {
    return await prStatus(cwd, branch);
  } catch {
    return null;
  }
}
