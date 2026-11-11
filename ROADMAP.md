# Agent School 进度

## SkillHub

已完成：独立本机 SkillHub，提供上传、版本仓库和本项目的 MCP 查询、安装服务。

- ZIP／SKILL.md 上传、元数据校验、不可覆盖的版本保存、说明与文件清单、分类／标签／已安装筛选及分页均已实现。
- 页面提供「上传 Skill」「安装到本机」「通过 MCP 安装」入口，支持复制安装提示词、Codex TOML 与通用 MCP JSON 配置，无外部平台品牌和账号依赖。
- 本机 stdio MCP 提供 `skillhubSearch`、`skillhubGetReadme`、`skillhubInstallGuide`、`skillhubInstall`，与 WebUI 共用仓库、版本与安装逻辑。
- 上传不自动安装；确认后才写 Skills 目录。仅解析 YAML 元数据，不执行脚本、不覆盖已有目录；必需依赖锁定精确版本，可选依赖不自动安装。
- `pnpm build`、`pnpm typecheck`、35 项 Node 回归和 `git diff --check` 全部通过。
- ego lite 已验证 ZIP 与 SKILL.md 上传、详情、MCP 入口、提示词复制与页面安装。独立 MCP 子进程已实际完成查询、详情、预览、确认安装，5 个文件的附件按字节读回一致，并通过真实 Codex 识别。
- 重启后保留 2 个上传 Skill 和 2 个安装记录；原生 Codex CLI 已识别生成配置对应的启动参数。390px、320px 页面无横向溢出。
- 验收数据位于项目 `.tmp/skillhub-completion/` 的隔离目录，未写全局 Skills。源码默认使用 `SKILLHUB_HOME/skillhub` 持久化仓库，安装目录仍由 `SKILLHUB_SKILLS_ROOT` 决定。

## Codex 程序发现

已完成：统一状态、设置与任务执行的 Codex 程序解析，支持只安装 macOS Desktop 的机器。

- 按显式配置、PATH、Desktop 内置程序的顺序查找；显式配置无效时直接报错。
- 就绪状态依据真实 app-server 握手及账号读取，不再用固定版本号提前拦截；诊断页展示实际路径与来源。
- 程序发现的 4 项回归包含在上述 35 项验证中。发布前另以排除独立 CLI 的搜索路径完成 Desktop 内置程序发现、握手与只读账号检查，均通过。

使用方式见 [README.md](/Users/reiserxu/kn_work/projects/agent-school/README.md) 。工程边界见 [AGENTS.md](/Users/reiserxu/kn_work/projects/agent-school/AGENTS.md) 。
