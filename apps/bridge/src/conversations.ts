import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  agentIdSchema,
  conversationDetailSchema,
  conversationSummarySchema,
  type ConversationDetail,
  type ConversationSummary,
} from "@skillhub/shared";
import { HttpError } from "./errors.js";
import type { RunStore } from "./runs.js";
import type { StoredTrainingRecord, TrainingService } from "./training.js";

type ConversationRow = {
  id: string;
  agent_id: string;
  agent_name: string;
  revision: number;
  project_path: string;
  title: string;
  thread_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  run_count: number;
};

const summarySelect = `
  SELECT conversations.*, (
    SELECT COUNT(*) FROM runs WHERE runs.conversation_id = conversations.id
  ) AS run_count
  FROM conversations
`;

function toSummary(row: ConversationRow): ConversationSummary {
  return conversationSummarySchema.parse({
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    revision: row.revision,
    projectPath: row.project_path,
    title: row.title,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    runCount: row.run_count,
  });
}

export class ConversationService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly training: TrainingService,
    private readonly runs: RunStore,
  ) {}

  create(agentIdInput: string): ConversationSummary {
    const agentId = agentIdSchema.parse(agentIdInput);
    const training = this.training.require(agentId);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO conversations (
        id, agent_id, agent_name, revision, project_path, title,
        thread_id, created_at, updated_at, last_message_at
      ) VALUES (?, ?, ?, ?, ?, '新会话', NULL, ?, ?, NULL)
    `).run(
      id,
      training.agentId,
      training.agentName,
      training.revision,
      training.projectPath,
      now,
      now,
    );
    return this.require(id);
  }

  ensureDetail(agentIdInput: string): ConversationDetail {
    const agentId = agentIdSchema.parse(agentIdInput);
    this.training.require(agentId);
    const [existing] = this.list(agentId);
    return existing ? this.detail(existing.id) : this.detail(this.create(agentId).id);
  }

  list(agentIdInput: string): ConversationSummary[] {
    const agentId = agentIdSchema.parse(agentIdInput);
    const rows = this.db.prepare(`
      ${summarySelect}
      WHERE agent_id = ?
      ORDER BY COALESCE(last_message_at, created_at) DESC, id ASC
    `).all(agentId) as unknown as ConversationRow[];
    return rows.map(toSummary);
  }

  require(idInput: string): ConversationSummary {
    const id = conversationSummarySchema.shape.id.parse(idInput);
    const row = this.db.prepare(`${summarySelect} WHERE id = ?`)
      .get(id) as unknown as ConversationRow | undefined;
    if (!row) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "会话不存在");
    return toSummary(row);
  }

  detail(id: string): ConversationDetail {
    const conversation = this.require(id);
    return conversationDetailSchema.parse({
      conversation,
      runs: this.runs.listForConversation(conversation.id),
    });
  }

  rebindToTraining(id: string, training: StoredTrainingRecord): ConversationSummary {
    this.require(id);
    this.db.prepare(`
      UPDATE conversations
      SET agent_name = ?, revision = ?, project_path = ?, updated_at = ?, thread_id = NULL
      WHERE id = ?
    `).run(
      training.agentName,
      training.revision,
      training.projectPath,
      new Date().toISOString(),
      id,
    );
    return this.require(id);
  }

  recordRun(id: string, task: string): ConversationSummary {
    const conversation = this.require(id);
    const now = new Date().toISOString();
    const title = conversation.lastMessageAt === null
      ? Array.from(task).slice(0, 80).join("")
      : conversation.title;
    this.db.prepare(`
      UPDATE conversations
      SET title = ?, updated_at = ?, last_message_at = ?
      WHERE id = ?
    `).run(title, now, now, id);
    return this.require(id);
  }

  setThread(id: string, threadId: string): void {
    this.db.prepare("UPDATE conversations SET thread_id = ? WHERE id = ?").run(threadId, id);
  }
}
