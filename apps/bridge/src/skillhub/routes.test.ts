import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { ZodError } from "zod";
import { HttpError } from "../errors.js";
import { registerSkillHubRoutes } from "../routes/skillhub.js";
import { createFixture, skillFixture, testZip } from "./test-fixtures.js";

function uploadBody(content: Buffer, fields: Record<string, string> = {}) {
  const boundary = "skillhub-test-boundary";
  const chunks = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skill.zip"\r\nContent-Type: application/zip\r\n\r\n`), content, Buffer.from("\r\n")];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function appFixture(t: Parameters<typeof createFixture>[0]) {
  const fixture = await createFixture(t);
  const app = Fastify();
  await app.register(multipart, { limits: { files: 10, fileSize: 10 * 1024 * 1024, fields: 10 } });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof HttpError ? error.statusCode : error instanceof ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 500).send({ error: error instanceof Error ? error.message : "操作失败" }));
  registerSkillHubRoutes(app, fixture.repository, fixture.installer, fixture.installs);
  t.after(() => app.close());
  return { ...fixture, app };
}

test("HTTP 上传、列表、详情、预览和确认安装完成同一条真实路由链路", async (t) => {
  const { app, settings } = await appFixture(t);
  const uploaded = await app.inject({ method: "POST", url: "/api/skillhub/uploads", ...uploadBody(skillFixture("http-example").zip, { displayName: "接口上传测试", category: "开发", tags: "HTTP，MCP" }) });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  assert.equal(uploaded.json().fileCount, 2);
  const listed = await app.inject({ method: "GET", url: "/api/skillhub/skills?keyword=HTTP" });
  assert.equal(listed.json().total, 1);
  const detail = await app.inject({ method: "GET", url: "/api/skillhub/skills/skl_http-example?version=1.0.0" });
  assert.equal(detail.json().title, "接口上传测试");
  const plan = await app.inject({ method: "POST", url: "/api/skillhub/skills/skl_http-example/plan", payload: { version: "1.0.0" } });
  assert.equal(plan.statusCode, 200, plan.body);
  const denied = await app.inject({ method: "POST", url: "/api/skillhub/installations", payload: { planId: plan.json().id, confirm: false } });
  assert.equal(denied.statusCode, 400);
  const installed = await app.inject({ method: "POST", url: "/api/skillhub/installations", payload: { planId: plan.json().id, confirm: true } });
  assert.equal(installed.json().error, null);
  assert.match(await readFile(path.join(settings.skillsRoot, "http-example", "SKILL.md"), "utf8"), /name: http-example/);
});

test("上传错误与重复版本返回明确状态，不覆盖已有版本", async (t) => {
  const { app } = await appFixture(t);
  const first = await app.inject({ method: "POST", url: "/api/skillhub/uploads", ...uploadBody(skillFixture("example").zip) });
  assert.equal(first.statusCode, 201);
  const duplicate = await app.inject({ method: "POST", url: "/api/skillhub/uploads", ...uploadBody(skillFixture("example").zip) });
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.body, /请上传新版本/);
  const invalid = await app.inject({ method: "POST", url: "/api/skillhub/uploads", ...uploadBody(Buffer.from("not a zip")) });
  assert.equal(invalid.statusCode, 400);
  const wrongField = await app.inject({ method: "POST", url: "/api/skillhub/uploads", ...uploadBody(skillFixture("another").zip, { unexpected: "field" }) });
  assert.equal(wrongField.statusCode, 400);
});

test("Skill 上传可超过普通附件的 10 MB 限制，资源按字节保留", async (t) => {
  const { app } = await appFixture(t);
  const binary = Buffer.alloc(11 * 1024 * 1024, 7);
  const zip = testZip([{ path: "SKILL.md", content: Buffer.from("---\nname: large-asset\ndescription: 大附件测试\n---\n") }, { path: "assets/blob.bin", content: binary }]);
  const uploaded = await app.inject({ method: "POST", url: "/api/skillhub/uploads", ...uploadBody(zip) });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  assert.equal(uploaded.json().files.find((file: { path: string }) => file.path === "assets/blob.bin").size, binary.length);
});
