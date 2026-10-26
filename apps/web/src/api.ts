import type {
  AgentCreateInput,
  AgentDuplicateInput,
  AgentListResponse,
  AgentResponse,
  AgentUpdateInput,
  ApprovalDecision,
  ApprovalRequest,
  CatalogResponse,
  CodexConfigResponse,
  CodexConfigUpdate,
  ConversationDetail,
  ConversationSummary,
  CreateRunFields,
  FeedbackInput,
  FeedbackListResponse,
  FeedbackRecord,
  FeedbackResponse,
  InstallationListResponse,
  InstallationResponse,
  RunDetail,
  RunListResponse,
  SkillDetail,
  SystemStatus,
  TrainingListResponse,
  TrainingResponse,
  VersionsResponse,
} from "@skillhub/shared";

let sessionPromise: Promise<void> | null = null;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function responseError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const wrapper = typeof body === "object" && body !== null
    ? body as { error?: { code?: unknown; message?: unknown; details?: unknown } }
    : null;
  const error = wrapper?.error;
  return new ApiError(
    typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
    typeof error?.message === "string" ? error.message : `请求失败（HTTP ${response.status}）`,
    response.status,
    error?.details,
  );
}

async function fetchLocal(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, credentials: "same-origin" });
  } catch {
    throw new ApiError("NETWORK_ERROR", "无法连接本地服务，请确认 Bridge 正在运行", 0);
  }
}

async function createSession(): Promise<void> {
  const response = await fetchLocal("/api/session", { method: "POST" });
  if (!response.ok) throw await responseError(response);
}

