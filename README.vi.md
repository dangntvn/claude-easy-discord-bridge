<div align="center">

# 🌉 Claude Easy Discord Bridge

*(tên kỹ thuật của skill/thư mục: `claude-easy-discord-bridge`)*

[English](README.md) · **Tiếng Việt** · [日本語](README.ja.md) · [中文](README.zh.md)

**Điều khiển Claude Code ngay trên Discord — kể cả từ điện thoại.**

Skill cho [Claude Code](https://claude.com/claude-code) biến mỗi session
đang chạy thành một cuộc trò chuyện Discord: nhắn tin, xem tiến độ — mọi lúc,
mọi nơi, không cần ngồi trước VSCode. Chạy **nhiều việc, nhiều dự án cùng
một lúc** vẫn tách bạch rõ ràng, không lo nhầm lẫn.

</div>

---

## 📌 Vì sao cần cái này?

Claude Code mặc định chỉ chạy được trong 1 cửa sổ terminal/VSCode — bạn phải
ngồi đó chờ, hoặc mất kết nối với session ngay khi rời máy. Skill này giải
quyết đúng vấn đề đó.

> 🔌 **Đặc biệt:** không cần chuẩn bị hay cấu hình gì trước. Đang chat dở
> với Claude giữa chừng một việc, chỉ cần gõ ngay **"hãy kết nối discord"**
> trong đúng cuộc trò chuyện đó là nối được luôn — không cần dừng việc đang
> làm, không cần mở lại từ đầu. Đây là điều **chỉ riêng skill này làm
> được**: hầu hết plugin/bot Discord khác bắt bạn phải khởi tạo phiên làm
> việc thông qua chúng ngay từ đầu, không "gắn" được Discord vào giữa một
> cuộc trò chuyện đang chạy dở.

| Không có skill | Có Claude Easy Discord Bridge |
|---|---|
| Đang chat dở một việc với Claude, muốn dùng Discord phải dừng lại, mở phiên mới từ đầu | Gõ "kết nối discord" ngay giữa chừng công việc đang làm, không mất ngữ cảnh, không cần khởi động lại |
| Nhiều session chạy song song → dễ lẫn lộn cửa sổ nào là cửa sổ nào | Mỗi session 1 thread riêng, tên rõ ràng, không bao giờ nhầm |
| Nhiều project → nhiều chỗ phải mở, phải nhớ | Mỗi project 1 channel riêng, tách bạch hoàn toàn |
| Muốn hỏi Claude 1 câu nhanh phải mở lại IDE | Gõ thẳng vào Discord, Claude trả lời ngay trong thread |
| Phải ngồi trước máy để theo dõi Claude làm việc | Theo dõi & trả lời ngay trên điện thoại qua Discord |

## ✨ Tính năng chính

### 🧵 Làm nhiều việc, nhiều dự án cùng lúc — vẫn cực kỳ đơn giản
Đây là điểm mạnh nhất của skill: bạn có thể mở nhiều cuộc trò chuyện Claude
Code khác nhau (ví dụ vừa sửa lỗi ở dự án A, vừa viết báo cáo ở dự án B)
**cùng một lúc**, và trên Discord mọi thứ tự sắp xếp gọn gàng:

- Mỗi **dự án** hiện thành **1 kênh Discord riêng** — việc của dự án A không
  bao giờ lẫn vào dự án B.
- Trong mỗi kênh, mỗi **cuộc trò chuyện đang chạy** hiện thành **1 thread
  riêng**, tự đặt tên theo đúng việc đang làm (vd "sửa lỗi đăng nhập",
  "phân tích báo cáo") — mở bao nhiêu việc cùng lúc cũng không lo nhắn nhầm
  chỗ, chỉ cần vào đúng thread là đang nói chuyện với đúng việc đó.
- Không cần tự quản lý hay đặt tên gì thủ công — mọi việc sắp xếp tự động
  ngay khi bạn nói "kết nối Discord đi".

### 💬 Nhắn tin 2 chiều theo thời gian thực
Gõ tin nhắn vào thread Discord, Claude Code nhận và trả lời gần như ngay lập
tức — không cần polling chậm chạp, không cần refresh.

### ✅ Trạng thái xử lý rõ ràng bằng reaction
React 🤔 ngay khi bắt đầu xử lý tin nhắn, đổi thành ✅ khi xong — nhìn vào
Discord là biết ngay Claude đang bận hay đã trả lời.

### 🔁 Resume đúng thread cũ, không tạo trùng
Kết nối lại đúng session cũ (mở lại đúng cuộc chat) sẽ tự tìm lại đúng thread
đã tạo trước đó, không bao giờ sinh thread trùng lặp.

### 🚦 Ngắt kết nối linh hoạt
Ngắt riêng 1 session hoặc ngắt cả project (kèm cảnh báo nếu còn session khác
đang sống) — luôn chủ động, không có cơ chế tự động ngắt ngầm.

### ⚡ Nhanh, không phụ thuộc chồng chéo
Gửi tin dùng REST trực tiếp, không qua Gateway — chiều gửi không bao giờ bị
chặn dù chiều nhận đang gặp sự cố. Đã đo hiệu năng thật, không đoán mò.

## 🏆 Ưu điểm nổi bật

- **🔌 Cài một lần, dùng mãi — kết nối ngay giữa chừng công việc, không cần
  chuẩn bị trước.** Chỉ cần cài đặt đúng 1 lần. Sau đó, bất cứ lúc nào —
  kể cả khi đang chat dở với Claude ở giữa một việc đang làm — chỉ cần gõ
  **"hãy kết nối discord"** ngay trong chính cuộc trò chuyện đó là nối luôn,
  không cần dừng việc đang làm, không cần mở lại từ đầu, không cần cấu hình
  gì thêm. Đây là điểm **chỉ riêng skill này làm được**: các plugin/bot
  Discord khác thường yêu cầu bạn khởi tạo phiên làm việc thông qua chúng
  ngay từ đầu — không hỗ trợ "gắn" Discord vào một cuộc trò chuyện **đang
  làm việc dở**.

- **📱 Làm việc từ xa thật sự, không chỉ nhận thông báo suông.** Tính năng
  báo thông báo lên điện thoại có sẵn của Claude Code chỉ để bạn *biết* là
  Claude cần gì đó — muốn trả lời vẫn phải quay lại đúng máy tính đang mở.
  Với skill này, bạn **trả lời và tiếp tục sai việc ngay trên điện thoại**,
  y như đang ngồi trước máy tính gõ lệnh.

- **🗂️ Không bao giờ nhầm việc, dù đang chạy nhiều việc cùng lúc.** Mỗi
  cuộc trò chuyện Claude Code là một thread riêng biệt, đặt tên rõ ràng theo
  đúng việc đang làm (vd "sửa lỗi đăng nhập", "viết báo cáo"). Đang chạy 3-4
  việc song song vẫn tách bạch rõ ràng, không lo trả lời nhầm cuộc trò
  chuyện này sang việc khác.

- **🏢 Nhiều dự án, mỗi dự án một khu riêng.** Nếu bạn làm nhiều dự án khác
  nhau, mỗi dự án hiện ra một kênh Discord riêng — không bị trộn lẫn việc
  của dự án này với dự án kia.

- **⚡ Trả lời nhanh, không phải chờ đợi hay tải lại.** Gõ xong tin nhắn là
  Claude nhận được gần như ngay lập tức, không cần bấm nút refresh hay chờ
  vòng lặp kiểm tra chậm chạp.

- **✅ Nhìn một cái là biết Claude đang bận hay đã xong.** Mỗi tin nhắn bạn
  gửi sẽ tự có biểu tượng 🤔 khi Claude đang xử lý và đổi thành ✅ khi xong —
  không cần hỏi lại "xong chưa?".

- **🔒 Riêng tư, không qua bên thứ ba.** Toàn bộ tin nhắn đi thẳng giữa máy
  bạn và Discord của chính bạn — không có máy chủ trung gian nào khác lưu
  hay đọc được nội dung trò chuyện.

- **🧠 Không cần biết kỹ thuật để dùng.** Chỉ cần gõ đúng 1 câu **"kết nối
  Discord đi"**, mọi thứ còn lại Claude tự lo — không cần chạy lệnh, không
  cần hiểu cách nó hoạt động bên trong.

- **🔁 Cài một lần, dùng mãi.** Thiết lập ban đầu chỉ mất vài phút, sau đó
  mọi cuộc trò chuyện mới đều tự động sẵn sàng kết nối Discord mà không cần
  làm lại từ đầu.

## ⚖️ So với plugin Discord chính thức (`discord@claude-plugins-official`)

Anthropic cũng có plugin Discord chính thức (MCP server chạy trên Bun, tích
hợp qua `claude --channels`). Skill này chọn hướng khác, đơn giản và bám sát
đúng nhu cầu multi-project/multi-session hơn:

- **Gắn Discord vào ngay 1 cuộc trò chuyện đang làm việc dở.** Chỉ cần gõ
  "hãy kết nối discord" ngay trong session đang chạy là xong — không cần
  biết trước sẽ cần Discord, không cần khởi động lại hay cấu hình gì trước
  khi bắt đầu việc. Plugin chính thức (và hầu hết bot Discord khác) yêu cầu
  thiết lập kênh/phiên làm việc thông qua chúng ngay từ đầu.
- **Tự động map 1 project ↔ 1 channel, 1 session ↔ 1 thread.** Plugin chính
  thức không có cơ chế này sẵn — phải tự quản lý threading bằng `reply_to`
  thủ công.
- **Gửi/nhận tách rời hoàn toàn.** `send.js` gọi REST trực tiếp, độc lập
  100% với chiều nhận — kể cả khi listener nhận tin đang gặp sự cố, gửi tin
  vẫn không bao giờ bị chặn. Plugin chính thức gộp chung trong 1 MCP server.
- **Không cần Bun, không cần MCP, không cần cờ `--channels`.** Chỉ cần
  Node.js >= 18 sẵn có + `npm install` trong đúng thư mục skill.
- **Cài đặt tối giản.** Một file `.env` khai báo token + ID, không cần chạy
  slash command cấu hình (`/discord:configure`, `/discord:access ...`) hay
  qua bước pairing code.
- **Đã đo hiệu năng thật trên máy, không đoán mò** (node khởi động ~85ms,
  1 REST call Discord ~0.4–0.66s, `fs.watch` phát hiện tin mới ~14ms) — và đã
  từng thử tối ưu bằng gộp REST call rồi bị revert vì gây race condition/429,
  nên hướng thiết kế hiện tại đã được kiểm chứng thực tế thay vì lý thuyết.
- **Gắn liền với từng project, không phải cấu hình toàn cục.** Muốn dùng ở
  project khác chỉ cần copy nguyên thư mục skill sang, không ảnh hưởng cấu
  hình Claude Code toàn máy.

## 🖼️ Demo

![Demo](.claude/skills/claude-easy-discord-bridge/assets/demo.png)

## 🏗️ Kiến trúc tổng quan

```
Project A                              Project B
   │                                       │
   ├─ Channel Discord A                    ├─ Channel Discord B
   │    ├─ Thread: session 1               │    ├─ Thread: session 1
   │    └─ Thread: session 2               │    └─ Thread: session 2
   │                                       │
   └─ discord-listener.js (1 tiến trình)   └─ discord-listener.js (1 tiến trình)
        dùng chung cho mọi session              dùng chung cho mọi session
```

Chi tiết đầy đủ (thành phần, luồng kết nối/gửi/nhận/ngắt, lý do từng quyết
định thiết kế, số liệu hiệu năng đo thật): xem
[docs/claude-easy-discord-bridge-architecture.md](.claude/skills/claude-easy-discord-bridge/docs/claude-easy-discord-bridge-architecture.md).

## 🚀 Cài đặt

**Yêu cầu: Node.js >= 18** (kiểm tra bằng `node -v`). Các script gọi Discord
REST bằng `fetch` toàn cục, chỉ có sẵn từ Node 18 — Node 16 trở xuống sẽ lỗi
`fetch is not defined`.

```bash
cd .claude/skills/claude-easy-discord-bridge
npm install
```

Tạo file `.env` ngay trong thư mục skill này:

```env
DISCORD_BOT_TOKEN=...
DISCORD_SERVER_ID=...
DISCORD_CHANNEL_ID=...
ALLOWED_USER_IDS=111,222,333
```

Bot Discord cần:
- Quyền: `View Channel`, `Send Messages`, `Create Public Threads`,
  `Send Messages in Threads` trên channel cha.
- Bật **Message Content Intent** trong Discord Developer Portal.

> Muốn dùng cho project khác? Chỉ cần copy nguyên thư mục
> `.claude/skills/claude-easy-discord-bridge/` sang `.claude/skills/`
> của project đó rồi cấu hình lại `.env`.

## 🎮 Cách dùng

Không cần tự tay chạy script — chỉ cần yêu cầu Claude:

> "Kết nối Discord đi"

Claude sẽ tự đọc skill và thực hiện đúng chuỗi lệnh cần thiết
(`ensure-thread.js` → `listen-message.js` → `send.js` → `react.js`), tự lặp
lại vòng nghe/trả lời cho tới khi bạn yêu cầu ngắt kết nối. Các lệnh này luôn
chạy qua Bash (kể cả trên Windows — không dùng PowerShell, vì PowerShell 5.1
dễ làm hỏng tiếng Việt có dấu/emoji khi truyền tham số cho `node.exe`). Chi tiết đầy đủ
về lệnh và quy tắc bắt buộc: xem
[SKILL.md](.claude/skills/claude-easy-discord-bridge/SKILL.md).

## ✅ Trạng thái

Đã code xong và **test end-to-end thật với Discord thật** (không phải mock):
tạo thread, gửi/nhận tin, react, ngắt/resume session đều đã chạy đúng.

## 📄 License

Phát hành theo [Apache License 2.0](LICENSE) — dùng, sửa, phân phối lại tự
do, kể cả cho mục đích thương mại, miễn giữ nguyên thông báo bản quyền.

## 👤 Tác giả

**dangntvn** — [dangnt.vn@gmail.com](mailto:dangnt.vn@gmail.com)
