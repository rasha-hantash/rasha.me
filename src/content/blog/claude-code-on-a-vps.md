---
title: "Running Claude Code on a Hetzner VPS"
pubDate: 2026-04-25
description: "How I run Claude Code on a Hetzner VPS over Tailscale: the components I use, the setup process, and an automated installer that compresses a 90-minute walkthrough into roughly ten."
tags: ["claude-code", "vps", "tailscale", "hetzner", "remote-development"]
draft: false
---

## Why I Built This

I wanted Claude Code to keep working after my laptop closed. A few specific situations led me here:

- I'm at a café with my laptop at home, and I want to continue iterating on something I started that morning.
- I'm running a long task — a refactor that touches a hundred files, an ingestion pipeline working through a corpus — and I'd rather it not be tied to whether my laptop is awake.
- I'm on my phone in a meeting and remember a small change I forgot to push. SSH in from Termius, fix it, push it.

A VPS handles all three. Among the cheap always-on options, Hetzner's smallest instance is the most reasonable I've found at **€4.49 per month**.

I had a constraint, though: the setup needed to be secure and low-maintenance. No public SSH on port 22 with fail2ban patched on top, no credentials sprayed across env files, no remembering which IP belongs to which machine. The result should feel about as secure as my laptop and similarly ergonomic.

## A Day-to-Day Session

I open a terminal on my laptop. From wherever I am — home, café, a friend's place:

```sh
ssh agent@claude-box.tail-scale-name.ts.net
tmux new -A -s work
claude
```

The first line connects to the Hetzner box over Tailscale (no public exposure, no IP to remember). The second attaches to a persistent tmux session, creating one if it doesn't exist. The third starts Claude Code. Same `gt`, same shell, same configuration I have on the laptop.

From my phone, the workflow is identical, just routed through Termius. A shell alias (`alias vps='ssh agent@claude-box.tail-scale-name.ts.net'`) shortens the connect step to a single character if you'd like.

## The Stack

Three components.

### Hetzner — Compute

A `cx23` instance: 2 vCPU, 4 GB RAM, 40 GB disk, ~€4.49 per month. The reason I chose Hetzner over DigitalOcean or AWS Lightsail is pricing — it's roughly half the cost of equivalent instances elsewhere, and it has been reliable for me.

4 GB is enough for Claude Code with a TypeScript LSP and a Next.js dev server, in my experience. For heavier workloads — local LLMs, large test suites — the `cx33` (8 GB, 4 vCPU) is a step up. Hetzner allows resizing without rebuilding, so starting small is reasonable.

### Tailscale — Network

Tailscale puts your laptop, VPS, and phone on a private network that only your devices can see. Each device gets a stable hostname like `claude-box.your-tailnet.ts.net` instead of an IP address that might change.

What this means in practice:

- The VPS isn't reachable from the public internet at all. Random bots scanning the internet for open SSH ports never see it. Only devices you've explicitly added to your Tailscale account can connect.
- You don't have to install any of the usual SSH-hardening tools (rate limiters, IP blockers, firewall rules per source IP). Tailscale itself is the gate.
- Adding a new device — a new laptop, a phone, a friend's machine you want to share access with — is one paste of a key in their Tailscale app.
- Free for personal use up to 100 devices.

### Auth — `claude` over SSH

Of the three components, authentication on a fresh Linux VPS was the part I expected to be hardest. Claude Code on macOS uses the system Keychain for OAuth credentials; Linux has no Keychain, and a fresh VPS has no browser to complete an OAuth flow. I was prepared to write a script that extracts the token from my Keychain and copies it across, or to fall back to an API key and lose the predictable subscription pricing.

It turns out Claude Code's first-run flow already handles this. On the VPS, run `claude` over SSH; it prints a login URL. Paste the URL into your laptop's browser, sign in, and Claude Code shows a code. Paste that code back into the SSH terminal. Credentials are saved to `~/.claude/.credentials.json` on the VPS, and subsequent invocations use them directly. No API key, no separate bill — just your existing Claude subscription.

(There's also `claude setup-token` for CI use, but that's a different flow: it prints a long-lived token without saving it, expecting you to set it as the `CLAUDE_CODE_OAUTH_TOKEN` env var in a secrets manager. For an interactive single-user VPS, plain `claude` is simpler.)

## Setup

I worked through the setup manually first to understand each step, then automated the parts that don't require judgment. The full manual version is roughly:

