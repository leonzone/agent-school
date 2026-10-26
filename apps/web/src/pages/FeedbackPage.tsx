import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCallback, useEffect, useState } from "react";
import type { FeedbackKind, FeedbackRecord, TestOutcome } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { useSystemStatus } from "../components/SystemStatus";
import { EmptyState, ErrorBanner, LoadingState, Notice, PageHeader } from "../components/UI";
import { useLocation } from "../router";
import { errorMessage, formatDate, shortCommit } from "../utils";

const kindLabels: Record<FeedbackKind, string> = {
  issue: "问题",
  suggestion: "建议",
  praise: "表扬",
};

type FeedbackForm = {
  skillId: string;
  skillCommit: string;
  runId: string;
  kind: FeedbackKind;
  author: string;
  content: string;
  outcome: TestOutcome | "";
};

function initialForm(search: string): FeedbackForm {
  const query = new URLSearchParams(search);
  const kind = query.get("kind");
  const outcome = query.get("outcome");
  return {
    skillId: query.get("skillId") ?? "",
    skillCommit: query.get("skillCommit") ?? "",
    runId: query.get("runId") ?? "",
    kind: kind === "issue" || kind === "suggestion" || kind === "praise" ? kind : "issue",
    author: "",
    content: "",
    outcome: outcome === "passed" || outcome === "failed" ? outcome : "",
  };
}

