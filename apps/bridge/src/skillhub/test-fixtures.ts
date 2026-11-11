import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import type { HubDependency } from "@skillhub/shared";
import { InstallationService } from "../installations.js";
import { SkillHubRepository } from "./catalog.js";
import { SkillInstaller } from "./installations.js";
import { SkillHubInstallService } from "./service.js";

export function testZip(entries: Array<{ path: string; content: Buffer; mode?: number }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    let crc = 0xffffffff;
    for (const byte of entry.content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(entry.content.length, 18);
    header.writeUInt32LE(entry.content.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(entry.content.length, 20);
    directory.writeUInt32LE(entry.content.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, entry.content);
    central.push(directory, name);
    offset += header.length + name.length + entry.content.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function skillFixture(name: string, version = "1.0.0", dependencies: HubDependency[] = []) {
  const files = [{ path: "SKILL.md", content: Buffer.from(`---\nname: ${name}\ndescription: 测试技能\n---\n# 测试说明\n`) }];
  const manifest = { code: name, version, type: "skill", dependsOn: dependencies, files: files.map((file) => ({ path: file.path, sha256: createHash("sha256").update(file.content).digest("hex") })) };
  const zip = testZip([...files, { path: "manifest.json", content: Buffer.from(JSON.stringify(manifest)) }]);
  return { files, zip, hash: createHash("sha256").update(zip).digest("hex") };
}

export async function createFixture(t: TestContext) {
  const scratch = fileURLToPath(new URL("../../../../.tmp/skillhub-completion/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "test-"));
  const db = new DatabaseSync(":memory:");
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const settings = { home: root, projectRoot: path.join(root, "workspace"), skillsRoot: path.join(root, "workspace", ".agents", "skills") };
  const repository = new SkillHubRepository(path.join(root, "skillhub"));
  const locks = new InstallationService(db);
  const installer = new SkillInstaller(settings.skillsRoot, locks);
  const installs = new SkillHubInstallService(repository, installer, settings, async () => {});
  return { root, settings, repository, locks, installer, installs };
}
