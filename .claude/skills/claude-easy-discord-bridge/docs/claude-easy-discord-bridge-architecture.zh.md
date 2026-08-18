# 标准化架构：Discord bridge 的 Project ↔ Channel ↔ Session ↔ Thread 模式

[English](claude-easy-discord-bridge-architecture.md) · [Tiếng Việt](claude-easy-discord-bridge-architecture.vi.md) · [日本語](claude-easy-discord-bridge-architecture.ja.md) · **中文**

状态：**代码已完成，并且用真实的 Discord 做过端到端测试**（不是 mock）——
创建 thread、真实收发消息、断开/恢复、relay permission prompt 都已验证可以
正常运行。已打包成 skill `claude-easy-discord-bridge`
（`.claude/skills/claude-easy-discord-bridge/`），而不是像旧的 `discord-bridge/`
目录那样零散放置。脚本按照 Anthropic 的 skill 目录规范放在 `scripts/` 下
（见第 3 节）。本文档是架构说明书，附带设计理由——是根据实际代码更新的，而
不是写代码之前的草稿。已经拍板的决策：

1. 不使用"tag"——**thread 名称由 Claude 自己在连接时命名**（不是用户手动
   输入的），但**名称只用于显示，绝不用于路由/管理**。
2. **每个 project 只有 1 个进程监听 WebSocket Gateway**，所有 session 共用。
3. **【已拍板】** 用于路由/管理的 session 标识**不再自行生成**——直接使用
   `CLAUDE_CODE_SESSION_ID`，这是**Claude Code 自动为当前正在运行的对话分
   配的**环境变量，已确认真实存在（在本次 session 中通过 `env` 就能读到：
   `CLAUDE_CODE_SESSION_ID=b41c7c22-...`）。由于这个 UUID 是系统分配的、
   对每一场对话都绝对唯一，**不再存在两个不同的 Claude 窗口争抢同一个
   session 的风险**——之前提到的"归属权（ownership）"问题自然就消失了，不
   需要再额外加任何锁文件。
4. Queue 采用 **maildir** 模式（1 个文件 = 1 条消息）——不需要自己写文件锁
   机制。
5. **【已拍板】** 发消息**直接通过 1 条 HTTP 命令走 REST API**（比如
   `curl`），不经过 `discord-listener.js`，不经过 `discord.js`，不需要
   Gateway/login。
6. **无论是首次连接（创建 thread）还是重新连接，都必须立刻往 thread 里发
   一条默认消息**——用来确认连接成功，并让用户在 Discord 上马上知道 session
   已经就绪。

## 1. 原始需求

1. 每个 **project** ↔ 一个专属的 **Discord channel**。
2. 每个 **session**（具体的一场 Claude Code 对话）↔ 该 channel 下的**一个
   专属 thread**。
3. 不同 project 使用不同的 channel，各自独立并行运行。
4. 只有在被明确要求时才连接 Discord。
5. 连接 session 时如果 thread 还不存在 → 自动创建；已存在 → 复用。
6. 无论是新建还是复用连接（无论是新建还是复用 thread），**连接时默认都要
   往 thread 发一条消息**以作确认。

## 2. 硬性原则

- **不自动启动 bridge**——只有收到明确命令时才运行。
- **不在多个 project 之间共享状态**——每个 project 都使用自己那份独立的
  `.claude/skills/claude-easy-discord-bridge/`。
- **每个 project 在任意时刻最多只能有 1 个存活的 Gateway 连接。**
- **标识/路由始终使用编号（`CLAUDE_CODE_SESSION_ID`），绝不使用名称。** 名
  称只是 Discord 上显示用的标签，由 Claude 在连接时自行设定（简要描述正在
  做的事，比如"修复登录问题"、"分析 HPG"），没有唯一性约束，也不用于查找。

## 3. 组件

