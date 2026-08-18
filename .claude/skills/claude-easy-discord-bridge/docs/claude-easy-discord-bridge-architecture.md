# Standardized architecture: Discord bridge along Project ↔ Channel ↔ Session ↔ Thread

**English** · [Tiếng Việt](claude-easy-discord-bridge-architecture.vi.md) · [日本語](claude-easy-discord-bridge-architecture.ja.md) · [中文](claude-easy-discord-bridge-architecture.zh.md)

Status: **fully coded and tested end-to-end against a real Discord** (not
a mock) — creating threads, sending/receiving real messages,
disconnecting/resuming, and relaying permission prompts have all been
verified working correctly. Packaged as the skill
`claude-easy-discord-bridge` (`.claude/skills/claude-easy-discord-bridge/`)
rather than left as a standalone `discord-bridge/` directory like before.
Scripts live under `scripts/` following Anthropic's standard skill
directory convention (see section 3). This document is the architecture
spec together with the design rationale — kept up to date with the actual
code, not a draft written before coding started. Decisions that have been
finalized:

1. No "tag" — **the thread name is chosen by Claude itself at connect
   time** (not typed by the user), but **the name is for display only, and
   is NOT used for routing/management**.
2. **Only 1 process listens on the WebSocket Gateway per project**, shared
   by every session.
3. **[FINALIZED]** The session identifier used for routing/management is
   **no longer self-generated** — it uses `CLAUDE_CODE_SESSION_ID`
   directly, the environment variable **that Claude Code itself provides
   for the exact chat that's running**, confirmed to genuinely exist
   (readable via `env` in this very session:
   `CLAUDE_CODE_SESSION_ID=b41c7c22-...`). Because this UUID is assigned by
   the system and is guaranteed to be absolutely unique per conversation,
   **there is no longer any risk of two different Claude windows fighting
   over the same session** — the "ownership" problem raised earlier
   naturally disappears, with no need for any additional lock file.
4. The queue uses a **maildir**-style layout (1 file = 1 message) — no
   need to hand-write a file-locking mechanism.
5. **[FINALIZED]** Sending messages uses the **REST API directly via a
   single HTTP command** (e.g. `curl`), not through
   `discord-listener.js`, not through `discord.js`, with no need for a
   Gateway connection/login.
6. **Both the first-time connection (creating the thread) and any
   reconnection must immediately send a default message into the
   thread** — to confirm the connection succeeded and to let the user
   know right away on Discord that the session is ready.

## 1. Original requirements

1. Each **project** ↔ its own **1 Discord channel**.
2. Each **session** (a specific Claude Code chat) ↔ its own **1 thread**
   within that channel.
3. Different projects use different channels, running independently in
   parallel.
4. Only connect to Discord when explicitly requested.
5. Connecting a session with no existing thread → create one; if one
   already exists → reuse it.
6. On connect (whether creating a new thread or reusing one), **by
   default send 1 message into the thread** to confirm.

## 2. Hard rules

- **Never auto-start the bridge** — it only runs on an explicit command.
- **No shared state between projects** — each project uses its own copy
  of `.claude/skills/claude-easy-discord-bridge/`.
- **Each project has at most 1 live Gateway connection at any given
  time.**
- **Identification/routing always uses the code (`CLAUDE_CODE_SESSION_ID`),
  never the name.** The name is just a display label on Discord, chosen
  by Claude at connect time (a short description of the task at hand,
  e.g. "fix login bug", "analyze HPG") — it has no uniqueness constraint
  and is never used for lookups.

## 3. Components

