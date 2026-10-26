import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, Installation, TrainedAgent } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { useSystemStatus } from "../components/SystemStatus";
import { EmptyState, ErrorBanner, LoadingState, Notice, PageHeader } from "../components/UI";
import { navigate } from "../router";
import { errorMessage, formatBytes, readRecentWorkspace, rememberWorkspace } from "../utils";

export function NewRunPage({ skillId, agentId, embedded = false }: { skillId?: string; agentId?: string; embedded?: boolean }) {
  const { status } = useSystemStatus();
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [training, setTraining] = useState<TrainedAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(readRecentWorkspace);
  const [task, setTask] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (agentId) {
        const [agentData, trainingData] = await Promise.all([
          api.agent(agentId),
          api.training(agentId).catch(() => null),
        ]);
        setAgent(agentData.agent);
        setTraining(trainingData?.training ?? null);
      } else if (skillId) {
        const data = await api.installations();
        setInstallation(data.installations.find((item) => item.skillId === skillId) ?? null);
      }
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [skillId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const subjectName = agent?.name ?? installation?.skillName ?? "";
  const ready = agentId ? training !== null : installation !== null;

  async function submit() {
    if (!ready || submitting) return;
    const normalizedWorkspace = agentId ? training?.projectPath ?? "" : workspace.trim();
    const normalizedTask = task.trim();
    if (!normalizedWorkspace.startsWith("/")) {
      setError("工作目录必须是 macOS 上的绝对路径，并以 / 开头");
      return;
    }
    if (!normalizedTask) {
      setError("请填写希望通过测试验证的任务");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const run = agentId
        ? await api.createRun({ agentId, workspace: "", task: normalizedTask }, files)
        : await api.createRun({ skillId: skillId!, workspace: normalizedWorkspace, task: normalizedTask }, files);
      if (!agentId) rememberWorkspace(normalizedWorkspace);
      navigate(`/runs/${encodeURIComponent(run.id)}`);
    } catch (submitError) {
      setError(errorMessage(submitError));
      setSubmitting(false);
    }
  }

  function clearFiles() {
    setFiles([]);
    if (fileInput.current) fileInput.current.value = "";
  }

  const backPath = agentId ? `/agents/${encodeURIComponent(agentId)}` : "/skills/installed";
  if (loading) return <LoadingState label="正在确认培训项目与固定版本" />;
  if (!ready) {
    return (
      <div>
        {!embedded ? <Link className="back-link" to={backPath}>返回</Link> : null}
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {!error ? (
          <EmptyState
            title={agentId ? "此角色尚未完成培训" : "此课程尚未安装"}
            description={agentId ? "请先在角色详情页创建本机培训项目，再开始测试调试。" : "执行测试需要一个明确的本机安装提交，请先安装课程。"}
            action={<Link className="button button-primary" to={agentId ? backPath : `/skills/${encodeURIComponent(skillId ?? "")}`}>{agentId ? "前往培训" : "前往安装"}</Link>}
          />
        ) : null}
      </div>
    );
  }

  const codexReady = status?.codex.available && status.codex.compatible && status.codex.loggedIn;

  return (
    <div className={embedded ? "embedded-run-page" : "narrow-page"}>
      {!embedded ? (
        <>
          <Link className="back-link" to={backPath}>返回{agentId ? "角色" : "已安装"}</Link>
          <PageHeader
            eyebrow={agentId ? "角色测试与调试" : "新建测试"}
            title={subjectName}
            description={agentId ? "Codex 将在角色培训项目中读取 AGENTS.md 和项目 Skills，完成你给出的测试题。" : "测试会在你指定的本机目录中执行，请确认任务描述和材料都已准备妥当。"}
          />
        </>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      <Notice tone={codexReady ? "info" : "warning"}>
        <strong>本地文件与 Codex 提示</strong>
        <p>Codex 将直接读取和修改工作目录中的文件；上传材料会保存到本次测试目录。请提前备份重要内容。</p>
        <p>当前 Codex：{status ? (codexReady ? `已就绪${status.codex.version ? `（${status.codex.version}）` : ""}` : "未就绪，请检查可用性、版本和登录状态") : "状态检查中"}。</p>
      </Notice>

      <form className="panel run-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <section className="fixed-run-skill" aria-label="固定测试目标与版本">
          <div><span>{agentId ? "培训角色" : "固定 Skill"}</span><strong>{subjectName}</strong><code>{agentId ?? skillId}</code></div>
          <div><span>{agentId ? "角色 revision" : "固定提交"}</span><code>{agentId ? training?.revision : installation?.commit}</code></div>
        </section>

        {agentId ? (
          <div className="training-run-context">
            <span>固定项目目录</span>
            <code>{training?.projectPath}</code>
            <p>{training?.skills.length} 个项目 Skills 将与角色指令一起用于本次测试，目录不能在此测试中替换。</p>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="run-workspace">绝对工作目录</label>
            <input id="run-workspace" type="text" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="/绝对路径/用于测试的项目目录" autoComplete="off" spellCheck={false} required disabled={submitting} />
            <p className="field-help">输入本机目录的绝对路径。成功创建测试后，会在此浏览器记住最近使用的目录。</p>
          </div>
        )}

        <div className="field">
          <label htmlFor="run-task">测试任务</label>
          <textarea id="run-task" value={task} onChange={(event) => setTask(event.target.value)} placeholder="用自然语言说明希望这个角色完成的任务，以及如何判断结果是否正确" rows={7} maxLength={20000} required disabled={submitting} />
          <p className="field-help">建议包含目标、约束和验收标准。当前 {task.length} / 20000 字。</p>
        </div>

        <div className="field">
          <label htmlFor="run-materials">测试材料（可多选）</label>
          <input ref={fileInput} id="run-materials" type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} disabled={submitting} />
          <p className="field-help">可上传文档、数据或示例文件，单个文件不超过 10 MB，最多 10 个。</p>
          {files.length > 0 ? (
            <div className="selected-files">
              <div className="section-heading"><strong>已选择 {files.length} 个文件</strong><button type="button" className="text-button" onClick={clearFiles} disabled={submitting}>清除材料</button></div>
              <ul className="plain-list">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span>{file.name}</span><span>{formatBytes(file.size)}</span></li>)}</ul>
            </div>
          ) : null}
        </div>

        <div className="form-footer">
          <p>提交后将跳转到实时运行详情，可在那里处理审批或停止测试。</p>
          <button type="submit" className="button button-primary" disabled={submitting || !task.trim() || (!agentId && !workspace.trim())}>{submitting ? "正在创建测试…" : "开始执行测试"}</button>
        </div>
      </form>
    </div>
  );
}