```
.claude/skills/claude-easy-discord-bridge/
  .env                       # DISCORD_BOT_TOKEN, SERVER_ID, CHANNEL_ID, ALLOWED_USER_IDS
  scripts/
    lib.js                    # 通用辅助函数（读取 .env、原子方式读写 JSON、
                              #   读取 CLAUDE_CODE_SESSION_ID、调用 Discord REST）
    discord-listener.js        # 每个 project 唯一的 1 个进程，持续存活，
                              #   保持 1 个 Gateway 连接，只负责接收方向
    ensure-thread.js           # 单次 REST 调用：为当前 session 查找/创建 thread
                              #   + 发送连接确认消息
    listen-message.js          # 不需要任何参数——自动从环境变量读取
                              #   CLAUDE_CODE_SESSION_ID 来判断该读哪个 inbox
    send.js                    # 把内容作为参数接收，自动读取
                              #   CLAUDE_CODE_SESSION_ID 来判断发到哪个 thread，
                              #   直接调用 REST（不 login，不依赖
                              #   discord-listener.js）
    react.js                   # 添加/移除状态表情（🤔 开始，✅ 完成），
                              #   依次调用 start 再 done——曾经**尝试**过和
                              #   send 合并成 reply.js 并并行执行以求更快，
                              #   但被回退了（见第 5.1 节）
    disconnect.js               # 断开 1 个 session 或断开整个 project
    permission-relay.js         # 通过 Discord relay permission prompt（第 8 节）
  .data/
    session-map.json           # 持久映射：编号（CLAUDE_CODE_SESSION_ID）-> {名称, threadId}
    active-listener.json       # discord-listener.js 的 pid + 心跳
    active-sessions.json       # 当前存活 SESSION 的 registry（不同于
                              #   session-map.json 这种持久映射）——{sessionId，
                              #   当前 listen-message.js 进程的 pid，
                              #   connectedAt}——用于在有人想断开整个 project
                              #   时能安全判断
    inbox/
      <CLAUDE_CODE_SESSION_ID-1>/   # 收件 queue，按真实 session 各自独立
        1739850001234-a1b2.json
      <CLAUDE_CODE_SESSION_ID-2>/
```

目录规范遵循 Anthropic 的 skill 标准：Claude 执行的脚本放在 `scripts/` 下，
在 `SKILL.md` 中通过 `${CLAUDE_SKILL_DIR}/scripts/<file>.js` 变量调用（会
自动替换为绝对路径，无论 cwd 在哪里都能正确运行）。`lib.js` 通过
`path.join(__dirname, '..')` 计算 `SKILL_DIR`，因为它自己也在 `scripts/`
下，比 `.env`/`.data/` 低一级。

`session-map.json`：
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
- **map 的键 = `CLAUDE_CODE_SESSION_ID`**——由 Claude Code 分配的真实编号，
  不是自己生成的，两场不同的对话之间不可能重复。
- `name`——只用于在 Discord 上显示为 thread 标题，由 Claude 在调用
  `ensure-thread.js` 时自行设定，**不在系统的任何地方用于查找/路由**。两个
  不同的 session 名称重复也不会造成任何问题（Discord 上的 thread 依然是分
  开的，因为 `threadId` 不同）。
- `threadId`——Discord 的真实 id，用于发送/接收。

### 为什么不需要 Claude 自己记住或手动传递任何标识

所有脚本（`ensure-thread.js`、`listen-message.js`、`send.js`）都会在进程
内部自动读取 `process.env.CLAUDE_CODE_SESSION_ID`——这个变量在当前对话对
应的每一条 Bash 命令中始终存在，是 Claude Code 自动注入到环境中的，不是
bridge 自己创建的。因此：
- Claude 不需要记住，也不需要在多次命令调用之间传递编号或名称。
- 不可能误调到别的 session，因为环境中只包含运行该命令的这个进程自己的那
  一个 `CLAUDE_CODE_SESSION_ID`。

### 为什么 queue 采用 maildir 模式（1 个文件 = 1 条消息）

