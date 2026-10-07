# Security policy

## Reporting a vulnerability

Please don't report security issues in public GitHub issues, discussions or pull requests.

Report them privately through GitHub instead: go to the repository's **Security** tab and choose **Report a vulnerability**, or open https://github.com/aynsdev/axis/security/advisories/new.

Include:

- A description of the issue
- Steps to reproduce
- The impact: what an attacker could do
- The affected version or commit

You'll get an acknowledgement within a few days. Please give the fix time to ship before disclosing anything publicly.

## Supported versions

Axis has no releases yet; fixes land on `main`. Run the latest `main`.

## Scope

Axis is a local-first developer tool. It starts coding agents that can read and change your repositories, run shell commands, and use your Claude, Codex, Git and GitHub CLI credentials. Its security model assumes it runs on a trusted machine with the default `127.0.0.1` binding.

In scope:

- Another website, or another process without your credentials, getting the hub to start agents, read data or change settings (for example by getting around the `Host`/`Origin` checks or the `x-axis` header).
- Axis leaking credentials, prompts or repository contents somewhere you didn't ask it to send them.
- Path or command injection through repository paths, branch names, task fields or PR fields.

Out of scope:

- Anything that requires exposing Axis beyond localhost (a LAN, tunnel, reverse proxy or shared server). That setup isn't supported.
- What an agent does when you run it in **Full access** mode. That mode intentionally turns off the agent's own permission checks.
