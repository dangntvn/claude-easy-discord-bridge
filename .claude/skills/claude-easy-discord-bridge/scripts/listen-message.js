// Blocks until exactly one message arrives for the current session, then
// prints it as JSON and exits. Takes no arguments - resolves the target
// inbox from CLAUDE_CODE_SESSION_ID. Follows the maildir convention (one
// file = one message): consumes a single file, deletes it, and exits, so the
// harness wakes up the correct Claude Code session that invoked this as a
// background tool call. See ../docs/claude-easy-discord-bridge-architecture.md sections 3
// and 6.2.
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const POLL_INTERVAL_MS = 2000;

// List candidate message files, sorted so that filename order (timestamp
// prefix) matches FIFO delivery order.
function listCandidates(dir) {
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json') && !f.startsWith('.'))
        .sort();
}

// Try to claim and consume the oldest pending message file. Returns null if
// none are available.
function tryConsumeOne(dir) {
    const files = listCandidates(dir);
    if (files.length === 0) return null;
    const filePath = path.join(dir, files[0]);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const payload = JSON.parse(content);
        fs.unlinkSync(filePath);
        return payload;
    } catch (err) {
        // The file may still be mid-write (rare, since writes are atomic
        // renames) or was already claimed by another process - skip it and
        // retry on the next pass.
        return null;
    }
}

function registerPid(sessionId) {
    const sessions = lib.readJson(lib.ACTIVE_SESSIONS_PATH, {});
    if (!sessions[sessionId]) {
        sessions[sessionId] = { sessionId, name: null, connectedAt: new Date().toISOString() };
    }
    sessions[sessionId].pid = process.pid;
    lib.writeJsonAtomic(lib.ACTIVE_SESSIONS_PATH, sessions);
}

function main() {
    const sessionId = lib.getSessionId();
    const dir = lib.inboxDirFor(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    registerPid(sessionId);

    const finish = (payload) => {
        console.log(JSON.stringify(payload));
        process.exit(0);
    };

    const immediate = tryConsumeOne(dir);
    if (immediate) { finish(immediate); return; }

    let watcher = null;
    const poll = setInterval(() => {
        const payload = tryConsumeOne(dir);
        if (payload) {
            clearInterval(poll);
            if (watcher) watcher.close();
            finish(payload);
        }
    }, POLL_INTERVAL_MS);

    try {
        watcher = fs.watch(dir, () => {
            const payload = tryConsumeOne(dir);
            if (payload) {
                clearInterval(poll);
                watcher.close();
                finish(payload);
            }
        });
    } catch {
        // fs.watch is unavailable on some platforms - the poll interval
        // above is enough to keep this working.
    }

    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
}

main();
