import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  hubDependencySchema, hubSkillIdSchema, hubUploadInputSchema, hubVersionSchema, skillIdSchema,
  type HubFile, type HubSkill, type HubSkillDetail, type HubUploadInput, type SkillHubCatalog, type SkillHubQuery,
} from "@skillhub/shared";
import { HttpError } from "../errors.js";
import { readSkillUpload } from "./archive.js";
import { assertSkillPath, MAX_SKILL_BYTES, parseSkillMarkdown, publishNewSkillDirectory, validateSkillFiles, type SkillPackageFile } from "./installations.js";

const METADATA_FILE = ".skillhub-package.json";
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const fileSchema = z.object({ path: z.string(), size: z.number().int().nonnegative(), sha256: hashSchema, executable: z.boolean() });
const metadataSchema = z.object({
  id: hubSkillIdSchema, name: skillIdSchema, title: z.string().min(1).max(100), description: z.string().min(1).max(10000),
  author: z.string().min(1).max(80), category: z.string().max(100), tags: z.array(z.string().min(1).max(50)).max(20),
  version: hubVersionSchema, uploadedAt: z.string().datetime(), files: z.array(fileSchema).min(1).max(1000),
  dependencies: z.array(hubDependencySchema).max(100), sourceSha256: hashSchema,
});
export type StoredSkill = z.infer<typeof metadataSchema>;
const manifestSchema = z.object({ code: z.string().optional(), version: hubVersionSchema.optional(), type: z.literal("skill").optional(), displayName: z.string().optional(), files: z.array(z.object({ path: z.string(), sha256: hashSchema })).optional(), dependsOn: z.array(hubDependencySchema).max(100).optional() });

export function compareVersions(left: string, right: string): number {
  const [leftCore = "", leftPre] = left.split(/-(.*)/s);
  const [rightCore = "", rightPre] = right.split(/-(.*)/s);
  const core = leftCore.localeCompare(rightCore, "en", { numeric: true });
  if (core) return core;
  if (leftPre === undefined || rightPre === undefined) return leftPre === rightPre ? 0 : leftPre === undefined ? 1 : -1;
  const a = leftPre.split(".");
  const b = rightPre.split(".");
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === undefined || b[index] === undefined) return a[index] === b[index] ? 0 : a[index] === undefined ? -1 : 1;
    const first = a[index]!;
    const second = b[index]!;
    if (first === second) continue;
    if (/^\d+$/.test(first) !== /^\d+$/.test(second)) return /^\d+$/.test(first) ? -1 : 1;
    return first.localeCompare(second, "en", { numeric: true });
  }
  return 0;
}

function summary(record: StoredSkill): HubSkill {
  return {
    id: record.id, name: record.name, title: record.title, description: record.description, author: record.author,
    category: record.category, tags: record.tags, version: record.version, uploadedAt: record.uploadedAt,
    fileCount: record.files.length, bytes: record.files.reduce((total, file) => total + file.size, 0),
  };
}

export class SkillHubRepository {
  constructor(readonly root: string) {}

  private versionPath(name: string, version: string) {
    return path.join(this.root, skillIdSchema.parse(name), hubVersionSchema.parse(version));
  }

