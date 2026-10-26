import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(databasePath: string): DatabaseSync {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS installations (
      skill_id TEXT PRIMARY KEY,
      skill_name TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      path TEXT NOT NULL,
      files_json TEXT NOT NULL,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      revision INTEGER NOT NULL,
      project_path TEXT NOT NULL,
      title TEXT NOT NULL,
      thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT
    );

    CREATE INDEX IF NOT EXISTS conversations_agent_activity_idx
      ON conversations(agent_id, COALESCE(last_message_at, created_at) DESC);

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'automated',
      conversation_id TEXT,
      skill_id TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      skill_commit TEXT NOT NULL,
      workspace TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      input_files_json TEXT NOT NULL,
      options_json TEXT,
      outcome TEXT,
      outcome_note TEXT,
      thread_id TEXT,
      turn_id TEXT,
      final_text TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      method TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );

    CREATE TABLE IF NOT EXISTS run_files (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      size INTEGER,
      sha256 TEXT,
      mime TEXT,
      artifact_path TEXT,
      preview_available INTEGER NOT NULL,
      truncated INTEGER NOT NULL,
      UNIQUE (run_id, path)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      skill_ids_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trained_agents (
      agent_id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      revision INTEGER NOT NULL,
      project_path TEXT NOT NULL UNIQUE,
      instruction_json TEXT NOT NULL,
      skills_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const agentColumns = db.prepare("PRAGMA table_info(agents)").all() as unknown as Array<{ name: string }>;
  if (!agentColumns.some((column) => column.name === "avatar")) {
    db.exec("ALTER TABLE agents ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
  }
  const runColumns = db.prepare("PRAGMA table_info(runs)").all() as unknown as Array<{ name: string }>;
  const runColumnNames = new Set(runColumns.map((column) => column.name));
  for (const [name, definition] of [
    ["agent_id", "TEXT"],
    ["agent_name", "TEXT"],
    ["agent_revision", "INTEGER"],
    ["kind", "TEXT NOT NULL DEFAULT 'automated'"],
    ["conversation_id", "TEXT"],
    ["options_json", "TEXT"],
  ] as const) {
    if (!runColumnNames.has(name)) db.exec(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS runs_conversation_created_at_idx ON runs(conversation_id, created_at);");
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE runs
    SET status = 'interrupted', error = ?, completed_at = ?
    WHERE status IN ('queued', 'running', 'waitingApproval')
  `).run("Bridge 重启，未完成的测试已中断", now);
  return db;
}
