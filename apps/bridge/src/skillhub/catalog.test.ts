import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { skillHubQuerySchema } from "@skillhub/shared";
import { compareVersions } from "./catalog.js";
import { createFixture, skillFixture, testZip } from "./test-fixtures.js";

const input = { category: "写作", tags: ["Markdown", "中文"] };

test("上传保存后可搜索、读取文件和版本，上传不自动安装", async (t) => {
  const { repository, settings } = await createFixture(t);
  assert.equal((await repository.search(skillHubQuerySchema.parse({}))).total, 0);
  const archive = skillFixture("article-writer");
  const detail = await repository.upload("writer.zip", archive.zip, { ...input, displayName: "文章写作", author: "测试作者" });
  assert.equal(detail.id, "skl_article-writer");
  assert.equal(detail.version, "1.0.0");
  assert.match(detail.skillMarkdown, /name: article-writer/);
  assert.equal(detail.files.length, 2);
  const found = await repository.search(skillHubQuerySchema.parse({ keyword: "Markdown", category: "写作", tag: "中文" }));
  assert.equal(found.skills[0]?.title, "文章写作");
  assert.equal(found.skills[0]?.author, "测试作者");
  await assert.rejects(readdir(settings.skillsRoot), /ENOENT/);
});

test("版本按语义顺序选择，同名同版本不覆盖原内容", async (t) => {
  const { repository } = await createFixture(t);
  await repository.upload("one.zip", skillFixture("example", "1.2.0").zip, input);
  await repository.upload("two.zip", skillFixture("example", "1.10.0").zip, input);
  await repository.upload("pre.zip", skillFixture("example", "1.10.0-beta.1").zip, input);
  const detail = await repository.detail("skl_example");
  assert.equal(detail.version, "1.10.0");
  assert.deepEqual(detail.versions.map((item) => item.version), ["1.10.0", "1.10.0-beta.1", "1.2.0"]);
  await assert.rejects(repository.upload("duplicate.zip", skillFixture("example", "1.10.0").zip, { ...input, displayName: "不得覆盖" }), /本次未覆盖任何文件/);
  assert.equal((await repository.detail("skl_example")).title, "example");
  assert.ok(compareVersions("2.0.0", "1.10.0") > 0);
  assert.ok(compareVersions("1.0.0-beta.2", "1.0.0-beta.10") < 0);
});

test("版本、名称与 manifest hash 不一致时不会入库", async (t) => {
  const { repository } = await createFixture(t);
  await assert.rejects(repository.upload("wrong.zip", skillFixture("example").zip, { ...input, version: "2.0.0" }), /版本不一致/);
  const skill = Buffer.from("---\nname: actual-name\ndescription: 示例\n---\n");
  await assert.rejects(repository.upload("name.zip", testZip([{ path: "SKILL.md", content: skill }, { path: "manifest.json", content: Buffer.from(JSON.stringify({ code: "wrong-name", version: "1.0.0" })) }]), input), /name 不一致/);
  await assert.rejects(repository.upload("hash.zip", testZip([{ path: "SKILL.md", content: skill }, { path: "manifest.json", content: Buffer.from(JSON.stringify({ version: "1.0.0", files: [{ path: "SKILL.md", sha256: "0".repeat(64) }] })) }]), input), /文件校验失败/);
  assert.equal((await repository.search(skillHubQuerySchema.parse({}))).total, 0);
});

test("仓库文件变化不能作为正常包继续安装", async (t) => {
  const { repository } = await createFixture(t);
  await repository.upload("example.zip", skillFixture("example").zip, input);
  const target = path.join(repository.root, "example", "1.0.0", "files", "SKILL.md");
  const content = await readFile(target);
  content[content.length - 2] = 65;
  await writeFile(target, content);
  await assert.rejects(repository.package("skl_example"), /校验失败/);
});

test("分类、标签、已安装范围与分页基于完整仓库", async (t) => {
  const { repository } = await createFixture(t);
  for (let index = 0; index < 14; index++) await repository.upload("SKILL.md", Buffer.from(`---\nname: example-${index}\ndescription: 测试技能\n---\n`), { category: index % 2 ? "开发" : "写作", tags: ["测试"] });
  const second = await repository.search(skillHubQuerySchema.parse({ page: 2, sort: "name" }));
  assert.equal(second.total, 14);
  assert.equal(second.skills.length, 2);
  const installed = await repository.search(skillHubQuerySchema.parse({ scope: "installed" }), new Set(["skl_example-1"]));
  assert.deepEqual(installed.skills.map((skill) => skill.id), ["skl_example-1"]);
});