- 写入：先在同一目录下创建临时文件，再用 `fs.renameSync()` 改名为正式文件
  名——同一磁盘上的 `rename` 是**原子（atomic）**操作，绝不会有写到一半的
  文件被误读。
- 读取：列出目录，取文件名最小的那个（文件名以时间戳开头，因此顺序天然正
  确），读取后删除。
- 每个 session 都有自己独立的目录（按 `CLAUDE_CODE_SESSION_ID` 区分），所
  以 session 之间不会发生竞争；在同一个目录里，写和读虽然是两个不同的进
  程，但在任何时刻操作的都是两个不同的文件 → **完全不需要任何文件锁库。**

## 4. 监听（接收消息）——如何保证稳定

`discord-listener.js` 是这个 project 唯一的单点故障，所以需要几个自我恢复
机制，全都很轻量，不需要额外的 supervisor/process-manager：

1. **不因临时性错误而自我终止。** 网络短暂断开时，discord.js 会自动
   reconnect/resume Gateway——只需要在 `error`/`shardError` 的 handler 里
   **不**调用 `client.destroy()`/`process.exit()`，只做日志记录即可。这个
   版本要持续存活，退出即视为异常（区别于旧的 `listen-once.js`，那个是收
   到恰好 1 条消息后就自行退出）。
2. **在 `active-listener.json` 中记录心跳。** 每隔固定时间（比如 30 秒）
   或每处理完 1 个事件，`discord-listener.js` 就会覆写
   `{ pid, lastHeartbeat }`。只检查 `pid` 是否存活
   （`process.kill(pid, 0)`）是不够的——进程可能还活着但已经卡死（比如
   Gateway 连接丢失但没有 crash）；心跳超过某个阈值（比如 > 90 秒）就视为
   "不可信"，需要重启。
3. **有需要时自动恢复，不需要额外的独立监控进程。** 每当有 session 准备
   调用 `listen-message.js` 时，会先检查 `active-listener.json`：pid 已
   死或心跳过期 → 在继续之前先自动重启 `discord-listener.js`。这样就不需
   要再额外起一个"看守"进程。
4. **收到停止请求时干净退出**（SIGINT/SIGTERM）：立刻删除自己在
   `active-listener.json` 里的条目，这样下一次检查就能马上知道它已经停止
   了，不用等心跳超时。
5. **把错误日志写入文件**（`discord-listener.log`），避免后台进程挂掉时错
   误信息无处可查。

## 5. 从 session 向 Discord 发送内容

**【已拍板】** 发消息**不需要 Gateway，不需要 `discord.js`，不依赖
`discord-listener.js` 是否存活**——只是**一次 HTTP REST 调用**，请求
`POST https://discord.com/api/v10/channels/<threadId>/messages`，附带
`Authorization: Bot <token>` 请求头。

```
Claude 想要回复（正运行在 CLAUDE_CODE_SESSION_ID = X 的 session 中）
        │
        ▼
send.js "<内容>"
   → 从环境变量读取 CLAUDE_CODE_SESSION_ID = X
   → 按编号 X 查询 session-map.json 取得 threadId
   → 直接调用 1 次 curl/fetch REST 请求发往 Discord，附带 .env 里的 Bot token
   → 立刻得到 HTTP response（200 = 发送成功，出错则当场就能知道）
        │
        ▼
消息立刻出现在正确的 thread 里，不经过 discord-listener.js
```

选择直接走 REST，而不是 (a) 每次发送都自己重新 login `discord.js`，或
(b) 写入 outbox 再由 `discord-listener.js` 代为发送，原因如下：

- **快**——只需 1 次 HTTP 往返（实测约 400-660ms，见第 5.1 节），不需要花
  时间建立/维持 Gateway 连接。
- **出错当场就知道**——token 错误/过期，或 bot 对该 thread 没有发送权限，
  `send.js` 都能通过 HTTP 错误码立刻知道。
