<div align="center">

# 🌉 Claude Easy Discord Bridge

*(skill/目录的技术名称：`claude-easy-discord-bridge`)*

[English](README.md) · [Tiếng Việt](README.vi.md) · [日本語](README.ja.md) · **中文**

**直接在 Discord 上操控 Claude Code——即使是在手机上也行。**

这是一个 [Claude Code](https://claude.com/claude-code) 的 skill，能把每一个
正在运行的 session 变成一场 Discord 对话：发消息、看进度——随时随地，不必
守在 VSCode 前。同时处理**多个任务、多个项目**依然条理分明，不会混淆。

</div>

---

## 📌 为什么需要这个？

Claude Code 默认只能在 1 个终端/VSCode 窗口里运行——你要么守在那里等，要么
一离开机器就和 session 断了联系。这个 skill 正是为了解决这个问题。

> 🔌 **特别之处：** 完全不需要提前准备或配置。正跟 Claude 聊到一半、任务做
> 到一半时，只需在那场对话里直接打一句**"帮我连接 discord"**，马上就能接
> 上——不用中断正在做的事，也不用从头重开。这是**唯一只有这个 skill 才能做
> 到的**：大多数其他 Discord 插件/机器人都要求你一开始就通过它们创建工作会
> 话，无法在一场已经进行到一半的对话中途"接上"Discord。

| 没有这个 skill | 有 Claude Easy Discord Bridge |
|---|---|
| 正跟 Claude 聊到一半，想用 Discord 就得停下来，从头开新会话 | 在做事做到一半时直接打"连接 discord"，不丢上下文，不用重启 |
| 多个 session 并行运行 → 很容易分不清哪个窗口是哪个 | 每个 session 各有一个专属 thread，名称清晰，绝不会认错 |
| 多个项目 → 要打开、要记住的地方太多 | 每个项目各有一个专属 channel，彻底分开 |
| 想快速问 Claude 一个问题也得重新打开 IDE | 直接在 Discord 里打字，Claude 就在 thread 里马上回复 |
| 必须守在电脑前才能看 Claude 在做什么 | 通过 Discord 在手机上随时查看并回复 |

## ✨ 主要特性

### 🧵 同时处理多个任务、多个项目——依然极其简单
这是这个 skill 最大的优势：你可以同时打开多个不同的 Claude Code 对话（比如
一边在项目 A 修 bug，一边在项目 B 写报告），而在 Discord 上一切都排列得井井
有条：

- 每个**项目**对应一个**专属的 Discord channel**——项目 A 的事绝不会和项目
  B 混在一起。
- 在每个 channel 里，每一场**正在进行的对话**对应一个**专属 thread**，会自
  动根据正在做的事命名（比如"修复登录 bug"、"分析报告"）——同时开多少个任
  务都不用担心发错地方，只要进对应的 thread 就是在跟对应的任务对话。
- 不需要手动管理或命名——只要你说一句"连接 Discord"，一切都会自动排好。

### 💬 实时双向消息
在 Discord 的 thread 里打字发消息，Claude Code 会几乎立刻收到并回复——不需
要缓慢的轮询，不需要刷新。

### ✅ 用表情反应清楚显示处理状态
一开始处理消息就用 🤔 做出反应，处理完就变成 ✅——看一眼 Discord 就知道
Claude 是在忙还是已经回复了。

### 🔁 恢复到原来的 thread，不会重复创建
重新连接到同一个 session（重新打开同一场对话）时，会自动找回之前创建过的
那个 thread，绝不会生成重复的 thread。

### 🚦 灵活断开连接
可以单独断开 1 个 session，也可以断开整个 project（如果还有其他 session 存
活会给出警告）——始终由用户主动触发，没有任何自动静默断开的机制。

### ⚡ 快速，不相互牵制
发消息直接用 REST，不经过 Gateway——即使接收方向出了问题，发送方向也绝不会
被阻塞。这些都经过了真实的性能测量，不是凭空猜测。

## 🏆 突出优点

- **🔌 装一次，用一辈子——工作做到一半也能随时接上，不需要提前准备。**
  只需要安装一次。之后，任何时候——哪怕正跟 Claude 聊到一半、事情做到一
  半——只要在那场对话里直接打一句**"帮我连接 discord"**就能接上，不用停下
  正在做的事，不用从头重开，也不用额外配置什么。这是**唯一只有这个 skill
  才能做到的**：其他 Discord 插件/机器人通常要求你一开始就通过它们创建工
  作会话——不支持把 Discord "接"到一场**正在进行中**的对话上。

- **📱 真正的远程办公，不只是收个通知了事。** Claude Code 自带的手机推送
  通知功能，只能让你*知道*Claude 需要什么——想回复还是得回到那台开着的电
  脑前。用了这个 skill 之后，你可以**直接在手机上回复并继续推进任务**，就
  像坐在电脑前敲命令一样。

- **🗂️ 即使同时跑多个任务，也绝不会搞错。** 每一场 Claude Code 对话都是一
  个独立的 thread，会根据正在做的事清楚命名（比如"修复登录 bug"、"写报
  告"）。同时跑 3、4 个任务依然条理清晰，不用担心把这个对话的回复发错到另
  一个任务里。

- **🏢 多个项目，各有各的区域。** 如果你同时做多个不同的项目，每个项目会显
  示为一个独立的 Discord channel——不会把这个项目的事和那个项目的事混在一
  起。

- **⚡ 回复很快，不用等待或重新加载。** 消息发出去，Claude 几乎立刻就能收
  到，不需要按刷新按钮，也不需要等待缓慢的检查循环。

- **✅ 一眼就知道 Claude 是在忙还是已经完成。** 你发送的每条消息都会自动带
  上表情标记：Claude 处理中显示 🤔，处理完变成 ✅——不用再问一句"好了没？"。

- **🔒 私密，不经过第三方。** 所有消息都直接在你的机器和你自己的 Discord 之
  间传输——没有任何其他中间服务器能存储或读取对话内容。

- **🧠 不需要懂技术也能用。** 只需要说对一句**"连接 Discord"**，剩下的一切
  Claude 都会自己处理——不用运行命令，也不用理解它内部是怎么工作的。

- **🔁 装一次，用一辈子。** 初始设置只需要几分钟，之后每一场新对话都会自动
  准备好可以连接 Discord，不用重新来一遍。

## ⚖️ 与官方 Discord 插件（`discord@claude-plugins-official`）的对比

Anthropic 也有一个官方的 Discord 插件（运行在 Bun 上的 MCP server，通过
`claude --channels` 集成）。这个 skill 选择了另一条路线，更简单，也更贴合
multi-project/multi-session 的实际需求：

- **能把 Discord 接到一场正在进行中的对话上。** 只需要在正在运行的 session
  里直接打一句"帮我连接 discord"就行——不需要事先就知道会用到 Discord，也
  不需要在开始工作之前重启或做任何配置。官方插件（以及大多数其他 Discord
  机器人）都要求一开始就通过它们建立好 channel/工作会话。
- **自动把 1 个 project 映射到 1 个 channel，1 个 session 映射到 1 个
  thread。** 官方插件没有现成的这种机制——必须手动用 `reply_to` 自己管理
  threading。
- **发送/接收完全分离。** `send.js` 直接调用 REST，与接收方向 100% 独立——
  即便负责接收消息的 listener 出了问题，发送也绝不会被阻塞。官方插件把两
  者都揉在同一个 MCP server 里。
- **不需要 Bun，不需要 MCP，不需要 `--channels` 参数。** 只需要现成的
  Node.js >= 18，在 skill 目录里 `npm install` 即可。
- **安装极其简单。** 一个 `.env` 文件声明 token 和各种 ID，不需要跑配置用
  的 slash command（`/discord:configure`、`/discord:access ...`），也不需
  要经过 pairing code 那一步。
- **在实机上真实测量过性能，不是凭空猜测**（node 启动约 85ms，1 次 Discord
  REST call 约 0.4–0.66s，`fs.watch` 检测到新消息约 14ms）——而且曾经尝试
  过通过合并 REST call 来优化，结果因为引发 race condition/429 而被回退，
  所以现在的设计方向是经过实际验证的，而不是纸上谈兵。
- **绑定到具体项目，而不是全局配置。** 想在别的项目用，只需要把整个 skill
  目录复制过去，不会影响整台机器上 Claude Code 的全局配置。

## 🖼️ 演示

![演示](.claude/skills/claude-easy-discord-bridge/assets/demo.png)

## 🏗️ 架构总览

```
Project A                              Project B
   │                                       │
   ├─ Channel Discord A                    ├─ Channel Discord B
   │    ├─ Thread: session 1               │    ├─ Thread: session 1
   │    └─ Thread: session 2               │    └─ Thread: session 2
   │                                       │
   └─ discord-listener.js（1 个进程）      └─ discord-listener.js（1 个进程）
        所有 session 共用                      所有 session 共用
```

完整细节（各组件、连接/发送/接收/断开的流程、每一项设计决策背后的原因、真
实测量的性能数据）：参见
[docs/claude-easy-discord-bridge-architecture.md](.claude/skills/claude-easy-discord-bridge/docs/claude-easy-discord-bridge-architecture.md)。

## 🚀 安装

**要求：Node.js >= 18**（用 `node -v` 检查）。脚本调用 Discord REST 用的是
全局 `fetch`，只有 Node 18 及以上才有——Node 16 及以下会报
`fetch is not defined` 错误。

```bash
cd .claude/skills/claude-easy-discord-bridge
npm install
```

在这个 skill 目录下创建 `.env` 文件：

```env
DISCORD_BOT_TOKEN=...
DISCORD_SERVER_ID=...
DISCORD_CHANNEL_ID=...
ALLOWED_USER_IDS=111,222,333
```

Discord bot 需要具备：
- 权限：在父 channel 上具备 `View Channel`、`Send Messages`、
  `Create Public Threads`、`Send Messages in Threads`。
- 在 Discord Developer Portal 里开启 **Message Content Intent**。

> 想用在别的项目上？只需要把整个
> `.claude/skills/claude-easy-discord-bridge/` 目录复制到该项目的
> `.claude/skills/` 下，再重新配置一次 `.env` 即可。

## 🎮 使用方法

不需要自己动手跑脚本——只要请 Claude 做就行：

> "帮我连接 discord"

Claude 会自己读取这个 skill 并执行必要的命令序列
（`ensure-thread.js` → `listen-message.js` → `send.js` → `react.js`），并
自动循环"监听/回复"，直到你要求断开连接为止。这些命令始终通过 Bash 运行
（即便在 Windows 上也是如此——不使用 PowerShell，因为 PowerShell 5.1 在把
带重音符号的越南语文本/emoji 作为参数传给 `node.exe` 时很容易出问题）。关于
命令和必须遵守的规则的完整细节：参见
[SKILL.md](.claude/skills/claude-easy-discord-bridge/SKILL.md)。

## ✅ 状态

代码已完成，并且**用真实的 Discord 做过端到端测试**（不是 mock）：创建
thread、发送/接收消息、react、断开/恢复 session 都已验证可以正常运行。

## 📄 License

依据 [Apache License 2.0](LICENSE) 发布——可自由使用、修改、再分发，包括用
于商业用途，只需保留版权声明。

## 👤 作者

**dangntvn** — [dangnt.vn@gmail.com](mailto:dangnt.vn@gmail.com)
