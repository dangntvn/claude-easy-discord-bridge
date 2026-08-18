// Invoked by Claude Code's "PermissionRequest" hook (configured in
// .claude/settings.json). See ../docs/claude-easy-discord-bridge-architecture.md section 8.
//
// Contract with Claude Code:
// - Reads a single JSON payload from stdin.
// - If the session is NOT connected to Discord (absent from
//   active-sessions.json) -> print nothing, exit 0 -> Claude Code handles the
//   permission prompt normally (no bridge involvement).
// - If the session IS connected -> post the question to its thread, wait up
//   to WAIT_BUDGET_MS, then return a decision as JSON on stdout following the
//   hookSpecificOutput.decision = allow|deny|ask schema.
// - On any error (thread not found, network failure, ...) -> print nothing,
//   exit 0 -> let Claude Code fail open. The hook must never hang on error.
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const POLL_INTERVAL_MS = 1500;
lib.loadEnv(); // needed to read PERMISSION_APPROVAL_WAIT_MS if set in .env
// How long to wait for a Discord reply, read from .env
// (PERMISSION_APPROVAL_WAIT_MS, in ms). Defaults to 10 minutes - it used to
// be 1 hour, but when something went wrong Claude Code would sit frozen for
// a full hour, which was too disruptive; 10 minutes is still generous enough
// to reply from a phone. MUST be <= the "timeout" field (in seconds) of the
// PermissionRequest hook in settings.json/settings.local.json - if
// WAIT_BUDGET_MS is set longer without also raising that timeout, Claude
// Code will kill the hook process before it finishes waiting.
const WAIT_BUDGET_MS = Number(process.env.PERMISSION_APPROVAL_WAIT_MS) || 600_000;

const ALLOW_WORDS = ['y', 'yes', 'allow', 'ok', 'oke', 'okay', 'được', 'đồng ý', 'dong y', 'duyệt', 'duyet', 'cho phép', 'cho phep'];
const DENY_WORDS = ['n', 'no', 'deny', 'không', 'khong', 'từ chối', 'tu choi', 'huỷ', 'huy', 'cancel'];

function readStdin() {
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
    });
}

// Classify free-text as an allow/deny decision by matching whole
// words/phrases against ALLOW_WORDS/DENY_WORDS. Text is normalized (stripped
// of punctuation, whitespace collapsed, padded on both ends) so matching via
// includes(' word ') doesn't get tripped up by trailing punctuation (e.g.
// "no, don't do it").
function classify(text) {
    const norm = ' ' + text.trim().toLowerCase()
        .replace(/[.,!?;:"'()[\]]/g, ' ')
        .replace(/\s+/g, ' ') + ' ';
    if (ALLOW_WORDS.some(w => norm.includes(` ${w} `))) return 'allow';
    if (DENY_WORDS.some(w => norm.includes(` ${w} `))) return 'deny';
    return null;
}

function summarizeToolInput(toolInput) {
    let json;
    try { json = JSON.stringify(toolInput, null, 2); } catch { json = String(toolInput); }
    if (json.length > 1500) json = json.slice(0, 1500) + '\n... (truncated)';
    return json;
}

function printDecision(decision, reason) {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision,
            reason,
        },
    }));
}

function cleanupFlag(sessionId) {
    try { fs.unlinkSync(lib.pendingApprovalPathFor(sessionId)); } catch { /* already removed by the listener, ignore */ }
}

// Scan `dir` for the oldest message file and claim it. When `onlyDecisive`
// is set, skip files whose content doesn't classify as allow/deny (used for
// the inbox fallback below, so ordinary chat messages aren't consumed).
// askedAtMs: chỉ chấp nhận tin nhắn gửi SAU thời điểm hỏi. Thiếu mốc này thì
// 1 chữ "yes" cũ còn sót lại sẽ bị dùng làm câu trả lời cho lần hỏi kế tiếp -
// câu trả lời lệch đi 1 nhịp, người dùng trả lời xong vẫn thấy "không xử lý
// gì" vì câu của họ lại nằm chờ cho lần sau.
function takeFirstFrom(dir, { onlyDecisive, askedAtMs }) {
    let files;
    try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.')).sort();
    } catch {
        return null; // directory doesn't exist yet
    }
    for (const f of files) {
        const filePath = path.join(dir, f);
        let payload;
        try {
            payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
            continue; // file is mid-write or was already claimed, retry next pass
        }
        const sentAt = Date.parse(payload.timestamp || '');
        if (Number.isNaN(sentAt) || sentAt < askedAtMs) continue; // tin cũ, không phải trả lời cho lần hỏi này
        const content = payload.content || '';
        if (onlyDecisive && classify(content) === null) continue;
        try { fs.unlinkSync(filePath); } catch { continue; }
        return content;
    }
    return null;
}

