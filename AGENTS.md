# reiser-skillhub 项目规范

## 项目定位

SkillHub（面向用户品牌 Agent School，「本机职业角色学习中心」）：本机运行的 Agent 技能学习与管理中心。核心流程：从课程 Git 仓库浏览/安装 Skills → 用本机 Codex CLI 培训/测试 → 记录运行并收集团队反馈。单仓库 pnpm monorepo，三进程架构：catalog（技能目录服务）+ bridge（本机桥接，调用 Codex）+ web（React 前端）。

## 核心目录及职责

- `apps/catalog/` — 技能目录服务（Fastify，端口 43110）。克隆课程 Git 仓库、解析 SKILL.md frontmatter（gray-matter）、打包归档、存团队反馈（SQLite）。数据在 `var/catalog/`。
- `apps/bridge/` — 本机桥接服务（Fastify，端口 43111）。连接本机 Codex CLI（`codex app-server --listen stdio://` JSON-RPC）、管理安装/会话/运行/培训/Codex 设置，并托管 web 构建产物。数据库 `~/.skillhub/bridge.db`（node:sqlite，无 ORM）。
- `apps/bridge/src/skillhub/` — 独立 SkillHub：上传与版本仓库、本机安装、面向 AI 客户端的 stdio MCP 服务。仓库位于 `SKILLHUB_HOME/skillhub`，不依赖外部平台账号；只提供 Skill 查询、详情、安装计划和确认安装工具。
- `apps/web/` — React 19 + Vite 前端，自研 History API router（`src/router.ts`），无路由库。使用 shadcn/ui（Base UI）及新版官方 AI Elements Patterns，配置在 `components.json`。
- `apps/web/src/components/ui/` — 由 shadcn CLI 安装的基础组件；`components/ai-elements/` 组合聊天 Patterns；`chat/timeline.ts` 将后端 RunEvent 转为展示模型，不负责网络请求。`hooks/`、`lib/` 存放组件使用的代码高亮能力。
- `apps/web/src/shadcn.css` — Tailwind 及 shadcn 主题、组件布局；不启用全局 Preflight，保留现有页面排版。与旧主题同名的色彩变量使用 `--ui-` 前缀，旧控件 CSS 不应覆盖带 `data-slot` 的 shadcn 组件。
- `.agents/skills/shadcn/` — 项目内官方 shadcn Skill，新增或组合组件前读取其文档。
- `packages/codex-protocol/` — Codex app-server 协议 TS 类型，`src/generated/` 由 `pnpm codex:generate` 生成。
- `packages/shared/` — 前后端共享类型与 zod schema。
- `examples/course-template/` — 课程仓库模板（技能含 `SKILL.md` + `skillhub.json`）。
- `scripts/init-demo.mjs` — 初始化演示环境（`pnpm demo:init`），产出 `var/demo/`。
- `var/` — 运行时数据（catalog 数据、演示仓库、验收产物），已被 gitignore，业务代码不得依赖。

## 工作流

- `pnpm dev` — 完整开发（先 build shared/protocol，再并发起 catalog + bridge + web）。
- `pnpm start` — 只起 catalog + bridge，由 bridge serve web dist。
- `pnpm build`、`pnpm typecheck` — 构建与类型检查；验证入口。
- `pnpm codex:generate` — 重新生成协议类型。
- 端口：catalog 43110、bridge 43111、Vite dev 5173（`/api` 代理到 bridge）。
- 环境变量统一前缀 `SKILLHUB_`（端口、路径、课程仓库地址等），见 `apps/*/src/config.ts`；无 `.env` 约定。

## 技术栈

Node ≥22.13、pnpm 10.9、全 ESM、TypeScript 7。后端 Fastify 5 + node:sqlite + zod 4 + tar；dev 用 tsx watch，build 用 tsc 到各包 `dist/`。前端 React 19 + Vite 8 + react-markdown + Tailwind CSS 4 + shadcn/ui；代码块通过 Shiki 按语言加载高亮。

