import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  agentCreateInputSchema,
  agentDuplicateInputSchema,
  agentIdSchema,
  agentProfileInputSchema,
  agentSchema,
  agentUpdateInputSchema,
  type Agent,
  type AgentCreateInput,
  type AgentDuplicateInput,
  type AgentListResponse,
  type AgentProfileInput,
  type AgentResponse,
  type AgentUpdateInput,
} from "@skillhub/shared";
import { catalogClient } from "./catalog-client.js";
import { HttpError } from "./errors.js";

type AgentRow = {
  id: string;
  name: string;
  avatar: string;
  description: string;
  instructions: string;
  skill_ids_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

const defaultAvatars = ["🧑‍💼", "🧑‍💻", "🧑‍🔬", "🧑‍🎨", "🧑‍🏫", "🕵️", "📊", "🗂️", "🤖", "🦉", "🐳", "🚀"];

function defaultAvatar(id: string): string {
  const digest = createHash("sha256").update(id).digest();
  return defaultAvatars[digest.readUInt32BE(0) % defaultAvatars.length] as string;
}

const exampleAgents: AgentCreateInput[] = [
  {
    id: "product-strategist",
    name: "产品策略分析师",
    description: "从用户问题和资料出发，完成调研、产品判断、方案分析与策略文档。",
    instructions: "# 产品策略分析师\n\n你是一名严谨的产品策略分析师，用中文协助用户完成产品研究与策略工作。\n\n## 工作原则\n- 先确认目标用户、业务问题、背景和交付用途；信息不足时列出假设与待确认项。\n- 区分材料事实、外部证据、分析判断和建议，不编造用户、数据或来源。\n- 根据任务选用已安装的调研、头脑风暴、表格分析和文档写作 Skills。\n- 优先给出可验证、可执行的结论，说明权衡、风险和下一步。\n\n## 默认交付\n1. 结论摘要。\n2. 背景与分析依据。\n3. 方案比较及取舍。\n4. 风险、待确认事项与行动建议。\n\n除非用户指定其他位置，将交付物写入当前项目目录。",
    skillIds: ["deep-research", "brainstorming", "spreadsheet-analysis", "document-writing"],
  },
  {
    id: "project-coordinator",
    name: "项目协调 PMO",
    description: "整理会议与项目材料，跟踪决策、风险、负责人、依赖和行动项。",
    instructions: "# 项目协调 PMO\n\n你是一名项目协调与 PMO 助手，用中文帮助团队保持项目进展透明、行动明确。\n\n## 工作原则\n- 先确认项目背景、时间范围、相关团队和交付对象。\n- 所有日期、负责人、状态和依赖必须来自材料；缺失时标记待确认。\n- 根据任务使用会议纪要、团队简报、表格分析和文档写作 Skills。\n- 不把建议当作团队已经达成的决定，不擅自承诺日期或资源。\n\n## 默认交付\n1. 当前进展与关键结论。\n2. 风险、依赖和待决策事项。\n3. 行动项表格：任务、负责人、截止时间、状态。\n4. 下一步同步建议。\n\n除非用户指定其他位置，将交付物写入当前项目目录。",
    skillIds: ["meeting-notes", "skillhub-team-brief", "spreadsheet-analysis", "document-writing"],
  },
  {
    id: "frontend-engineer",
    name: "前端开发工程师",
    description: "把产品需求转化为清晰、可访问、可验证的响应式 Web 界面。",
    instructions: "# 前端开发工程师\n\n你是一名注重质量的前端开发工程师，在当前项目中实现和审查 Web 界面。\n\n## 工作原则\n- 先阅读项目结构、现有组件和工具链，遵循已有技术栈，不擅自增加依赖。\n- 先确认用户流程、交互状态和验收条件，再实施最小完整改动。\n- 根据任务使用前端设计和代码审查 Skills。\n- 覆盖加载、空数据、失败、键盘操作与移动端布局，不伪造测试结果。\n\n## 默认交付\n1. 实现内容和关键取舍。\n2. 修改的文件。\n3. 实际执行的检查及结果。\n4. 剩余风险和后续建议。\n\n未经用户明确要求，不执行发布、提交或破坏性操作。",
    skillIds: ["frontend-design", "code-review"],
  },
];

function toAgent(row: AgentRow): Agent {
  return agentSchema.parse({
    id: row.id,
    name: row.name,
    avatar: row.avatar || defaultAvatar(row.id),
    description: row.description,
    instructions: row.instructions,
    skillIds: JSON.parse(row.skill_ids_json),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class AgentService {
  constructor(private readonly db: DatabaseSync) {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM agents").get() as unknown as { count: number };
    if (count.count === 0) {
      for (const input of exampleAgents) this.insert(agentCreateInputSchema.parse(input));
    }
  }

  list(): AgentListResponse {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY created_at, id").all() as unknown as AgentRow[];
    return { agents: rows.map(toAgent) };
  }

  get(idInput: string): Agent | null {
    const id = agentIdSchema.parse(idInput);
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as unknown as AgentRow | undefined;
    return row ? toAgent(row) : null;
  }

  require(id: string): Agent {
    const agent = this.get(id);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "角色不存在");
    return agent;
  }

  async create(input: AgentCreateInput): Promise<AgentResponse> {
    const parsed = agentCreateInputSchema.parse(input);
    await this.validateSkills(parsed.skillIds);
    if (this.get(parsed.id)) throw new HttpError(409, "AGENT_EXISTS", "这个角色标识已经存在");
    return { agent: this.insert(parsed) };
  }

  async update(idInput: string, input: AgentUpdateInput): Promise<AgentResponse> {
    const id = agentIdSchema.parse(idInput);
    const parsed = agentUpdateInputSchema.parse(input);
    await this.validateSkills(parsed.skillIds);
    this.require(id);
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE agents SET name = ?, description = ?, instructions = ?, skill_ids_json = ?,
        revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(
      parsed.name,
      parsed.description,
      parsed.instructions,
      JSON.stringify(parsed.skillIds),
      now,
      id,
      parsed.expectedRevision,
    );
    if (result.changes === 0) {
      throw new HttpError(409, "AGENT_REVISION_CONFLICT", "角色已在其他页面更新，请刷新后重试");
    }
    return { agent: this.require(id) };
  }

  updateProfile(idInput: string, input: AgentProfileInput): AgentResponse {
    const id = agentIdSchema.parse(idInput);
    const parsed = agentProfileInputSchema.parse(input);
    this.require(id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE agents SET name = ?, avatar = ?, updated_at = ? WHERE id = ?
      `).run(parsed.name, parsed.avatar, new Date().toISOString(), id);
      this.db.prepare("UPDATE trained_agents SET agent_name = ? WHERE agent_id = ?")
        .run(parsed.name, id);
      this.db.prepare("UPDATE conversations SET agent_name = ? WHERE agent_id = ?")
        .run(parsed.name, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { agent: this.require(id) };
  }

  async duplicate(id: string, input: AgentDuplicateInput): Promise<AgentResponse> {
    const source = this.require(id);
    const parsed = agentDuplicateInputSchema.parse(input);
    if (this.get(parsed.id)) throw new HttpError(409, "AGENT_EXISTS", "这个角色标识已经存在");
    return {
      agent: this.insert({
        ...source,
        id: parsed.id,
        name: parsed.name ?? `${source.name} 副本`,
      }),
    };
  }

  delete(idInput: string): void {
    const id = agentIdSchema.parse(idInput);
    this.require(id);
    const trained = this.db.prepare("SELECT 1 AS trained FROM trained_agents WHERE agent_id = ?").get(id);
    if (trained) throw new HttpError(409, "AGENT_TRAINED", "已培训角色不能删除，以免丢失项目关联");
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }

  private insert(input: AgentCreateInput): Agent {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agents (
        id, name, avatar, description, instructions, skill_ids_json, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      input.id,
      input.name,
      input.avatar ?? defaultAvatar(input.id),
      input.description,
      input.instructions,
      JSON.stringify(input.skillIds),
      now,
      now,
    );
    return this.require(input.id);
  }

  private async validateSkills(skillIds: string[]): Promise<void> {
    const catalog = await catalogClient.list("");
    const known = new Set(catalog.skills.map((skill) => skill.id));
    const missing = skillIds.filter((id) => !known.has(id));
    if (missing.length) throw new HttpError(400, "AGENT_SKILL_NOT_FOUND", `目录中不存在这些 Skills：${missing.join("、")}`);
  }
}
