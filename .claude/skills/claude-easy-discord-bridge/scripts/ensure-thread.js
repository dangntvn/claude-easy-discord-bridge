// One-shot setup: find or create the Discord thread for the current session
// (CLAUDE_CODE_SESSION_ID), make sure discord-listener.js is alive, and
// always post a confirmation message to the thread. See
// ../docs/claude-easy-discord-bridge-architecture.md section 6.1.
//
// Usage: node ensure-thread.js "<name chosen by Claude>"
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

// Start discord-listener.js if it isn't running or its heartbeat is stale,
// and wait for it to report its first heartbeat before returning.
async function ensureListenerAlive() {
    const HEARTBEAT_STALE_MS = 90_000;
    const info = lib.readJson(lib.ACTIVE_LISTENER_PATH, null);
    if (info && lib.isPidAlive(info.pid)) {
        const age = Date.now() - new Date(info.lastHeartbeat).getTime();
        if (age < HEARTBEAT_STALE_MS) return; // alive and healthy
    }
    // Dead or stale heartbeat - (re)start it, detached from this process.
    const child = spawn(process.execPath, [lib.LISTENER_SCRIPT_PATH], {
        cwd: lib.SKILL_DIR,
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
    // Wait for the listener to log in and write its first heartbeat before continuing.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        const cur = lib.readJson(lib.ACTIVE_LISTENER_PATH, null);
        if (cur && cur.pid === child.pid) return;
    }
    throw new Error('discord-listener.js did not start within 15s, check discord-listener.log');
}

// Reuse the session's existing thread if it still exists on Discord,
// otherwise create a new one and persist the mapping.
async function findOrCreateThread(sessionId, name) {
    const { channelId } = lib.getConfig();
    const map = lib.readJson(lib.SESSION_MAP_PATH, {});
    const existing = map[sessionId];

    if (existing && existing.threadId) {
        try {
            await lib.discordFetch(`/channels/${existing.threadId}`);
            if (existing.name !== name) {
                existing.name = name;
                map[sessionId] = existing;
                lib.writeJsonAtomic(lib.SESSION_MAP_PATH, map);
            }
            return { threadId: existing.threadId, isNew: false };
        } catch (err) {
            if (err.status !== 404) throw err;
            // Thread was deleted on Discord - fall through and create a new one.
        }
    }

    const thread = await lib.discordFetch(`/channels/${channelId}/threads`, {
        method: 'POST',
        body: JSON.stringify({
            name,
            type: 11, // GUILD_PUBLIC_THREAD
            auto_archive_duration: 1440,
        }),
    });
    map[sessionId] = { name, threadId: thread.id };
    lib.writeJsonAtomic(lib.SESSION_MAP_PATH, map);
    return { threadId: thread.id, isNew: true };
}

// Remove any leftover message files from a previous connection before
// starting a new one, so stale messages aren't mistaken for freshly arrived
// ones.
function clearStaleInbox(sessionId) {
    const dir = lib.inboxDirFor(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.json') && !f.startsWith('.')) {
            fs.unlinkSync(path.join(dir, f));
        }
    }
}

function registerActiveSession(sessionId, name) {
    const sessions = lib.readJson(lib.ACTIVE_SESSIONS_PATH, {});
    sessions[sessionId] = {
        sessionId,
        name,
        pid: null,
        connectedAt: sessions[sessionId]?.connectedAt || new Date().toISOString(),
    };
    lib.writeJsonAtomic(lib.ACTIVE_SESSIONS_PATH, sessions);
}

async function main() {
    const name = (process.argv[2] || '').trim();
    if (!name) {
        console.error('Usage: node ensure-thread.js "<short description>"');
        process.exit(1);
    }
    const sessionId = lib.getSessionId();

    const { threadId, isNew } = await findOrCreateThread(sessionId, name);
    clearStaleInbox(sessionId);
    await ensureListenerAlive();

    await lib.discordFetch(`/channels/${threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: `🟢 Session '${name}' connected.` }),
    });

    registerActiveSession(sessionId, name);

    console.log(JSON.stringify({ sessionId, threadId, name, isNew }));
}

main().catch((err) => {
    console.error('ensure-thread.js failed:', err.message);
    process.exit(1);
});