## 项目特有红线

- catalog 只绑定 loopback；bridge 有本机防护（Host/Origin 白名单 + 随机 session cookie），不得放宽。
- Codex CLI 不限制版本号；版本仅用于诊断展示，就绪状态以实际 app-server 握手和账号读取结果判断，具体能力以对应协议调用结果为准，不得按版本号提前拦截。
- Codex 程序统一按 `SKILLHUB_CODEX_PATH`、`PATH`、macOS Desktop 内置程序的顺序发现；显式配置无效时直接报错，不静默切换。状态、设置与运行必须使用统一解析入口，诊断页显示来源和实际路径。
- 不得手改 `packages/codex-protocol/src/generated/`，只通过 `codex:generate` 生成。
- 不得向 `var/` 或 `~/.skillhub` 写入测试/演示之外的数据；bridge 有写文件到本机用户目录（`~/.agents/skills`、`~/AgentSchool`）的能力，相关改动须谨慎验证。

## 执行纪律

- 无测试框架、无 lint 配置；改动验证以 `pnpm build` + `pnpm typecheck` 为准，必要时手动起 `pnpm dev` 验证页面。
- 聊天事件回归：`pnpm exec tsx --test apps/web/src/chat/timeline.test.ts`（Node 内置测试）。新组件使用 `pnpm dlx shadcn@latest add <组件> -c apps/web`，不安装旧版 AI SDK Elements 或迁移聊天后端。
- Codex 程序发现回归：`pnpm exec tsx --test apps/bridge/src/codex/executable.test.ts`；Desktop 自动发现另以排除独立 CLI 搜索路径的只读连接检查验证。
- SkillHub 安装回归：`pnpm exec tsx --test apps/bridge/src/skillhub/*.test.ts`；使用项目 `.tmp/` 下的隔离目录，不写入真实 Skills 目录。已有同名目录一律拒绝覆盖，不执行下载包内的脚本。
- SkillHub 中文文案在渲染层通过 `apps/web/src/lib/chinese-text.ts` 兜底，Markdown 仅处理正文文本节点，保留 URL 和代码；回归入口为 `pnpm exec tsx --test apps/web/src/lib/chinese-text.test.ts`。
- 全站基础控件优先使用 `components/ui/`：表单使用 Field / FieldGroup，普通下拉使用 NativeSelect，导航链接通过 NavigationMenu 与现有 Link 组合。公共提示、空状态、加载状态在 `components/UI.tsx` 组合 Alert / Empty / Skeleton / Spinner；保留原生文件选择器和支持 @ Skills 的聊天编辑器。
- 员工页保留左侧员工列表、中间聊天、右侧配置三栏；每位员工仅显示一个持续会话，不提供新建或切换会话入口；模型与思考强度位于输入框。保留附件、@ Skills、权限选择与人工审批，思考展示仅使用后端明确提供的摘要。停止生成不删除历史记录或产物。
- 聊天正文与输入框最大宽度为 800px 并居中；超过 20 轮且聊天区域至少 960px 宽时，在正文左侧留白显示刻度导航。使用 MessageScroller 的定位与可见性 API；启用导航时保留完整消息高度，避免延迟布局造成跳转偏移。
- 改 `packages/shared` 后需先 build（dev/typecheck 脚本已内置此前置）。
- 前端文案使用中文，遵循全局中文排版规范；页面导航「能力中心」含 Skills / MCP / 连接器三个 tab，后两者为预留。
- `/skillhub` 管理用户上传的 Skill；团队课程仍在 `/skills`。上传不自动安装，同名同版本不可覆盖；安装先展示目录、版本和必需依赖再确认。MCP 采用本机 stdio，不为 MCP 放宽 Bridge 的 Host／Origin／会话防护，不在 MCP 标准输出打印日志。
- 项目入口文档为 README.md；功能、启动方式或项目约定变化时，同步维护 README.md 与本文件。