- **与 `discord-listener.js` 完全独立**——listener 挂掉只影响接收方向，不
  影响发送方向。
- **`send.js` 不需要安装 `discord.js`**——只需要调用 HTTP（curl 或 Node
  18+ 自带的 `fetch`）。
- 内容超过 2000 个字符 → `send.js` 会自动拆成多次连续的 REST 调用。

### 5.1. 性能——实测数据（Windows，取 3 次平均值）

| 项目 | 耗时 |
|---|---|
| node 启动 | ~85ms |
| 1 次任意 Discord REST call（PUT/DELETE/POST） | ~0.4–0.66s |
| `fs.watch` 检测到 inbox 中的新文件 | ~14ms |

**唯一显著的延迟来源是要排队等待的 REST call 数量，而不是 inbox 的读取机
制。** `fs.watch` 的 14ms 相比每次 REST call 动辄几百毫秒来说微不足道——不
要去优化 `POLL_INTERVAL_MS`（2000ms 只是 `fs.watch` 不可用时的 fallback，
实际上几乎从来用不到）。

三条降低延迟的原则，**曾经尝试**应用过（对应脚本 `reply.js`，现已删除）：

1. **把多次 REST call 合并进 1 个 node 进程**——每调用一次脚本就要付出约
   85ms 的启动代价。`reply.js` 把 send + react ✅ 合并成一个。
2. **相互独立的调用用 `Promise.all`，不要用 `await` 依次排队**——比如移除
   🤔 和添加 ✅ 是两个不同的表情，彼此完全独立。
3. **只有展示作用的调用采用 fire-and-forget**——`react.js start` 用
   `run_in_background: true` 调用；不阻塞约 0.9 秒去等表情加上才开始真正
   干活。

实测效果不错：每次回复的开销从 **约 3.2s 降到约 0.76s**。

**但由此引发了 2 个真实问题，导致用户要求整体 REVERT：**

- Bug：第 3 条原则（fire-and-forget）导致 `react.js start`（PUT 🤔）在后
  台运行时，与紧接着对**同一条**消息调用的 `reply.js`（DELETE 🤔 + PUT
  ✅）发生**碰撞** → Discord 返回 429 rate limit。`reply.js` 最初**吞掉**
  了这个错误（虚假地报告 `reacted: true`）。后来通过在 `lib.discordFetch`
  里加入 retry-on-429（这部分保留下来，仍然有用）+ 让 `reply.js` 如实报告
  真实状态来修复。
- 操作层面：修复完之后，Claude（也就是写这段代码的人）在一次快速测试后忘
  了重新调用 `listen-message.js` → 用户误以为连接被断开了。这是操作失误，
  不是设计缺陷，但和 429 那个 bug 叠加在一起，让用户判断"更慢了、错误更多
  了"，因而要求恢复回旧的流程，只保留 🤔 图标。

**与用户拍板确定的结论：** 保留原来那套顺序流程（`react start` 等它执行
完 → `send.js` → `react done` 等它执行完，全部用 `await` 依次排队，不用
`Promise.all`，不合并进程）。相比 race condition 的风险，每次约 3.2 秒的
开销是可以接受的代价。除非被明确要求，否则不要再朝这个方向优化。

## 6. 整体运作流程

### 6.1. 连接 1 个 session（仅在被要求时）——始终发送确认消息

