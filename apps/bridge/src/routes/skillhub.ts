import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hubInstallConfirmationSchema, hubSkillIdSchema, hubUploadInputSchema, hubVersionSchema, skillHubQuerySchema } from "@skillhub/shared";
import { HttpError } from "../errors.js";
import { SkillHubRepository } from "../skillhub/catalog.js";
import { MAX_SKILL_BYTES, SkillInstaller } from "../skillhub/installations.js";
import { skillHubMcpInfo } from "../skillhub/mcp-client.js";
import { SkillHubInstallService } from "../skillhub/service.js";

export function registerSkillHubRoutes(app: FastifyInstance, repository: SkillHubRepository, installer: SkillInstaller, installs = new SkillHubInstallService(repository, installer)) {
  app.get("/api/skillhub/mcp", async (_request, reply) => reply.header("Cache-Control", "no-store").send(skillHubMcpInfo()));
  app.get("/api/skillhub/installations", async () => ({ installations: await installer.list() }));
  app.get("/api/skillhub/skills", async (request) => repository.search(skillHubQuerySchema.parse(request.query), new Set((await installer.list()).map((item) => item.skillId))));
  app.get("/api/skillhub/skills/:id", async (request) => {
    const { id } = request.params as { id: string };
    const { version } = z.object({ version: hubVersionSchema.optional() }).parse(request.query);
    return repository.detail(hubSkillIdSchema.parse(id), version);
  });
  app.post("/api/skillhub/uploads", async (request, reply) => {
    if (!request.isMultipart()) throw new HttpError(400, "MULTIPART_REQUIRED", "请使用文件上传表单提交 Skill");
    const fields: Record<string, string> = {};
    let upload: { name: string; content: Buffer } | undefined;
    for await (const part of request.parts({ limits: { files: 1, fields: 5, parts: 6, fileSize: MAX_SKILL_BYTES, fieldSize: 16 * 1024 } })) {
      if (part.type === "field") {
        if (!["version", "displayName", "author", "category", "tags"].includes(part.fieldname) || Object.hasOwn(fields, part.fieldname)) throw new HttpError(400, "INVALID_UPLOAD_FIELD", `上传字段无效或重复：${part.fieldname}`);
        if (part.fieldnameTruncated || part.valueTruncated) throw new HttpError(413, "UPLOAD_FIELD_TOO_LARGE", "Skill 上传信息过长");
        fields[part.fieldname] = String(part.value);
      } else {
        if (part.fieldname !== "file" || upload) throw new HttpError(400, "INVALID_UPLOAD_FIELD", "请选择一个 Skill 安装包文件");
        const content = await part.toBuffer();
        if (part.file.truncated) throw new HttpError(413, "SKILL_UPLOAD_TOO_LARGE", "Skill 安装包不能超过 50 MB");
        upload = { name: part.filename, content };
      }
    }
    if (!upload) throw new HttpError(400, "SKILL_UPLOAD_REQUIRED", "请选择 Skill ZIP 或 SKILL.md 文件");
    const optional = (name: string) => fields[name]?.trim() || undefined;
    const input = hubUploadInputSchema.parse({
      ...(optional("version") ? { version: optional("version") } : {}),
      ...(optional("displayName") ? { displayName: optional("displayName") } : {}),
      ...(optional("author") ? { author: optional("author") } : {}),
      category: fields.category ?? "", tags: (fields.tags ?? "").split(/[,，、\n]/).map((tag) => tag.trim()).filter(Boolean),
    });
    const skill = await repository.upload(upload.name, upload.content, input);
    return reply.code(201).send(skill);
  });
  app.post("/api/skillhub/skills/:id/plan", async (request) => {
    const { id } = request.params as { id: string };
    const { version } = z.object({ version: hubVersionSchema.optional() }).strict().parse(request.body ?? {});
    return installs.prepare(hubSkillIdSchema.parse(id), version);
  });
  app.post("/api/skillhub/installations", async (request) => installs.install(hubInstallConfirmationSchema.parse(request.body).planId));
}