1. Create a Hetzner account, generate an API token (browser)
2. Create a Tailscale account, generate a reusable auth key (browser)
3. `hcloud server create` with your SSH key
4. SSH in as root via the public IP
5. Install Tailscale, join the tailnet, lock SSH to the `tailscale0` interface, disable root login, create a non-root user, install Claude Code and `gh`, and configure dotfiles
6. Generate an SSH keypair for the non-root user on the VPS, add its public key to your laptop's `~/.ssh/authorized_keys`, and enable macOS Remote Login (System Settings → General → Sharing) — required so the VPS can rsync your gitignored `.claude/` files back from the laptop
7. Run `claude` and complete OAuth via your laptop's browser, then `gh auth login` for repo cloning
8. Verify the laptop can reach the box via the Tailscale hostname *and* the VPS can reach the laptop the other way
9. Set up the phone (install Termius, add the host)

Each step is straightforward in isolation. They accumulate. End-to-end, my first run took about **90 minutes** of clock time, with significant context-switching between the Hetzner console, Tailscale admin panel, and terminal.

The second time I did it — helping a friend reproduce the same setup on a different VM — took nearly as long. At that point, automation made sense.

### The Installer

The automation lives in a small repo: <a href="https://github.com/rasha-hantash/claude-vps-setup" target="_blank">claude-vps-setup</a>. The flow:

```sh
# Both secrets need to be in your shell environment before running /setup.
# AskUserQuestion renders pasted text in plaintext in its option list,
# which would leak the token into terminal scrollback and the session
# transcript — so the wizard refuses to prompt for them.
export HCLOUD_TOKEN=<paste-from-console.hetzner.cloud>
export TS_AUTH_KEY=<paste-from-login.tailscale.com>

git clone https://github.com/rasha-hantash/claude-vps-setup
cd claude-vps-setup
claude
```

Inside Claude Code:

```
/setup
```

It asks one question at a time — VM type, region, name — pulling live availability from the Hetzner API so the type/region picker only shows valid combinations (Hetzner rolls out new types EU-first, so `cx23` is currently NBG-1 / HEL-1 only). Each answer informs the next step. When it finishes, you have a working VPS and a `.setup-state.json` recording what was provisioned.

The time it saves:

| Phase | Manual | `/setup` | Saved |
|---|---|---|---|
| Provision Hetzner VM (console clicks: image, region, key) | 8–12 min | ~90 sec | ~10 min |
| Bootstrap (user, SSH harden, UFW, Tailscale, Claude Code, gh) | 25–40 min | 3–5 min | ~30 min |
| Agent SSH key + laptop authorized_keys + Remote Login | 5–10 min | 0 (auto + one toggle) | ~7 min |
| Tmux + global `CLAUDE.md` + mobile ergonomics | 10–15 min | 0 (templated) | ~12 min |
| Optional: personal `~/.claude/` rsync (hooks, agents, skills) | 10–15 min | 0 (one prompt) | ~12 min |
| Optional: Paper Desktop bridge (autossh + persistent unit) | 30–60 min | 2 min | ~45 min |
| Optional: HTTPS dev preview (UFW, Caddy, DNS) | 15–20 min | 3–4 min | ~15 min |
| **First run total** | **~100 min – 3 hr** | **~10–15 min clock, ~3 min attention** | **~90–160 min** |

The first run isn't where automation pays off. The value comes on the second run — a new laptop, a second VPS, helping someone else reproduce the setup, returning to it six months from now. In those cases, the time drops from roughly 90 minutes to 10.

A few minutes are unavoidable: generating the Hetzner API token (browser), generating the Tailscale auth key (browser), installing Tailscale on the laptop (GUI). Plan on three to four minutes of human input even with the installer.

### What the Install Looks Like

A condensed transcript of what the installer asks and what it runs. The installer uses Claude Code's `AskUserQuestion` UI, which renders as a structured prompt rather than a terminal `read -p`.

