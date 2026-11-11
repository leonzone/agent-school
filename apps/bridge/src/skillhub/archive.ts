import { fromBufferPromise } from "yauzl";
import { HttpError } from "../errors.js";
import { assertSkillPath, MAX_SKILL_BYTES, validateSkillFiles, type SkillPackageFile } from "./installations.js";

export async function readSkillZip(archive: Buffer): Promise<SkillPackageFile[]> {
  if (archive.length > MAX_SKILL_BYTES) throw new HttpError(413, "SKILL_ARCHIVE_TOO_LARGE", "Skill ZIP 超过 50 MB 限制");
  const files: SkillPackageFile[] = [];
  try {
    const zip = await fromBufferPromise(archive, { strictFileNames: true, validateEntrySizes: true });
    if (zip.entryCount > 2000) throw new Error("ZIP 条目过多");
    let total = 0;
    for await (const entry of zip.eachEntry()) {
      const entryPath = entry.fileName.replace(/\/$/, "");
      assertSkillPath(entryPath);
      const mode = entry.externalFileAttributes >>> 16;
      const type = mode & 0xf000;
      if (entry.isEncrypted() || ![0, 0x8000, 0x4000].includes(type)) throw new Error("ZIP 不允许加密文件、链接或特殊文件");
      if (entry.fileName.endsWith("/")) continue;
      if (type === 0x4000) throw new Error("ZIP 文件类型与路径不一致");
      total += entry.uncompressedSize;
      if (files.length >= 1000 || total > MAX_SKILL_BYTES) throw new Error("ZIP 解压大小或文件数量超过限制");
      if (entry.fileName.startsWith("__MACOSX/") || entry.fileName.split("/").at(-1) === ".DS_Store") continue;
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let actualSize = 0;
      for await (const chunk of stream) {
        actualSize += (chunk as Buffer).length;
        if (actualSize > entry.uncompressedSize) throw new Error("ZIP 文件大小与声明不一致");
        chunks.push(Buffer.from(chunk as Buffer));
      }
      files.push({ path: entry.fileName, content: Buffer.concat(chunks), executable: Boolean(mode & 0o111) });
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_SKILL_ZIP", "Skill ZIP 无法安全读取，可能包含非法路径、链接或超限内容");
  }
  let selectedFiles = files;
  if (!files.some((file) => file.path === "SKILL.md")) {
    const prefix = `${files[0]?.path.split("/")[0] ?? ""}/`;
    if (files.length && files.every((file) => file.path.startsWith(prefix)) && files.some((file) => file.path === `${prefix}SKILL.md`)) {
      selectedFiles = files.map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
    }
  }
  validateSkillFiles(selectedFiles);
  return selectedFiles;
}

export async function readSkillUpload(fileName: string, content: Buffer): Promise<SkillPackageFile[]> {
  if (fileName.toLowerCase().endsWith(".zip")) return readSkillZip(content);
  if (fileName !== "SKILL.md") throw new HttpError(400, "INVALID_SKILL_UPLOAD", "请选择 Skill ZIP 安装包或 SKILL.md 文件");
  const files = [{ path: "SKILL.md", content }];
  validateSkillFiles(files);
  return files;
}

