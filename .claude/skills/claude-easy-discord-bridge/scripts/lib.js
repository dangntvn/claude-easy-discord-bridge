// Shared helpers used by every script in this skill. This is not one of the
// four main components described in
// ../docs/claude-easy-discord-bridge-architecture.md section 3 - it just
// centralizes .env loading, atomic JSON read/write, and reading
// CLAUDE_CODE_SESSION_ID, since that logic is identical across all scripts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// This file lives in scripts/, one level below the skill root where .env
// and .data/ live.
const SKILL_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(SKILL_DIR, '.data');
const ENV_PATH = path.join(SKILL_DIR, '.env');
const SESSION_MAP_PATH = path.join(DATA_DIR, 'session-map.json');
const ACTIVE_LISTENER_PATH = path.join(DATA_DIR, 'active-listener.json');
const ACTIVE_SESSIONS_PATH = path.join(DATA_DIR, 'active-sessions.json');
const INBOX_DIR = path.join(DATA_DIR, 'inbox');
const LISTENER_LOG_PATH = path.join(DATA_DIR, 'discord-listener.log');
const LISTENER_SCRIPT_PATH = path.join(__dirname, 'discord-listener.js');
const PENDING_APPROVAL_DIR = path.join(DATA_DIR, 'pending-approval');
const APPROVALS_DIR = path.join(DATA_DIR, 'approvals');

// Load key=value pairs from .env into process.env, without overwriting
// variables that are already set.
function loadEnv() {
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
    }
}

// Read and validate the Discord bot configuration from .env.
function getConfig() {
    loadEnv();
    const token = process.env.DISCORD_BOT_TOKEN;
    const serverId = process.env.DISCORD_SERVER_ID;
    const channelId = process.env.DISCORD_CHANNEL_ID;
    const allowedUserIds = (process.env.ALLOWED_USER_IDS || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    if (!token || !serverId || !channelId || allowedUserIds.length === 0) {
        throw new Error('Missing DISCORD_BOT_TOKEN / DISCORD_SERVER_ID / DISCORD_CHANNEL_ID / ALLOWED_USER_IDS in .env');
    }
    return { token, serverId, channelId, allowedUserIds };
}

// Read the current Claude Code session id from the environment. Every script
// in this skill must run inside a Claude Code session for this to succeed.
function getSessionId() {
    const id = process.env.CLAUDE_CODE_SESSION_ID;
    if (!id) throw new Error('CLAUDE_CODE_SESSION_ID is not set in the environment - this script must run inside a Claude Code session.');
    return id;
}

// Parse a JSON file, returning `fallback` if it is missing or malformed.
function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

// Write JSON atomically: write to a temp file in the same directory, then
// rename - avoids readers ever seeing a partially-written file when two
// processes race (the maildir principle described in the architecture doc).
function writeJsonAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

// Check whether a process with the given pid is still alive.
function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function inboxDirFor(sessionId) {
    return path.join(INBOX_DIR, sessionId);
}

function pendingApprovalPathFor(sessionId) {
    return path.join(PENDING_APPROVAL_DIR, `${sessionId}.json`);
}

function approvalsDirFor(sessionId) {
    return path.join(APPROVALS_DIR, sessionId);
}

// Thin wrapper around Discord's REST API. Reaction PUT/DELETE calls fired in
// quick succession at the SAME message (observed for real while
// experimenting with batching/parallelizing reaction calls - see
// discord-architecture.md section 5.1) are prone to HTTP 429. Discord returns
// a `retry_after` (seconds) in the response body, so waiting exactly that
// long and retrying is sufficient - no need to guess a backoff. Capped at 3
// attempts to avoid hanging forever under a real, sustained rate limit.
async function discordFetch(pathname, options = {}, attempt = 0) {
    const { token } = getConfig();
    const res = await fetch(`https://discord.com/api/v10${pathname}`, {
        ...options,
        headers: {
            'Authorization': `Bot ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    if (res.status === 429 && attempt < 3) {
        const body = await res.json().catch(() => ({}));
        const waitMs = Math.ceil((body.retry_after || 1) * 1000);
        await new Promise(r => setTimeout(r, waitMs));
        return discordFetch(pathname, options, attempt + 1);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`Discord REST ${options.method || 'GET'} ${pathname} -> HTTP ${res.status}: ${body}`);
        err.status = res.status;
        throw err;
    }
    if (res.status === 204) return null;
    return res.json();
}

module.exports = {
    SKILL_DIR, DATA_DIR, ENV_PATH, SESSION_MAP_PATH, ACTIVE_LISTENER_PATH, ACTIVE_SESSIONS_PATH,
    INBOX_DIR, LISTENER_LOG_PATH, LISTENER_SCRIPT_PATH, PENDING_APPROVAL_DIR, APPROVALS_DIR,
    loadEnv, getConfig, getSessionId, readJson, writeJsonAtomic, isPidAlive, inboxDirFor,
    pendingApprovalPathFor, approvalsDirFor,
    discordFetch,
};
