# Kiến trúc chuẩn hoá: Discord bridge theo Project ↔ Channel ↔ Session ↔ Thread

Trạng thái: **đã code xong và test end-to-end thật với Discord thật** (không
phải mock) — tạo thread, gửi/nhận tin thật, ngắt/resume, relay permission
prompt đều đã chạy đúng. Đóng gói thành skill
`claude-easy-discord-bridge` (`.claude/skills/claude-easy-discord-bridge/`)
thay vì để rời như thư mục `discord-bridge/` cũ. Script nằm trong `scripts/`
theo đúng chuẩn thư mục skill của Anthropic (xem mục 3). Tài liệu này là
đặc tả kiến trúc kèm lý do thiết kế — cập nhật theo code thật, không phải
bản nháp trước khi code. Các quyết định đã chốt:

1. Không dùng "tag" — **tên thread do chính Claude tự đặt lúc kết nối**
   (không phải người dùng gõ), nhưng **tên chỉ để hiển thị, KHÔNG dùng để
   định tuyến/quản lý**.
2. **Chỉ 1 tiến trình lắng nghe WebSocket Gateway cho mỗi project**, dùng
   chung cho mọi session.
3. **[ĐÃ CHỐT]** Mã session dùng để định tuyến/quản lý **không tự sinh nữa**
   — dùng thẳng `CLAUDE_CODE_SESSION_ID`, biến môi trường **Claude Code tự
   cấp sẵn cho đúng cuộc chat đang chạy**, đã xác nhận tồn tại thật (đọc được
   qua `env` ngay trong phiên này: `CLAUDE_CODE_SESSION_ID=b41c7c22-...`).
   Vì UUID này do hệ thống cấp và đảm bảo duy nhất tuyệt đối cho từng cuộc
   hội thoại, **không còn nguy cơ 2 cửa sổ Claude khác nhau tranh nhau 1
   session** — vấn đề "ownership" đã nêu trước đó tự nhiên biến mất, không
   cần thêm file khoá nào.
4. Queue dùng kiểu **maildir** (1 file = 1 tin nhắn) — không cần tự viết cơ
   chế khoá file.
5. **[ĐÃ CHỐT]** Gửi tin dùng **REST API trực tiếp qua 1 lệnh HTTP** (vd
   `curl`), không qua `discord-listener.js`, không qua `discord.js`, không
   cần Gateway/login.
6. **Kết nối lần đầu (tạo thread) hoặc kết nối lại đều phải gửi ngay 1 tin
   nhắn mặc định vào thread** — để xác nhận kết nối thành công và để người
   dùng biết ngay trên Discord là session đã sẵn sàng.

## 1. Yêu cầu gốc

1. Mỗi **project** ↔ **1 channel Discord** riêng.
2. Mỗi **session** (1 cuộc chat Claude Code cụ thể) ↔ **1 thread riêng**
   trong channel đó.
3. Project khác nhau dùng channel khác nhau, chạy song song độc lập.
4. Chỉ kết nối Discord khi được yêu cầu tường minh.
5. Kết nối session mà thread chưa có → tự tạo; đã có → dùng lại.
6. Khi kết nối (dù tạo mới hay dùng lại), **mặc định gửi 1 tin nhắn vào
   thread** để xác nhận.

## 2. Nguyên tắc cứng

- **Không tự động khởi động bridge** — chỉ chạy khi có lệnh tường minh.
- **Không chia sẻ trạng thái giữa các project** — mỗi project dùng riêng 1
  bản `.claude/skills/claude-easy-discord-bridge/` của chính project đó.
