# dsh-session-title

会话标题跟随这段会话真正做过的工作，而不是启动它的第一句提示词。
[English](README.md) | **简体中文**

[![License](https://img.shields.io/github/license/icrefin/dsh-session-title?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/icrefin/dsh-session-title?style=flat-square)](https://github.com/icrefin/dsh-session-title/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/icrefin/dsh-session-title/ci.yml?branch=main&style=flat-square)](https://github.com/icrefin/dsh-session-title/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/icrefin/dsh-session-title?style=flat-square)](https://github.com/icrefin/dsh-session-title/commits/main)
[![Stars](https://img.shields.io/github/stars/icrefin/dsh-session-title?style=flat-square)](https://github.com/icrefin/dsh-session-title/stargazers)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](.github/CONTRIBUTING.md)
[![Node](https://img.shields.io/badge/node-%3E%3D24.9-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.5-4B5563?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)

DeepSeek Harness 按**第一句提示词**给会话命名，然后就到此为止。对只问一句话
的会话来说这没什么；对任何一个真实会话来说都错了：标题在侧边栏上挂了一个小
时，工作却已经从「新建一个插件……」走到提供方、调度器、测试套件，再到一个
tarball 安装包。本插件按会话**实际做过的任务**给它命名，并随着后续回合把工作
继续往前推，让名字跟上。

针对 **dsh 0.2.2-rc.2**（桌面端）测试。

```
Before, after fourteen turns of work:      After:
  Create a new plugin that                   Session-title provider with turn scheduler
```

## 这里的「基于任务」指什么

人写的提示词说的是**被要求**做什么。会话日志说的是**实际做了**什么：被改过
的文件、跑过的命令、跟踪过的待办、了结这一回合的那个回答。本插件把这份日志
折叠成一份小的**工作摘要**，再请模型据此给这段工作命名：

```json
{
  "currentTitle": "Build a title provider",
  "totalTurns": 4,
  "toolCallCount": 31,
  "turns": [
    {
      "turn": 3,
      "prompt": "Add the update scheduler",
      "work": ["write: src/scheduler.ts", "read: lib/index.js", "bash: Run the test suite"],
      "outcome": "Scheduler gates on progress, rest, and novelty."
    }
  ]
}
```

有两个工具调用被单独处理，因为它们本身就写着任务名：`todo_write` 变成它记录
的待办列表，`exit_plan_mode` 变成那份计划的标题。其余调用各贡献一行「工具:
目标」式的小结，优先取调用自身的标注（bash 的 `description`、一个文件路径、
一个搜索模式），而不是原始 JSON。

## 它是怎么接进去的

会话标题本来就由 harness 正经掌管：`dsh-session-title` 负责调度、取代
（supersession）、归一化，以及持久的 `session/title` 事件，并通过
`ctx.sessionTitle.register()` 只接受**一个**提供方。本插件就是这个提供方，外加
随包提供的那个提供方从不做的部分：

| 部件 | 文件 | 职责 |
|---|---|---|
| 提供方 | `src/provider.ts` | 把日志折叠成摘要，在字节上限内组织成框架，通过共享的 `dsh-session-title-llm` 执行器发一次辅助模型调用 |
| 摘要 | `src/digest.ts` | 把 `turn/start`、人类的 `user/message`、`tool/call`、`assistant/message`、`turn/end` 纯函数式地折叠成逐回合的工作 |
| 提示词 | `src/prompt.ts` | 指令、JSON 框架、到 `maxInputBytes` 的确定性裁剪、单行回答解析 |
| 调度器 | `src/scheduler.ts` | 判断一次改写**什么时候**值得发一次调用 |
| 目录路由 | `src/routes.ts` | 告诉设置页这台宿主提供哪些提供方和模型 |
| 设置页 | `src/client/` | Settings → **Session titles**：选定命名模型和改写节奏 |
| 补丁 | `cordis.patch.yml` | 停用随包提供的第一句提示词提供方，插入本插件的这一行 |

因为一个会话只有一个提供方，bundle 的补丁会在插入替代行之前，先关掉随包提供
的 `session-title-llm` 那一行。移除这个 bundle，下次重启就会恢复随包提供的
提供方。

## 标题什么时候会被改写

三道闸门，必须全部通过，这样标题既不会来回抖动，也不会白白花掉一次模型调用：

1. **有进展** —— 一个已完成的回合（`turn/end`），或运行中的回合内已完成
   `minStepsBetweenUpdates` 个步骤。很长的一个回合也照样能拿到当前标题。
2. **有间隔** —— 距上次尝试已过 `minUpdateIntervalMs`。
3. **有新颖度** —— 摘要指纹（回合、工具调用、提示词）与当前标题所描述的那份
   工作已经不同。

**用户**自己改过名的会话不动：服务会把那个标题标记为 `user` 来源并钉住，调度
器从不解除这种钉住。子会话（subagent fork）会被跳过，除非打开
`includeChildSessions`。

提供方还继承了服务自带的 `first-prompt` 自动节奏，所以一个全新的会话能从它的
第一句提示词很快拿到第一个名字——之后交给调度器接手。

## 怎么选命名模型

一次标题只跑一个很小的辅助请求，所以它可以用比对话更小、更便宜的模型。
Settings → **Session titles** 掌管这个选择：

- **跟随各会话自己的模型**（默认）—— 会话自己记录的那次请求所用的路由。
- **始终使用同一个模型** —— 钉死的提供方和模型，从运行中宿主公布的目录里挑。
  模型控件接受宿主能解析的任何 id，所以某个提供方没有列出的模型照样能用。

这一页还编辑标题长度的目标和改写节奏。每个字段都是**易变（volatile）**的：设置
传输层写入 Host 文档，Loader 就地更新运行中的那一行，提供方在下次标题请求时读
到当前值。不用重启，不用重新挂载，设置也不会多出第二份副本——这一页读写的
`Config`，与 profile 补丁用的是同一个。

模型列表是宿主的事实，所以这一页通过一条只读的回环路由
`GET /api/dsh-session-title/catalog` 向宿主询问，该路由列出
`ctx.llm.listProviders()` 以及每个提供方公布的模型。取列表失败的提供方仍然会
被列出，并附上原因；这一页随后回退到自由文本输入。

```
Settings
  Session titles        ← this page
    Naming model        ○ follow the session  ● pin provider + model
    Title length        words / CJK characters
    When a title is revised
      turns · steps · interval · boundaries · subagent sessions
```

## 配置

每个字段都是一个行设置；设置页实时编辑它们，profile 补丁设定初始值。下面这些
就是 bundle 补丁随包发布的值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `targetWords` | `6` | 非 CJK 标题的目标长度 |
| `targetCjkCharacters` | `12` | CJK 标题的目标长度 |
| `maxInputBytes` | `8192` | 组织好后的摘要的字节上限 |
| `maxOutputTokens` | `2048` | 输出上限（一道防止跑飞的保险，同时给推理留出空间） |
| `timeoutMs` | `30000` | 一次标题调用的端到端截止时间 |
| `provider`, `model` | — | 可选的显式路由；要么两个都给，要么都不给。省略即继承会话自己记录的路由 |
| `maxTurnsInDigest` | `10` | 摘要里带多少个最近的回合 |
| `minTurnsBetweenUpdates` | `1` | 触发一次改写所需的已完成回合数 |
| `minStepsBetweenUpdates` | `2` | 回合中途改写所需的已完成步骤数 |
| `minUpdateIntervalMs` | `120000` | 两次尝试之间的最小间隔 |
| `updateOnTurnEnd`, `updateOnStepEnd` | `true` | 哪些边界算作可改写的机会 |
| `includeChildSessions` | `false` | 是否也给子代理会话命名 |

**成本。** 每次改写一个辅助请求，受 `maxInputBytes` 和 `maxOutputTokens` 约束，
用该路由最低的推理档位。主对话不增加任何 token，也没有额外延迟：标题服务在主
请求之后做这件事，只追加一条仅入日志的 `session/title` 事件。工作没变就永远不
会触发调用。

## 安装

```sh
pnpm check            # typecheck, build, tests
scripts/install.sh    # packs dist/dsh-session-title-0.4.0.tgz
```

把 tarball 装进运行 harness 的那个 profile：

```sh
cd ~/.dsh/profiles/desktop
pnpm add file:/absolute/path/to/dsh-session-title-0.4.0.tgz
```

然后把 `"dsh-session-title"` 加进该 profile `package.json` 的
`dsh.profile.bundles`（紧跟其他插件 bundle 之后）。**重启 Harness**：bundle 层
是在启动时组合的，所以那个替换标题提供方的补丁在重启时生效，而不是在重新加载
时生效。已有会话会保留当前标题，直到它们的下一个回合完成；有了新的工作，它们
就会被重新命名。

## 验证

- `pnpm test`（78 个用例）拿录制下来的事件形状跑摘要，拿字节上限跑框架与裁
  剪，拿假计时器跑调度器，并让提供方走**真实的**共享执行器（只有适配器流是假
  的），包括它记录的那条一模一样的 `session/title-llm-request` 记录。设置页由
  真实组件在 jsdom 中渲染并驱动：钉住会原子地写入提供方与模型这一对，跟随会把
  两者一起清空，非法数字永远到不了宿主。目录路由由真实的回环 HTTP 服务器
  伺服。
- `test/manifest.spec.ts` 和 `test/bundle.spec.ts` 断言各处的 id 一致（包名、
  行 id、导出的 `name`、客户端 bundle id），断言补丁停用了
  `session-title-llm`，并断言构建出的客户端 bundle 以包名注册、且没有再打进一
  份 React。
- 目视检查——侧边栏里某一行的标题会变——需要把插件装进一个运行中的 Harness。
  测试套件并不声称覆盖这一点。

## 已知限制

- **一个会话只有一个提供方。** 一个 profile 如果还启用了上游的标题提供方
  bundle（`dsh-experimental-session-titles-bundle`），就会组合出两个提供方，
  本插件的这一行会在挂载时带着那条提示直接报错。
- **标题的变化是改写，不是实时游标。** 改写要等闸门放行；一个忙碌的会话可能
  在长达 `minUpdateIntervalMs` 的时间里显示一个略旧的名称。
- **「是否仍然准确」由模型判断。** 提示词要求模型保留一个已经够用的标题，只在
  工作有实质变化时才改；那是一条指令，不是语义校验。
- **摘要溢出即拒绝。** 装不进 `maxInputBytes` 的摘要会直接失败而不是被截断，
  上一个标题会一直沿用到下次改写。

## 贡献

欢迎提交 Issue 和 Pull Request——开发环境的搭建方式和 sign-off 要求见
[CONTRIBUTING.md](.github/CONTRIBUTING.md)。安全类问题请按
[SECURITY.md](.github/SECURITY.md) 所述私下报告。

## 许可证

MIT —— 见 [LICENSE](./LICENSE)。

> 如果你的侧边栏终于读起来像一份工作日志，一颗 ⭐ star 能帮更多 DSH 用户发现它。