```
.claude/skills/claude-easy-discord-bridge/
  .env                       # DISCORD_BOT_TOKEN, SERVER_ID, CHANNEL_ID, ALLOWED_USER_IDS
  scripts/
    lib.js                    # shared helpers (read .env, atomic JSON read/write,
                              #   read CLAUDE_CODE_SESSION_ID, call the Discord REST API)
    discord-listener.js        # the ONE AND ONLY process/project, runs continuously,
                              #   holds 1 Gateway connection, handles only the RECEIVE direction
    ensure-thread.js           # one-shot REST call: find/create the thread for the current session
                              #   + send the connection-confirmation message
    listen-message.js          # takes NO parameters — reads CLAUDE_CODE_SESSION_ID
                              #   from the environment itself to know which inbox to read
    send.js                    # takes the content as a parameter, reads
                              #   CLAUDE_CODE_SESSION_ID itself to know which thread to send to,
                              #   calls REST directly (no login, no dependency on
                              #   discord-listener.js)
    react.js                   # attach/remove status emoji (🤔 start, ✅ done),
                              #   called sequentially, start then done - merging it with
                              #   send into a parallel-running reply.js for speed was
                              #   TRIED but reverted (see section 5.1)
    disconnect.js               # disconnect 1 session or an entire project
    permission-relay.js         # relay permission prompts via Discord (section 8)
  .data/
    session-map.json           # persistent mapping: code (CLAUDE_CODE_SESSION_ID) -> {name, threadId}
    active-listener.json       # pid + heartbeat of discord-listener.js
    active-sessions.json       # registry of LIVE sessions (distinct from session-map.json,
                              #   which is the persistent mapping) — {sessionId, pid of the
                              #   current listen-message.js process, connectedAt} — used to
                              #   know it's safe when someone tries to disconnect the whole project
    inbox/
      <CLAUDE_CODE_SESSION_ID-1>/   # INCOMING message queue, separate per real session
        1739850001234-a1b2.json
      <CLAUDE_CODE_SESSION_ID-2>/
```

Directory conventions follow Anthropic's standard skill layout: scripts
Claude executes live under `scripts/`, invoked via the
`${CLAUDE_SKILL_DIR}/scripts/<file>.js` variable from `SKILL.md` (which
gets substituted with an absolute path, so it works correctly regardless
of the current working directory). `lib.js` computes `SKILL_DIR` as
`path.join(__dirname, '..')` since it itself lives under `scripts/`, one
level below `.env`/`.data/`.

`session-map.json`:
```json
{
  "b41c7c22-d067-470e-90e2-7bd87dbcd7ef": {
    "name": "fix login bug",
    "threadId": "1538900000000000001"
  },
  "9f2a1e10-55bb-4a11-8e3d-2c9a7f001122": {
    "name": "analyze HPG",
    "threadId": "1538900000000000002"
  }
}
```
- **The map's key = `CLAUDE_CODE_SESSION_ID`** — the real code assigned by
  Claude Code, never self-generated, and unable to collide between two
  different conversations.
- `name` — used only for display as the thread title on Discord, chosen
  by Claude when it calls `ensure-thread.js`, **never used for
  lookup/routing anywhere in the system**. Two different sessions can
  share the same name without causing any problem (their Discord threads
  still stay separate because `threadId` differs).
- `threadId` — Discord's real ID, used for sending/receiving.

### Why Claude never needs to remember or hand off any identifier

Every script (`ensure-thread.js`, `listen-message.js`, `send.js`) reads
`process.env.CLAUDE_CODE_SESSION_ID` itself, right inside the process —
this variable is always available in every Bash command of the exact
conversation that's running, injected into the environment by Claude Code
itself, not created by the bridge. As a result:
- Claude never needs to remember or pass a code or name between command
  calls.
- It's impossible to accidentally call into the wrong session, because
  the environment only ever contains the single `CLAUDE_CODE_SESSION_ID`
  of the very process running that command.

### Why a maildir-style queue (1 file = 1 message)

- Writing: create a temp file in the same directory, then
  `fs.renameSync()` it to its real name — a `rename` on the same drive is
  an **atomic** operation, so a partially-written file is never read by
  mistake.
- Reading: list the directory, take the file with the smallest name
  (names start with a timestamp so ordering is automatically correct),
  read it, then delete it.
- Each session has its own directory (keyed by `CLAUDE_CODE_SESSION_ID`),
  so there's no contention between sessions; within a single directory,
  writing and reading are 2 different processes but they operate on 2
  different files at any given moment → **no file-locking library needed
  at all.**

## 4. Listening (receiving messages) — how to keep it stable

`discord-listener.js` is the project's single point of failure, so it
needs a handful of self-recovery mechanisms, all small, with no need for
an external supervisor/process manager:

