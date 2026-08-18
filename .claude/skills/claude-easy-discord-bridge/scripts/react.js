// Marks processing state with a reaction on the user's original message:
// 🤔 when work starts, replaced with ✅ when it's done. Unlike a typing
// indicator (which auto-expires after 10s), this doesn't depend on
// processing time - just two fixed REST calls. See
// ../docs/claude-easy-discord-bridge-architecture.md.
//
// Usage: node react.js <messageId> <start|done>
const lib = require('./lib');

const PENDING_EMOJI = encodeURIComponent('🤔');
const DONE_EMOJI = encodeURIComponent('✅');

function addReaction(threadId, messageId, emoji) {
    lib.discordFetch(
        `/channels/${threadId}/messages/${messageId}/reactions/${emoji}/@me`,
        { method: 'PUT' },
    )
    .then(() => {})
    .catch(() => {});
}

function removeOwnReaction(threadId, messageId, emoji) {
    lib.discordFetch(
        `/channels/${threadId}/messages/${messageId}/reactions/${emoji}/@me`,
        { method: 'DELETE' },
    )
    .then(() => {})
    .catch(() => {});
}

async function main() {
    const [messageId, action] = process.argv.slice(2);
    if (!messageId || !['start', 'done'].includes(action)) {
        console.error('Usage: node react.js <messageId> <start|done>');
        process.exit(1);
    }

    const sessionId = lib.getSessionId();
    const map = lib.readJson(lib.SESSION_MAP_PATH, {});
    const entry = map[sessionId];
    if (!entry || !entry.threadId) {
        console.error(`Session ${sessionId} has no thread yet - run ensure-thread.js first.`);
        process.exit(1);
    }

    if (action === 'start') {
        addReaction(entry.threadId, messageId, PENDING_EMOJI);
    } else {
        // addReaction/removeOwnReaction already swallow their own errors via
        // .catch() internally (fire-and-forget), so nothing to chain here.
        removeOwnReaction(entry.threadId, messageId, PENDING_EMOJI);
        addReaction(entry.threadId, messageId, DONE_EMOJI);
    }
    console.log(JSON.stringify({ ok: true, threadId: entry.threadId, messageId, action }));
}

main().catch((err) => {
    console.error('react.js failed:', err.message);
    process.exit(1);
});