```
用户："连接 discord"
        │
        ▼
1. Claude 自己为正在做的事取一个简短描述性名称（比如"修复登录问题"）
        │
        ▼
2. ensure-thread.js "<Claude 取的名称>"
     - 从环境变量读取 CLAUDE_CODE_SESSION_ID = X（不需要手动传递）
     - 按编号 X 查询 session-map.json：
         + 已有 threadId → 复用（显示名称可以更新也可以保持不变，不影响
           路由）
         + 还没有 → 在 Discord 上创建新 thread，标题为 Claude 刚设定的名
           称，把 { X: { name, threadId } } 存入 session-map.json
     - 这一步之后**始终**要往 thread 里发一条默认消息
       （比如："🟢 Session '<名称>' 已连接。"）——无论 thread 是新建的还是
       复用的，这都是必须执行的步骤，没有任何条件可以跳过
3. 检查 active-listener.json（pid + 心跳）：
     - 还活着 & 心跳是新的 → 直接使用
     - 已死/过期 → 重启 discord-listener.js（后台，持续存活）
4. 如果 inbox/<X>/ 目录还不存在，就创建一个空目录
5. 开始循环：调用 listen-message.js（后台）→ 等待 task-notification
```

### 6.2. 接收并处理消息

```
Discord 消息发到 session X 对应的正确 thread 中
        │
        ▼
discord-listener.js 通过 Gateway 收到 → 查出 threadId → 找到对应的编号 X
   （按 threadId 反查 session-map.json）
        │
        ▼
往 inbox/<X>/ 写入一个新文件（maildir 模式）
        │
        ▼
listen-message.js（正运行在 session X 中，自动读取 CLAUDE_CODE_SESSION_ID
   来判断该读哪个 inbox/<X>/）检测到新文件
   → 读取、打印 JSON、删除文件 → 退出 → harness 唤醒对应的 Claude 会话
        │
        ▼
Claude 处理 → send.js "..."（自动按 X 查出 threadId，直接调用 REST）
   → Claude 再次调用 listen-message.js 继续等待
```

### 6.3. 同一 project 下的多个 session

- 接收方向共用同一个 `discord-listener.js`。每个 session 在处理层面各自
  独立：各自拥有独立的 `inbox/<CLAUDE_CODE_SESSION_ID>/` 目录，每场对话的
  `listen-message.js` 自动读取属于自己的那个目录——session A 忙碌不会阻塞
  session B 接收消息。不存在"占用名称"这种概念，因为名称不用于路由。
- 发送方向（`send.js`）与 listener 以及其他 session 完全独立。

### 6.4. 多个 project 并行运行

- 不变：每个 project 都有自己独立的 `discord-listener.js`，不与其他
  project 共享任何东西。

## 7. 断开连接

### 7.1. 何时断开

1. **用户在对应的对话里明确要求**（比如"断开 discord 连接"）——主要方式，
   始终由用户主动触发，不自动进行。
2. **对话自然结束**（关闭窗口/会话结束）——在后台等待的
   `listen-message.js` 进程是该对话本身的子进程，会随着该会话的进程生命
   周期自然被清理掉，不需要额外写代码处理。

不存在"闲置 X 分钟后自动断开"这种分支——严格遵守只有被要求时才行动的原则
（第 2 节）。

### 7.2. 断开某一个具体的 session

```
用户："断开 discord 连接"
        │
        ▼
1. 停止循环：不再重新调用 listen-message.js
2. 如果后台正有一个 listen-message.js 进程在等待 → 停掉它
3. 通过 REST 往 thread 发一条断开通知消息（与连接时对称）：
     "🔴 Session '<名称>' 已断开连接。"
4. 从 active-sessions.json（"存活中"的 registry）里删除该 session 的条目
```

`session-map.json`（编号 ↔ 名称 ↔ threadId）**保持不变，不删除**——如果之
后再恢复同一场对话，`CLAUDE_CODE_SESSION_ID` 不会变，所以依然能接回原来的
那个 thread，不会创建新的/重复的 thread。

### 7.3. 断开整个 project（彻底停止 `discord-listener.js`）

会影响到共用同一个 listener 的**所有其他 session**，所以需要比断开单个
session 更加谨慎——不应被当作某个 session 自行断开的默认连带结果。