1. **Never self-terminate on a transient error.** discord.js automatically
   reconnects/resumes the Gateway on a brief network drop — you just need
   to **avoid** calling `client.destroy()`/`process.exit()` in the
   `error`/`shardError` handlers, and just log instead. This process runs
   continuously; exiting is abnormal (unlike the old `listen-once.js`,
   which exited on its own after exactly 1 message).
2. **Heartbeat in `active-listener.json`.** At a fixed interval (e.g.
   30s) or every time it finishes handling 1 event, `discord-listener.js`
   overwrites `{ pid, lastHeartbeat }`. Just checking whether the `pid` is
   still alive (`process.kill(pid, 0)`) isn't enough — the process could
   still be alive but hung (lost its Gateway connection without
   crashing); a heartbeat older than a threshold (e.g. > 90s) is treated
   as "untrustworthy" and needs a restart.
3. **Self-heals on demand, with no separate monitoring process needed.**
   Whenever a session is about to call `listen-message.js`, it first
   checks `active-listener.json`: dead pid or stale heartbeat → restart
   `discord-listener.js` before continuing. This means no separate
   "watchdog" process is needed.
4. **Exits cleanly when asked to stop** (SIGINT/SIGTERM): immediately
   removes its own entry from `active-listener.json` so the next check
   knows right away that it has stopped, without waiting for the
   heartbeat to expire.
5. **Logs errors to a file** (`discord-listener.log`) instead of letting
   errors vanish without a trace when the background process dies.

## 5. Sending content from a session to Discord

**[FINALIZED]** Sending messages **requires no Gateway, no `discord.js`,
and does not depend on whether `discord-listener.js` is alive** — it's
just **1 HTTP REST call** to
`POST https://discord.com/api/v10/channels/<threadId>/messages`, with an
`Authorization: Bot <token>` header.

```
Claude wants to reply (running inside a session with CLAUDE_CODE_SESSION_ID = X)
        │
        ▼
send.js "<content>"
   → reads CLAUDE_CODE_SESSION_ID = X from the environment
   → looks up session-map.json by code X to get threadId
   → makes a curl/fetch REST call straight to Discord, with the Bot token from .env
   → gets the HTTP response right away (200 = sent successfully, error = known immediately)
        │
        ▼
The message appears in the correct thread instantly, without going through discord-listener.js
```

Why direct REST was chosen over (a) logging into `discord.js` on every
send, or (b) writing to an outbox and letting `discord-listener.js` send
it on your behalf:

- **Fast** — 1 HTTP round trip (measured in practice at ~400-660ms, see
  section 5.1), with no time spent opening/maintaining a Gateway
  connection.
- **Errors are known immediately, on the spot** — a wrong/expired token,
  or the bot losing permission to send into that thread, `send.js` learns
  right away via the HTTP error code.
- **Fully independent from `discord-listener.js`** — the listener dying
  only affects the receive direction, not the send direction.
- **`send.js` doesn't need `discord.js` installed** — it only needs to
  make an HTTP call (curl or the `fetch` already built into Node 18+).
- Content longer than 2000 characters → `send.js` automatically splits it
  into multiple consecutive REST calls.

### 5.1. Performance — real measured numbers (Windows, averaged over 3 runs)

| Task | Time |
|---|---|
| node startup | ~85ms |
| any 1 REST call to Discord (PUT/DELETE/POST) | ~0.4–0.66s |
| `fs.watch` detecting a new file in the inbox | ~14ms |

