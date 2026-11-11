import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SystemStatus } from "@skillhub/shared";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export type CodexExecutable = {
  path: string;
  source: NonNullable<SystemStatus["codex"]["source"]>;
};

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function findOnPath(command: string, searchPath: string): Promise<string | null> {
  const extensions = process.platform === "win32" && !path.extname(command)
    ? (process.env.PATHEXT ?? ".EXE").split(";")
    : [""];
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.resolve(directory, `${command}${extension}`);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

async function findDesktopExecutable(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  let discovered: string[] = [];
  try {
    const { stdout } = await execFileAsync("/usr/bin/mdfind", [
      'kMDItemCFBundleIdentifier == "com.openai.codex"',
    ], { timeout: 3_000, maxBuffer: 1024 * 1024 });
    discovered = stdout.split("\n").filter(Boolean).sort();
  } catch {
    // Spotlight may be disabled; standard installation paths remain usable.
  }
  const applications = new Set([
    ...discovered,
    ...["/Applications", path.join(os.homedir(), "Applications")].flatMap((directory) =>
      ["Codex.app", "ChatGPT.app"].map((name) => path.join(directory, name))),
  ]);
  for (const application of applications) {
    try {
      const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
        "-c", "Print :CFBundleIdentifier", path.join(application, "Contents/Info.plist"),
      ], { timeout: 2_000 });
      if (stdout.trim() !== "com.openai.codex") continue;
    } catch {
      continue;
    }
    for (const relative of [
      "Contents/Resources/codex-cli/bin/codex",
      "Contents/Resources/codex",
      "Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    ]) {
      const candidate = path.join(application, relative);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

export async function resolveCodexExecutable(
  configuredPath: string | null | undefined = config.codexPath,
  searchPath = process.env.PATH ?? "",
): Promise<CodexExecutable> {
  if (configuredPath !== undefined && configuredPath !== null) {
    const candidate = path.isAbsolute(configuredPath) || /[/\\]/.test(configuredPath)
      ? path.resolve(configuredPath)
      : await findOnPath(configuredPath, searchPath);
    if (candidate && await isExecutable(candidate)) return { path: candidate, source: "configured" };
    throw new Error("SKILLHUB_CODEX_PATH 指定的 Codex 程序不存在或不可执行，请检查配置");
  }
  const cli = await findOnPath("codex", searchPath);
  if (cli) return { path: cli, source: "path" };
  const desktop = await findDesktopExecutable();
  if (desktop) return { path: desktop, source: "desktop" };
  throw new Error(process.platform === "darwin"
    ? "未找到 Codex，请安装 Codex CLI 或 Codex Desktop，或设置 SKILLHUB_CODEX_PATH"
    : "未找到 Codex，请安装 Codex CLI 或设置 SKILLHUB_CODEX_PATH");
}
