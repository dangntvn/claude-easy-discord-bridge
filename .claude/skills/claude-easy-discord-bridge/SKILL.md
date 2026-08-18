---
name: claude-easy-discord-bridge
description: Discord bridge for Claude Code — 1 channel per project, 1 dedicated thread per session (conversation), used when the user asks to connect/send/receive messages via Discord for the running session.
allowed-tools:
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/*.js)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/*.js *)
---

Two-way Discord bridge for exactly 1 running Claude Code session: 1 project ↔
1 channel, 1 session (conversation) ↔ 1 dedicated thread in that channel. All
executable scripts live in `scripts/`, always invoked via
`${CLAUDE_SKILL_DIR}/scripts/<file name>.js` (Claude Code substitutes this
with the absolute path of this skill's directory) — no need to `cd` into the
skill directory first, it works correctly regardless of Bash's current
working directory. No session id is ever passed by hand — every script reads
`CLAUDE_CODE_SESSION_ID` from the environment itself to know which
session/thread it's operating on.

**Every command in this skill MUST be called via the Bash tool** — even on
Windows, not PowerShell. Reasons: (1) this skill's `allowed-tools` only
whitelists the `Bash(...)` form, calling via another shell would trigger a
fresh permission prompt on every single command, breaking the remote-control
experience; (2) Windows PowerShell 5.1 passes arguments to `node.exe` using
the ANSI codepage, so non-ASCII text and emoji easily get corrupted before
reaching Discord.

Full design/architecture (not needed to use the skill, only when modifying
the code): see [architecture.md](docs/claude-easy-discord-bridge-architecture.md).

## First-time setup (once per project)

**Requires Node.js >= 18** (check with `node -v`) — the scripts call the
Discord REST API with the global `fetch`, only available from Node 18
onward. Node 16 or lower will fail with `fetch is not defined`.

```
cd .claude/skills/claude-easy-discord-bridge
npm install
```

Create a `.env` file right in this skill's directory, declaring
`DISCORD_BOT_TOKEN`, `DISCORD_SERVER_ID`, `DISCORD_CHANNEL_ID`,
`ALLOWED_USER_IDS` (comma-separated for multiple users, e.g.
`111,222,333`).

## When to use this skill

Only act when the user **explicitly** asks, in that exact conversation (e.g.
"connect to discord", "disconnect from discord"). Never auto-connect, never
auto-disconnect under any other circumstance.

## Operating flow — follow this exact order

### 1. Connect

Pick a short description of the current task (e.g. "fix login bug"), then
call:

```
node ${CLAUDE_SKILL_DIR}/scripts/ensure-thread.js "<short description>"
```

This script handles everything: creates a new thread or reuses this
session's existing thread, clears out any leftover stale messages in the
inbox from a previous connection, sends a confirmation message to the
thread, and restarts the shared listener if it isn't running or has died.

### 2. Wait for the next message from Discord

```
node ${CLAUDE_SKILL_DIR}/scripts/listen-message.js
```

**MUST be called via Bash with `run_in_background: true`** — never
synchronously, never with a fixed `timeout`. This script has no internal
timeout: it waits indefinitely until a new message arrives, prints exactly
one line of JSON (`messageId`, `content`, ...), then exits on its own. If
called synchronously with a `timeout`, the bash tool would kill the command
partway through once time runs out — losing the `task-notification`, so
Claude never wakes back up when the real message actually arrives. Running
it in the background never blocks sending — `send.js` can be called at any
time, even while `listen-message.js` is waiting in the background.

**As soon as the `task-notification` with this step's JSON arrives (BEFORE
doing anything else)**: immediately call `listen-message.js` again (in the
background) to keep waiting for the next message — don't wait until the
current message is fully handled before re-arming it. This way, if the user
sends another message while Claude is still processing the current one,
Claude gets notified right away instead of silently waiting until it's done
with the current message.

### 3. Handle the message just received

```
node ${CLAUDE_SKILL_DIR}/scripts/react.js <messageId> start
```
React 🤔 on the original message to signal it's being processed (use the
`messageId` from step 2's JSON).

Handle the user's request in the message as usual, then reply:

```
node ${CLAUDE_SKILL_DIR}/scripts/send.js "<reply content>"
```

```
node ${CLAUDE_SKILL_DIR}/scripts/react.js <messageId> done
```
Removes 🤔, adds ✅ — call this before or right after `send.js`, regardless
of how long processing took.

### 4. The loop continues naturally

Since step 2 already re-armed `listen-message.js` (in the background) as
soon as the message arrived — before processing began — the listener is
already waiting for the next message while step 3 is happening, so nothing
else needs to be done here. When the next `task-notification` arrives, go
back to step 2 → 3. Only stop the loop entirely (stop re-arming
`listen-message.js`) when the user asks to disconnect.

## Disconnecting

- **Disconnect the current session** (only affects this conversation's
  session, doesn't touch other sessions):
  `node ${CLAUDE_SKILL_DIR}/scripts/disconnect.js session`
- **Disconnect the whole project** (kills the listener shared by EVERY
  session of this project — the script warns first if other sessions are
  still alive; requires `--confirm` to proceed after seeing the warning):
  `node ${CLAUDE_SKILL_DIR}/scripts/disconnect.js project [--confirm]`

## Asking multiple-choice questions (like `AskUserQuestion`) while connected to Discord

`AskUserQuestion` only shows up in the native UI (VSCode/CLI) — a user
following along via Discord won't see that tool. When you need to ask the
user to choose between multiple options while connected to Discord, do the
following instead (optionally alongside still calling `AskUserQuestion`
normally, to keep both channels in sync):

1. Write the question + list the numbered options (1, 2, 3...) with short
   descriptions, send it with
   `node ${CLAUDE_SKILL_DIR}/scripts/send.js "<question>\n1. ...\n2. ...\n3. ..."`.
2. Call `listen-message.js` again (in the background) to wait for the
   reply, exactly like the normal chat loop in steps 2-4.
3. The user may reply with a number ("2") or type the option's content
   directly — interpret it flexibly, no need for an exact string match.

This needs no extra hook or dedicated mechanism — it reuses the existing
`send.js`/`listen-message.js`, since this is Claude proactively asking, not
a permission prompt.

## Hard rules — do not change these on your own

- Never auto-connect/auto-disconnect — only on explicit user request.
- Always call scripts via the Bash tool, never PowerShell (reason at the
  top of this file).
- Keep the sequential flow `react start` (await) → `send.js` → `react done`
  (await). Do not merge these calls into parallel/fire-and-forget execution
  to "optimize speed" — this was tried before and the user asked for a
  revert because it caused real bugs (rate limiting, wrong status
  reporting). Do not re-attempt this optimization unless explicitly asked.
- Do not optimize the inbox-reading mechanism (`fs.watch`/
  `POLL_INTERVAL_MS`) — it is not a meaningful source of latency in this
  bridge.

For the reasoning, real measured numbers, and the full design decisions
behind these rules: see
[architecture.md](docs/claude-easy-discord-bridge-architecture.md).
