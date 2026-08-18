---
name: claude-easy-discord-bridge
description: Cầu nối Discord cho Claude Code — mỗi project 1 channel, mỗi session (cuộc chat) 1 thread riêng, dùng khi người dùng yêu cầu kết nối/gửi/nhận tin nhắn qua Discord cho phiên đang chạy.
allowed-tools:
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/*.js)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/*.js *)
---

Cầu nối Discord 2 chiều cho đúng 1 session Claude Code đang chạy: mỗi
project ↔ 1 channel, mỗi session (cuộc chat) ↔ 1 thread riêng trong channel
đó. Toàn bộ script thực thi nằm trong `scripts/`, luôn gọi qua
`${CLAUDE_SKILL_DIR}/scripts/<tên file>.js` (Claude Code tự thay thành đường
dẫn tuyệt đối của thư mục skill này) — không cần `cd` vào thư mục skill
trước, chạy đúng dù Bash đang ở cwd nào. Không tự truyền tay session id nào
cả — mọi script tự đọc `CLAUDE_CODE_SESSION_ID` từ môi trường Bash để biết
đang thao tác đúng session/thread nào.

**Mọi lệnh của skill này BẮT BUỘC gọi bằng Bash tool** — kể cả trên Windows,
không dùng PowerShell. Lý do: (1) `allowed-tools` của skill chỉ whitelist
dạng `Bash(...)`, gọi bằng shell khác sẽ bị hỏi quyền lại ở từng lệnh, phá
hỏng trải nghiệm điều khiển từ xa; (2) Windows PowerShell 5.1 truyền tham số
cho `node.exe` theo ANSI codepage, nội dung tiếng Việt có dấu và emoji dễ bị
hỏng khi gửi lên Discord.

Thiết kế/kiến trúc đầy đủ (không cần đọc để dùng skill, chỉ cần khi sửa
code): xem [architecture.md](docs/claude-easy-discord-bridge-architecture.md).

## Cài đặt lần đầu (chỉ 1 lần cho mỗi project)

**Yêu cầu: Node.js >= 18** (kiểm tra bằng `node -v`) — các script gọi Discord
REST bằng `fetch` toàn cục, chỉ có sẵn từ Node 18. Node 16 trở xuống sẽ lỗi
`fetch is not defined`.

```
cd .claude/skills/claude-easy-discord-bridge
npm install
```

Tạo file `.env` ngay trong thư mục skill này, khai báo `DISCORD_BOT_TOKEN`,
`DISCORD_SERVER_ID`, `DISCORD_CHANNEL_ID`, `ALLOWED_USER_IDS` (nhiều user thì
cách nhau bởi dấu phẩy, ví dụ `111,222,333`).

## Khi nào dùng skill này

Chỉ hành động khi người dùng yêu cầu **tường minh** trong đúng cuộc chat đó
(vd "kết nối discord đi", "ngắt kết nối discord đi"). Không tự động kết nối,
không tự động ngắt kết nối trong bất kỳ trường hợp nào khác.

## Luồng hoạt động — làm đúng thứ tự sau

### 1. Kết nối

Tự đặt 1 tên mô tả ngắn cho việc đang làm (vd "sửa lỗi đăng nhập"), rồi gọi:

```
node ${CLAUDE_SKILL_DIR}/scripts/ensure-thread.js "<tên mô tả ngắn>"
```

Script này tự lo hết: tạo thread mới hoặc dùng lại đúng thread cũ của session
này, dọn sạch tin rác còn sót trong inbox từ lần kết nối trước, gửi 1 tin xác
nhận vào thread, và tự khởi động lại listener dùng chung nếu nó chưa chạy
hoặc đã chết.

### 2. Chờ tin nhắn kế tiếp từ Discord

```
node ${CLAUDE_SKILL_DIR}/scripts/listen-message.js
```

**BẮT BUỘC gọi qua Bash với `run_in_background: true`** — không gọi đồng bộ,
không kèm `timeout` cố định. Script này không có timeout nội bộ: tự chờ vô
hạn tới khi có tin nhắn mới, in ra đúng 1 dòng JSON (`messageId`, `content`,
...) rồi tự thoát. Nếu gọi đồng bộ kèm `timeout`, hết giờ mà chưa có tin thì
bash tool sẽ huỷ lệnh giữa chừng — mất `task-notification`, Claude không
được đánh thức lại khi tin nhắn thật sự tới. Chạy nền không chặn việc gửi
tin — `send.js` gọi được bất cứ lúc nào kể cả khi `listen-message.js` đang
chờ ở nền.

**Ngay khi nhận được `task-notification` kèm JSON của bước này (TRƯỚC KHI
làm bất cứ việc gì khác)**: gọi lại `listen-message.js` (nền) một lần nữa
ngay lập tức để tiếp tục chờ tin kế tiếp — không đợi xử lý xong tin vừa nhận
mới gọi lại. Nhờ vậy nếu người dùng gửi tiếp 1 tin khác trong lúc Claude
đang xử lý tin này, Claude vẫn được báo ngay chứ không bị im lặng chờ đến khi
xử lý xong tin hiện tại.

### 3. Xử lý tin nhắn vừa nhận được

```
node ${CLAUDE_SKILL_DIR}/scripts/react.js <messageId> start
```
react 🤔 lên đúng tin nhắn gốc để báo đang xử lý (dùng `messageId` từ JSON ở
bước 2).

Xử lý yêu cầu của người dùng trong tin nhắn như bình thường, rồi trả lời:

```
node ${CLAUDE_SKILL_DIR}/scripts/send.js "<nội dung trả lời>"
```

```
node ${CLAUDE_SKILL_DIR}/scripts/react.js <messageId> done
```
gỡ 🤔, react ✅ — gọi trước hoặc ngay sau `send.js`, không phụ thuộc thời
lượng xử lý tin nhắn.

### 4. Vòng lặp tiếp tục tự nhiên

Vì bước 2 đã tự gọi lại `listen-message.js` (nền) ngay khi nhận tin — trước
khi xử lý — nên lúc đang làm bước 3 thì listener đã sẵn sàng chờ tin kế tiếp
rồi, không cần làm gì thêm ở đây. Khi `task-notification` tiếp theo tới,
quay lại bước 2 → 3 như cũ. Chỉ dừng hẳn vòng lặp (không re-arm
`listen-message.js` nữa) khi người dùng yêu cầu ngắt kết nối.

## Ngắt kết nối

- **Ngắt session hiện tại** (chỉ ảnh hưởng đúng session đang chat, không đụng
  session khác):
  `node ${CLAUDE_SKILL_DIR}/scripts/disconnect.js session`
- **Ngắt cả project** (kill listener dùng chung cho MỌI session của project
  này — script tự cảnh báo nếu còn session khác đang sống; cần thêm
  `--confirm` để vẫn tiếp tục sau khi đã thấy cảnh báo):
  `node ${CLAUDE_SKILL_DIR}/scripts/disconnect.js project [--confirm]`

## Hỏi nhiều lựa chọn (kiểu `AskUserQuestion`) khi đang nối Discord

`AskUserQuestion` chỉ hiện ở giao diện gốc (VSCode/CLI) — người dùng đang
theo dõi qua Discord sẽ không thấy tool đó. Khi cần hỏi người dùng chọn giữa
nhiều phương án trong lúc đang nối Discord, làm thêm bước sau (có thể song
song với việc vẫn gọi `AskUserQuestion` như bình thường để giữ cả 2 kênh):

1. Soạn câu hỏi + liệt kê các lựa chọn đánh số (1, 2, 3...) kèm mô tả ngắn,
   gửi bằng `node ${CLAUDE_SKILL_DIR}/scripts/send.js "<câu hỏi>\n1. ...\n2. ...\n3. ..."`.
2. Gọi lại `listen-message.js` (nền) chờ trả lời, đúng như vòng lặp chat
   bình thường ở bước 2-4.
3. Người dùng có thể trả lời bằng số ("2") hoặc gõ thẳng nội dung lựa chọn —
   tự diễn giải linh hoạt, không cần khớp chính xác chuỗi.

Việc này không cần thêm hook hay cơ chế riêng — dùng lại đúng `send.js`/
`listen-message.js` đã có sẵn, vì đây là Claude chủ động hỏi.

## Quy tắc bắt buộc — đừng tự ý đổi

- Không tự động kết nối/ngắt kết nối — chỉ khi người dùng yêu cầu tường minh.
- Luôn gọi script bằng Bash tool, không dùng PowerShell (lý do ở đầu file).
- Giữ nguyên luồng tuần tự `react start` (chờ xong) → `send.js` → `react
  done` (chờ xong). Không gộp các lệnh này chạy song song/fire-and-forget để
  "tối ưu tốc độ" — đã thử và bị yêu cầu revert vì gây lỗi thật (rate limit,
  báo trạng thái sai). Không tối ưu lại theo hướng này trừ khi được yêu cầu
  tường minh.
- Không đi tối ưu cơ chế đọc inbox (`fs.watch`/`POLL_INTERVAL_MS`) — không
  phải nguồn độ trễ đáng kể của cầu nối này.

Lý do, số liệu đo thật, và toàn bộ quyết định thiết kế đứng sau các quy tắc
trên: xem [architecture.md](docs/claude-easy-discord-bridge-architecture.md).
