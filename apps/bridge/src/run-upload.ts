import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { UploadedFile } from "@skillhub/shared";
import type { FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";
import { createRunDirectories, sanitizeUploadName } from "./workspace-files.js";

export async function receiveRunUpload(
  request: FastifyRequest,
  runId: string,
  fileFieldName?: string,
): Promise<{ fields: Record<string, string>; inputFiles: UploadedFile[] }> {
  if (!request.isMultipart()) {
    throw new HttpError(400, "MULTIPART_REQUIRED", "请求需要使用 multipart/form-data");
  }
  const paths = await createRunDirectories(runId);
  const fields: Record<string, string> = {};
  const inputFiles: UploadedFile[] = [];
  for await (const part of request.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = String(part.value);
      continue;
    }
    if (fileFieldName !== undefined && part.fieldname !== fileFieldName) {
      throw new HttpError(400, "INVALID_UPLOAD_FIELD", `附件字段名必须为 ${fileFieldName}`);
    }
    const name = sanitizeUploadName(part.filename, inputFiles.length);
    const destination = path.join(paths.inputs, name);
    await pipeline(part.file, createWriteStream(destination, { flags: "wx" }));
    if (part.file.truncated) {
      throw new HttpError(413, "UPLOAD_TOO_LARGE", "单个材料不能超过 10 MB");
    }
    const fileStat = await stat(destination);
    inputFiles.push({ name, path: destination, size: fileStat.size, mime: part.mimetype || null });
  }
  return { fields, inputFiles };
}
