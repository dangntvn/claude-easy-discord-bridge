// Implements the disconnect procedure described in
// ../docs/claude-easy-discord-bridge-architecture.md section 7. Not one of the four
// components listed in section 3 (that section predates section 7), but
// needed to carry out the documented procedure in code rather than by hand.
//
// Usage:
//   node disconnect.js session            - disconnect the current session (reads CLAUDE_CODE_SESSION_ID)
//   node disconnect.js project --confirm  - disconnect the whole project (kills the shared discord-listener.js)
const lib = require('./lib');

async function disconnectSession() {
    const sessionId = lib.getSessionId();
    const map = lib.readJson(lib.SESSION_MAP_PATH, {});
    const entry = map[sessionId];
    const sessions = lib.readJson(lib.ACTIVE_SESSIONS_PATH, {});
    const active = sessions[sessionId];

    if (active && lib.isPidAlive(active.pid) && active.pid !== process.pid) {
        try { process.kill(active.pid, 'SIGTERM'); } catch { /* already dead */ }
    }

    if (entry && entry.threadId) {
        const name = entry.name || sessionId;
        await lib.discordFetch(`/channels/${entry.threadId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content: `🔴 Session '${name}' has disconnected.` }),
        });
    }

    delete sessions[sessionId];
    lib.writeJsonAtomic(lib.ACTIVE_SESSIONS_PATH, sessions);
    // session-map.json is intentionally left untouched - resuming later
    // still reconnects to the same thread.
    console.log(JSON.stringify({ ok: true, sessionId, threadNotified: !!entry }));
}

async function disconnectProject() {
    const confirmed = process.argv.includes('--confirm');
    const sessions = lib.readJson(lib.ACTIVE_SESSIONS_PATH, {});
    const currentSessionId = process.env.CLAUDE_CODE_SESSION_ID || null;
    const others = Object.keys(sessions).filter(id => id !== currentSessionId);

    if (others.length > 0 && !confirmed) {
        console.error(JSON.stringify({
            ok: false,
            reason: 'other_sessions_active',
            otherSessions: others,
            message: `${others.length} other session(s) are still connected. Re-run with --confirm if you really want to disconnect the whole project.`,
        }));
        process.exit(2);
    }

    const info = lib.readJson(lib.ACTIVE_LISTENER_PATH, null);
    if (info && lib.isPidAlive(info.pid)) {
        try { process.kill(info.pid, 'SIGTERM'); } catch { /* already dead */ }
    }
    const fs = require('fs');
    try { fs.unlinkSync(lib.ACTIVE_LISTENER_PATH); } catch { /* didn't exist, ignore */ }
    lib.writeJsonAtomic(lib.ACTIVE_SESSIONS_PATH, {});
    console.log(JSON.stringify({ ok: true, killedPid: info ? info.pid : null }));
}

async function main() {
    const mode = process.argv[2];
    if (mode === 'session') return disconnectSession();
    if (mode === 'project') return disconnectProject();
    console.error('Usage: node disconnect.js session | node disconnect.js project [--confirm]');
    process.exit(1);
}

main().catch((err) => {
    console.error('disconnect.js failed:', err.message);
    process.exit(1);
});
