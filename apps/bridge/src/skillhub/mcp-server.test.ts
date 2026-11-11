import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSkillHubMcpServer } from "./mcp-server.js";
import { createFixture, skillFixture } from "./test-fixtures.js";

test("真实 MCP 协议完成发现、详情、只读预览与确认安装，拒绝无确认写入", async (t) => {
  const { repository, installer, installs, settings } = await createFixture(t);
  await repository.upload("example.zip", skillFixture("example").zip, { category: "开发", tags: ["测试"] });
  const server = createSkillHubMcpServer(repository, installer, installs);
  const client = new Client({ name: "skillhub-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["skillhubSearch", "skillhubGetReadme", "skillhubInstallGuide", "skillhubInstall"]);
    const search = await client.callTool({ name: "skillhubSearch", arguments: { keyword: "example" } });
    assert.equal((search.structuredContent as { total: number }).total, 1);
    const detail = await client.callTool({ name: "skillhubGetReadme", arguments: { skillId: "skl_example" } });
    assert.equal((detail.structuredContent as { version: string }).version, "1.0.0");
    const preview = await client.callTool({ name: "skillhubInstallGuide", arguments: { skillId: "skl_example", version: "1.0.0" } });
    const planId = (preview.structuredContent as { id: string }).id;
    await assert.rejects(readdir(settings.skillsRoot), /ENOENT/);
    const rejected = await client.callTool({ name: "skillhubInstall", arguments: { planId, confirm: false } });
    assert.equal(rejected.isError, true);
    const installed = await client.callTool({ name: "skillhubInstall", arguments: { planId, confirm: true } });
    assert.equal((installed.structuredContent as { error: null }).error, null);
    assert.match(await readFile(path.join(settings.skillsRoot, "example", "SKILL.md"), "utf8"), /name: example/);
    const replay = await client.callTool({ name: "skillhubInstall", arguments: { planId, confirm: true } });
    assert.equal(replay.isError, true);
    const missing = await client.callTool({ name: "skillhubGetReadme", arguments: { skillId: "skl_missing" } });
    assert.equal(missing.isError, true);
  } finally { await client.close(); await server.close(); }
});
