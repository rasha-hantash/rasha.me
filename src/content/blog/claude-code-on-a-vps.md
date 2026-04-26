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

A VPS handles all three. Among the cheap always-on options, Hetzner's smallest instance is the most reasonable I've found at **€4.51 per month**.

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

A `cx22` instance: 2 vCPU, 4 GB RAM, 40 GB disk, ~€4.51 per month. The reason I chose Hetzner over DigitalOcean or AWS Lightsail is pricing — the cx22 is roughly half the cost of equivalent instances elsewhere, and it has been reliable for me.

4 GB is enough for Claude Code with a TypeScript LSP and a Next.js dev server, in my experience. For heavier workloads — local LLMs, large test suites — the cx32 (€7.50, 8 GB) is a step up. Hetzner allows resizing without rebuilding, so starting small is reasonable.

### Tailscale — Network

Tailscale puts your laptop, VPS, and phone on a private network that only your devices can see. Each device gets a stable hostname like `claude-box.your-tailnet.ts.net` instead of an IP address that might change.

What this means in practice:

- The VPS isn't reachable from the public internet at all. Random bots scanning the internet for open SSH ports never see it. Only devices you've explicitly added to your Tailscale account can connect.
- You don't have to install any of the usual SSH-hardening tools (rate limiters, IP blockers, firewall rules per source IP). Tailscale itself is the gate.
- Adding a new device — a new laptop, a phone, a friend's machine you want to share access with — is one paste of a key in their Tailscale app.
- Free for personal use up to 100 devices.

### `claude setup-token` — Auth

Of the three components, authentication on a fresh Linux VPS was the part I expected to be hardest. Claude Code on macOS uses the system Keychain for OAuth credentials; Linux has no Keychain, and a fresh VPS has no browser to complete an OAuth flow. I was prepared to write a script that extracts the token from my Keychain and copies it across, or to fall back to an API key and lose the predictable subscription pricing.

Anthropic shipped exactly the tool needed: `claude setup-token`. Run it once on the VPS, paste the token Claude Code prints, and authentication is complete. It's long-lived, doesn't need a browser, and uses your existing Claude subscription — no separate API key, no separate bill.

## Setup

I worked through the setup manually first to understand each step, then automated the parts that don't require judgment. The full manual version is roughly:

1. Create a Hetzner account, generate an API token (browser)
2. Create a Tailscale account, generate a reusable auth key (browser)
3. `hcloud server create` with your SSH key
4. SSH in as root via the public IP
5. Install Tailscale, join the tailnet, lock SSH to the `tailscale0` interface, disable root login, create a non-root user, install Node, Claude Code, `gh`, `gt`, and configure dotfiles
6. Run `claude setup-token`, paste the token
7. Verify the laptop can reach the box via the Tailscale hostname
8. Set up the phone (install Termius, add the host)

Each step is straightforward in isolation. They accumulate. End-to-end, my first run took about **90 minutes** of clock time, with significant context-switching between the Hetzner console, Tailscale admin panel, and terminal.

The second time I did it — helping a friend reproduce the same setup on a different VM — took nearly as long. At that point, automation made sense.

### The Installer

The automation lives in a small repo: <a href="https://github.com/rasha-hantash/claude-vps-setup" target="_blank">claude-vps-setup</a>. The flow:

```sh
git clone https://github.com/rasha-hantash/claude-vps-setup
cd claude-vps-setup
claude
```

Inside Claude Code:

```
/setup
```

It asks one question at a time — Hetzner token, Tailscale auth key, region, VM name — printing the relevant browser steps inline so the source for each value is clear. Each answer informs the next step. When it finishes, you have a working VPS and a `.setup-state.json` recording what was provisioned.

The time it saves:

| Phase | Manual | `/setup` | Saved |
|---|---|---|---|
| Provision Hetzner VM (console clicks: image, region, key) | 8–12 min | ~90 sec | ~10 min |
| Bootstrap (user, SSH harden, UFW, Tailscale, Node, Claude Code) | 25–40 min | 3–5 min | ~30 min |
| Tmux + global `CLAUDE.md` + mobile ergonomics | 10–15 min | 0 (templated) | ~12 min |
| Optional: Paper Desktop bridge (autossh + persistent unit) | 30–60 min | 2 min | ~45 min |
| Optional: HTTPS dev preview (UFW, Caddy, DNS) | 15–20 min | 3–4 min | ~15 min |
| **First run total** | **~90 min – 2.5 hr** | **~10–15 min clock, ~3 min attention** | **~80–130 min** |

The first run isn't where automation pays off. The value comes on the second run — a new laptop, a second VPS, helping someone else reproduce the setup, returning to it six months from now. In those cases, the time drops from roughly 90 minutes to 10.

A few minutes are unavoidable: generating the Hetzner API token (browser), generating the Tailscale auth key (browser), installing Tailscale on the laptop (GUI). Plan on three to four minutes of human input even with the installer.

### What the Install Looks Like

A condensed transcript of what the installer asks and what it runs. The installer uses Claude Code's `AskUserQuestion` UI, which renders as a structured prompt rather than a terminal `read -p`.

