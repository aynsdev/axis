# Axis

Local agents hub for Claude Code and Codex. Queue tasks against your repos, watch agents work live, review their diffs, and track token usage and spend.

## Getting started

### Prerequisites

| Tool | Version | Why |
|---|---|---|
| [Node.js](https://nodejs.org) | 22 or newer | Runs the hub and the dashboard |
| [pnpm](https://pnpm.io) | 10 (`corepack enable` sets it up) | Workspace package manager |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and/or [Codex](https://github.com/openai/codex) | latest | The agents. Each must be on your `PATH` and logged in (run `claude` or `codex` once). |
| [GitHub CLI](https://cli.github.com) | optional | Needed only for opening PRs (`gh auth login`) |
| [terminal-notifier](https://github.com/julienXX/terminal-notifier) | optional, macOS | Makes notifications clickable (`brew install terminal-notifier`) |

### Install

```sh
git clone git@github.com:aynsdev/axis.git
cd axis
pnpm install
```

`pnpm install` compiles `better-sqlite3`. If that fails, install the Xcode command line tools (`xcode-select --install`) on macOS, or `build-essential` and `python3` on Linux, then run it again.

### Run

```sh
pnpm dev
```

This starts both apps, with logs labeled `hubd` and `web`:

- **Dashboard:** http://127.0.0.1:5317. Open this one.
- **Hub API:** http://127.0.0.1:4317. It listens on localhost only, and the dashboard proxies `/api` and `/ws` to it.

Both reload when you edit their code. Stop them with `Ctrl+C`.

On first start the hub creates `~/.axis` (database and worktrees) and begins importing your Claude Code and Codex transcripts, so **Usage**, **Sessions** and **Workspace** fill in within a minute. If you used Axis under its old name, it keeps using `~/.aynshq` until `~/.axis` exists, so nothing is lost.

To run on other ports:

```sh
AXIS_PORT=4400 pnpm dev   # the dashboard proxy follows AXIS_PORT
```

### First steps

1. Open **Repositories** and add the absolute path of a git repo.
2. Choose **New task**: pick the repo, Claude or Codex, a permission level, and write a prompt.
3. Watch it on the task page, or zoom out to **Workspace** to see every session and sub agent at their desks.
4. When it finishes, review the diff and choose **Open PR**.

### Troubleshooting

- **A page or `/api/...` returns 404, or the dashboard looks out of date.** An older hub is probably still holding the port. Run `lsof -nP -iTCP:4317 -iTCP:5317 -sTCP:LISTEN`, stop those processes, and run `pnpm dev` again.
- **`EADDRINUSE`.** Same cause: something else is on 4317 or 5317. Stop it, or pick another port with `AXIS_PORT`.
- **"hubd offline" in the sidebar.** The hub crashed or isn't running. Check the `hubd` lines in the `pnpm dev` output.
- **Claude plan limits say to sign in.** Run `claude` once so its login is fresh. The hub reads it but never refreshes it.
- **Tasks fail at once.** Check that `claude --version` or `codex --version` works in the same shell, or point `AXIS_CLAUDE_BIN` / `AXIS_CODEX_BIN` at the binary.

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Hub and dashboard with live reload |
| `pnpm typecheck` | Type-checks every package |
| `pnpm build` | Production build of the dashboard (`apps/web/dist`) |
| `pnpm --filter @axis/hubd start` | Hub only, without file watching |

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

- **Notifications:** sent for a task succeeding or failing, an automatic draft PR, a PR being merged or closed, PR checks failing, and a Claude or Codex plan window reaching 90%.
  - They appear as toasts in the dashboard and as macOS notifications. With `terminal-notifier` installed, clicking a macOS notification opens the task or PR; without it, `osascript` is used.
  - Toggle each event on the **Settings** page, which also has a **Send test** button.
- **Priority:** high, normal or low. When every slot is busy, higher priority tasks start first. A queued task's priority can be changed from its page.
- **Templates:** on **New task**, fill in the form and choose **Save as template**, then pick it from **Start from template** next time. Templates are managed on **Settings**.
- **Agents running at once** is set on **Settings**, and changes take effect immediately. The `AXIS_MAX_CONCURRENCY` env var is only the initial default.

### Usage and sessions

Every minute the hub reads new lines from your local transcripts. This covers sessions you start in a terminal, not just hub tasks:

- `~/.claude/projects/**/*.jsonl` (Claude Code, including subagents)
- `~/.codex/sessions/**/*.jsonl` and `~/.codex/archived_sessions/*.jsonl` (Codex)

It only reads bytes added since the last pass. The first import of about 2 GB takes a few seconds; later passes take milliseconds.

- **Tokens** counts input, cache writes and output. Cache reads are listed separately.
- **API-equivalent cost** prices Claude usage at Anthropic list prices (`apps/hubd/src/importer/pricing.ts`). On a subscription, this is not what you're billed. Codex usage isn't priced.
- **Claude plan limits** shows your 5-hour session and weekly usage, checked every 5 minutes. The hub reads Claude Code's login (macOS keychain, else `~/.claude/.credentials.json`) and asks Anthropic's usage endpoint, the same one `/usage` uses. It never refreshes the token, so if the login has expired, run `claude` once.
- **Codex plan limits** shows the 5-hour and weekly windows from your most recent Codex turn.
- Already-imported usage is kept when Claude Code later deletes old transcripts.

### Workspace

**Workspace** is a 3D voxel office where you can watch your agents work, live.

- **Your team:** every agent in `~/.claude/agents` (plus a repo's `.claude/agents`) gets an office with a name plate. A description that starts with a name, like `Zuck. React specialist…`, gives that agent its persona. When a session spawns it, the agent sits up, its monitors scroll, and its plate shows what it's doing (`Editing server.ts`). Parallel runs show as `×2`.
- **Hot desks** seat built-in sub agents such as Explore and Plan.
- **Command desks** around the hologram seat up to four Claude Code and Codex sessions active in the last 30 minutes.
- Click a desk or a roster entry to see its runs, which session started them, and recent tool calls. The office follows your light or dark theme.

The hub tails transcripts every 2 seconds while a dashboard is open, so updates are near real time.

## Project layout

```
apps/hubd        Hono server · task queue · runners · SQLite (~/.axis/hub.db)
apps/web         React + Vite dashboard · TanStack Router/Query · Tailwind
packages/shared  Types shared by both
```

## Configuration

| Env var | Default | |
|---|---|---|
| `AXIS_HOME` | `~/.axis` | Database and worktrees |
| `AXIS_PORT` | `4317` | Hub port; the web dev proxy follows it |
| `AXIS_MAX_CONCURRENCY` | `3` | Initial agents running at once (then set in Settings) |
| `AXIS_CLAUDE_BIN` / `AXIS_CODEX_BIN` | `claude` / `codex` | CLI paths |
| `AXIS_IMPORT` | `1` | Set to `0` to disable transcript import |
| `AXIS_CLAUDE_LIMITS` | `1` | Set to `0` to stop checking Claude plan limits |
| `AXIS_GH_BIN` | `gh` | GitHub CLI path |
| `AXIS_WEB_URL` | `http://127.0.0.1:5317` | Where notification clicks open |
| `CLAUDE_CONFIG_DIR` / `CODEX_HOME` | `~/.claude` / `~/.codex` | Where transcripts are read from |

## Permissions

| Level | Claude | Codex |
|---|---|---|
| Edit files | `--permission-mode acceptEdits` | `-s workspace-write` |
| Full access | `--permission-mode bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` |

The hub binds to 127.0.0.1. It rejects foreign `Host`/`Origin` headers and requires an `x-axis: 1` header on writes, so other websites can't start agents.

## Roadmap

- [x] Phase 1: tasks, live logs, diffs, usage
- [x] Phase 2: import local sessions, usage by model and project, Codex plan limits
- [ ] Chat webhooks (Slack / Discord / Telegram) → tasks, status replies in the thread
- [x] Phase 3: open PRs from tasks (manual or automatic draft), live PR status
- [x] Phase 4: notifications (desktop + in-app), task priorities, templates, settings page
- [x] Phase 5: Workspace (live 3D office of sessions, team and sub agents), Claude plan limits
