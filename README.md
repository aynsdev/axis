# aynshq

Local agents hub for Claude Code and Codex. Queue tasks against your repos, watch agents work live, review their diffs, and track token usage and spend.

## Run

```sh
pnpm install
pnpm dev
```

- Dashboard: http://127.0.0.1:5317
- Hub API: http://127.0.0.1:4317 (localhost only)

You need `claude` and/or `codex` on your `PATH`, already logged in.

## How it works

1. Register a repository on **Repositories**.
2. Create a task: pick a repo, an agent, and write a prompt.
3. The hub creates a git worktree on a new `hub/<task-id>` branch and runs the agent there:
   - Claude: `claude -p --output-format stream-json`
   - Codex: `codex exec --json`
4. Agent output streams to the dashboard over WebSocket.
5. When the run finishes, any uncommitted changes are committed, so the branch is ready for a PR.

### Pull requests

On a finished task with commits, **Open PR** lets you review the title, description and draft flag. It then pushes `hub/<task-id>` to `origin` and runs `gh pr create` against the task's base branch. If you tick **Open a draft PR when it succeeds** when creating a task, the hub does this automatically.

- If you leave the description empty, the hub uses the agent's final message, the prompt and the diff stat.
- If a PR already exists for the branch, for example one the agent opened itself, the hub links it instead of opening a new one.
- Open PRs are refreshed every 2 minutes: state (open, draft, merged, closed), CI checks and review decision.
- Requires `gh auth login` and an `origin` remote. Every step is logged in the task's activity.

### Notifications, priorities and templates

- **Notifications:** sent for a task succeeding or failing, an automatic draft PR, a PR being merged or closed, PR checks failing, and a Codex plan window reaching 90%.
  - They appear as toasts in the dashboard and as macOS notifications. With `terminal-notifier` installed, clicking a macOS notification opens the task or PR; without it, `osascript` is used.
  - Toggle each event on the **Settings** page, which also has a **Send test** button.
- **Priority:** high, normal or low. When every slot is busy, higher priority tasks start first. A queued task's priority can be changed from its page.
- **Templates:** on **New task**, fill in the form and choose **Save as template**, then pick it from **Start from template** next time. Templates are managed on **Settings**.
- **Agents running at once** is set on **Settings**, and changes take effect immediately. The `AYNSHQ_MAX_CONCURRENCY` env var is only the initial default.

### Usage and sessions

Every minute the hub reads new lines from your local transcripts. This covers sessions you start in a terminal, not just hub tasks:

- `~/.claude/projects/**/*.jsonl` (Claude Code, including subagents)
- `~/.codex/sessions/**/*.jsonl` and `~/.codex/archived_sessions/*.jsonl` (Codex)

It only reads bytes added since the last pass. The first import of about 2 GB takes a few seconds; later passes take milliseconds.

- **Tokens** counts input, cache writes and output. Cache reads are listed separately.
- **API-equivalent cost** prices Claude usage at Anthropic list prices (`apps/hubd/src/importer/pricing.ts`). On a subscription, this is not what you're billed. Codex usage isn't priced.
- **Codex plan limits** shows the 5-hour and weekly windows from your most recent Codex turn.
- Already-imported usage is kept when Claude Code later deletes old transcripts.

```
apps/hubd        Hono server · task queue · runners · SQLite (~/.aynshq/hub.db)
apps/web         React + Vite dashboard · TanStack Router/Query · Tailwind
packages/shared  Types shared by both
```

## Configuration

| Env var | Default | |
|---|---|---|
| `AYNSHQ_HOME` | `~/.aynshq` | Database and worktrees |
| `AYNSHQ_PORT` | `4317` | Hub port; the web dev proxy follows it |
| `AYNSHQ_MAX_CONCURRENCY` | `3` | Initial agents running at once (then set in Settings) |
| `AYNSHQ_CLAUDE_BIN` / `AYNSHQ_CODEX_BIN` | `claude` / `codex` | CLI paths |
| `AYNSHQ_IMPORT` | `1` | Set to `0` to disable transcript import |
| `AYNSHQ_GH_BIN` | `gh` | GitHub CLI path |
| `AYNSHQ_WEB_URL` | `http://127.0.0.1:5317` | Where notification clicks open |
| `CLAUDE_CONFIG_DIR` / `CODEX_HOME` | `~/.claude` / `~/.codex` | Where transcripts are read from |

## Permissions

| Level | Claude | Codex |
|---|---|---|
| Edit files | `--permission-mode acceptEdits` | `-s workspace-write` |
| Full access | `--permission-mode bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` |

The hub binds to 127.0.0.1. It rejects foreign `Host`/`Origin` headers and requires an `x-aynshq: 1` header on writes, so other websites can't start agents.

## Roadmap

- [x] Phase 1: tasks, live logs, diffs, usage
- [x] Phase 2: import local sessions, usage by model and project, Codex plan limits
- [ ] Chat webhooks (Slack / Discord / Telegram) → tasks, status replies in the thread
- [x] Phase 3: open PRs from tasks (manual or automatic draft), live PR status
- [x] Phase 4: notifications (desktop + in-app), task priorities, templates, settings page
