import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { DatabaseSync } from "node:sqlite";
import {
  runDetailSchema,
  runEventSchema,
  runSummarySchema,
  type RunComposerOptions,
  type RunDetail,
  type RunEvent,
  type RunFile,
  type RunStatus,
  type RunSummary,
  type TestOutcome,
  type TrainedAgent,
  type UploadedFile,
} from "@skillhub/shared";
import { HttpError } from "./errors.js";
import type { InstalledSkillRecord } from "./installations.js";

type RunRow = {
  id: string;
  kind: string;
  conversation_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  agent_revision: number | null;
  skill_id: string;
  skill_name: string;
  skill_commit: string;
  workspace: string;
  task: string;
  status: string;
  input_files_json: string;
  options_json: string | null;
  outcome: string | null;
  outcome_note: string | null;
  thread_id: string | null;
  turn_id: string | null;
  final_text: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type EventRow = {
  run_id: string;
  seq: number;
  kind: string;
  method: string | null;
  payload_json: string;
  created_at: string;
};

type FileRow = {
  id: string;
  run_id: string;
  path: string;
  kind: string;
  size: number | null;
  sha256: string | null;
  mime: string | null;
  artifact_path: string | null;
  preview_available: number;
  truncated: number;
};

export type StoredRunFile = RunFile & { artifactPath: string | null };

export type NewRunFile = {
  path: string;
  kind: "added" | "modified" | "deleted";
  size: number | null;
  sha256: string | null;
  mime: string | null;
  artifactPath: string | null;
  previewAvailable: boolean;
  truncated: boolean;
};

function toSummary(row: RunRow): RunSummary {
  return runSummarySchema.parse({
    id: row.id,
    kind: row.kind,
    conversationId: row.conversation_id,
    options: row.options_json === null ? null : JSON.parse(row.options_json),
    agent: row.agent_id && row.agent_name && row.agent_revision
      ? { id: row.agent_id, name: row.agent_name, revision: row.agent_revision }
      : null,
    skillId: row.skill_id,
    skillName: row.skill_name,
    skillCommit: row.skill_commit,
    workspace: row.workspace,
    task: row.task,
    status: row.status,
    outcome: row.outcome,
    outcomeNote: row.outcome_note,
    threadId: row.thread_id,
    turnId: row.turn_id,
    finalText: row.final_text,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  });
}

function toFile(row: FileRow): StoredRunFile {
  return {
    id: row.id,
    runId: row.run_id,
    path: row.path,
    kind: row.kind as RunFile["kind"],
    size: row.size,
    sha256: row.sha256,
    mime: row.mime,
    artifactAvailable: row.artifact_path !== null,
    previewAvailable: row.preview_available === 1,
    truncated: row.truncated === 1,
    artifactPath: row.artifact_path,
  };
}

export class RunStore {
  private readonly events = new EventEmitter();

  constructor(private readonly db: DatabaseSync) {
    this.events.setMaxListeners(100);
    const incomplete = this.db.prepare(`
      SELECT id, final_text FROM runs
      WHERE status IN ('queued', 'running', 'waitingApproval')
    `).all() as unknown as Array<Pick<RunRow, "id" | "final_text">>;
    for (const run of incomplete) {
      this.complete({
        id: run.id,
        status: "interrupted",
        finalText: run.final_text,
        error: "Bridge 已重启，无法恢复未完成的 Codex 运行；请重新执行测试",
      });
    }
  }

  create(options: {
    id: string;
    skill: InstalledSkillRecord;
    agent?: TrainedAgent;
    workspace: string;
    task: string;
    inputFiles: UploadedFile[];
    kind?: RunSummary["kind"];
    conversationId?: string;
    options?: RunComposerOptions | null;
  }): RunDetail {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO runs (
        id, kind, conversation_id, skill_id, skill_name, skill_commit, workspace, task, status,
        input_files_json, options_json, created_at, agent_id, agent_name, agent_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `).run(
      options.id,
      options.kind ?? "automated",
      options.conversationId ?? null,
      options.skill.skillId,
      options.skill.skillName,
      options.skill.commit,
      options.workspace,
      options.task,
      JSON.stringify(options.inputFiles),
      options.options ? JSON.stringify(options.options) : null,
      now,
      options.agent?.agentId ?? null,
      options.agent?.agentName ?? null,
      options.agent?.revision ?? null,
    );
    const run = this.get(options.id);
    this.appendEvent(options.id, "status", null, run);
    return run;
  }

  list(limit = 50, kind: RunSummary["kind"] = "automated"): RunSummary[] {
    const rows = this.db.prepare("SELECT * FROM runs WHERE kind = ? ORDER BY created_at DESC LIMIT ?")
      .all(kind, limit) as unknown as RunRow[];
    return rows.map(toSummary);
  }

  listForConversation(conversationId: string): RunSummary[] {
    const rows = this.db.prepare(`
      SELECT * FROM runs WHERE conversation_id = ? ORDER BY created_at ASC, id ASC
    `).all(conversationId) as unknown as RunRow[];
    return rows.map(toSummary);
  }

  active(): RunSummary | null {
    const row = this.db.prepare(`
      SELECT * FROM runs
      WHERE status IN ('queued', 'running', 'waitingApproval')
      ORDER BY created_at DESC LIMIT 1
    `).get() as unknown as RunRow | undefined;
    return row ? toSummary(row) : null;
  }

  get(id: string): RunDetail {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?")
      .get(id) as unknown as RunRow | undefined;
    if (!row) throw new HttpError(404, "RUN_NOT_FOUND", "测试记录不存在");
    const summary = toSummary(row);
    const files = this.db.prepare("SELECT * FROM run_files WHERE run_id = ? ORDER BY path")
      .all(id) as unknown as FileRow[];
    return runDetailSchema.parse({
      ...summary,
      inputFiles: JSON.parse(row.input_files_json) as UploadedFile[],
      files: files.map((file) => {
        const { artifactPath: _artifactPath, ...publicFile } = toFile(file);
        return publicFile;
      }),
    });
  }

  find(id: string): RunDetail | null {
    try {
      return this.get(id);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) return null;
      throw error;
    }
  }

  setThread(id: string, threadId: string): void {
    this.db.prepare("UPDATE runs SET thread_id = ? WHERE id = ?").run(threadId, id);
    this.appendEvent(id, "meta", null, this.get(id));
  }

  setTurn(id: string, turnId: string): void {
    this.db.prepare("UPDATE runs SET turn_id = ? WHERE id = ?").run(turnId, id);
  }

  setStatus(id: string, status: RunStatus): void {
    const current = this.get(id);
    const startedAt = status === "running" && !current.startedAt
      ? new Date().toISOString()
      : current.startedAt;
    this.db.prepare("UPDATE runs SET status = ?, started_at = ? WHERE id = ?")
      .run(status, startedAt, id);
    this.appendEvent(id, "status", null, this.get(id));
  }

  complete(options: {
    id: string;
    status: "completed" | "failed" | "interrupted";
    finalText: string | null;
    error: string | null;
  }): void {
    this.db.prepare(`
      UPDATE runs
      SET status = ?, final_text = ?, error = ?, completed_at = ?
      WHERE id = ?
    `).run(
      options.status,
      options.finalText,
      options.error,
      new Date().toISOString(),
      options.id,
    );
    this.appendEvent(options.id, "status", null, this.get(options.id));
  }

  setOutcome(id: string, outcome: TestOutcome, note: string): void {
    this.db.prepare("UPDATE runs SET outcome = ?, outcome_note = ? WHERE id = ?")
      .run(outcome, note || null, id);
    this.appendEvent(id, "outcome", null, this.get(id));
  }

  appendEvent(runId: string, kind: string, method: string | null, payload: unknown): RunEvent {
    const seq = ((this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_events WHERE run_id = ?")
      .get(runId) as unknown as { seq: number }).seq);
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO run_events (run_id, seq, kind, method, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, seq, kind, method, JSON.stringify(payload ?? null), createdAt);
    const event = runEventSchema.parse({ seq, runId, kind, method, payload: payload ?? null, createdAt });
    this.events.emit(runId, event);
    return event;
  }

  eventsAfter(runId: string, afterSeq: number, limit = 500): RunEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?
    `).all(runId, afterSeq, limit) as unknown as EventRow[];
    return rows.map((row) => runEventSchema.parse({
      seq: row.seq,
      runId: row.run_id,
      kind: row.kind,
      method: row.method,
      payload: JSON.parse(row.payload_json),
      createdAt: row.created_at,
    }));
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.events.on(runId, listener);
    return () => this.events.off(runId, listener);
  }

  replaceFiles(runId: string, files: NewRunFile[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM run_files WHERE run_id = ?").run(runId);
      const insert = this.db.prepare(`
        INSERT INTO run_files (
          id, run_id, path, kind, size, sha256, mime, artifact_path,
          preview_available, truncated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const file of files) {
        insert.run(
          randomUUID(),
          runId,
          file.path,
          file.kind,
          file.size,
          file.sha256,
          file.mime,
          file.artifactPath,
          file.previewAvailable ? 1 : 0,
          file.truncated ? 1 : 0,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getFile(runId: string, fileId: string): StoredRunFile | null {
    const row = this.db.prepare("SELECT * FROM run_files WHERE run_id = ? AND id = ?")
      .get(runId, fileId) as unknown as FileRow | undefined;
    return row ? toFile(row) : null;
  }
}
