// The single, long-running process per project. Holds one Gateway
// connection and is responsible only for the RECEIVE side: it writes
// incoming Discord messages into inbox/<CLAUDE_CODE_SESSION_ID>/ using the
// maildir convention (one file = one message). See
// ../docs/claude-easy-discord-bridge-architecture.md section 4.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const lib = require('./lib');

const { token, serverId, allowedUserIds } = lib.getConfig();

const HEARTBEAT_INTERVAL_MS = 30_000;

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(lib.LISTENER_LOG_PATH, line);
}

function writeHeartbeat() {
    lib.writeJsonAtomic(lib.ACTIVE_LISTENER_PATH, {
        pid: process.pid,
        lastHeartbeat: new Date().toISOString(),
    });
}

function clearActiveListenerIfMine() {
    const cur = lib.readJson(lib.ACTIVE_LISTENER_PATH, null);
    if (cur && cur.pid === process.pid) {
        try { fs.unlinkSync(lib.ACTIVE_LISTENER_PATH); } catch { /* noop */ }
    }
}

function findSessionIdByThreadId(threadId) {
    const map = lib.readJson(lib.SESSION_MAP_PATH, {});
    for (const [sessionId, entry] of Object.entries(map)) {
        if (entry.threadId === threadId) return sessionId;
    }
    return null;
}

// Write a message payload to `dir` using an atomic write-then-rename, so
// listen-message.js never observes a partially-written file.
function deliverToDir(dir, payload) {
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
    const tmp = path.join(dir, `.tmp-${filename}`);
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, path.join(dir, filename));
}

// If this session has a permission prompt currently awaiting approval (see
// ../docs/claude-easy-discord-bridge-architecture.md section 8.2), the NEXT valid message
// from the user in that thread is treated as the approval reply rather than
// regular chat - it gets routed to approvals/ instead of inbox/, and the
// flag is deleted immediately (single use) so later messages go back to
// normal routing.
function isPendingApproval(sessionId) {
    const flagPath = lib.pendingApprovalPathFor(sessionId);
    if (!fs.existsSync(flagPath)) return false;
    try { fs.unlinkSync(flagPath); } catch { /* already removed by permission-relay.js, treat as expired */ return false; }
    return true;
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

client.on('clientReady', () => {
    log(`Ready, logged in as ${client.user.tag}`);
    writeHeartbeat();
});

client.on('error', (err) => {
    log(`Gateway error (not exiting, letting discord.js reconnect): ${err.message}`);
});

client.on('shardError', (err) => {
    log(`Shard error (not exiting, letting discord.js reconnect): ${err.message}`);
});

client.on('messageCreate', (message) => {
    try {
        if (message.author.bot) return;
        if (!allowedUserIds.includes(message.author.id)) return;
        if (message.guildId && message.guildId !== serverId) return;
        if (!message.channel.isThread()) return; // only accept messages inside a thread (one session = one thread)

        const sessionId = findSessionIdByThreadId(message.channelId);
        if (!sessionId) {
            log(`Ignoring message from unknown thread (not in session-map.json): ${message.channelId}`);
            return;
        }

        const payload = {
            messageId: message.id,
            threadId: message.channelId,
            guildId: message.guildId,
            authorId: message.author.id,
            content: message.content,
            timestamp: message.createdAt.toISOString(),
        };

        if (isPendingApproval(sessionId)) {
            deliverToDir(lib.approvalsDirFor(sessionId), payload);
            log(`Received a permission-approval reply for session ${sessionId}, written to approvals.`);
        } else {
            deliverToDir(lib.inboxDirFor(sessionId), payload);
            log(`Received a message for session ${sessionId}, written to inbox.`);
        }
    } catch (err) {
        log(`Error while handling messageCreate (not exiting): ${err.message}`);
    }
});

const heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);

function shutdown(signal) {
    log(`Received ${signal}, shutting down cleanly.`);
    clearInterval(heartbeatTimer);
    clearActiveListenerIfMine();
    client.destroy().finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(token).catch((err) => {
    log(`Login failed, exiting: ${err.message}`);
    clearActiveListenerIfMine();
    process.exit(1);
});
