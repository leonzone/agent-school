import {
  catalogResponseSchema,
  feedbackInputSchema,
  feedbackListResponseSchema,
  feedbackResponseSchema,
  skillDetailSchema,
  versionsResponseSchema,
  type CatalogResponse,
  type FeedbackInput,
  type FeedbackListResponse,
  type FeedbackResponse,
  type SkillDetail,
  type VersionsResponse,
} from "@skillhub/shared";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

async function request(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${config.catalogUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new HttpError(503, "CATALOG_UNAVAILABLE", "课程服务不可用，请确认本机 Catalog 已启动");
  }

  if (!response.ok) {
    let code = "CATALOG_ERROR";
    let message = `课程服务返回 ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
    }
    throw new HttpError(response.status, code, message);
  }
  return response;
}

export const catalogClient = {
  async health(): Promise<void> {
    await request("/api/health");
  },

  async list(query: string): Promise<CatalogResponse> {
    const response = await request(`/api/skills?q=${encodeURIComponent(query)}`);
    return catalogResponseSchema.parse(await response.json());
  },

  async sync(): Promise<CatalogResponse> {
    const response = await request("/api/sync", { method: "POST" }, 60_000);
    return catalogResponseSchema.parse(await response.json());
  },

  async detail(skillId: string, commit?: string): Promise<SkillDetail> {
    const suffix = commit ? `?commit=${encodeURIComponent(commit)}` : "";
    const response = await request(`/api/skills/${encodeURIComponent(skillId)}${suffix}`);
    return skillDetailSchema.parse(await response.json());
  },

  async versions(skillId: string): Promise<VersionsResponse> {
    const response = await request(`/api/skills/${encodeURIComponent(skillId)}/versions`);
    return versionsResponseSchema.parse(await response.json());
  },

  async archive(skillId: string, commit: string): Promise<{ data: Buffer; sha256: string }> {
    const response = await request(
      `/api/skills/${encodeURIComponent(skillId)}/versions/${commit}/archive`,
      { headers: { accept: "application/x-tar" } },
      60_000,
    );
    const expectedSha = response.headers.get("x-content-sha256");
    const upstreamCommit = response.headers.get("x-skill-commit");
    if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha) || upstreamCommit !== commit) {
      throw new HttpError(502, "INVALID_ARCHIVE_RESPONSE", "课程服务返回的归档校验信息无效");
    }
    return { data: Buffer.from(await response.arrayBuffer()), sha256: expectedSha };
  },

  async createFeedback(input: FeedbackInput): Promise<FeedbackResponse> {
    const parsed = feedbackInputSchema.parse(input);
    const response = await request("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed),
    });
    return feedbackResponseSchema.parse(await response.json());
  },

  async listFeedback(query: URLSearchParams): Promise<FeedbackListResponse> {
    const response = await request(`/api/feedback?${query.toString()}`);
    return feedbackListResponseSchema.parse(await response.json());
  },
};