- **Mỗi project chỉ có tối đa 1 kết nối Gateway sống tại một thời điểm.**
- **Định danh/định tuyến luôn dùng mã (`CLAUDE_CODE_SESSION_ID`), không bao
  giờ dùng tên.** Tên chỉ là nhãn hiển thị trên Discord, do Claude tự đặt lúc
  kết nối (mô tả ngắn gọn công việc đang làm, ví dụ "sửa lỗi login", "phân
  tích HPG"), không có ràng buộc duy nhất, không dùng để tra cứu.

## 3. Thành phần

```
.claude/skills/claude-easy-discord-bridge/
  .env                       # DISCORD_BOT_TOKEN, SERVER_ID, CHANNEL_ID, ALLOWED_USER_IDS
  scripts/
    lib.js                    # helper dùng chung (đọc .env, đọc/ghi JSON atomic,
                              #   đọc CLAUDE_CODE_SESSION_ID, gọi REST tới Discord)
    discord-listener.js        # tiến trình DUY NHẤT/project, sống liên tục,
                              #   giữ 1 kết nối Gateway, chỉ lo chiều NHẬN
    ensure-thread.js           # REST 1 lần: tìm/tạo thread cho session hiện tại
                              #   + gửi tin xác nhận kết nối
    listen-message.js          # KHÔNG cần tham số — tự đọc CLAUDE_CODE_SESSION_ID
                              #   từ biến môi trường để biết đọc đúng inbox nào
    send.js                    # nhận nội dung làm tham số, tự đọc
                              #   CLAUDE_CODE_SESSION_ID để biết gửi vào thread nào,
                              #   gọi REST trực tiếp (không login, không phụ thuộc
                              #   discord-listener.js)
    react.js                   # gắn/gỡ emoji trạng thái (🤔 bắt đầu, ✅ xong),
                              #   gọi tuần tự start rồi done - đã THỬ gộp với
                              #   send thành reply.js chạy song song cho nhanh
                              #   hơn nhưng bị revert (xem mục 5.1)
    disconnect.js               # ngắt 1 session hoặc ngắt cả project
    permission-relay.js         # relay permission prompt qua Discord (mục 8)
  .data/
    session-map.json           # ánh xạ bền vững: mã (CLAUDE_CODE_SESSION_ID) -> {tên, threadId}
    active-listener.json       # pid + heartbeat của discord-listener.js
    active-sessions.json       # registry SESSION ĐANG SỐNG (khác session-map.json
                              #   là ánh xạ bền vững) — {sessionId, pid tiến trình
                              #   listen-message.js hiện tại, connectedAt} — dùng để
                              #   biết an toàn khi có ai định ngắt cả project
    inbox/
      <CLAUDE_CODE_SESSION_ID-1>/   # queue tin ĐẾN, riêng theo từng session thật
        1739850001234-a1b2.json
      <CLAUDE_CODE_SESSION_ID-2>/
```

Quy ước thư mục theo đúng chuẩn skill của Anthropic: script Claude thực thi
nằm trong `scripts/`, gọi qua biến `${CLAUDE_SKILL_DIR}/scripts/<file>.js` từ
`SKILL.md` (tự thay thành đường dẫn tuyệt đối, chạy đúng dù cwd đang ở đâu).
`lib.js` tính `SKILL_DIR` bằng `path.join(__dirname, '..')` vì bản thân nó
cũng nằm trong `scripts/`, thấp hơn `.env`/`.data/` một cấp.

`session-map.json`:
```json
{
  "b41c7c22-d067-470e-90e2-7bd87dbcd7ef": {
    "name": "sửa lỗi login",
    "threadId": "1538900000000000001"
  },
  "9f2a1e10-55bb-4a11-8e3d-2c9a7f001122": {
    "name": "phân tích HPG",
    "threadId": "1538900000000000002"
  }
}
```
- **Khoá của map = `CLAUDE_CODE_SESSION_ID`** — mã thật do Claude Code cấp,
  không tự sinh, không thể trùng giữa 2 cuộc hội thoại khác nhau.
- `name` — chỉ để hiển thị làm tiêu đề thread trên Discord, do Claude tự đặt
  lúc gọi `ensure-thread.js`, **không dùng để tra cứu/định tuyến bất cứ đâu
  trong hệ thống**. Có thể trùng tên giữa 2 session khác nhau mà không gây
  vấn đề gì (thread trên Discord vẫn tách biệt vì `threadId` khác nhau).
- `threadId` — id thật của Discord, dùng để gửi/nhận.

### Vì sao không cần Claude tự nhớ hay truyền tay bất kỳ định danh nào

Tất cả script (`ensure-thread.js`, `listen-message.js`, `send.js`) đều tự đọc
`process.env.CLAUDE_CODE_SESSION_ID` ngay trong tiến trình — biến này luôn có
sẵn trong mọi lệnh Bash của đúng cuộc hội thoại đang chạy, do Claude Code tự
bơm vào môi trường, không phải do bridge tự tạo. Vì vậy:
- Claude không cần nhớ, không cần truyền mã hay tên qua các lần gọi lệnh.
- Không thể gọi nhầm sang session khác, vì môi trường chỉ chứa đúng 1
  `CLAUDE_CODE_SESSION_ID` của chính tiến trình đang chạy lệnh đó.

### Vì sao queue kiểu maildir (1 file = 1 tin)

- Ghi: tạo file tạm trong cùng thư mục rồi `fs.renameSync()` đổi tên thành
  tên thật — `rename` trên cùng ổ đĩa là thao tác **nguyên tử (atomic)**,
  không bao giờ có file ghi dở bị đọc nhầm.
- Đọc: liệt kê thư mục, lấy file có tên nhỏ nhất (tên bắt đầu bằng
  timestamp nên tự đúng thứ tự), đọc rồi xoá.
- Mỗi session có thư mục riêng (theo `CLAUDE_CODE_SESSION_ID`) nên không
  tranh chấp giữa các session; trong cùng 1 thư mục, ghi và đọc là 2 tiến
  trình khác nhau nhưng thao tác trên 2 file khác nhau tại mọi thời điểm →
  **không cần thư viện khoá file nào cả.**

## 4. Việc lắng nghe (nhận tin) — làm sao để ổn định

`discord-listener.js` là điểm chịu lỗi duy nhất của project, nên cần vài cơ
chế tự phục hồi, tất cả đều nhỏ, không cần supervisor/process-manager ngoài:

1. **Không tự huỷ khi lỗi tạm thời.** discord.js tự động reconnect/resume
   Gateway khi mất kết nối mạng thoáng qua — chỉ cần **không** gọi
   `client.destroy()`/`process.exit()` trong handler `error`/`shardError`,
   chỉ log lại. Bản này sống liên tục, thoát là bất thường (khác
   `listen-once.js` cũ tự thoát sau đúng 1 tin).
2. **Heartbeat trong `active-listener.json`.** Cứ mỗi khoảng thời gian cố
   định (vd 30s) hoặc mỗi lần xử lý xong 1 sự kiện, `discord-listener.js` ghi
   đè `{ pid, lastHeartbeat }`. Chỉ kiểm tra `pid` còn sống
   (`process.kill(pid, 0)`) không đủ — tiến trình có thể còn sống nhưng bị
   treo (mất kết nối Gateway mà không crash); heartbeat cũ quá 1 ngưỡng (vd
   > 90s) coi như "không đáng tin", cần khởi động lại.
3. **Tự phục hồi khi có nhu cầu, không cần tiến trình giám sát riêng.** Mỗi
   khi 1 session chuẩn bị gọi `listen-message.js`, trước tiên kiểm tra
   `active-listener.json`: pid chết hoặc heartbeat cũ → tự khởi động lại
   `discord-listener.js` trước khi tiếp tục. Nhờ vậy không cần thêm 1 tiến
   trình "canh chừng" độc lập.
4. **Thoát sạch khi được yêu cầu dừng** (SIGINT/SIGTERM): xoá luôn entry của
   mình trong `active-listener.json` để lần kiểm tra sau biết ngay là đã
   dừng, không phải chờ hết hạn heartbeat.
5. **Ghi log lỗi ra file** (`discord-listener.log`) thay vì để lỗi mất dấu
   vết khi tiến trình nền chết.

## 5. Việc gửi nội dung từ session lên Discord

**[ĐÃ CHỐT]** Gửi tin **không cần Gateway, không cần `discord.js`, không phụ
thuộc `discord-listener.js` có đang sống hay không** — chỉ là **1 lệnh HTTP
REST** tới `POST https://discord.com/api/v10/channels/<threadId>/messages`,
kèm header `Authorization: Bot <token>`.

```
Claude muốn trả lời (đang chạy trong session có CLAUDE_CODE_SESSION_ID = X)
        │
        ▼
send.js "<nội dung>"
   → đọc CLAUDE_CODE_SESSION_ID = X từ môi trường
   → tra session-map.json theo mã X để lấy threadId
   → gọi 1 lệnh curl/fetch REST thẳng tới Discord, kèm Bot token từ .env
   → nhận HTTP response ngay (200 = gửi thành công, lỗi = biết ngay tại chỗ)
        │
        ▼
Tin xuất hiện trên đúng thread ngay lập tức, không qua discord-listener.js
```

Lý do chọn REST trực tiếp thay vì (a) tự login `discord.js` mỗi lần gửi,
hoặc (b) ghi outbox rồi để `discord-listener.js` gửi hộ:

- **Nhanh** — 1 round-trip HTTP (đo thật ~400-660ms, xem mục 5.1), không tốn
  thời gian mở/duy trì kết nối Gateway.
- **Biết lỗi ngay tại chỗ** — token sai/hết hạn hoặc bot mất quyền gửi vào
  thread đó, `send.js` biết ngay qua mã lỗi HTTP.
- **Độc lập hoàn toàn với `discord-listener.js`** — listener chết chỉ ảnh
  hưởng chiều nhận, không ảnh hưởng chiều gửi.
- **`send.js` không cần cài `discord.js`** — chỉ cần gọi HTTP (curl hoặc
  `fetch` có sẵn trong Node 18+).
- Nội dung dài hơn 2000 ký tự → `send.js` tự cắt thành nhiều lệnh gọi REST
  liên tiếp.

### 5.1. Hiệu năng — số liệu đo thật (Windows, 3 lần lấy trung bình)

| Việc | Thời gian |
|---|---|
| node khởi động | ~85ms |
| 1 REST call bất kỳ tới Discord (PUT/DELETE/POST) | ~0.4–0.66s |
| `fs.watch` phát hiện file mới trong inbox | ~14ms |

**Nguồn độ trễ duy nhất đáng kể là số REST call phải đứng chờ, không phải cơ
chế đọc inbox.** `fs.watch` 14ms là không đáng kể so với hàng trăm ms mỗi REST
call — đừng đi tối ưu `POLL_INTERVAL_MS` (2000ms chỉ là fallback khi `fs.watch`
không khả dụng, thực tế gần như không bao giờ chạm tới).

Ba nguyên tắc giảm độ trễ, đã THỬ áp dụng (script `reply.js`, nay đã xoá):

1. **Gộp REST call vào 1 tiến trình node** — mỗi lần gọi script là 1 lần trả
   giá ~85ms khởi động. `reply.js` gộp send + react ✅ làm một.
2. **Call độc lập thì `Promise.all`, không `await` nối đuôi** — ví dụ gỡ 🤔 và
   thêm ✅ là 2 emoji khác nhau, hoàn toàn độc lập.
3. **Call chỉ có tác dụng hiển thị thì fire-and-forget** — `react.js start`
   gọi với `run_in_background: true`; không chặn ~0.9s chờ emoji trước khi
   bắt đầu làm việc thật.

Đo được kết quả tốt: chi phí mỗi lượt trả lời từ **~3.2s xuống ~0.76s**.

**Nhưng phát sinh 2 vấn đề thật khiến người dùng yêu cầu REVERT toàn bộ:**

- Bug: nguyên tắc 3 (fire-and-forget) khiến `react.js start` (PUT 🤔) chạy nền
  ĐỤNG ĐỘ với `reply.js` (DELETE 🤔 + PUT ✅) gọi ngay sau đó trên CÙNG 1 tin
  nhắn → Discord trả 429 rate limit. `reply.js` ban đầu NUỐT lỗi này (báo
  `reacted: true` giả). Đã vá bằng retry-on-429 trong `lib.discordFetch`
  (giữ lại, vẫn hữu ích) + báo đúng trạng thái thật trong `reply.js`.
- Vận hành: sau khi vá xong, Claude (người viết code này) quên gọi lại
  `listen-message.js` sau 1 lượt test nhanh → người dùng tưởng bị ngắt kết
  nối. Đây là lỗi thao tác, không phải lỗi thiết kế, nhưng cộng dồn với bug
  429 khiến người dùng đánh giá "chậm hơn, lỗi hơn" và yêu cầu quay lại luồng
  cũ, chỉ giữ icon 🤔.

**Kết luận đã chốt với người dùng:** giữ nguyên luồng tuần tự cũ (`react
start` chờ xong → `send.js` → `react done` chờ xong, tất cả `await` nối
đuôi, không `Promise.all`, không gộp tiến trình). ~3.2s/lượt là chi phí chấp
nhận được so với rủi ro race condition. Không tối ưu lại hướng này trừ khi
được yêu cầu tường minh.

## 6. Luồng hoạt động tổng quát

### 6.1. Kết nối 1 session (chỉ khi được bảo) — luôn gửi tin xác nhận

```
Người dùng: "kết nối discord đi"
        │
        ▼
1. Claude tự đặt 1 tên mô tả ngắn cho công việc đang làm (vd "sửa lỗi login")
        │
        ▼
2. ensure-thread.js "<tên do Claude đặt>"
     - Đọc CLAUDE_CODE_SESSION_ID = X từ môi trường (không cần truyền tay)
     - Tra session-map.json theo mã X:
         + Có sẵn threadId → dùng lại (tên hiển thị có thể cập nhật hoặc
           giữ nguyên, không ảnh hưởng định tuyến)
         + Chưa có → tạo thread mới trên Discord với tiêu đề = tên Claude
           vừa đặt, lưu { X: { name, threadId } } vào session-map.json
     - LUÔN gửi 1 tin nhắn mặc định vào thread ngay sau bước này
       (vd: "🟢 Session '<tên>' đã kết nối.") — dù thread mới tạo hay
       dùng lại thread cũ, đây là bước bắt buộc, không có điều kiện bỏ qua
3. Kiểm tra active-listener.json (pid + heartbeat):
     - còn sống & heartbeat mới → dùng luôn
     - chết/hết hạn → khởi động lại discord-listener.js (nền, sống liên tục)
4. Tạo thư mục rỗng inbox/<X>/ nếu chưa có
5. Bắt đầu vòng lặp: gọi listen-message.js (nền) → chờ task-notification
```

### 6.2. Nhận và xử lý tin nhắn

```
Tin nhắn Discord gửi vào đúng thread của session X
        │
        ▼
discord-listener.js nhận qua Gateway → tra threadId → tìm ra mã X tương ứng
   (tra ngược session-map.json theo threadId)
        │
        ▼
ghi 1 file mới vào inbox/<X>/ (kiểu maildir)
        │
        ▼
listen-message.js (đang chạy trong đúng session X, tự đọc CLAUDE_CODE_SESSION_ID
   để biết đọc đúng inbox/<X>/) phát hiện file mới
   → đọc, in JSON, xoá file → thoát → harness đánh thức đúng phiên Claude
        │
        ▼
Claude xử lý → send.js "..." (tự tra threadId theo X, gọi REST thẳng)
   → Claude tự gọi lại listen-message.js để tiếp tục chờ
```

### 6.3. Nhiều session trong cùng project

- Chiều nhận dùng chung 1 `discord-listener.js`. Mỗi session độc lập ở tầng
  xử lý: thư mục `inbox/<CLAUDE_CODE_SESSION_ID>/` riêng, `listen-message.js`
  của từng cuộc hội thoại tự đọc đúng thư mục của chính nó — session A bận
  không chặn session B nhận tin. Không có khái niệm "chiếm tên" vì tên không
  dùng để định tuyến.
- Chiều gửi (`send.js`) độc lập với listener và với session khác hoàn toàn.

### 6.4. Nhiều project chạy song song

- Không đổi: mỗi project có `discord-listener.js` riêng, không chia sẻ gì
  với project khác.

## 7. Ngắt kết nối

### 7.1. Khi nào ngắt

1. **Người dùng yêu cầu tường minh** trong đúng cuộc chat đó (vd "ngắt kết
   nối discord đi") — cách chính, luôn chủ động, không tự động.
2. **Cuộc hội thoại tự nhiên kết thúc** (đóng cửa sổ/hết phiên) — tiến trình
   `listen-message.js` đang chờ ở nền là tiến trình con của đúng phiên đó,
   tự bị dọn theo vòng đời tiến trình khi phiên chấm dứt, không cần code
   thêm.

Không có nhánh "tự động ngắt sau X phút không hoạt động" — giữ đúng nguyên
tắc chỉ hành động khi được bảo (mục 2).

### 7.2. Ngắt 1 session cụ thể

```
Người dùng: "ngắt kết nối discord đi"
        │
        ▼
1. Dừng vòng lặp: không tự gọi lại listen-message.js nữa
2. Nếu đang có 1 tiến trình listen-message.js chờ ở nền → dừng nó
3. Gửi 1 tin nhắn thông báo vào thread qua REST (đối xứng với lúc kết nối):
     "🔴 Session '<tên>' đã ngắt kết nối."
4. Xoá entry của session này khỏi active-sessions.json (registry "đang sống")
```

`session-map.json` (mã ↔ tên ↔ threadId) **giữ nguyên, không xoá** — nếu sau
này resume đúng cuộc hội thoại này, `CLAUDE_CODE_SESSION_ID` không đổi nên
vẫn nối lại đúng thread cũ, không tạo thread mới/trùng lặp.

### 7.3. Ngắt toàn bộ project (dừng hẳn `discord-listener.js`)

Ảnh hưởng tới **mọi session khác** đang dùng chung listener, nên cần thận
trọng hơn hẳn ngắt 1 session — không được coi là hệ quả ngầm định của việc 1
session tự ngắt.

```
Người dùng: "ngắt toàn bộ discord của project này"
        │
        ▼
1. Đọc active-sessions.json → liệt kê các session đang thực sự sống
2. Còn session khác (không phải session hiện tại) đang sống?
     - Có → CẢNH BÁO trước khi làm: "còn N session khác đang kết nối,
       dừng cả project sẽ ngắt luôn các session đó, xác nhận chứ?"
     - Không / đã xác nhận → tiếp tục
3. Kill discord-listener.js (theo pid trong active-listener.json)
4. Xoá active-listener.json
```

`session-map.json` vẫn giữ nguyên — chỉ là dữ liệu ánh xạ, không phải trạng
thái "đang chạy", không cần xoá khi dừng listener.

## 8. Relay xin quyền (permission prompt) qua Discord

Bổ sung sau khi test thật phát hiện: bridge ban đầu chỉ relay **chat**, không
relay **permission prompt** (khi Claude Code cần xin phép chạy tool). Người
dùng ngồi ở Discord không thấy/không duyệt được prompt đó vì nó chỉ hiện ở
giao diện gốc (VSCode). Yêu cầu đã chốt với người dùng: **bám sát đúng cơ chế
gốc của Claude Code** — Claude hỏi quyền lúc nào thì relay lúc đó, Claude
không hỏi thì không gửi gì, hết hạn chờ thì để cơ chế fail-open gốc của
Claude Code tự xử lý (không tự chế thêm luật riêng).

### 8.1. Cơ chế dùng: hook `PermissionRequest`

Xác nhận qua tài liệu chính thức (`https://code.claude.com/docs/en/hooks.md`):
- Hook `PermissionRequest` **chỉ fire đúng lúc Claude Code sắp hiện permission
  prompt** — tool đã được auto-allow theo permission-mode/rule sẵn có thì hook
  này không chạy, khỏi phải tự lọc thêm ở tầng ứng dụng.
- Input (stdin, JSON): `session_id`, `tool_name`, `tool_input`, `permission_mode`,
  `tool_use_id`, ...
- Output (stdout, JSON, khi exit code 0):
  `{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": "allow"|"deny"|"escalate", "reason": "..."}}`
  - `escalate` = đẩy về hỏi bình thường ở giao diện gốc (dùng khi câu trả lời
    trên Discord không rõ ràng).
- **Fail-open theo đúng thiết kế gốc của Claude Code**: hook crash, in JSON
  sai định dạng, hoặc **hết timeout** (mặc định 600s, có thể chỉnh bằng field
  `timeout` trong cấu hình hook) → Claude Code tự rơi về luồng permission bình
  thường (hiện prompt ở VSCode như chưa có bridge), **không** treo cứng,
  không tự ý cho phép bừa. Đây chính là hành vi "hết hạn thì theo cơ chế của
  Claude" mà người dùng yêu cầu — không cần code thêm logic timeout riêng,
  chỉ cần không trả lời gì khi hết giờ chờ Discord là tự động fail-open đúng
  chuẩn.

### 8.2. Vấn đề định tuyến: câu trả lời duyệt quyền vs tin nhắn chat thường

Cả 2 đều là tin nhắn text trong cùng 1 thread, cần tách luồng để
`listen-message.js` (vòng lặp chat) không nuốt nhầm câu trả lời duyệt quyền,
và ngược lại.

Giải pháp: đánh dấu "đang chờ duyệt quyền" bằng 1 file cờ dùng 1 lần.

```
pending-approval/<CLAUDE_CODE_SESSION_ID>.json   # { promptId, askedAt } - hook tạo lúc hỏi
approvals/<CLAUDE_CODE_SESSION_ID>/               # maildir riêng cho câu trả lời duyệt quyền
```

- `permission-relay.js` (script chạy bởi hook) tạo file cờ `pending-approval/<mã>.json`
  trước khi gửi câu hỏi vào thread, rồi poll thư mục `approvals/<mã>/` chờ trả lời.
- `discord-listener.js`: mỗi khi nhận tin nhắn, sau khi tra ra `sessionId` từ
  `threadId` như bình thường, kiểm tra thêm có file cờ `pending-approval/<mã>.json`
  không:
  - Có → đây là tin trả lời cho permission prompt: ghi vào `approvals/<mã>/`
    (không ghi vào `inbox/<mã>/`), **xoá file cờ ngay** (dùng 1 lần) để tin
    nhắn kế tiếp trở lại route bình thường vào `inbox/`.
  - Không có → route như cũ, vào `inbox/<mã>/`.
- `permission-relay.js` đọc được file trong `approvals/<mã>/` → parse ý định:
  chứa các từ như "y", "yes", "allow", "ok", "được", "đồng ý", "duyệt" → `allow`;
  chứa "n", "no", "deny", "không", "từ chối" → `deny`; không rõ → `escalate`
  (đẩy về hỏi lại ở VSCode, an toàn hơn là đoán bừa).

### 8.3. Nội dung tin nhắn hỏi quyền gửi lên Discord

```
⚠️ [Xin quyền] Session '<tên>' muốn dùng tool '<tool_name>':
```<tool_input rút gọn còn tối đa ~1500 ký tự, dạng JSON>```
Trả lời 'y' để đồng ý, 'n' để từ chối. Không trả lời kịp thì prompt sẽ tự
hiện lại ở VSCode như bình thường.
```

### 8.4. Rủi ro triển khai — vì sao phải test tách biệt trước khi bật thật

Hook cấu hình trong `.claude/settings.json` (hoặc `.claude/settings.local.json`)
là **áp dụng cho toàn bộ project, mọi session**, không chỉ session đang nối
Discord. Sai sót trong `permission-relay.js` có thể ảnh hưởng đến trải nghiệm
xin quyền của MỌI phiên Claude Code đang chạy trong repo này, kể cả các
session không liên quan gì tới Discord (dù cơ chế fail-open ở 9.1 đã giảm
thiểu rủi ro treo cứng, không loại bỏ hoàn toàn rủi ro logic sai). Vì vậy quy
trình bắt buộc trước khi bật thật:
1. Test `permission-relay.js` độc lập bằng cách tự đưa JSON giả vào stdin
   (không đụng `settings.json`) — kiểm tra đủ nhánh: session không kết nối
   Discord (phải im lặng, không in gì), session có kết nối + trả lời allow/
   deny/không rõ, hết thời gian chờ.
2. Chỉ sau khi bước 1 pass hết mới thêm hook vào `settings.json` và test thật
   bằng 1 tool call thật trong session đang nối Discord.
3. Nếu có bất kỳ dấu hiệu bất thường ở bước 2 (hook không fire đúng lúc, ăn
   sai định dạng...), gỡ ngay khỏi `settings.json` trước khi tìm hiểu tiếp -
   ưu tiên không để ảnh hưởng các session khác.

## 9. Vẫn ngoài phạm vi / rủi ro chưa xử lý

- **Đồng bộ `session-map.json` với thực tế trên Discord** (thread bị xoá /
  đổi tên thủ công trên Discord) — chưa có cơ chế phát hiện & tự phục hồi.
- **DM** không có khái niệm thread, cần nhánh riêng nếu muốn giữ.
- **Quyền bot**: cần `Create Public Threads` + `Send Messages in Threads`
  trên channel cha của từng project, ngoài quyền View/Send hiện có.
- **Giới hạn 2000 ký tự/tin của Discord** khi nội dung trả lời dài — cần
  logic chia nhỏ trong `send.js`, chưa thiết kế chi tiết cách chia (theo
  dòng? theo đoạn?).
- **Dọn dẹp session cũ**: `session-map.json`/`inbox/` sẽ phình dần theo số
  cuộc hội thoại đã từng kết nối — chưa có cơ chế dọn định kỳ cho các
  `CLAUDE_CODE_SESSION_ID` đã hết hạn/không còn dùng.

## 10. Đã test thật (không phải giả lập)

Tạo thread thật, gửi tin xác nhận thật, người dùng gõ tin nhắn thật vào
thread và `discord-listener.js` nhận + ghi đúng inbox, `listen-message.js`
lấy đúng thứ tự FIFO, `send.js` gửi và tự chia tin >2000 ký tự, self-filter
đúng tin nhắn của chính bot, `disconnect.js session` kill đúng tiến trình
đang chờ + gửi tin ngắt + giữ nguyên `session-map.json` để resume lại đúng
thread cũ, `disconnect.js project` cảnh báo đúng khi còn session khác sống
và kill đúng listener khi `--confirm`. Thread test đã được archive/đổi tên
trên Discord (bot không có quyền xoá hẳn thread - `Manage Threads`).
