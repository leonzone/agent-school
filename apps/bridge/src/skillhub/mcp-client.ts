import { existsSync } from "node:fs";
import path from "node:path";
import type { HubMcpInfo } from "@skillhub/shared";
import { config } from "../config.js";

export const SKILLHUB_TOOLS = [
  { name: "skillhubSearch", description: "搜索本机 SkillHub 中已上传的 Skill 与版本" },
  { name: "skillhubGetReadme", description: "读取 Skill 说明、文件清单、版本与依赖" },
  { name: "skillhubInstallGuide", description: "校验内容并预览本机安装路径、精确版本与必需依赖" },
  { name: "skillhubInstall", description: "按已确认的计划安装 Skill，并校验 Codex 识别结果" },
] as const;

export function skillHubMcpInfo(settings: Pick<typeof config, "projectRoot" | "home" | "skillsRoot"> & { codexPath?: string | undefined } = config): HubMcpInfo {
  const entry = path.join(settings.projectRoot, "apps", "bridge", "dist", "skillhub", "mcp-stdio.js");
  const env: Record<string, string> = { SKILLHUB_HOME: settings.home, SKILLHUB_SKILLS_ROOT: settings.skillsRoot };
  if (settings.codexPath) env.SKILLHUB_CODEX_PATH = settings.codexPath;
  return {
    ready: existsSync(entry),
    codexConfig: `[mcp_servers.agent-school-skillhub]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([entry])}\n\n[mcp_servers.agent-school-skillhub.env]\n${Object.entries(env).map(([name, value]) => `${name} = ${JSON.stringify(value)}`).join("\n")}\n`,
    config: { mcpServers: { "agent-school-skillhub": { command: process.execPath, args: [entry], env } } },
    tools: SKILLHUB_TOOLS.map((tool) => ({ ...tool })),
    instructions: "将配置添加到支持 stdio MCP 的本机 AI 客户端。服务进程读取同一个 SkillHub 仓库；先查询、读取说明并展示安装计划，得到用户确认后再安装。安装发生在运行 MCP 服务的这台电脑。",
  };
}
