// Sends a message to the current session's Discord thread. Takes the content
// as an argument, resolves the target thread from CLAUDE_CODE_SESSION_ID, and
// calls the REST API directly - no login step, no dependency on
// discord-listener.js. See ../docs/claude-easy-discord-bridge-architecture.md section 5.
//
// Usage: node send.js "<content>"
const lib = require('./lib');

const DISCORD_MAX_LEN = 2000;

// Split content into chunks that each fit within Discord's per-message
// character limit, preferring to break on a newline near the boundary.
function splitContent(content) {
    if (content.length <= DISCORD_MAX_LEN) return [content];
    const chunks = [];
    let rest = content;
    while (rest.length > DISCORD_MAX_LEN) {
        let cut = rest.lastIndexOf('\n', DISCORD_MAX_LEN);
        if (cut <= 0) cut = DISCORD_MAX_LEN;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    if (rest.length > 0) chunks.push(rest);
    return chunks;
}

async function main() {
    const content = process.argv[2];
    if (!content) {
        console.error('Usage: node send.js "<content>"');
        process.exit(1);
    }
    const sessionId = lib.getSessionId();
    const map = lib.readJson(lib.SESSION_MAP_PATH, {});
    const entry = map[sessionId];
    if (!entry || !entry.threadId) {
        console.error(`Session ${sessionId} has no thread yet - run ensure-thread.js first.`);
        process.exit(1);
    }

    for (const chunk of splitContent(content)) {
        await lib.discordFetch(`/channels/${entry.threadId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content: chunk }),
        });
    }
    console.log(JSON.stringify({ ok: true, threadId: entry.threadId, chunks: splitContent(content).length }));
}

main().catch((err) => {
    console.error('send.js failed:', err.message);
    process.exit(1);
});
