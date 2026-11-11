import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { skillHubMcpInfo } from "./mcp-client.js";
import { createFixture } from "./test-fixtures.js";

test("MCP 配置使用本机进程参数数组和相同仓库，不包含外部账号或网络地址", async (t) => {
  const { settings } = await createFixture(t);
  const info = skillHubMcpInfo(settings);
  const server = info.config.mcpServers["agent-school-skillhub"]!;
  assert.equal(server.command, process.execPath);
  assert.deepEqual(server.args, [path.join(settings.projectRoot, "apps/bridge/dist/skillhub/mcp-stdio.js")]);
  assert.equal(server.env.SKILLHUB_HOME, settings.home);
  assert.equal(server.env.SKILLHUB_SKILLS_ROOT, settings.skillsRoot);
  assert.match(info.codexConfig, /\[mcp_servers\.agent-school-skillhub\]/);
  assert.match(info.codexConfig, /\[mcp_servers\.agent-school-skillhub\.env\]/);
  assert.deepEqual(info.tools.map((tool) => tool.name), ["skillhubSearch", "skillhubGetReadme", "skillhubInstallGuide", "skillhubInstall"]);
  assert.ok(!JSON.stringify(info).includes("https://"));
  assert.match(info.instructions, /运行 MCP 服务的这台电脑/);
});