```
You:    /setup

Claude: Checking prereqs...
        ✓ ssh-keygen, ~/.ssh/id_ed25519.pub
        ✓ hcloud, tailscale
        ✓ HCLOUD_TOKEN, TS_AUTH_KEY in env
        ✗ macOS Remote Login (sshd) is OFF

        Open System Settings → General → Sharing → Remote Login and
        toggle it ON, then reply "done". Required so the VPS can rsync
        your gitignored .claude/ files back from this laptop.

You:    done

Claude: VM type?
        ● cx23  — 2 vCPU / 4 GB — available in nbg1, hel1 — from €4.49/mo
        ○ cx33  — 4 vCPU / 8 GB — available in nbg1, hel1 — from €8.49/mo
        ○ cpx22 — 2 vCPU / 4 GB — available everywhere — from €4.85/mo
          (Hetzner ships new types EU-first; pick spec first so the
           region prompt only shows valid options.)

You:    cx23

Claude: Region?
        ● nbg1 — Nuremberg 🇩🇪
        ○ hel1 — Helsinki 🇫🇮

You:    nbg1

Claude: Name? [default: claude-box]

You:    (enter)

Claude: Two optional add-ons — pick yes if you'll want them later:
        Paper Desktop bridge?  [Y/n]
        HTTPS dev preview?     [y/N]

You:    Y / N

Claude: About to do this:
          VM:        claude-box (cx23, nbg1)
          Cost:      €4.49/mo, billed hourly starting now
          Hardening: disable root login, lock SSH to tailscale0
          Install:   Tailscale, Claude Code (native), gh, tmux, zsh, jq
        Continue?  [Y/n]

You:    Y

Claude: [1/8] Provisioning VM... ✓ 137.184.42.91 in 47s
        [2/8] Waiting for SSH... ✓ up after 28s
        [3/8] Copying bootstrap script... ✓
        [4/8] Running bootstrap (~3 min)...
              → Tailscale joined: claude-box.tail-abc123.ts.net
              → Generated agent SSH keypair
              → Installed: Claude Code (native), gh, zsh, tmux, jq
              → SSH hardened
        [5/8] Authorizing VPS pubkey on this laptop... ✓ (appended to ~/.ssh/authorized_keys)
        [6/8] Verifying Tailscale connectivity (laptop ↔ VPS, both directions)... ✓
        [7/8] Sync your personal ~/.claude/ config to the VPS? [Y/n]

You:    Y

Claude: ▸ rsync -av --info=progress2 ~/.claude/{CLAUDE.md,hooks,agents,skills,commands,settings.json}
        ✓ 142 files, 8.4 MB
        [8/8] Wrote .setup-state.json

        Your VPS:  claude-box.tail-abc123.ts.net (user: agent)
        SSH:       ssh agent@claude-box.tail-abc123.ts.net
        Phone:     Termius → host = claude-box.tail-abc123.ts.net

        Two manual one-time auth steps remain:
          ssh agent@claude-box.tail-abc123.ts.net -t claude          # Claude Code OAuth
          ssh agent@claude-box.tail-abc123.ts.net -t gh auth login   # GitHub auth

        Suggested next: /add-paper (Paper Desktop bridge — see Caveats)
                        /add-chrome (claude-in-chrome browser tools — see Caveats)
```

Two aspects of this flow are difficult to replicate with a plain bash script using `read -p`. The first is **adaptive defaults** — suggesting `ash` as the region from the user's timezone, for example. The second is **recovery messaging** — when step 4 fails with `Error: invalid auth key`, the installer can explain *"Tailscale rejected the auth key — usually means it's expired or single-use and already consumed. Regenerate at https://... and re-run with `/setup --resume`"* instead of surfacing a stack trace.

State is persisted to `./.setup-state.json` in the repo directory on the laptop (not on the VPS), so follow-up commands like `/add-paper` know which box to act on. If the VPS is destroyed and reprovisioned, the file is overwritten cleanly.

## Working With Repositories

Once the VPS is provisioned, day-to-day work involves cloning repos with `gh repo clone`. There's one detail to handle: Claude Code stores per-machine permission grants in each repo's `.claude/settings.local.json`, which is gitignored by convention. A fresh clone on the VPS won't have the trust grants you've already approved on your laptop, which means re-prompting for `Bash(pnpm install)`, `Bash(cargo build)`, and the other commands you've already vouched for.

The installer ships a small helper to close that gap. It's installed to `~/.local/bin` on the VPS during bootstrap:

- **`vps-clone <owner/repo>`** clones the repo on the VPS, then matches it to the same repo on your laptop by git remote URL and rsyncs the gitignored `.claude/` files over the Tailscale link. One step, no prompts.
- **`vps-sync-repo`** runs the same rsync after the fact — useful for repos cloned manually with `gh repo clone`, or when something on the laptop has changed and needs to be re-synced.

Both rely on the laptop being on Tailscale and reachable. If it isn't, the helpers print a clear error and exit; the repo still works, you just re-grant permissions interactively.

## Costs

The €4.49 monthly fee is the simple part. The more complete picture:

| Item | Cost |
|---|---|
| Hetzner cx23 VM | €4.49/mo |
| Hetzner snapshots (optional) | ~€0.50/mo |
| Tailscale | Free (personal tier covers everything) |
| **Claude API or Max subscription** | **$20–200/mo** |

The VPS itself is the smallest line item. Your Claude usage — Max subscription or API metering — is the dominant cost, and it doesn't change based on whether Claude runs on your laptop or the VPS.

## Caveats

A few constraints worth knowing.