```
You:    /setup

Claude: Checking prereqs...
        ✓ ssh-keygen, ~/.ssh/id_ed25519.pub
        ✗ hcloud not found
        ✗ tailscale not found

        Both are available via Homebrew. Install them now? [Y/n]

You:    Y

Claude: ▸ brew install hcloud tailscale
        ✓ Installed.

Claude: Paste your Hetzner API token. Open
        https://console.hetzner.cloud/ → Security → API tokens →
        Generate (Read & Write). The token only displays once.
        [token input]

You:    Bx9mPq...

Claude: Region?
        ● ash  — Ashburn 🇺🇸  ← suggested (your timezone is LA, this is closest)
        ○ nbg1 — Nuremberg 🇩🇪
        ○ hel1 — Helsinki 🇫🇮
        ○ sin  — Singapore 🇸🇬

You:    ash

Claude: VM type?
        ● cx22  — 2 vCPU / 4 GB — €4.51/mo  ← recommended
        ○ cx32  — 4 vCPU / 8 GB — €7.50/mo  (if your repos are large)

You:    cx22

Claude: Name? [default: claude-box]

You:    (enter)

Claude: Tailscale auth key. Open
        https://login.tailscale.com/admin/settings/keys → Generate.
        Make it reusable, 90-day expiry.

You:    tskey-auth-kAB...

Claude: Two optional add-ons — pick yes if you'll want them later:
        Paper Desktop bridge?  [Y/n]
        HTTPS dev preview?     [y/N]

You:    Y / N

Claude: About to do this:
          VM:        claude-box (cx22, ash)
          Cost:      €4.51/mo, billed hourly starting now
          Hardening: disable root login, lock SSH to tailscale0
          Install:   Tailscale, Node 20, Claude Code, gh, gt, tmux, zsh
        Continue?  [Y/n]

You:    Y

Claude: [1/6] Provisioning VM... ✓ 137.184.42.91 in 47s
        [2/6] Waiting for SSH... ✓ up after 28s
        [3/6] Copying bootstrap script... ✓
        [4/6] Running bootstrap (~3 min)...
              → Tailscale joined: claude-box.tail-abc123.ts.net
              → Installed: Node 20, Claude Code 2.1.112, gh, gt, zsh
              → SSH hardened
        [5/6] Verifying Tailscale connectivity from laptop... ✓
        [6/6] Wrote .setup-state.json

        Your VPS:  claude-box.tail-abc123.ts.net (user: agent)
        SSH:       ssh agent@claude-box.tail-abc123.ts.net
        Phone:     Termius → host = claude-box.tail-abc123.ts.net

        One more step on the VPS — `claude setup-token` to authenticate:
          ssh agent@claude-box.tail-abc123.ts.net "claude setup-token"

        Suggested next: /add-paper (sets up the Paper Desktop bridge — see Caveats)
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

The €4.51 monthly fee is the simple part. The more complete picture:

| Item | Cost |
|---|---|
| Hetzner cx22 VM | €4.51/mo |
| Hetzner snapshots (optional) | ~€0.50/mo |
| Tailscale | Free (personal tier covers everything) |
| **Claude API or Max subscription** | **$20–200/mo** |

The VPS itself is the smallest line item. Your Claude usage — Max subscription or API metering — is the dominant cost, and it doesn't change based on whether Claude runs on your laptop or the VPS.

## Caveats

A few constraints worth knowing.

**Paper Desktop requires the laptop to be on.** [Paper Desktop](https://paper.design) is a design tool that exposes its canvas to Claude Code via a local MCP server, so Claude can read and write designs directly. The server binds to `127.0.0.1` only and rejects requests with non-localhost `Host` headers (I verified this experimentally). The only way to reach it from the VPS is an SSH reverse tunnel back to the laptop. That works, but it requires the laptop to be awake, on Tailscale, and running Paper Desktop. Phone-only workflows can't use Paper. The installer offers an `/add-paper` command that sets up the tunnel via `autossh` for users who want it.

**Credentials live on a cloud machine.** Even with `claude setup-token`, your auth token sits on a rented box that you don't physically control. Tailscale-only access helps — nothing on the public internet can probe it — but it's still a remote machine. I'd avoid putting credentials on a VPS that I wouldn't put on any rented server.

**Transcripts aren't synced automatically.** Claude Code stores per-project session JSONLs in `~/.claude/projects/`. Sessions started on the laptop won't appear in `claude --resume` on the VPS. A one-shot `rsync -av ~/.claude/projects/ agent@claude-box:.claude/projects/` is enough if the history matters. I don't sync them — VPS sessions tend to start fresh, which fits how I use the box anyway.

## What's Next

The installer is at an early version. Remaining work I have planned:

- Inline `claude setup-token` as the final installer step (currently it's a manual action after setup completes)
- Document the Paper bridge well enough that someone who has never written a launchd unit can ship it
- Test the install path on a non-macOS laptop

If you want to try the setup, the repo is <a href="https://github.com/rasha-hantash/claude-vps-setup" target="_blank">here</a>. Issues and corrections are welcome — I'd like this to become a reliable reference for running Claude Code on a VPS, and at the moment my testing only covers my own laptop.

---

_This article builds on Andrey Markin's <a href="https://andrey-markin.com/blog/claude-code-vps-setup#vps-setup" target="_blank">claude-code-vps-setup</a> post, which was the first place I saw the Hetzner and Tailscale combination written up cleanly. What follows is what I learned reproducing his setup and adapting it into something I could share with friends._
