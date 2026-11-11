import { createHash, randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { type HubInstallPlan, type HubInstallResult } from "@skillhub/shared";
import { verifyInstalledSkill } from "../codex/service.js";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import { computeSkillManifest } from "../skill-manifest.js";
import { SkillHubRepository, type StoredSkill } from "./catalog.js";
import { MAX_SKILL_BYTES, SkillInstaller, type SkillPackageFile } from "./installations.js";

type PreparedNode = { record: StoredSkill; files: SkillPackageFile[]; public: HubInstallPlan["nodes"][number] };

async function pathExists(target: string) {
  try { await lstat(target); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function installedFilesMatch(directory: string, files: SkillPackageFile[]) {
  const actual = (await computeSkillManifest(directory)).filter((file) => file.path !== ".skillhub-installation.json");
  return actual.length === files.length && files.every((file) => actual.some((entry) => entry.path === file.path && entry.sha256 === createHash("sha256").update(file.content).digest("hex") && entry.mode === (file.executable ? 0o755 : 0o644)));
}

export class SkillHubInstallService {
  private plan: { public: HubInstallPlan; nodes: PreparedNode[] } | undefined;
  private busy = false;

  constructor(
    private readonly repository: SkillHubRepository,
    private readonly installer: SkillInstaller,
    private readonly settings: Pick<typeof config, "skillsRoot" | "projectRoot"> = config,
    private readonly verifySkill: typeof verifyInstalledSkill = verifyInstalledSkill,
  ) {}

  async prepare(skillId: string, version?: string): Promise<HubInstallPlan> {
    if (this.busy) throw new HttpError(409, "SKILL_PLAN_BUSY", "正在准备或执行另一项安装，请稍后重试");
    this.busy = true;
    try {
      const installed = await this.installer.list();
      const nodes: PreparedNode[] = [];
      const selectedVersions = new Map<string, string>();
      const visiting = new Set<string>();
      const visited = new Set<string>();
      let bytes = 0;
      const visit = async (id: string, requestedVersion: string | undefined, depth: number): Promise<void> => {
        if (depth > 10) throw new HttpError(409, "DEPENDENCY_DEPTH_LIMIT", "Skill 依赖超过 10 层，请检查声明");
        const snapshot = await this.repository.package(id, requestedVersion);
        const { record, files } = snapshot;
        const previous = selectedVersions.get(id);
        if (previous && previous !== record.version) throw new HttpError(409, "DEPENDENCY_VERSION_CONFLICT", `Skill ${id} 同时依赖 ${previous} 和 ${record.version}，本次未执行安装`);
        if (visiting.has(id)) throw new HttpError(409, "DEPENDENCY_CYCLE", `Skill 依赖存在循环：${id}`);
        if (visited.has(id)) return;
        selectedVersions.set(id, record.version);
        if (selectedVersions.size > 100) throw new HttpError(409, "DEPENDENCY_COUNT_LIMIT", "整组安装超过 100 个 Skill");
        visiting.add(id);
        for (const dependency of record.dependencies.filter((item) => item.required)) await visit(dependency.id, dependency.version, depth + 1);
        visiting.delete(id);
        const target = path.join(this.settings.skillsRoot, record.name);
        let alreadyInstalled = false;
        if (await pathExists(target)) {
          const match = installed.find((item) => item.skillId === record.id && item.version === record.version && item.path === target);
          if (!match || !(await installedFilesMatch(target, files))) throw new HttpError(409, "SKILL_DIRECTORY_EXISTS", `安装目录已有其他版本或本地内容，本次未覆盖任何文件：${target}`);
          alreadyInstalled = true;
        }
        bytes += files.reduce((total, file) => total + file.content.length, 0);
        if (bytes > MAX_SKILL_BYTES) throw new HttpError(413, "SKILL_PLAN_TOO_LARGE", "整组安装内容超过 50 MB，请拆分依赖");
        nodes.push({ record, files, public: {
          skillId: record.id, name: record.name, title: record.title, version: record.version, path: target,
          fileCount: files.length, bytes: files.reduce((total, file) => total + file.content.length, 0), alreadyInstalled, dependencies: record.dependencies,
        } });
        visited.add(id);
      };
      await visit(skillId, version, 0);
      const plan: HubInstallPlan = { id: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), nodes: nodes.map((node) => node.public) };
      this.plan = { public: plan, nodes };
      return plan;
    } finally { this.busy = false; }
  }

  async install(planId: string): Promise<HubInstallResult> {
    if (this.busy) throw new HttpError(409, "SKILL_INSTALL_BUSY", "已有安装正在执行，请稍后重试");
    const plan = this.plan;
    if (!plan || plan.public.id !== planId || Date.parse(plan.public.expiresAt) <= Date.now()) throw new HttpError(409, "SKILL_PLAN_EXPIRED", "安装计划已失效或已使用，请重新预览并确认");
    this.plan = undefined;
    this.busy = true;
    const result: HubInstallResult = { installations: [], codexErrors: [], error: null, skipped: [] };
    try {
      for (let index = 0; index < plan.nodes.length; index++) {
        const node = plan.nodes[index]!;
        try {
          const latestSnapshot = await this.repository.package(node.record.id, node.record.version);
          if (JSON.stringify(latestSnapshot.record) !== JSON.stringify(node.record)) throw new HttpError(409, "SKILL_CHANGED_AFTER_REVIEW", "Skill 在预览后发生变化，请重新准备安装计划");
          let installation;
          if (node.public.alreadyInstalled) {
            installation = (await this.installer.list()).find((item) => item.skillId === node.record.id && item.version === node.record.version);
            if (!installation || !(await installedFilesMatch(installation.path, node.files))) throw new HttpError(409, "SKILL_CHANGED_AFTER_REVIEW", "已安装的 Skill 在预览后发生变化，请先保留本地修改");
          } else { installation = await this.installer.install(node.record.id, node.files, node.record.version); }
          result.installations.push(installation);
          const cwd = path.basename(this.settings.skillsRoot) === "skills" && path.basename(path.dirname(this.settings.skillsRoot)) === ".agents" ? path.dirname(path.dirname(this.settings.skillsRoot)) : this.settings.projectRoot;
          try { await this.verifySkill(path.join(installation.path, "SKILL.md"), cwd); }
          catch {
            result.codexErrors.push(`${node.record.title}：文件已安装，Codex 识别校验未完成，请检查 Codex 连接与安装目录`);
            if (index < plan.nodes.length - 1) throw new HttpError(409, "DEPENDENCY_NOT_RECOGNIZED", "必需依赖未通过 Codex 识别校验，后续安装已停止");
          }
        } catch (error) {
          result.error = error instanceof HttpError ? error.message : `${node.record.title} 安装未完成，已保留现有文件，请检查本机目录`;
          result.skipped = plan.nodes.slice(index + 1).map((item) => item.record.title);
          break;
        }
      }
      return result;
    } finally { this.busy = false; }
  }
}