```
用户："断开这个 project 的全部 discord 连接"
        │
        ▼
1. 读取 active-sessions.json → 列出实际存活的 session
2. 是否还有其他 session（不是当前这个）在存活？
     - 有 → 在动手之前先**警告**："还有 N 个其他 session 正在连接，停掉整
       个 project 会一并断开这些 session，确认要继续吗？"
     - 没有 / 已确认 → 继续
3. 根据 active-listener.json 里的 pid，kill 掉 discord-listener.js
4. 删除 active-listener.json
```

`session-map.json` 依然保持不变——它只是映射数据，不是"正在运行"的状态，
停止 listener 时不需要删除它。

## 8. 通过 Discord relay 权限申请（permission prompt）

在真实测试中发现后追加的功能：bridge 最初只 relay **聊天**，不 relay
**permission prompt**（Claude Code 需要请求权限运行某个 tool 的时候）。用
户坐在 Discord 那边看不到、也没法批准那个 prompt，因为它只出现在原生界面
（VSCode）里。已经和用户拍板确定的要求：**严格贴合 Claude Code 原生的机
制**——Claude 什么时候问权限，就在什么时候 relay；Claude 不问，就什么都不
发；等待超时了，就交给 Claude Code 原生的 fail-open 机制自己处理（不要自
己另外发明规则）。

### 8.1. 采用的机制：`PermissionRequest` hook

已通过官方文档核实（`https://code.claude.com/docs/en/hooks.md`）：
- `PermissionRequest` hook **只会在 Claude Code 即将弹出 permission
  prompt 时触发**——如果某个 tool 已经根据既有的 permission-mode/规则被
  自动允许，这个 hook 就不会运行，不需要在应用层再自己额外过滤一遍。
- 输入（stdin，JSON）：`session_id`、`tool_name`、`tool_input`、
  `permission_mode`、`tool_use_id` 等等。
- 输出（stdout，JSON，exit code 为 0 时）：
  `{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": "allow"|"deny"|"escalate", "reason": "..."}}`
  - `escalate` = 退回到原生界面正常询问（当 Discord 上的回答不明确时使
    用）。
- **严格按照 Claude Code 原生设计做到 fail-open**：hook crash、输出的
  JSON 格式错误，或者**超时**（默认 600 秒，可以通过 hook 配置中的
  `timeout` 字段调整）→ Claude Code 会自动回落到正常的 permission 流程
  （像没有 bridge 时一样，在 VSCode 里弹出 prompt），**不会**卡死，也不
  会自作主张地随便放行。这正是用户要求的"超时就按 Claude 自己的机制处
  理"这一行为——不需要额外写超时逻辑，只要在等待 Discord 回答超时时什么
  都不回应，就会自动、正确地 fail-open。

### 8.2. 路由问题：权限批准回复 vs 普通聊天消息

两者在同一个 thread 里都是文本消息，需要把这两条流分开，这样
`listen-message.js`（聊天循环）才不会误把权限批准的回复当成普通消息吞掉，
反过来也一样。

解决方案：用一个一次性的标志文件来标记"正在等待权限批准"。

```
pending-approval/<CLAUDE_CODE_SESSION_ID>.json   # { promptId, askedAt } - hook 在提问时创建
approvals/<CLAUDE_CODE_SESSION_ID>/               # 专门存放权限批准回复的 maildir
```

- `permission-relay.js`（由 hook 运行的脚本）会在把问题发到 thread 之前先
  创建标志文件 `pending-approval/<编号>.json`，然后轮询
  `approvals/<编号>/` 目录等待回答。
- `discord-listener.js`：每次收到消息时，像平常一样通过 `threadId` 查出
  `sessionId` 之后，再额外检查一下是否存在标志文件
  `pending-approval/<编号>.json`：
  - 存在 → 说明这是对 permission prompt 的回复：写入 `approvals/<编号>/`
    （不写入 `inbox/<编号>/`），并**立刻删除标志文件**（一次性使用），这
    样下一条消息就会恢复走正常路由进入 `inbox/`。
  - 不存在 → 按原来的方式路由，进入 `inbox/<编号>/`。