  private async versions(name: string): Promise<StoredSkill[]> {
    const directory = path.join(this.root, name);
    let entries: Dirent[];
    try {
      if (!(await lstat(directory)).isDirectory()) throw new HttpError(409, "INVALID_SKILL_STORAGE", `Skill 仓库目录不是普通目录：${directory}`);
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: StoredSkill[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory() || !hubVersionSchema.safeParse(entry.name).success) throw new HttpError(409, "INVALID_SKILL_STORAGE", `Skill 仓库含有无效版本目录：${path.join(directory, entry.name)}`);
      const metadataPath = path.join(directory, entry.name, METADATA_FILE);
      let raw: string;
      try {
        const file = await lstat(metadataPath);
        if (!file.isFile() || file.size > 2 * 1024 * 1024) throw new HttpError(409, "INVALID_SKILL_STORAGE", `Skill 版本记录不是有效的普通文件：${metadataPath}`);
        raw = await readFile(metadataPath, "utf8");
      } catch (error) {
        // An exclusively reserved directory is invisible until atomic publication finishes.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      let record: StoredSkill;
      try { record = metadataSchema.parse(JSON.parse(raw)); }
      catch { throw new HttpError(409, "INVALID_SKILL_STORAGE", `Skill 版本记录损坏：${metadataPath}`); }
      if (record.name !== name || record.id !== `skl_${name}` || record.version !== entry.name || record.files.reduce((sum, file) => sum + file.size, 0) > MAX_SKILL_BYTES) throw new HttpError(409, "INVALID_SKILL_STORAGE", `Skill 版本记录与目录不一致：${metadataPath}`);
      const seen = new Set<string>();
      for (const file of record.files) {
        assertSkillPath(file.path);
        const key = file.path.normalize("NFC").toLowerCase();
        if (seen.has(key)) throw new HttpError(409, "INVALID_SKILL_STORAGE", `Skill 版本记录含重复路径：${metadataPath}`);
        seen.add(key);
      }
      records.push(record);
    }
    return records.sort((a, b) => compareVersions(b.version, a.version));
  }

  async resolve(idInput: string, version?: string): Promise<StoredSkill> {
    const id = hubSkillIdSchema.parse(idInput);
    if (version !== undefined) hubVersionSchema.parse(version);
    const versions = await this.versions(id.slice(4));
    const record = version ? versions.find((item) => item.version === version) : versions[0];
    if (!record) throw new HttpError(404, "HUB_SKILL_NOT_FOUND", `没有找到 Skill ${id}${version ? ` 的 ${version} 版本` : ""}`);
    return record;
  }

  async search(query: SkillHubQuery, installedIds = new Set<string>()): Promise<SkillHubCatalog> {
    let entries: Dirent[];
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") entries = []; else throw error; }
    const all: StoredSkill[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory() || !skillIdSchema.safeParse(entry.name).success) throw new HttpError(409, "INVALID_SKILL_STORAGE", `Skill 仓库含有无效目录：${entry.name}`);
      const latest = (await this.versions(entry.name))[0];
      if (latest) all.push(latest);
    }
    const keyword = query.keyword.toLocaleLowerCase();
    const matching = all.filter((record) =>
      (!keyword || [record.title, record.name, record.description, record.author, record.category, ...record.tags].some((value) => value.toLocaleLowerCase().includes(keyword))) &&
      (query.scope !== "installed" || installedIds.has(record.id)) &&
      (!query.category || record.category === query.category) && (!query.tag || record.tags.includes(query.tag)),
    );
    matching.sort(query.sort === "name" ? (a, b) => a.title.localeCompare(b.title, "zh-CN") : (a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.id.localeCompare(b.id));
    const pageSize = 12;
    return {
      skills: matching.slice((query.page - 1) * pageSize, query.page * pageSize).map(summary), total: matching.length, page: query.page, pageSize,
      facets: { categories: [...new Set(all.map((record) => record.category).filter(Boolean))].sort(), tags: [...new Set(all.flatMap((record) => record.tags))].sort() },
    };
  }

  private async file(record: StoredSkill, entry: HubFile): Promise<Buffer> {
    const directory = path.join(this.versionPath(record.name, record.version), "files");
    if (!(await lstat(directory)).isDirectory()) throw new HttpError(409, "SKILL_PACKAGE_CHANGED", "Skill 文件目录已被替换，请检查仓库");
    const target = path.join(directory, entry.path);
    const file = await lstat(target);
    if (!file.isFile() || file.size !== entry.size) throw new HttpError(409, "SKILL_PACKAGE_CHANGED", `Skill 文件类型或大小已改变：${entry.path}`);
    const actual = await realpath(target);
    const root = await realpath(directory);
    if (!actual.startsWith(`${root}${path.sep}`)) throw new HttpError(409, "SKILL_PACKAGE_CHANGED", `Skill 文件指向仓库外：${entry.path}`);
    const content = await readFile(target);
    if (createHash("sha256").update(content).digest("hex") !== entry.sha256) throw new HttpError(409, "SKILL_PACKAGE_CHANGED", `Skill 文件校验失败：${entry.path}`);
    return content;
  }

  async package(id: string, version?: string): Promise<{ record: StoredSkill; files: SkillPackageFile[] }> {
    const record = await this.resolve(id, version);
    const files: SkillPackageFile[] = [];
    for (const entry of record.files) files.push({ path: entry.path, content: await this.file(record, entry), executable: entry.executable });
    validateSkillFiles(files);
    return { record, files };
  }

  async detail(id: string, version?: string): Promise<HubSkillDetail> {
    const record = await this.resolve(id, version);
    const skill = record.files.find((file) => file.path === "SKILL.md");
    if (!skill) throw new HttpError(409, "INVALID_SKILL_STORAGE", "Skill 版本记录缺少 SKILL.md");
    const skillMarkdown = (await this.file(record, skill)).toString("utf8");
    const readme = record.files.find((file) => file.path === "README.md" && file.size <= 512 * 1024);
    const markdown = readme ? (await this.file(record, readme)).toString("utf8") : parseSkillMarkdown(skillMarkdown).content;
    return { ...summary(record), markdown, skillMarkdown, files: record.files, versions: (await this.versions(record.name)).map((item) => ({ version: item.version, uploadedAt: item.uploadedAt })), dependencies: record.dependencies };
  }

  async upload(fileName: string, content: Buffer, input: HubUploadInput): Promise<HubSkillDetail> {
    const options = hubUploadInputSchema.parse(input);
    const files = await readSkillUpload(fileName, content);
    const name = validateSkillFiles(files);
    const skill = files.find((file) => file.path === "SKILL.md")!;
    if (skill.content.length > 512 * 1024) throw new HttpError(413, "SKILL_MARKDOWN_TOO_LARGE", "SKILL.md 不能超过 512 KB");
    const frontmatter = parseSkillMarkdown(skill.content.toString("utf8")).data;
    let manifest: z.infer<typeof manifestSchema> = {};
    const manifestFile = files.find((file) => file.path === "manifest.json");
    if (manifestFile) {
      try {
        manifest = manifestSchema.parse(JSON.parse(manifestFile.content.toString("utf8")));
      } catch { throw new HttpError(400, "INVALID_SKILL_MANIFEST", "manifest.json 的内容、版本或依赖声明无效"); }
      if (manifest.code && manifest.code !== name) throw new HttpError(400, "SKILL_NAME_MISMATCH", "manifest.json 的 code 与 SKILL.md 的 name 不一致");
      if (manifest.files) {
        if (manifest.files.length !== files.length - 1 || new Set(manifest.files.map((entry) => entry.path)).size !== manifest.files.length) throw new HttpError(400, "INVALID_SKILL_MANIFEST", "manifest.json 的文件清单与 ZIP 不一致");
        for (const entry of manifest.files) {
          const file = files.find((candidate) => candidate.path === entry.path);
          if (!file || createHash("sha256").update(file.content).digest("hex") !== entry.sha256) throw new HttpError(400, "INVALID_SKILL_MANIFEST", `manifest.json 文件校验失败：${entry.path}`);
        }
      }
    }
    const declaredVersions = [options.version, manifest.version, frontmatter.version].filter((value) => value !== undefined);
    if (declaredVersions.some((version) => typeof version !== "string" || !hubVersionSchema.safeParse(version).success) || new Set(declaredVersions).size > 1) throw new HttpError(400, "SKILL_VERSION_MISMATCH", "填写的版本与安装包内的版本不一致，或版本格式无效");
    const version = hubVersionSchema.parse(declaredVersions[0] ?? "1.0.0");
    const record = metadataSchema.parse({
      id: `skl_${name}`, name, version, title: options.displayName ?? manifest.displayName ?? name,
      description: String(frontmatter.description).trim(), author: options.author ?? (typeof frontmatter.author === "string" && frontmatter.author.trim() ? frontmatter.author.trim() : "本机用户"),
      category: options.category, tags: [...new Set(options.tags)], uploadedAt: new Date().toISOString(), dependencies: manifest.dependsOn ?? [],
      sourceSha256: createHash("sha256").update(content).digest("hex"),
      files: files.map((file) => ({ path: file.path, size: file.content.length, sha256: createHash("sha256").update(file.content).digest("hex"), executable: Boolean(file.executable) })),
    });
    await mkdir(this.root, { recursive: true });
    const parent = path.join(this.root, name);
    try {
      if (!(await lstat(parent)).isDirectory()) throw new HttpError(409, "INVALID_SKILL_STORAGE", `Skill 仓库目录被替换：${parent}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try {
      await publishNewSkillDirectory(this.versionPath(name, version), [
        ...files.map((file) => ({ ...file, path: `files/${file.path}` })),
        { path: METADATA_FILE, content: Buffer.from(JSON.stringify(record, null, 2)) },
      ]);
    } catch (error) {
      if (error instanceof HttpError && error.code === "SKILL_DIRECTORY_EXISTS") throw new HttpError(409, "SKILL_VERSION_EXISTS", `${name} ${version} 已存在，本次未覆盖任何文件；请上传新版本`);
      throw error;
    }
    return this.detail(record.id, version);
  }
}