export function initializeSession(force = false): Promise<void> {
  if (force || sessionPromise === null) {
    const pending = createSession();
    sessionPromise = pending.catch((error: unknown) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  await initializeSession();
  const response = await fetchLocal(path, init);
  if (response.status === 401 && retry) {
    await initializeSession(true);
    return request<T>(path, init, false);
  }
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  systemStatus: () => request<SystemStatus>("/api/system/status"),
  codexConfig: () => request<CodexConfigResponse>("/api/codex/config"),
  updateCodexConfig: (input: CodexConfigUpdate) => request<CodexConfigResponse>(
    "/api/codex/config",
    jsonRequest("PUT", input),
  ),

  agents: () => request<AgentListResponse>("/api/agents"),
  agent: (id: string) => request<AgentResponse>(`/api/agents/${encodeURIComponent(id)}`),
  createAgent: (input: AgentCreateInput) => request<AgentResponse>(
    "/api/agents",
    jsonRequest("POST", input),
  ),
  updateAgent: (id: string, input: AgentUpdateInput) => request<AgentResponse>(
    `/api/agents/${encodeURIComponent(id)}`,
    jsonRequest("PUT", input),
  ),
  updateAgentProfile: (id: string, input: { name: string; avatar: string }) => request<AgentResponse>(
    `/api/agents/${encodeURIComponent(id)}/profile`,
    jsonRequest("PUT", input),
  ),
  deleteAgent: (id: string) => request<{ ok: boolean }>(
    `/api/agents/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  ),
  duplicateAgent: (id: string, input: AgentDuplicateInput) => request<AgentResponse>(
    `/api/agents/${encodeURIComponent(id)}/duplicate`,
    jsonRequest("POST", input),
  ),
  trainings: () => request<TrainingListResponse>("/api/trainings"),
  training: (id: string) => request<TrainingResponse>(`/api/trainings/${encodeURIComponent(id)}`),
  trainAgent: (id: string) => request<TrainingResponse>(
    `/api/agents/${encodeURIComponent(id)}/train`,
    { method: "POST" },
  ),
  conversations: (agentId: string) => request<{ conversations: ConversationSummary[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/conversations`,
  ),
  createConversation: (agentId: string) => request<{ conversation: ConversationSummary }>(
    `/api/agents/${encodeURIComponent(agentId)}/conversations`,
    { method: "POST" },
  ),
  ensureConversation: (agentId: string) => request<ConversationDetail>(
    `/api/agents/${encodeURIComponent(agentId)}/conversation`,
    { method: "POST" },
  ),
  conversation: (id: string) => request<ConversationDetail>(
    `/api/conversations/${encodeURIComponent(id)}`,
  ),
  sendConversationMessage: (id: string, task: string, files: File[], options?: {
    skillIds: string[];
    permissionMode: "strict" | "workspace" | "full";
    model: string;
    effort: string;
  }) => {
    const body = new FormData();
    body.set("task", task);
    if (options) {
      body.set("skillIds", JSON.stringify(options.skillIds));
      body.set("model", options.model);
      body.set("effort", options.effort);
      body.set("permissionMode", options.permissionMode);
      if (options.permissionMode === "full") body.set("confirmFullAccess", "true");
    }
    for (const file of files) body.append("materials", file, file.name);
    return request<RunDetail>(`/api/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body });
  },

  catalog: (query = "") => request<CatalogResponse>(
    `/api/catalog/skills?q=${encodeURIComponent(query)}`,
  ),
  syncCatalog: () => request<CatalogResponse>("/api/catalog/sync", { method: "POST" }),
  skillDetail: (id: string, commit?: string) => request<SkillDetail>(
    `/api/catalog/skills/${encodeURIComponent(id)}${commit ? `?commit=${encodeURIComponent(commit)}` : ""}`,
  ),
  skillVersions: (id: string) => request<VersionsResponse>(
    `/api/catalog/skills/${encodeURIComponent(id)}/versions`,
  ),

  installations: () => request<InstallationListResponse>("/api/installations"),
  install: (skillId: string, commit: string) => request<InstallationResponse>(
    "/api/installations",
    jsonRequest("POST", { skillId, commit }),
  ),
  uninstall: (id: string) => request<{ ok: boolean }>(
    `/api/installations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  ),

  runs: () => request<RunListResponse>("/api/runs"),
  run: (id: string) => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  createRun: (fields: CreateRunFields, files: File[]) => {
    const body = new FormData();
    if (fields.skillId) body.set("skillId", fields.skillId);
    if (fields.agentId) body.set("agentId", fields.agentId);
    if (fields.workspace) body.set("workspace", fields.workspace);
    body.set("task", fields.task);
    for (const file of files) body.append("materials", file, file.name);
    return request<RunDetail>("/api/runs", { method: "POST", body });
  },
  stopRun: (id: string) => request<RunDetail>(
    `/api/runs/${encodeURIComponent(id)}/stop`,
    { method: "POST" },
  ),
  setOutcome: (id: string, outcome: "passed" | "failed", note: string) => request<RunDetail>(
    `/api/runs/${encodeURIComponent(id)}/outcome`,
    jsonRequest("POST", { outcome, note }),
  ),
  approvals: (id: string) => request<{ approvals: ApprovalRequest[] }>(
    `/api/runs/${encodeURIComponent(id)}/approvals`,
  ),
  resolveApproval: (id: string, requestId: string | number, decision: ApprovalDecision) => (
    request<{ approvals: ApprovalRequest[] }>(
      `/api/runs/${encodeURIComponent(id)}/approvals`,
      jsonRequest("POST", { requestId, decision }),
    )
  ),
  filePreview: (runId: string, fileId: string) => request<{
    path: string;
    mime: string | null;
    content: string;
    truncated: boolean;
  }>(`/api/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(fileId)}/preview`),

  feedback: (filters: { skillId?: string; skillCommit?: string } = {}) => {
    const query = new URLSearchParams();
    if (filters.skillId) query.set("skillId", filters.skillId);
    if (filters.skillCommit) query.set("skillCommit", filters.skillCommit);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return request<FeedbackListResponse>(`/api/feedback${suffix}`);
  },
  createFeedback: async (input: FeedbackInput): Promise<FeedbackRecord> => {
    const response = await request<FeedbackResponse>("/api/feedback", jsonRequest("POST", input));
    return response.feedback;
  },
};
