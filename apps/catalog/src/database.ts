import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  feedbackRecordSchema,
  type FeedbackInput,
  type FeedbackRecord,
} from "@skillhub/shared";
import { z } from "zod";

const feedbackRowSchema = z.object({
  id: z.string(),
  skill_id: z.string(),
  skill_commit: z.string(),
  run_id: z.string().nullable(),
  kind: z.string(),
  author: z.string(),
  content: z.string(),
  outcome: z.string().nullable(),
  created_at: z.string(),
});

export interface FeedbackQuery {
  skillId?: string;
  skillCommit?: string;
  limit?: number;
}

function toFeedbackRecord(value: unknown): FeedbackRecord {
  const row = feedbackRowSchema.parse(value);
  return feedbackRecordSchema.parse({
    id: row.id,
    skillId: row.skill_id,
    skillCommit: row.skill_commit,
    runId: row.run_id,
    kind: row.kind,
    author: row.author,
    content: row.content,
    outcome: row.outcome,
    createdAt: row.created_at,
  });
}

export class CatalogDatabase {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.database = new DatabaseSync(join(dataDir, "catalog.sqlite"));
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        skill_commit TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        outcome TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feedback_skill_created
        ON feedback (skill_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS feedback_skill_commit_created
        ON feedback (skill_id, skill_commit, created_at DESC);
    `);
  }

  insertFeedback(input: FeedbackInput): FeedbackRecord {
    const record: FeedbackRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    this.database
      .prepare(`
        INSERT INTO feedback (
          id, skill_id, skill_commit, run_id, kind, author, content, outcome, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.skillId,
        record.skillCommit,
        record.runId,
        record.kind,
        record.author,
        record.content,
        record.outcome,
        record.createdAt,
      );

    return record;
  }

  listFeedback(query: FeedbackQuery = {}): FeedbackRecord[] {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];

    if (query.skillId !== undefined) {
      conditions.push("skill_id = ?");
      parameters.push(query.skillId);
    }
    if (query.skillCommit !== undefined) {
      conditions.push("skill_commit = ?");
      parameters.push(query.skillCommit);
    }

    const requestedLimit = query.limit ?? 100;
    const normalizedLimit = Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 100;
    const limit = Math.min(200, Math.max(1, normalizedLimit));
    parameters.push(limit);

    const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
    const rows = this.database
      .prepare(`
        SELECT id, skill_id, skill_commit, run_id, kind, author, content, outcome, created_at
        FROM feedback${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(...parameters);

    return rows.map(toFeedbackRecord);
  }

  close(): void {
    this.database.close();
  }
}
