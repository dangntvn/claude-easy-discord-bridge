# Claude Easy Discord Bridge

*(tên kỹ thuật của skill/thư mục: `claude-easy-discord-bridge`, repo cũ có tên
`claude-multi-session-to-discord`)*

Repo này **chỉ chứa đúng 1 skill**: `.claude/skills/claude-easy-discord-bridge/`.
Không có code nào khác ngoài skill đó — không thêm src/, app/, server/... ở gốc
repo trừ khi được yêu cầu tường minh.

## Việc này là gì

Cầu nối Discord cho Claude Code: mỗi project ↔ 1 channel Discord, mỗi session
(cuộc chat) ↔ 1 thread riêng trong channel đó. Cho phép gửi/nhận tin nhắn với
Claude Code đang chạy ngay từ Discord (kể cả từ điện thoại).

## Nguồn sự thật (đọc trước khi sửa bất cứ gì)

1. [.claude/skills/claude-easy-discord-bridge/SKILL.md](.claude/skills/claude-easy-discord-bridge/SKILL.md) —
   cách dùng skill (lệnh, thứ tự gọi, quy tắc bắt buộc).
2. [.claude/skills/claude-easy-discord-bridge/docs/claude-easy-discord-bridge-architecture.md](.claude/skills/claude-easy-discord-bridge/docs/claude-easy-discord-bridge-architecture.md) —
   đặc tả kiến trúc đầy đủ (thành phần, luồng kết nối/gửi/nhận/ngắt, lý do
   từng quyết định thiết kế, các thứ đã thử và bị revert).

Trạng thái: **đã code xong, đã test end-to-end thật với Discord thật** (không
phải mock). Trước khi đổi cách gửi/nhận tin (vd định gộp REST call lại cho
nhanh, định đổi cơ chế poll/`fs.watch`), đọc kỹ mục "Hiệu năng" trong 2 file
trên — đã thử và bị người dùng yêu cầu revert vì gây race condition/429 rate
limit, đừng làm lại trừ khi được yêu cầu tường minh.

## Quy tắc khi sửa code trong skill này

- Định danh/định tuyến session luôn dùng `CLAUDE_CODE_SESSION_ID` (biến môi
  trường Claude Code tự cấp), không tự sinh mã riêng, không dùng tên hiển thị
  để tra cứu.
- Chiều gửi (`send.js`) độc lập hoàn toàn với chiều nhận (`discord-listener.js`)
  — gọi REST trực tiếp, không qua Gateway.
- Không tự động khởi động bridge hay tự động ngắt kết nối — chỉ hành động khi
  người dùng yêu cầu tường minh trong đúng cuộc chat đó.
- `.env` (token bot, id server/channel, danh sách user được phép) không commit
  — đã có trong `.gitignore` cùng `node_modules/` và `.data/`. Không bao giờ
  in nội dung `.env` ra ngoài hay đưa vào commit.
