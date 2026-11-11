import assert from "node:assert/strict";
import { mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateSkillFiles } from "./installations.js";
import { createFixture } from "./test-fixtures.js";

const markdown = Buffer.from("---\nname: example-skill\ndescription: 示例技能\n---\n# 示例\n");
const files = () => [{ path: "SKILL.md", content: markdown }];

test("完整安装嵌套和二进制文件，保存版本，脚本不会执行", async (t) => {
  const { settings, installer } = await createFixture(t);
  const binary = Buffer.from([0, 255, 17, 0, 98]);
  const installed = await installer.install("skl_example-skill", [...files(), { path: "assets/image.bin", content: binary }, { path: "scripts/run.sh", content: Buffer.from("#!/bin/sh\nexit 1\n"), executable: true }], "1.0.0");
  assert.equal(installed.path, path.join(settings.skillsRoot, "example-skill"));
  assert.deepEqual(await readFile(path.join(installed.path, "assets/image.bin")), binary);
  assert.equal((await stat(path.join(installed.path, "scripts/run.sh"))).mode & 0o111, 0o111);
  assert.deepEqual(await installer.list(), [installed]);
  assert.deepEqual(await readdir(settings.skillsRoot), ["example-skill"]);
});

test("路径穿越、绝对路径、重复路径与保留记录不能安装", () => {
  for (const invalid of ["../escape", "/absolute", "C:/escape", "a\\escape", "a//b", "a/./b", "a/../b", "a\0b", ".skillhub-installation.json", ".skillhub-package.json", "skill.md"]) assert.throws(() => validateSkillFiles([...files(), { path: invalid, content: Buffer.from("unsafe") }]), /非法路径|重复或保留路径/);
  assert.throws(() => validateSkillFiles([]), /安装包最多/);
  assert.throws(() => validateSkillFiles([{ path: "README.md", content: markdown }]), /缺少根目录/);
  assert.throws(() => validateSkillFiles([{ path: "SKILL.md", content: Buffer.from("---\nname: ../bad\ndescription: test\n---") }]), /name 必须/);
});

test("上传只解析 YAML frontmatter，不执行语言标记中的 JavaScript", () => {
  const state = globalThis as typeof globalThis & { __skillhubEngineProbe?: boolean };
  delete state.__skillhubEngineProbe;
  const content = Buffer.from('---javascript\n({name:"engine-check",description:"测试",probe:(globalThis.__skillhubEngineProbe=true)})\n---\n# 测试\n');
  try {
    assert.throws(() => validateSkillFiles([{ path: "SKILL.md", content }]), /YAML/);
    assert.equal(state.__skillhubEngineProbe, undefined);
  } finally { delete state.__skillhubEngineProbe; }
});

test("已有目录和符号链接不被覆盖", async (t) => {
  const { root, settings, installer } = await createFixture(t);
  const target = path.join(settings.skillsRoot, "example-skill");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "user.txt"), "original");
  await assert.rejects(installer.install("skl_example-skill", files(), "1.0.0"), /本次未覆盖任何文件/);
  assert.equal(await readFile(path.join(target, "user.txt"), "utf8"), "original");
  await symlink(root, path.join(settings.skillsRoot, "link-skill"));
  await assert.rejects(installer.install("skl_link-skill", [{ path: "SKILL.md", content: Buffer.from("---\nname: link-skill\ndescription: test\n---") }], "1.0.0"), /本次未覆盖任何文件/);
});

test("并发安装仅发布一次，正在运行的 Skill 受保护", async (t) => {
  const { settings, installer, locks } = await createFixture(t);
  const results = await Promise.allSettled([installer.install("skl_example-skill", files(), "1.0.0"), installer.install("skl_example-skill", files(), "1.0.0")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.deepEqual(await readdir(settings.skillsRoot), ["example-skill"]);
  locks.beginRun("running-skill");
  await assert.rejects(installer.install("skl_running-skill", [{ path: "SKILL.md", content: Buffer.from("---\nname: running-skill\ndescription: test\n---") }], "1.0.0"), /正在测试中/);
});

test("写入中途失败不会发布半成品目录", async (t) => {
  const { settings, installer } = await createFixture(t);
  await assert.rejects(installer.install("skl_example-skill", [...files(), { path: "conflict", content: Buffer.from("file") }, { path: "conflict/child", content: Buffer.from("child") }], "1.0.0"), /ENOTDIR|EEXIST/);
  assert.deepEqual(await readdir(settings.skillsRoot), []);
});
