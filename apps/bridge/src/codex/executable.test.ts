import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveCodexExecutable } from "./executable.js";

test("显式配置优先于 PATH，支持包含空格的路径", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillhub-codex-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "Desktop Codex");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  assert.deepEqual(await resolveCodexExecutable(executable, process.env.PATH), {
    path: executable, source: "configured",
  });
});

test("无效的显式配置不会回退到已安装的 Codex", async () => {
  await assert.rejects(resolveCodexExecutable("/nonexistent/skillhub/codex"), /SKILLHUB_CODEX_PATH/);
});

test("拒绝目录和无执行权限的文件", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillhub-codex-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(resolveCodexExecutable(root), /不可执行/);
  const file = path.join(root, "codex");
  await writeFile(file, "text");
  await chmod(file, 0o644);
  await assert.rejects(resolveCodexExecutable(file), /不可执行/);
});

test("PATH 按顺序查找并返回绝对路径，优先于 Desktop", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillhub-codex-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  const name = process.platform === "win32" ? "codex.EXE" : "codex";
  for (const directory of [first, second]) {
    await writeFile(path.join(directory, name), "fixture", { mode: 0o755 });
  }
  const searchPath = [first, second].join(path.delimiter);
  assert.deepEqual(await resolveCodexExecutable(null, searchPath), {
    path: path.join(first, name), source: "path",
  });
  assert.deepEqual(await resolveCodexExecutable(name, searchPath), {
    path: path.join(first, name), source: "configured",
  });
});