**The only significant source of latency is the number of REST calls that
have to be waited on, not the inbox-reading mechanism.** `fs.watch` at
14ms is negligible compared to the hundreds of ms per REST call — do not
go optimize `POLL_INTERVAL_MS` (the 2000ms value is only a fallback for
when `fs.watch` is unavailable, and in practice it's almost never hit).

Three latency-reduction principles were TRIED (in the `reply.js` script,
now deleted):

1. **Batch REST calls into 1 node process** — every script invocation
   pays a ~85ms startup cost. `reply.js` merged send + react ✅ into one.
2. **Independent calls use `Promise.all` instead of chained `await`** —
   e.g. removing 🤔 and adding ✅ are 2 different emoji, fully
   independent of each other.
3. **A call that only has a display effect is fire-and-forget** —
   `react.js start` is called with `run_in_background: true`; it doesn't
   block ~0.9s waiting for the emoji before starting the actual work.

The measured result was good: cost per reply dropped from **~3.2s down to
~0.76s**.

**But it introduced 2 real problems that led the user to demand a full
REVERT:**

- Bug: principle 3 (fire-and-forget) caused `react.js start` (PUT 🤔),
  running in the background, to COLLIDE with `reply.js` (DELETE 🤔 + PUT
  ✅) called right after it on the SAME message → Discord returned a 429
  rate limit. `reply.js` initially SWALLOWED this error (reporting a fake
  `reacted: true`). This was patched with retry-on-429 in
  `lib.discordFetch` (kept, still useful) plus reporting the true actual
  status in `reply.js`.
- Operational: after the patch, Claude (the author of this code) forgot
  to call `listen-message.js` again after a quick round of testing → the
  user thought the connection had dropped. This was an operator error,
  not a design flaw, but combined with the 429 bug it made the user judge
  the change as "slower, buggier" and ask to go back to the old flow,
  keeping only the 🤔 icon.

**Conclusion finalized with the user:** keep the old sequential flow
(`react start` waits to finish → `send.js` → `react done` waits to
finish, all chained `await`, no `Promise.all`, no merged processes).
~3.2s/turn is an acceptable cost compared to the risk of a race
condition. Do not re-optimize in this direction unless explicitly
requested.

## 6. General operational flow

### 6.1. Connecting 1 session (only when told to) — always sends a confirmation message

```
User: "connect to discord"
        │
        ▼
1. Claude picks a short descriptive name for the task at hand (e.g. "fix login bug")
        │
        ▼
2. ensure-thread.js "<name Claude chose>"
     - Reads CLAUDE_CODE_SESSION_ID = X from the environment (no manual passing needed)
     - Looks up session-map.json by code X:
         + threadId already exists → reuse it (the display name may be
           updated or kept as-is, with no effect on routing)
         + Doesn't exist yet → create a new thread on Discord with the
           title = the name Claude just chose, save { X: { name, threadId } }
           into session-map.json
     - ALWAYS sends 1 default message into the thread right after this step
       (e.g.: "🟢 Session '<name>' connected.") — whether the thread was
       newly created or reused, this step is mandatory, with no
       conditional skip
3. Check active-listener.json (pid + heartbeat):
     - still alive & fresh heartbeat → use it as-is
     - dead/expired → restart discord-listener.js (background, runs continuously)
4. Create an empty inbox/<X>/ directory if it doesn't exist yet
5. Start the loop: call listen-message.js (background) → wait for a task-notification
```

### 6.2. Receiving and processing a message

```
A Discord message is sent into the correct thread of session X
        │
        ▼
discord-listener.js receives it via the Gateway → looks up the threadId → finds the corresponding code X
   (reverse lookup in session-map.json by threadId)
        │
        ▼
writes a new file into inbox/<X>/ (maildir style)
        │
        ▼
listen-message.js (running inside session X itself, reads CLAUDE_CODE_SESSION_ID
   itself to know which inbox/<X>/ to read) detects the new file
   → reads it, prints the JSON, deletes the file → exits → the harness wakes up the correct Claude session
        │
        ▼
Claude processes it → send.js "..." (looks up threadId by X itself, calls REST directly)
   → Claude calls listen-message.js again to keep waiting
```

### 6.3. Multiple sessions within the same project

- The receive direction shares 1 `discord-listener.js`. Each session is
  independent at the processing layer: its own `inbox/<CLAUDE_CODE_SESSION_ID>/`
  directory, with each conversation's own `listen-message.js` reading its
  own directory itself — session A being busy doesn't block session B
  from receiving messages. There's no concept of "claiming a name" since
  names aren't used for routing.
- The send direction (`send.js`) is fully independent from the listener
  and from other sessions.

### 6.4. Multiple projects running in parallel

- Unchanged: each project has its own `discord-listener.js`, sharing
  nothing with other projects.

## 7. Disconnecting

### 7.1. When to disconnect

1. **The user explicitly requests it** in that exact chat (e.g.
   "disconnect discord") — the primary method, always explicit, never
   automatic.
2. **The conversation ends naturally** (window closed/session ended) —
   the `listen-message.js` process waiting in the background is a child
   process of that exact session, and gets cleaned up automatically as
   part of the process lifecycle when the session terminates, requiring
   no extra code.

There is no "auto-disconnect after X minutes of inactivity" branch — this
sticks to the rule of only acting when explicitly told to (section 2).

### 7.2. Disconnecting one specific session

```
User: "disconnect discord"
        │
        ▼
1. Stop the loop: no longer call listen-message.js again
2. If a listen-message.js process is currently waiting in the background → stop it
3. Send a notification message into the thread via REST (symmetric with connecting):
     "🔴 Session '<name>' disconnected."
4. Remove this session's entry from active-sessions.json (the "live" registry)
```

`session-map.json` (code ↔ name ↔ threadId) **stays unchanged, not
deleted** — if this exact conversation is resumed later,
`CLAUDE_CODE_SESSION_ID` doesn't change, so it reconnects to the same old
thread, without creating a new/duplicate thread.

### 7.3. Disconnecting an entire project (fully stopping `discord-listener.js`)

Affects **every other session** sharing the same listener, so it needs to
be handled with much more care than disconnecting a single session — it
must never be treated as an implicit side effect of one session
disconnecting itself.

```
User: "disconnect discord entirely for this project"
        │
        ▼
1. Read active-sessions.json → list the sessions that are actually alive
2. Are there other sessions (not the current one) still alive?
     - Yes → WARN before proceeding: "there are N other sessions still
       connected, stopping the whole project will disconnect them too,
       confirm?"
     - No / already confirmed → proceed
3. Kill discord-listener.js (using the pid in active-listener.json)
4. Delete active-listener.json
```

`session-map.json` still stays unchanged — it's just mapping data, not
"currently running" state, so it doesn't need to be cleared when the
listener stops.

## 8. Relaying permission prompts via Discord

Added after real testing revealed: the bridge originally only relayed
**chat**, not **permission prompts** (when Claude Code needs to ask
permission to run a tool). A user sitting on Discord couldn't
see/approve that prompt because it only appeared in the original
interface (VSCode). The requirement finalized with the user: **stick
closely to Claude Code's own original mechanism** — relay a permission
question exactly when Claude asks it, send nothing when Claude doesn't
ask, and when the wait times out, let Claude Code's own original
fail-open mechanism handle it (don't invent extra custom rules).

### 8.1. Mechanism used: the `PermissionRequest` hook

Confirmed via the official documentation
(`https://code.claude.com/docs/en/hooks.md`):
- The `PermissionRequest` hook **only fires exactly when Claude Code is
  about to show a permission prompt** — if a tool has already been
  auto-allowed by the existing permission-mode/rule, this hook doesn't
  run, so there's no need to do extra filtering at the application layer.
- Input (stdin, JSON): `session_id`, `tool_name`, `tool_input`,
  `permission_mode`, `tool_use_id`, ...
- Output (stdout, JSON, when exit code is 0):
  `{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": "allow"|"deny"|"escalate", "reason": "..."}}`
  - `escalate` = fall back to asking normally in the original interface
    (used when the answer on Discord is ambiguous).
- **Fail-open, following Claude Code's own original design**: if the hook
  crashes, prints malformed JSON, or **times out** (default 600s,
  adjustable via the `timeout` field in the hook configuration) → Claude
  Code automatically falls back to the normal permission flow (showing
  the prompt in VSCode as if there were no bridge), **without** hanging,
  and without ever auto-granting permission carelessly. This is exactly
  the "on timeout, follow Claude's own mechanism" behavior the user
  asked for — no need to write any extra timeout logic; simply not
  responding when the Discord wait times out automatically triggers the
  correct standard fail-open behavior.

### 8.2. A routing problem: permission-approval replies vs. ordinary chat messages

Both are text messages in the same thread, so the flows need to be
separated so that `listen-message.js` (the chat loop) doesn't accidentally
swallow a permission-approval reply, and vice versa.

Solution: mark "currently awaiting permission approval" with a one-time-use
flag file.

```
pending-approval/<CLAUDE_CODE_SESSION_ID>.json   # { promptId, askedAt } - created by the hook when it asks
approvals/<CLAUDE_CODE_SESSION_ID>/               # a dedicated maildir for permission-approval replies
```

- `permission-relay.js` (the script run by the hook) creates the
  `pending-approval/<code>.json` flag file before sending the question
  into the thread, then polls the `approvals/<code>/` directory waiting
  for a reply.
- `discord-listener.js`: every time it receives a message, after looking
  up `sessionId` from `threadId` as usual, it additionally checks whether
  a `pending-approval/<code>.json` flag file exists:
  - If it exists → this message is a reply to the permission prompt:
    write it into `approvals/<code>/` (not into `inbox/<code>/`), and
    **delete the flag file immediately** (one-time use) so the next
    message routes normally back into `inbox/`.
  - If it doesn't exist → route as before, into `inbox/<code>/`.
- `permission-relay.js` reads the file in `approvals/<code>/` → parses
  the intent: contains words like "y", "yes", "allow", "ok", "được",
  "đồng ý", "duyệt" → `allow`; contains "n", "no", "deny", "không", "từ
  chối" → `deny`; unclear → `escalate` (fall back to asking again in
  VSCode, which is safer than guessing blindly).

### 8.3. Content of the permission-request message sent to Discord

```
⚠️ [Permission request] Session '<name>' wants to use tool '<tool_name>':
```<tool_input, truncated to a maximum of ~1500 characters, JSON format>```
Reply 'y' to allow, 'n' to deny. If there's no reply in time, the prompt
will reappear in VSCode as usual.
```

### 8.4. Rollout risk — why it must be tested in isolation before enabling for real

A hook configured in `.claude/settings.json` (or
`.claude/settings.local.json`) **applies to the entire project, every
session**, not just the session connected to Discord. A mistake in
`permission-relay.js` could affect the permission-request experience of
EVERY Claude Code session running in this repo, including sessions that
have nothing to do with Discord at all (even though the fail-open
mechanism in 9.1 reduces the risk of hanging, it does not fully eliminate
the risk of faulty logic). Therefore, the mandatory process before
enabling it for real:
1. Test `permission-relay.js` in isolation by feeding it fake JSON on
   stdin yourself (without touching `settings.json`) — check every
   branch: a session not connected to Discord (must stay silent, print
   nothing), a connected session replying allow/deny/unclear, and a
   timeout.
2. Only after step 1 passes fully should the hook be added to
   `settings.json` and tested for real with an actual tool call in a
   session connected to Discord.
3. If anything abnormal shows up in step 2 (the hook not firing at the
   right time, parsing the wrong format, ...), remove it from
   `settings.json` immediately before investigating further — prioritize
   not affecting other sessions.

## 9. Still out of scope / unresolved risks

- **Keeping `session-map.json` in sync with actual Discord state** (a
  thread deleted / manually renamed on Discord) — there's no detection &
  self-recovery mechanism yet.
- **DMs** have no concept of threads, and would need a separate branch to
  support them.
- **Bot permissions**: needs `Create Public Threads` +
  `Send Messages in Threads` on each project's parent channel, in
  addition to the existing View/Send permissions.
- **Discord's 2000-character/message limit** when a reply's content is
  long — needs splitting logic in `send.js`; the details of how to split
  it (by line? by paragraph?) haven't been designed yet.
- **Cleaning up old sessions**: `session-map.json`/`inbox/` will keep
  growing with the number of conversations that have ever connected —
  there's no periodic cleanup mechanism yet for
  `CLAUDE_CODE_SESSION_ID`s that have expired/are no longer used.

## 10. Tested for real (not simulated)

Created a real thread, sent a real confirmation message, the user typed a
real message into the thread and `discord-listener.js` received it and
wrote it into the correct inbox, `listen-message.js` retrieved it in the
correct FIFO order, `send.js` sent it and automatically split messages
>2000 characters, correctly self-filtered the bot's own messages,
`disconnect.js session` correctly killed the waiting process + sent the
disconnect message + kept `session-map.json` intact so it could resume
the same thread later, `disconnect.js project` correctly warned when
other sessions were still alive and correctly killed the listener when
given `--confirm`. The test thread has been archived/renamed on Discord
(the bot doesn't have permission to fully delete threads -
`Manage Threads`).