- `permission-relay.js` 读到 `approvals/<编号>/` 里的文件后 → 解析意图：
  含有"y"、"yes"、"allow"、"ok"、"được"、"đồng ý"、"duyệt" 之类的词 →
  `allow`；含有"n"、"no"、"deny"、"không"、"từ chối" → `deny`；无法判断
  → `escalate`（退回到 VSCode 重新询问，比瞎猜更安全）。

### 8.3. 发到 Discord 上的权限询问消息内容

```
⚠️ [请求权限] Session '<名称>' 想使用 tool '<tool_name>'：
```<tool_input 截短至最多约 1500 个字符，JSON 格式>```
回复 'y' 表示同意，'n' 表示拒绝。如果没有及时回复，prompt 会照常重新出现在
VSCode 里。
```

### 8.4. 落地实施的风险——为什么必须先做隔离测试再正式启用

在 `.claude/settings.json`（或 `.claude/settings.local.json`）里配置的
hook 是**对整个 project、所有 session 都生效的**，不只是正在连接 Discord
的那个 session。`permission-relay.js` 里的失误可能会影响到这个仓库里正在
运行的**所有** Claude Code 会话在请求权限时的体验，包括那些和 Discord 完
全无关的 session（虽然 9.1 节的 fail-open 机制已经降低了卡死的风险，但并
没有完全消除逻辑出错的风险）。因此，正式启用之前必须遵循以下流程：
1. 先独立测试 `permission-relay.js`：自己往 stdin 里塞假的 JSON 数据（不
   动 `settings.json`）——把各种分支都测到：session 没有连接 Discord（必
   须保持沉默，不输出任何内容）、session 已连接且回复 allow/deny/含义不
   明、等待超时。
2. 只有第 1 步全部通过之后，才把 hook 加进 `settings.json`，用一次真实的
   tool call 在已连接 Discord 的 session 里做真实测试。
3. 如果第 2 步出现任何异常迹象（hook 没有在正确时机触发、吃到错误格式的
   数据等等），立刻从 `settings.json` 里移除，再去排查——优先保证不影响
   其他 session。

## 9. 仍在范围之外 / 尚未处理的风险

- **`session-map.json` 与 Discord 实际情况的同步**（thread 在 Discord 上
  被手动删除/改名）——目前还没有检测与自动恢复的机制。
- **DM（私信）** 没有 thread 的概念，如果要支持需要单独做一个分支。
- **Bot 权限**：每个 project 的父 channel 除了已有的 View/Send 权限之外，
  还需要 `Create Public Threads` + `Send Messages in Threads`。
- **Discord 每条消息 2000 字符的限制**，当回复内容较长时——需要在
  `send.js` 里做拆分逻辑，具体怎么拆（按行？按段落？）目前还没有细化设
  计。
- **清理旧 session**：随着连接过的对话数量增多，`session-map.json`/
  `inbox/` 会逐渐变大——目前还没有针对已过期/不再使用的
  `CLAUDE_CODE_SESSION_ID` 做定期清理的机制。

## 10. 已做过的真实测试（不是模拟）

创建过真实的 thread、发送过真实的确认消息，用户往 thread 里输入过真实的消
息，`discord-listener.js` 也正确接收并写入了对应的 inbox，
`listen-message.js` 按正确的 FIFO 顺序取出消息，`send.js` 能正常发送并自
动拆分超过 2000 字符的消息，能正确 self-filter 掉 bot 自己发的消息，
`disconnect.js session` 能正确 kill 掉正在等待的进程 + 发送断开消息 + 保
留 `session-map.json` 以便之后恢复到原来的 thread，`disconnect.js
project` 在还有其他 session 存活时能正确发出警告，并在带 `--confirm` 时
正确 kill 掉 listener。测试用的 thread 已在 Discord 上被 archive/改名
（bot 没有彻底删除 thread 的权限——`Manage Threads`）。
