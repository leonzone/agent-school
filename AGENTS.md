# reiser-skillhub 项目规范

## 项目定位

SkillHub（面向用户品牌 Agent School，「本机职业角色学习中心」）：本机运行的 Agent 技能学习与管理中心。核心流程：从课程 Git 仓库浏览/安装 Skills → 用本机 Codex CLI 培训/测试 → 记录运行并收集团队反馈。单仓库 pnpm monorepo，三进程架构：catalog（技能目录服务）+ bridge（本机桥接，调用 Codex）+ web（React 前端）。

## 核心目录及职责

- `apps/catalog/` — 技能目录服务（Fastify，端口 43110）。克隆课程 Git 仓库、解析 SKILL.md frontmatter（gray-matter）、打包归档、存团队反馈（SQLite）。数据在 `var/catalog/`。
- `apps/bridge/` — 本机桥接服务（Fastify，端口 43111）。连接本机 Codex CLI（`codex app-server --listen stdio://` JSON-RPC）、管理安装/会话/运行/培训/Codex 设置，并托管 web 构建产物。数据库 `~/.skillhub/bridge.db`（node:sqlite，无 ORM）。
- `apps/web/` — React 19 + Vite 前端，自研 hash router（`src/router.ts`），无路由库、无 UI 框架。
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

Node ≥22.13、pnpm 10.9、全 ESM、TypeScript 7。后端 Fastify 5 + node:sqlite + zod 4 + tar；dev 用 tsx watch，build 用 tsc 到各包 `dist/`。前端 React 19 + Vite 8 + react-markdown。

## 项目特有红线

- catalog 只绑定 loopback；bridge 有本机防护（Host/Origin 白名单 + 随机 session cookie），不得放宽。
- Codex CLI 版本钉在 `0.163.0`（`apps/bridge/src/codex/service.ts` 的 `verifiedCodexVersion`），升级前必须验证协议兼容性。
- 不得手改 `packages/codex-protocol/src/generated/`，只通过 `codex:generate` 生成。
- 不得向 `var/` 或 `~/.skillhub` 写入测试/演示之外的数据；bridge 有写文件到本机用户目录（`~/.agents/skills`、`~/AgentSchool`）的能力，相关改动须谨慎验证。

## 执行纪律

- 无测试框架、无 lint 配置；改动验证以 `pnpm build` + `pnpm typecheck` 为准，必要时手动起 `pnpm dev` 验证页面。
- 改 `packages/shared` 后需先 build（dev/typecheck 脚本已内置此前置）。
- 前端文案使用中文，遵循全局中文排版规范；页面导航「能力中心」含 Skills / MCP / 连接器三个 tab，后两者为预留。
- 项目暂无 ROADMAP.md / README.md；「更新文档」时只需维护本文件。