export function FeedbackPage() {
  const { search } = useLocation();
  const { status } = useSystemStatus();
  const [form, setForm] = useState<FeedbackForm>(() => initialForm(search));
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [filterSkill, setFilterSkill] = useState("");
  const [filterCommit, setFilterCommit] = useState("");
  const [filters, setFilters] = useState({ skillId: "", skillCommit: "" });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.feedback(filters);
      setRecords(data.feedback);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateForm<K extends keyof FeedbackForm>(key: K, value: FeedbackForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const record = await api.createFeedback({
        skillId: form.skillId.trim(),
        skillCommit: form.skillCommit.trim(),
        runId: form.runId.trim() || null,
        kind: form.kind,
        author: form.author.trim(),
        content: form.content.trim(),
        outcome: form.outcome || null,
      });
      setForm((current) => ({ ...current, content: "" }));
      setMessage(`反馈已保存，记录编号为 ${record.id}`);
      await load();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  function applyFilters() {
    const next = { skillId: filterSkill.trim(), skillCommit: filterCommit.trim() };
    if (next.skillId === filters.skillId && next.skillCommit === filters.skillCommit) void load();
    else setFilters(next);
  }

  function clearFilters() {
    setFilterSkill("");
    setFilterCommit("");
    if (!filters.skillId && !filters.skillCommit) void load();
    else setFilters({ skillId: "", skillCommit: "" });
  }

  return (
    <div>
      <PageHeader
        eyebrow="团队改进"
        title="团队反馈"
        description="记录问题、改进建议和值得保留的经验，并关联具体课程版本与测试结果。"
      />

      <section className="maintenance-note" aria-labelledby="maintenance-title">
        <div>
          <span className="eyebrow">维护人工作方式</span>
          <h2 id="maintenance-title">在维护工作目录中修改并推送</h2>
          <p>维护人需要在以下 Git 工作目录中完成修改并 push，然后回到课程库点击“刷新课程”。反馈保存本身不会自动通知维护人，也不会自动修改 Git。</p>
        </div>
        <div>
          <span>维护工作目录</span>
          {status?.maintenanceClonePath ? <code>{status.maintenanceClonePath}</code> : <strong>未检测到可用的维护工作目录</strong>}
        </div>
      </section>

      <div className="feedback-layout">
        <Card className="content-panel feedback-form-panel" aria-labelledby="feedback-form-title">
          <CardHeader><div><span className="eyebrow">新记录</span><h2 id="feedback-form-title">提交反馈</h2></div></CardHeader>
          <CardContent>
          {form.runId ? <Notice>已从运行结果预填课程、提交和测试编号，提交后会保持关联。</Notice> : null}
          {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}
          <form className="feedback-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <FieldGroup>
            <Field className="field">
              <FieldLabel htmlFor="feedback-kind">反馈类型</FieldLabel>
              <NativeSelect className="w-full" id="feedback-kind" value={form.kind} onChange={(event) => updateForm("kind", event.target.value as FeedbackKind)} disabled={submitting}>
                <NativeSelectOption value="issue">问题</NativeSelectOption>
                <NativeSelectOption value="suggestion">建议</NativeSelectOption>
                <NativeSelectOption value="praise">表扬</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field className="field">
              <FieldLabel htmlFor="feedback-author">署名（留空即匿名）</FieldLabel>
              <Input id="feedback-author" value={form.author} onChange={(event) => updateForm("author", event.target.value)} maxLength={80} placeholder="你的称呼" disabled={submitting} />
            </Field>
            <Field className="field">
              <FieldLabel htmlFor="feedback-content">反馈内容</FieldLabel>
              <Textarea id="feedback-content" value={form.content} onChange={(event) => updateForm("content", event.target.value)} rows={6} maxLength={5000} required placeholder="描述具体问题、复现条件、改进建议或值得肯定的体验" disabled={submitting} />
              <p className="field-help">{form.content.length} / 5000 字</p>
            </Field>
            <FieldGroup className="form-two-columns">
              <Field className="field">
                <FieldLabel htmlFor="feedback-skill">Skill ID</FieldLabel>
                <Input id="feedback-skill" value={form.skillId} onChange={(event) => updateForm("skillId", event.target.value)} pattern="[a-z0-9][a-z0-9-]{0,63}" required spellCheck={false} disabled={submitting} />
              </Field>
              <Field className="field">
                <FieldLabel htmlFor="feedback-outcome">关联验收结论</FieldLabel>
                <NativeSelect className="w-full" id="feedback-outcome" value={form.outcome} onChange={(event) => updateForm("outcome", event.target.value as TestOutcome | "")} disabled={submitting}>
                  <NativeSelectOption value="">不关联结论</NativeSelectOption>
                  <NativeSelectOption value="passed">达到预期</NativeSelectOption>
                  <NativeSelectOption value="failed">未达到预期</NativeSelectOption>
                </NativeSelect>
              </Field>
            </FieldGroup>
            <Field className="field">
              <FieldLabel htmlFor="feedback-commit">Skill 提交（完整 40 位）</FieldLabel>
              <Input id="feedback-commit" value={form.skillCommit} onChange={(event) => updateForm("skillCommit", event.target.value)} pattern="[0-9a-f]{40}" minLength={40} maxLength={40} required spellCheck={false} disabled={submitting} />
            </Field>
            <Field className="field">
              <FieldLabel htmlFor="feedback-run">关联测试编号（可选）</FieldLabel>
              <Input id="feedback-run" value={form.runId} onChange={(event) => updateForm("runId", event.target.value)} spellCheck={false} placeholder="测试记录 UUID" disabled={submitting} />
            </Field>
            <Button variant="default" type="submit" className="w-full" disabled={submitting || !form.content.trim()}>{submitting ? "正在保存…" : "保存反馈"}</Button>
          </FieldGroup>
</form>
          </CardContent>
        </Card>

        <section className="feedback-list-panel" aria-labelledby="feedback-list-title">
          <div className="section-heading">
            <div><span className="eyebrow">团队记录</span><h2 id="feedback-list-title">反馈列表</h2></div>
            <span className="muted">{records.length} 条</span>
          </div>
          <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
            <Field className="field"><FieldLabel htmlFor="filter-skill">按 Skill 过滤</FieldLabel><Input id="filter-skill" value={filterSkill} onChange={(event) => setFilterSkill(event.target.value)} placeholder="完整 Skill ID" /></Field>
            <Field className="field"><FieldLabel htmlFor="filter-commit">按提交过滤</FieldLabel><Input id="filter-commit" value={filterCommit} onChange={(event) => setFilterCommit(event.target.value)} placeholder="完整 40 位提交" minLength={0} maxLength={40} spellCheck={false} /></Field>
            <div className="button-row"><Button variant="outline" type="submit">应用过滤</Button><Button variant="ghost" type="button" onClick={clearFilters}>清空</Button></div>
          </form>
          {loading ? <LoadingState label="正在读取团队反馈" /> : null}
          {!loading && records.length === 0 ? <EmptyState title="没有反馈记录" description={filters.skillId || filters.skillCommit ? "当前过滤条件下没有记录，可以清空过滤后再查看。" : "提交第一条反馈，帮助维护人改进课程。"} /> : null}
          <div className="feedback-list">
            {records.map((record) => (
              <Card key={record.id}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <Badge variant="secondary">{kindLabels[record.kind]}</Badge>
                  <time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>
                </CardHeader>
                <CardContent><p className="feedback-content">{record.content}</p></CardContent>
                <CardFooter className="flex-wrap gap-3">
                  <span>{record.author || "匿名"}</span>
                  <span><code>{record.skillId}</code> · <code>{shortCommit(record.skillCommit)}</code></span>
                  {record.outcome ? <span>{record.outcome === "passed" ? "达到预期" : "未达到预期"}</span> : null}
                  {record.runId ? <Link className="text-link" to={`/runs/${encodeURIComponent(record.runId)}`}>查看关联测试</Link> : null}
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
