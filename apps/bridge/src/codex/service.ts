import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { v2 } from "@skillhub/codex-protocol";
import type { SystemStatus } from "@skillhub/shared";
import { config } from "../config.js";
import { AppServerClient } from "./app-server-client.js";

const execFileAsync = promisify(execFile);

export async function readCodexVersion(): Promise<string> {
  const { stdout } = await execFileAsync(config.codexPath, ["--version"], {
    timeout: 5_000,
    windowsHide: true,
  });
  const version = stdout.trim().match(/codex-cli\s+(\S+)/)?.[1];
  if (!version) throw new Error(`无法识别 Codex 版本输出: ${stdout.trim()}`);
  return version;
}

export async function getCodexStatus(): Promise<SystemStatus["codex"]> {
  let version: string | null = null;
  try {
    version = await readCodexVersion();
    const compatible = version === config.verifiedCodexVersion;
    if (!compatible) {
      return {
        available: true,
        version,
        compatible: false,
        loggedIn: false,
        accountType: null,
        error: `当前版本未经验证，请使用 codex-cli ${config.verifiedCodexVersion}`,
      };
    }
    const client = await AppServerClient.start();
    try {
      const account = await client.call<v2.GetAccountResponse>("account/read", { refreshToken: false });
      return {
        available: true,
        version,
        compatible,
        loggedIn: account.account !== null || !account.requiresOpenaiAuth,
        accountType: account.account?.type ?? null,
        error: account.account === null && account.requiresOpenaiAuth
          ? "Codex 尚未登录，请先在终端运行 codex login"
          : null,
      };
    } finally {
      await client.stop();
    }
  } catch (error) {
    return {
      available: version !== null,
      version,
      compatible: version === config.verifiedCodexVersion,
      loggedIn: false,
      accountType: null,
      error: error instanceof Error ? error.message : "无法连接 Codex",
    };
  }
}

export async function verifyInstalledSkill(skillPath: string, cwd: string): Promise<void> {
  const client = await AppServerClient.start();
  try {
    const result = await client.call<v2.SkillsListResponse>("skills/list", {
      cwds: [cwd],
      forceReload: true,
    });
    const expectedPath = path.resolve(skillPath);
    const skills = result.data.flatMap((entry: v2.SkillsListEntry) => entry.skills);
    const match = skills.find((skill: v2.SkillMetadata) => path.resolve(skill.path) === expectedPath);
    if (!match) {
      const errors = result.data.flatMap((entry: v2.SkillsListEntry) => entry.errors).map((entry: v2.SkillErrorInfo) => JSON.stringify(entry));
      throw new Error(`Codex 未发现 ${expectedPath}${errors.length ? `；${errors.join("；")}` : ""}`);
    }
    if (!match.enabled) throw new Error(`Codex 已发现 Skill，但它处于禁用状态: ${expectedPath}`);
  } finally {
    await client.stop();
  }
}
