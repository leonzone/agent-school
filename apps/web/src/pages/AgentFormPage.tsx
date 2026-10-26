import { Button } from "@/components/ui/button";
import { FieldGroup, Field, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useCallback, useEffect, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SkillSummary } from "@skillhub/shared";
import { api, ApiError } from "../api";
import { Link } from "../components/Link";
import { Markdown } from "../components/Markdown";
import { CardSkeletons, EmptyState, ErrorBanner, Notice, PageHeader } from "../components/UI";
import { navigate } from "../router";
import { errorMessage } from "../utils";

type AgentForm = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  skillIds: string[];
};

const emptyForm: AgentForm = {
  id: "",
  name: "",
  description: "",
  instructions: "",
  skillIds: [],
};

export function AgentFormPage({ id }: { id?: string }) {
  const editing = id !== undefined;
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [revision, setRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setReady(false);
    setError(null);
    setConflict(false);
    try {
      const [catalogData, agentData] = await Promise.all([
        api.catalog(),
        id ? api.agent(id) : Promise.resolve(null),
      ]);
      setSkills(catalogData.skills);
      setRevision(agentData?.agent.revision ?? null);
      setForm(agentData ? {
        id: agentData.agent.id,
        name: agentData.agent.name,
        description: agentData.agent.description,
        instructions: agentData.agent.instructions,
        skillIds: agentData.agent.skillIds,
      } : emptyForm);
      setMode("edit");
      setReady(true);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateForm<K extends keyof AgentForm>(key: K, value: AgentForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleSkill(skillId: string) {
    setForm((current) => ({
      ...current,
      skillIds: current.skillIds.includes(skillId)
        ? current.skillIds.filter((item) => item !== skillId)
        : [...current.skillIds, skillId],
    }));
  }

  async function submit() {
    if (submitting) return;
    const fields = {
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions.trim(),
      skillIds: form.skillIds,
    };
    if (!fields.name || !fields.description || !fields.instructions) {
      setError("请填写角色名称、描述和 AGENTS.md 指令");
      return;
    }
    if (fields.skillIds.length === 0) {
      setError("请至少选择一个 Skill");
      return;
    }
    const agentId = form.id.trim();
    if (!editing && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(agentId)) {
      setError("目录标识需以小写字母或数字开头，且只能包含小写字母、数字和连字符");
      return;
    }
    if (editing && revision === null) {
      setError("无法确认角色 revision，请刷新后重试");
      return;
    }

    setSubmitting(true);
    setError(null);
    setConflict(false);
    try {
      const result = editing && id
        ? await api.updateAgent(id, { ...fields, expectedRevision: revision ?? 0 })
        : await api.createAgent({ ...fields, id: agentId });
      navigate(`/agents/${encodeURIComponent(result.agent.id)}`);
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 409) setConflict(true);
      setError(errorMessage(submitError));
      setSubmitting(false);
    }
  }

  const backTo = editing && id ? `/agents/${encodeURIComponent(id)}` : "/";
  const missingSkills = form.skillIds.filter((skillId) => !skills.some((skill) => skill.id === skillId));

  if (loading) {
    return <div className="agent-page agent-form-page"><CardSkeletons count={2} /></div>;
  }
  if (!ready) {
    return (
      <div className="agent-page agent-form-page">
        <Link className="back-link" to={backTo}>返回</Link>
        <PageHeader title={editing ? "编辑角色" : "创建角色"} />
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      </div>
    );
  }

  return (
    <div className="agent-page agent-form-page">
      <Link className="back-link" to={backTo}>{editing ? "返回角色详情" : "返回学习中心"}</Link>
      <PageHeader
        eyebrow={editing ? `revision ${revision ?? ""}` : "Agent School"}
        title={editing ? `编辑 ${form.name}` : "创建角色"}
        description={editing ? "修改角色指令和 Skills 后，需要更新培训才能在本机测试中使用最新内容。" : "定义角色工作方式，并选择它在培训时固定使用的 Skills。"}
      />

      {error ? <ErrorBanner message={error} /> : null}
      {conflict ? (
        <Notice tone="warning">
          <div className="agent-conflict">
            <span>角色已被其他页面修改，本次保存未覆盖最新内容。刷新会放弃当前未保存修改。</span>
            <Button variant="outline" size="sm" type="button" onClick={() => void load()} disabled={loading}>刷新最新角色</Button>
          </div>
        </Notice>
      ) : null}
      {editing ? <Notice>保存只会修改角色配置；已有培训仍保留原 revision，请在详情页或培训项目中更新培训。</Notice> : null}

      {skills.length === 0 && form.skillIds.length === 0 ? (
        <EmptyState
          title="暂无可选 Skills"
          description="角色至少需要一个 Skill，请先同步团队课程目录后重试。"
          action={<Button variant="outline" type="button" onClick={() => void load()}>重新读取</Button>}
        />
      ) : (
        <form className="panel agent-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <FieldGroup>
          <FieldGroup className="agent-form-fields">
            <Field className="field">
              <FieldLabel htmlFor="agent-name">角色名称</FieldLabel>
              <Input id="agent-name" value={form.name} onChange={(event) => updateForm("name", event.target.value)} maxLength={100} required disabled={submitting} placeholder="例如：发布助手" />
            </Field>
            <Field className="field">
              <FieldLabel htmlFor="agent-id">英文目录标识</FieldLabel>
              <Input
                id="agent-id"
                value={form.id}
                onChange={(event) => updateForm("id", event.target.value)}
                pattern="[a-z0-9][a-z0-9-]{0,63}"
                maxLength={64}
                required
                disabled={editing || submitting}
                spellCheck={false}
                autoComplete="off"
                placeholder="release-assistant"
              />
              <p className="field-help">{editing ? "目录标识创建后不可修改。" : "最多 64 位，只能使用小写字母、数字和连字符。"}</p>
            </Field>
          </FieldGroup>

          <Field className="field">
            <FieldLabel htmlFor="agent-description">角色描述</FieldLabel>
            <Textarea id="agent-description" value={form.description} onChange={(event) => updateForm("description", event.target.value)} rows={3} maxLength={500} required disabled={submitting} placeholder="说明这个角色适合完成什么任务" />
            <p className="field-help">{form.description.length} / 500 字</p>
          </Field>

          <section className="agent-instructions" aria-labelledby="agent-instructions-title">
            <div className="agent-instructions-heading">
              <div><FieldLabel id="agent-instructions-title" htmlFor="agent-instructions">AGENTS.md 指令</FieldLabel><p>用 Markdown 描述目标、流程、约束和验收标准。</p></div>
              <ToggleGroup value={[mode]} onValueChange={(values) => { if (values[0] === "edit" || values[0] === "preview") setMode(values[0]); }} disabled={submitting} aria-label="指令显示方式">
                <ToggleGroupItem value="edit">编辑</ToggleGroupItem>
                <ToggleGroupItem value="preview">预览</ToggleGroupItem>
              </ToggleGroup>
            </div>
            {mode === "edit" ? (
              <Textarea id="agent-instructions" value={form.instructions} onChange={(event) => updateForm("instructions", event.target.value)} rows={18} maxLength={100000} required disabled={submitting} spellCheck={false} placeholder={"# 角色目标\n\n## 工作流程\n\n## 约束与验收标准"} />
            ) : (
              <div className="agent-instructions-preview">
                {form.instructions.trim() ? <Markdown>{form.instructions}</Markdown> : <p className="muted">暂无指令内容</p>}
              </div>
            )}
            <p className="field-help">{form.instructions.length} / 100000 字</p>
          </section>

          <FieldSet className="agent-skill-picker" disabled={submitting}>
            <FieldLegend>选择 Skills</FieldLegend>
            <p className="field-help">已选择 {form.skillIds.length} / 20 个，培训时会固定各 Skill 的 commit。</p>
            <div className="agent-skill-options">
              {skills.map((skill) => {
                const checked = form.skillIds.includes(skill.id);
                return (
                  <FieldLabel className={`agent-skill-option${checked ? " agent-skill-option-selected" : ""}`} key={skill.id}>
                    <Checkbox checked={checked} onCheckedChange={() => toggleSkill(skill.id)} disabled={submitting || (!checked && form.skillIds.length >= 20)} />
                    <span><strong>{skill.displayName}</strong><code>{skill.id}</code><small>{skill.description}</small></span>
                  </FieldLabel>
                );
              })}
              {missingSkills.map((skillId) => (
                <FieldLabel className="agent-skill-option agent-skill-option-selected" key={skillId}>
                  <Checkbox checked onCheckedChange={() => toggleSkill(skillId)} disabled={submitting} />
                  <span><strong>{skillId}</strong><code>{skillId}</code><small>此 Skill 不在当前目录中；取消选择后不能重新添加。</small></span>
                </FieldLabel>
              ))}
            </div>
          </FieldSet>

          <div className="form-footer agent-form-footer">
            <p>{editing ? "保存使用 revision 冲突检查，避免覆盖其他人的修改。" : "创建后可先检查 AGENTS.md，再开始本机培训。"}</p>
            <div className="button-row">
              <Button variant="outline" nativeButton={false} render={<Link to={backTo} />}>取消</Button>
              <Button variant="default" type="submit" disabled={submitting || form.skillIds.length === 0}>
                {submitting ? "正在保存…" : editing ? "保存修改" : "创建角色"}
              </Button>
            </div>
          </div>
        </FieldGroup>
</form>
      )}
    </div>
  );
}
