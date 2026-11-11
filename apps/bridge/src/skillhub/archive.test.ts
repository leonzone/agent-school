import assert from "node:assert/strict";
import test from "node:test";
import { readSkillUpload, readSkillZip } from "./archive.js";
import { skillFixture, testZip } from "./test-fixtures.js";

const markdown = Buffer.from("---\nname: upload-example\ndescription: 上传测试\n---\n# 示例\n");

test("上传 SKILL.md 与 ZIP 保留内容和资源，单层目录可直接解包", async () => {
  assert.equal((await readSkillUpload("SKILL.md", markdown))[0]?.content.toString(), markdown.toString());
  const binary = Buffer.from([0, 255, 12, 0]);
  const zip = testZip([{ path: "upload-example/SKILL.md", content: markdown }, { path: "upload-example/assets/example.bin", content: binary }]);
  const files = await readSkillUpload("skill.zip", zip);
  assert.deepEqual(files.map((file) => file.path), ["SKILL.md", "assets/example.bin"]);
  assert.deepEqual(files[1]?.content, binary);
  assert.equal((await readSkillZip(skillFixture("example").zip)).length, 2);
});

test("ZIP 拒绝路径穿越、符号链接、畸形与超限内容", async () => {
  for (const entry of [{ path: "../escape", mode: 0o100644 }, { path: "link", mode: 0o120777 }]) {
    await assert.rejects(readSkillZip(testZip([{ ...entry, content: Buffer.from("unsafe") }])), /无法安全读取|非法路径/);
  }
  await assert.rejects(readSkillZip(Buffer.from("not a zip")), /无法安全读取/);
  const oversized = testZip([{ path: "large", content: Buffer.alloc(0) }]);
  oversized.writeUInt32LE(51 * 1024 * 1024, 30 + Buffer.byteLength("large") + 24);
  await assert.rejects(readSkillZip(oversized), /无法安全读取/);
});

test("错误文件类型、模糊目录和缺少入口不能上传", async () => {
  await assert.rejects(readSkillUpload("other.md", markdown), /请选择 Skill ZIP/);
  await assert.rejects(readSkillUpload("invalid.zip", testZip([{ path: "a/SKILL.md", content: markdown }, { path: "b/other.txt", content: Buffer.from("other") }])), /缺少根目录/);
  await assert.rejects(readSkillUpload("missing.zip", testZip([{ path: "README.md", content: markdown }])), /缺少根目录/);
});

test("macOS 压缩包的系统元数据不会阻止识别 Skill 根目录", async () => {
  const zip = testZip([{ path: "upload-example/SKILL.md", content: markdown }, { path: "upload-example/.DS_Store", content: Buffer.from("metadata") }, { path: "__MACOSX/upload-example/._SKILL.md", content: Buffer.from("metadata") }]);
  assert.deepEqual((await readSkillUpload("finder.zip", zip)).map((file) => file.path), ["SKILL.md"]);
});