**Paper Desktop requires the laptop to be on.** [Paper Desktop](https://paper.design) is a design tool that exposes its canvas to Claude Code via a local MCP server, so Claude can read and write designs directly. The server binds to `127.0.0.1` only and rejects requests with non-localhost `Host` headers (I verified this experimentally). The only way to reach it from the VPS is an SSH reverse tunnel back to the laptop. That works, but it requires the laptop to be awake, on Tailscale, and running Paper Desktop. Phone-only workflows can't use Paper. The installer offers an `/add-paper` command that sets up the tunnel via `autossh` for users who want it.

**Credentials live on a cloud machine.** Your auth token sits in `~/.claude/.credentials.json` on a rented box that you don't physically control. Tailscale-only access helps — nothing on the public internet can probe it — but it's still a remote machine. I'd avoid putting credentials on a VPS that I wouldn't put on any rented server.

**Transcripts aren't synced automatically.** Claude Code stores per-project session JSONLs in `~/.claude/projects/`. Sessions started on the laptop won't appear in `claude --resume` on the VPS. A one-shot `rsync -av ~/.claude/projects/ agent@claude-box:.claude/projects/` is enough if the history matters. I don't sync them — VPS sessions tend to start fresh, which fits how I use the box anyway.

**HTTPS dev previews need extra setup.** By default the VPS is locked to Tailscale — the public internet can't reach it. That's the right default for solo work, but some workflows need a public HTTPS URL: OAuth callbacks (most providers require HTTPS redirect URIs), webhooks from Stripe / GitHub / Slack, mobile testing on real devices for service workers and other HTTPS-only browser APIs, and sharing a preview link with someone not on your tailnet. The installer offers an `/add-https` command that layers in Caddy, opens UFW for ports 80/443, and reverse-proxies a domain you own to a dev server port — Caddy handles the Let's Encrypt cert automatically. The command is wired but untested end-to-end, so file an issue if it breaks on first run.

**macOS Remote Login is required for repo sync.** `vps-clone` and `vps-sync-repo` work by having the VPS SSH back into the laptop to rsync gitignored `.claude/` files. macOS ships with the SSH server (`sshd`) off by default — you have to flip it on at System Settings → General → Sharing → Remote Login. The wizard surfaces this as a prereq, but if you skip it, the helpers fail with "Connection closed by ... port 22" on first run. Re-enabling it and re-running fixes it; nothing on the VPS needs to change.

**First-run rsync of `.claude/worktrees/` can be heavy.** The sync helper transfers every gitignored file under `.claude/`, which on most active repos is dominated by per-worktree directories with their own `node_modules` and build artifacts. On one of my repos that came out to **7.5 GB**. At typical home upload bandwidth (5 MB/s), that's 25 minutes for the first sync. Subsequent runs are incremental and fast. `du -sh .claude/` on the laptop tells you the payload before you commit. A future improvement will prune merged + clean worktrees before sync — for now, plan accordingly or `rm -rf .claude/worktrees/<old-branch>` ahead of time on repos where you don't need them.

**Browser MCP tools (`claude-in-chrome`) need a separate bridge.** The VPS is headless Linux — no Chrome, no GUI. So the chrome MCP that drives a real browser doesn't run there natively. The installer ships a sketched `/add-chrome` command that mirrors `/add-paper`'s pattern: `autossh` reverse tunnel from the laptop's `claude-in-chrome` MCP port to the VPS, so VPS Claude can call browser tools as if they were local. It's not yet end-to-end tested (the transport — HTTP vs Chrome native messaging — needs to be confirmed before the tunnel pattern can be promised), but the architecture is correct. Until that ships cleanly: keep browser-heavy tasks on the laptop side, or use Playwright headlessly on the VPS for things that don't need extension-level interactivity.

## What's Next

The installer is at an early version. Remaining work I have planned:

- Inline the `claude` first-run OAuth and `gh auth login` as the final installer steps (currently they're manual actions after setup completes — an SSH-and-paste pattern would close that loop)
- Test `/add-https` against a real VPS end-to-end and fix whatever breaks
- Confirm `claude-in-chrome`'s transport and finish `/add-chrome` end-to-end
- Detect-and-prune merged + clean worktrees on the laptop side before `vps-sync-repo` to cut multi-GB first syncs
- Test the install path on a non-macOS laptop (Linux laptop SSH server is on by default — different prereq UX)

If you want to try the setup, the repo is <a href="https://github.com/rasha-hantash/claude-vps-setup" target="_blank">here</a>. Issues and corrections are welcome — I'd like this to become a reliable reference for running Claude Code on a VPS, and at the moment my testing only covers my own laptop.

---

_This article builds on Andrey Markin's <a href="https://andrey-markin.com/blog/claude-code-vps-setup#vps-setup" target="_blank">claude-code-vps-setup</a> post, which was the first place I saw the Hetzner and Tailscale combination written up cleanly. What follows is what I learned reproducing his setup and adapting it into something I could share with friends._
