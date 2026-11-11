import assert from "node:assert/strict";
import test from "node:test";
import { formatChineseText, remarkChineseTypography } from "./chinese-text";

test("中文排版确定性补空格、全角标点和双连字符", () => {
  assert.equal(formatChineseText('用Codex处理3个Skill,保留JSON和32位ID。'), "用 Codex 处理 3 个 Skill，保留 JSON 和 32 位 ID。");
  assert.equal(formatChineseText('“中文”  ，  已确认——下一步'), "“中文”，已确认--下一步");
  assert.equal(formatChineseText("B站、GPT-5.6模型"), "B 站、GPT-5.6 模型");
});

test("URL、代码和 Markdown 代码节点保留原值", () => {
  const url = "https://example.com/中文?q=Skill,1";
  assert.equal(formatChineseText(`${url} 和 \`中文Id=3\``), `${url} 和 \`中文Id=3\``);
  const code = { type: "code", value: "const 中文Id=3;" };
  const paragraph = { type: "paragraph", children: [{ type: "text", value: "使用MCP安装3个Skill" }] };
  const tree = { type: "root", children: [paragraph, code] };
  remarkChineseTypography()(tree);
  assert.equal(paragraph.children[0]?.value, "使用 MCP 安装 3 个 Skill");
  assert.equal(code.value, "const 中文Id=3;");
});
