import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SkillHubInstallService } from "./service.js";
import { createFixture, skillFixture } from "./test-fixtures.js";

const input = { category: "", tags: [] };

test("安装计划只读，确认后发布并验证，过期或已使用计划不可重放", async (t) => {
  const { root, settings, repository, installer } = await createFixture(t);
  await repository.upload("example.zip", skillFixture("example").zip, input);
  let checks = 0;
  const service = new SkillHubInstallService(repository, installer, settings, async (skillPath, cwd) => { checks++; assert.equal(cwd, settings.projectRoot); assert.match(await readFile(skillPath, "utf8"), /name: example/); });
  const plan = await service.prepare("skl_example");
  assert.equal(plan.nodes[0]?.version, "1.0.0");
  await assert.rejects(readdir(settings.skillsRoot), /ENOENT/);
  await assert.rejects(service.install("0".repeat(64)), /计划已失效/);
  const result = await service.install(plan.id);
  assert.equal(result.error, null);
  assert.deepEqual(result.codexErrors, []);
  assert.equal(result.installations.length, 1);
  assert.equal(checks, 1);
  await assert.rejects(service.install(plan.id), /计划已失效/);
  const reused = await service.prepare("skl_example");
  assert.equal(reused.nodes[0]?.alreadyInstalled, true);
  assert.equal((await service.install(reused.id)).error, null);
  assert.ok(root.startsWith(path.resolve(".tmp")));
});

test("同名用户目录、预览后的变化与版本冲突不会被覆盖", async (t) => {
  const { settings, repository, installs } = await createFixture(t);
  await repository.upload("example.zip", skillFixture("example").zip, input);
  const plan = await installs.prepare("skl_example");
  await mkdir(path.join(settings.skillsRoot, "example"), { recursive: true });
  await writeFile(path.join(settings.skillsRoot, "example", "user.txt"), "keep me");
  const result = await installs.install(plan.id);
  assert.match(result.error!, /未覆盖任何文件/);
  assert.equal(await readFile(path.join(settings.skillsRoot, "example", "user.txt"), "utf8"), "keep me");
});

test("缺少必需依赖或出现循环时整组安装在落盘前停止", async (t) => {
  const { repository, settings, installs } = await createFixture(t);
  await repository.upload("root.zip", skillFixture("root", "1.0.0", [{ type: "skill", id: "skl_dependency", version: "1.0.0", required: true }]).zip, input);
  await assert.rejects(installs.prepare("skl_root"), /没有找到 Skill skl_dependency/);
  await repository.upload("dependency.zip", skillFixture("dependency", "1.0.0", [{ type: "skill", id: "skl_root", version: "1.0.0", required: true }]).zip, input);
  await assert.rejects(installs.prepare("skl_root"), /依赖存在循环/);
  await assert.rejects(readdir(settings.skillsRoot), /ENOENT/);
});

test("锁定精确版本并按依赖先行安装，可选依赖不自动安装", async (t) => {
  const { repository, installs } = await createFixture(t);
  await repository.upload("dependency.zip", skillFixture("dependency", "1.0.0").zip, input);
  await repository.upload("new.zip", skillFixture("dependency", "2.0.0").zip, input);
  await repository.upload("root.zip", skillFixture("root", "1.0.0", [{ type: "skill", id: "skl_dependency", version: "1.0.0", required: true }, { type: "skill", id: "skl_optional", version: "1.0.0", required: false }]).zip, input);
  const plan = await installs.prepare("skl_root");
  assert.deepEqual(plan.nodes.map((node) => `${node.skillId}@${node.version}`), ["skl_dependency@1.0.0", "skl_root@1.0.0"]);
  const result = await installs.install(plan.id);
  assert.equal(result.error, null);
  assert.deepEqual(result.installations.map((item) => item.name), ["dependency", "root"]);
});

test("依赖识别失败时保留已完成文件，并明确列出未执行根包", async (t) => {
  const { repository, installer, settings } = await createFixture(t);
  await repository.upload("dependency.zip", skillFixture("dependency").zip, input);
  await repository.upload("root.zip", skillFixture("root", "1.0.0", [{ type: "skill", id: "skl_dependency", version: "1.0.0", required: true }]).zip, input);
  const service = new SkillHubInstallService(repository, installer, settings, async () => { throw new Error("unavailable"); });
  const plan = await service.prepare("skl_root");
  const result = await service.install(plan.id);
  assert.equal(result.installations.length, 1);
  assert.equal(result.codexErrors.length, 1);
  assert.match(result.error!, /必需依赖未通过/);
  assert.deepEqual(result.skipped, ["root"]);
});