// Wait for a reply in BOTH approvals/ and inbox/. Normally the listener
// routes the reply into approvals/ via the pending-approval flag, but if the
// flag hasn't been written yet (user replies too fast) or gets consumed by
// an unrelated message, the reply can land in inbox/ instead - it must still
// be recognized there, otherwise the hook hangs until timeout and Claude
// Code appears frozen along with it. This was the root cause of "I replied
// yes but nothing happened".
async function waitForApproval(sessionId, deadline, askedAtMs) {
    const approvalsDir = lib.approvalsDirFor(sessionId);
    const inboxDir = lib.inboxDirFor(sessionId);
    fs.mkdirSync(approvalsDir, { recursive: true });
    while (Date.now() < deadline) {
        const fromApprovals = takeFirstFrom(approvalsDir, { onlyDecisive: false, askedAtMs });
        if (fromApprovals !== null) return fromApprovals;
        const fromInbox = takeFirstFrom(inboxDir, { onlyDecisive: true, askedAtMs });
        if (fromInbox !== null) return fromInbox;
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    return null; // timed out, no reply
}

async function main() {
    const raw = await readStdin();
    let input;
    try {
        input = JSON.parse(raw);
    } catch {
        return; // malformed input -> stay silent, let Claude Code handle it normally
    }

    const sessionId = input.session_id;
    if (!sessionId) return;

    const sessions = lib.readJson(lib.ACTIVE_SESSIONS_PATH, {});
    if (!sessions[sessionId]) return; // this session isn't connected to Discord -> don't intervene

    const map = lib.readJson(lib.SESSION_MAP_PATH, {});
    const entry = map[sessionId];
    if (!entry || !entry.threadId) return;

    const toolName = input.tool_name || '(unknown tool)';
    const summary = summarizeToolInput(input.tool_input);

    // Write the flag BEFORE posting the message - posting first would leave
    // a ~0.5s gap (the REST call's round trip) during which a fast reply
    // would be misrouted into the inbox instead of approvals.
    const askedAtMs = Date.now();
    lib.writeJsonAtomic(lib.pendingApprovalPathFor(sessionId), {
        promptId: input.tool_use_id || null,
        askedAt: new Date(askedAtMs).toISOString(),
    });

    await lib.discordFetch(`/channels/${entry.threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
            content: `⚠️ [Permission request] Session '${entry.name || sessionId}' wants to use tool '${toolName}':\n\`\`\`json\n${summary}\n\`\`\`\nReply **yes** to allow, **no** to deny (type it exactly, watch out for phone autocorrect). Waiting up to ${Math.round(WAIT_BUDGET_MS / 60000)} minutes - if there's no reply in time, the prompt will appear normally in VSCode.`,
        }),
    });

    const deadline = Date.now() + WAIT_BUDGET_MS;
    const reply = await waitForApproval(sessionId, deadline, askedAtMs);
    cleanupFlag(sessionId);

    if (reply === null) {
        // Timed out waiting on Discord -> print nothing, let Claude Code
        // fail open (show the prompt normally in VSCode), as agreed with
        // the user. Post to the thread so the user knows why Discord went
        // quiet instead of wondering if the bridge broke.
        await lib.discordFetch(`/channels/${entry.threadId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: `⌛ Timed out after ${Math.round(WAIT_BUDGET_MS / 60000)} minutes waiting for a reply to the permission request above - it has fallen back to VSCode, please approve it there.`,
            }),
        }).catch(() => { /* best-effort notification, fine if it fails */ });
        return;
    }

    const decision = classify(reply);
    if (decision === 'allow') {
        printDecision('allow', `Approved via Discord in thread '${entry.name || sessionId}'.`);
    } else if (decision === 'deny') {
        printDecision('deny', `Denied via Discord in thread '${entry.name || sessionId}'.`);
    } else {
        // Per the official docs, PermissionRequest only accepts
        // allow|deny|ask. This used to return 'escalate' (a PreToolUse
        // value) - wrong schema, which Claude Code silently ignored as if
        // the hook hadn't made a decision at all.
        printDecision('ask', `Reply on Discord was ambiguous ("${reply}") - falling back to asking directly.`);
    }
}

main().catch(() => {
    // Never let an error cause the hook to exit non-zero with garbage
    // output on stdout - staying silent and letting Claude Code fail open
    // is the safest option.
});
