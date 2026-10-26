import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import type {
  Agent,
  ApprovalRequest,
  CodexConfigResponse,
  ConversationDetail,
  RunDetail,
  RunEvent,
  RunSummary,
  TrainedAgent,
} from "@skillhub/shared";
import { api, ApiError, initializeSession } from "../api";
import { Approvals } from "../components/Approvals";
import { ChatComposerEditor, type ChatComposerEditorHandle } from "../components/ChatComposerEditor";
import { Markdown } from "../components/Markdown";
import { RunFiles } from "../components/RunFiles";
import { AgentActivity, RunHistory, eventKinds } from "../components/ai-elements/AgentActivity";
import { ChoiceMenu } from "../components/ai-elements/ChoiceMenu";
import { Button } from "../components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton } from "../components/ui/input-group";
import { Message, MessageContent, MessageHeader, MessageFooter } from "../components/ui/message";
import { Bubble, BubbleContent } from "../components/ui/bubble";
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from "../components/ui/message-scroller";
import { ConversationIndex } from "../components/ai-elements/ConversationIndex";
import { Attachment, AttachmentGroup, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions, AttachmentAction } from "../components/ui/attachment";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "../components/ui/empty";
import { CopyIcon, ArrowUpIcon, SquareIcon, PaperclipIcon, XIcon, FileIcon } from "lucide-react";
import { ErrorBanner, LoadingState, Notice, RunStatusBadge } from "../components/UI";
import { agentAvatar, asRecord, errorMessage, formatBytes, isActiveStatus, isRunEvent } from "../utils";

const supportedImageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const maxAttachmentCount = 10;
const maxAttachmentSize = 10 * 1024 * 1024;
const permissionLabels = {
  strict: "始终请求批准",
  workspace: "必要时请求批准",
  full: "完全权限",
} as const;
const permissionBadgeLabels = {
  strict: "严格权限",
  workspace: "工作区权限",
  full: "完全权限",
} as const;

type ConnectionState = "connecting" | "connected" | "reconnecting";
type PermissionMode = keyof typeof permissionLabels;
type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};
type ComposerOptions = {
  skillIds: string[];
  permissionMode: PermissionMode;
  model: string;
  effort: string;
};

function runOptions(run: RunSummary): ComposerOptions | null {
  if (!("options" in run)) return null;
  const options = asRecord(run.options);
  if (!options || !Array.isArray(options.skillIds)) return null;
  const permissionMode = options.permissionMode;
  if (
    (permissionMode !== "strict" && permissionMode !== "workspace" && permissionMode !== "full")
    || typeof options.model !== "string"
    || typeof options.effort !== "string"
  ) return null;
  return {
    skillIds: options.skillIds.filter((skillId): skillId is string => typeof skillId === "string"),
    permissionMode,
    model: options.model,
    effort: options.effort,
  };
}

export function AgentChatPage({ agent, training, onAvatarClick, onMessagePreview, configOpen = false }: {
  agent: Agent;
  training: TrainedAgent;
  onAvatarClick?: (() => void) | undefined;
  configOpen?: boolean | undefined;
  onMessagePreview?: ((agentId: string, text: string) => void) | undefined;
}) {
  const conversationIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({});
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [task, setTask] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [codexConfig, setCodexConfig] = useState<CodexConfigResponse | null>(null);
  const [codexLoading, setCodexLoading] = useState(true);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("workspace");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerEditor = useRef<ChatComposerEditorHandle>(null);
  const skillsMenu = useRef<HTMLDivElement>(null);
  const skillsPopover = useRef<HTMLDivElement>(null);
  const attachmentSequence = useRef(0);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const currentAgentId = useRef(agent.id);
  const currentRunId = useRef(activeRunId);
  const mounted = useRef(true);
  currentAgentId.current = agent.id;
  currentRunId.current = activeRunId;
  attachmentsRef.current = attachments;

  const visibleDetail = detail?.conversation.agentId === agent.id ? detail : null;
  const activeSummary = visibleDetail?.runs.find((run) => run.id === activeRunId) ?? null;
  const activeRun = activeRunId ? runDetails[activeRunId] ?? null : null;
  const active = activeRun
    ? isActiveStatus(activeRun.status)
    : activeSummary !== null && isActiveStatus(activeSummary.status);
  const revisionUpdated = visibleDetail !== null && visibleDetail.conversation.revision !== training.revision;
  const selectedModel = codexConfig?.models.find((candidate) => candidate.model === model) ?? null;
  const composerDisabled = !visibleDetail || sending || active;
  const settingsDisabled = composerDisabled || codexLoading;

  useEffect(() => {
    const latest = visibleDetail?.runs.at(-1);
    if (!latest) return;
    const run = runDetails[latest.id] ?? latest;
    onMessagePreview?.(agent.id, run.finalText || run.task);
  }, [agent.id, visibleDetail, runDetails, onMessagePreview]);

  const replaceAttachments = useCallback((next: ComposerAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const clearAttachments = useCallback(() => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    replaceAttachments([]);
    if (fileInput.current) fileInput.current.value = "";
  }, [replaceAttachments]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
      attachmentsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!skillsOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!skillsMenu.current?.contains(target) && !skillsPopover.current?.contains(target)) setSkillsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSkillsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [skillsOpen]);

  useEffect(() => {
    if (settingsDisabled) setSkillsOpen(false);
  }, [settingsDisabled]);

  const loadCodexConfig = useCallback(async () => {
    const requestedAgentId = agent.id;
    setCodexLoading(true);
    setCodexError(null);
    try {
      const data = await api.codexConfig();
      if (!mounted.current || currentAgentId.current !== requestedAgentId) return;
      setCodexConfig(data);
      const configuredModel = data.models.find((candidate) => candidate.model === data.settings?.model);
      const initialModel = configuredModel ?? data.models.find((candidate) => candidate.isDefault) ?? data.models[0] ?? null;
      setModel(initialModel?.model ?? "");
      setEffort(initialModel?.defaultReasoningEffort ?? "");
      if (!initialModel) setCodexError("当前没有可用模型，请检查 Codex 配置");
    } catch (error) {
      if (mounted.current && currentAgentId.current === requestedAgentId) setCodexError(errorMessage(error));
    } finally {
      if (mounted.current && currentAgentId.current === requestedAgentId) setCodexLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void loadCodexConfig();
  }, [loadCodexConfig]);

  const refreshRun = useCallback(async (runId: string) => {
    try {
      const data = await api.run(runId);
      if (mounted.current && data.agent?.id === currentAgentId.current) {
        setRunDetails((current) => ({ ...current, [runId]: data }));
      }
      return data;
    } catch (error) {
      if (mounted.current && currentRunId.current === runId) setActionError(errorMessage(error));
      return null;
    }
  }, []);

  const refreshApprovals = useCallback(async (runId: string) => {
    try {
      const data = await api.approvals(runId);
      if (mounted.current && currentRunId.current === runId) setApprovals(data.approvals);
    } catch (error) {
      if (mounted.current && currentRunId.current === runId) setActionError(errorMessage(error));
    }
  }, []);

  const refreshConversation = useCallback(async (initial = false) => {
    const requestedAgentId = agent.id;
    if (initial) {
      setDetailLoading(true);
      setDetailError(null);
    }
    try {
      const requestedConversationId = conversationIdRef.current;
      const data = requestedConversationId ? await api.conversation(requestedConversationId) : await api.ensureConversation(requestedAgentId);
      const details = await Promise.all(data.runs.map(async (run) => {
        try {
          return await api.run(run.id);
        } catch (error) {
          if (mounted.current && currentAgentId.current === requestedAgentId) setActionError(`运行详情读取失败：${errorMessage(error)}`);
          return null;
        }
      }));
      if (!mounted.current || currentAgentId.current !== requestedAgentId || conversationIdRef.current !== requestedConversationId) return null;
      conversationIdRef.current = data.conversation.id;
      setDetail(data);
      setRunDetails((current) => {
        const next = { ...current };
        for (const run of details) {
          if (run) next[run.id] = run;
        }
        return next;
      });
      const latestActive = data.runs.find((run) => isActiveStatus(run.status));
      setActiveRunId((current) => {
        const currentRun = details.find((run) => run?.id === current);
        return currentRun && isActiveStatus(currentRun.status) ? current : latestActive?.id ?? null;
      });
      setDetailError(null);
      return data;
    } catch (error) {
      if (mounted.current && currentAgentId.current === requestedAgentId) setDetailError(errorMessage(error));
      return null;
    } finally {
      if (mounted.current && currentAgentId.current === requestedAgentId) setDetailLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    conversationIdRef.current = null;
    setDetail(null);
    setRunDetails({});
    setActiveRunId(null);
    setApprovals([]);
    setEvents([]);
    setActionError(null);
    setComposerError(null);
    setDetailError(null);
    setSending(false);
    setStopping(false);
    setTask("");
    setSelectedSkillIds([]);
    setPermissionMode("workspace");
    setSkillsOpen(false);
    clearAttachments();
    void refreshConversation(true);
  }, [agent.id, clearAttachments, refreshConversation]);

  useEffect(() => {
    if (!activeRunId) {
      setEvents([]);
      setApprovals([]);
      return;
    }
    const runId = activeRunId;
    let disposed = false;
    let finishing = false;
    let source: EventSource | null = null;
    const seen = new Set<number>();
    setEvents([]);
    setApprovals([]);
    setConnection("connecting");

    const finish = async () => {
      if (finishing) return;
      finishing = true;
      await Promise.all([
        refreshConversation(),
        refreshRun(runId),
        refreshApprovals(runId),
      ]);
    };

    const receive = (event: Event) => {
      const message = event as MessageEvent<string>;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }
      if (!isRunEvent(parsed) || parsed.runId !== runId || seen.has(parsed.seq)) return;
      seen.add(parsed.seq);
      setEvents((current) => [...current, parsed]);

      if (parsed.kind === "status" || parsed.kind === "meta" || parsed.kind === "outcome") {
        const payload = asRecord(parsed.payload);
        if (payload) {
          setRunDetails((current) => {
            const run = current[runId];
            return run ? { ...current, [runId]: { ...run, ...payload } as RunDetail } : current;
          });
        }
      }
      if (parsed.kind === "files") void refreshRun(runId);
      if (parsed.kind === "approval" || parsed.kind === "approvalDecision") void refreshApprovals(runId);
      if (parsed.kind === "notification" && parsed.method === "serverRequest/resolved") void refreshApprovals(runId);
      if (parsed.kind === "status") {
        const status = asRecord(parsed.payload)?.status;
        if (typeof status === "string" && ["completed", "failed", "interrupted"].includes(status)) void finish();
      }
    };

    async function connect() {
      try {
        await initializeSession();
        if (disposed) return;
        source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
        source.onopen = () => {
          if (!disposed) setConnection("connected");
        };
        source.onerror = () => {
          if (!disposed) setConnection("reconnecting");
        };
        for (const kind of eventKinds) source.addEventListener(kind, receive);
      } catch (error) {
        if (!disposed) {
          setConnection("reconnecting");
          setActionError(errorMessage(error));
        }
      }
    }

    void connect();
    void refreshApprovals(runId);
    const poll = window.setInterval(() => {
      void refreshRun(runId);
      void refreshApprovals(runId);
    }, 20000);
    return () => {
      disposed = true;
      window.clearInterval(poll);
      source?.close();
    };
  }, [activeRunId, refreshApprovals, refreshConversation, refreshRun]);

  function addFiles(incoming: File[]) {
    if (composerDisabled || incoming.length === 0) return;
    const remaining = maxAttachmentCount - attachmentsRef.current.length;
    const accepted = incoming.slice(0, Math.max(0, remaining));
    const next: ComposerAttachment[] = [];
    let validationError = incoming.length > remaining ? `最多添加 ${maxAttachmentCount} 个附件` : null;
    for (const file of accepted) {
      if (file.size > maxAttachmentSize) {
        validationError = `${file.name} 超过 10 MB，未添加`;
        continue;
      }
      if (file.type.startsWith("image/") && !supportedImageMimes.has(file.type)) {
        validationError = `${file.name} 的图片格式不支持，仅支持 PNG、JPEG、WebP、GIF`;
        continue;
      }
      const image = supportedImageMimes.has(file.type);
      attachmentSequence.current += 1;
      next.push({
        id: `${Date.now()}-${attachmentSequence.current}`,
        file,
        previewUrl: image ? URL.createObjectURL(file) : null,
      });
    }
    if (next.length > 0) replaceAttachments([...attachmentsRef.current, ...next]);
    setComposerError(validationError);
  }

  function removeAttachment(id: string) {
    const target = attachmentsRef.current.find((attachment) => attachment.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    replaceAttachments(attachmentsRef.current.filter((attachment) => attachment.id !== id));
    setComposerError(null);
  }

  function pasteFiles(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length === 0 || composerDisabled) return;
    event.preventDefault();
    addFiles(pasted);
  }

  async function send() {
    if (!visibleDetail || sending || active) return;
    const normalizedTask = task.trim();
    if (!normalizedTask) {
      setComposerError("请输入要发送给员工的消息");
      return;
    }
    if (!selectedModel) {
      setComposerError(codexLoading ? "模型配置仍在加载，请稍候" : "没有可用模型，请检查 Codex 配置");
      return;
    }
    if (permissionMode === "full" && !window.confirm("完全权限将不审批且可访问工作区外文件。确认本轮以完全权限发送吗？")) return;
    const options: ComposerOptions = {
      skillIds: [...selectedSkillIds],
      permissionMode,
      model: selectedModel.model,
      effort: effort || selectedModel.defaultReasoningEffort,
    };
    setSending(true);
    setComposerError(null);
    setSkillsOpen(false);
    try {
      const run = await api.sendConversationMessage(
        visibleDetail.conversation.id,
        normalizedTask,
        attachmentsRef.current.map((attachment) => attachment.file),
        options,
      );
      setRunDetails((current) => ({ ...current, [run.id]: run }));
      setActiveRunId(run.id);
      setTask("");
      setSelectedSkillIds([]);
      clearAttachments();
      await refreshConversation();
    } catch (error) {
      setComposerError(error instanceof ApiError && error.status === 409
        ? "当前有其他 Run 正在执行，请等待它完成或停止后再发送。"
        : errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!activeRunId || stopping) return;
    setStopping(true);
    setActionError(null);
    try {
      const run = await api.stopRun(activeRunId);
      setRunDetails((current) => ({ ...current, [run.id]: run }));
      await refreshApprovals(run.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setStopping(false);
    }
  }

  async function copyReply(text: string) {
    try { await navigator.clipboard.writeText(text); }
    catch { setActionError("复制失败，请检查浏览器剪贴板权限。"); }
  }

  return (
    <section className="chat-main employee-chat-main" aria-label={`${agent.name} 的员工对话`}>
      <header className="agent-chat-header">
        <Button className="agent-chat-identity" variant="outline" onClick={onAvatarClick} aria-label={configOpen ? "隐藏员工配置" : "显示员工配置"} aria-expanded={configOpen} aria-controls="employee-config" title={training.projectPath}>
          <span className="employee-avatar" aria-hidden="true">{agentAvatar(agent)}</span><strong>{agent.name}</strong>
        </Button>
        <span className="agent-chat-status" role="status">{active ? "正在回复…" : sending ? "正在发送…" : ""}</span>
      </header>
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {revisionUpdated ? <Notice><span>历史聊天保留，新回复使用最新培训上下文</span></Notice> : null}

      <MessageScrollerProvider key={visibleDetail?.conversation.id ?? "loading"} autoScroll scrollMargin={100}>
        <MessageScroller className="agent-chat-scroller">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-6 p-5" aria-busy={active || detailLoading}>
              {detailLoading && !visibleDetail ? <MessageScrollerItem messageId="loading"><LoadingState label="正在进入员工会话" /></MessageScrollerItem> : null}
              {detailError ? <MessageScrollerItem messageId="error"><ErrorBanner message={detailError} onRetry={() => void refreshConversation(true)} /></MessageScrollerItem> : null}
              {visibleDetail?.runs.length === 0 ? <MessageScrollerItem messageId="welcome"><Empty><EmptyHeader><EmptyTitle>与 {agent.name} 开始协作</EmptyTitle><EmptyDescription>描述任务，或添加文档、数据和示例文件。</EmptyDescription></EmptyHeader></Empty></MessageScrollerItem> : null}
              {visibleDetail?.runs.flatMap((summary) => {
                const run = runDetails[summary.id] ?? null;
                const isCurrent = activeRunId === summary.id && active;
                const finalText = run?.finalText ?? summary.finalText;
                const runError = run?.error ?? summary.error;
                const options = runOptions(run ?? summary);
                return [
                  <MessageScrollerItem key={`${summary.id}-user`} messageId={`${summary.id}-user`} scrollAnchor>
                    <Message align="end" className="user-chat-message"><MessageContent>
                      <Bubble align="end" variant="default"><BubbleContent className="whitespace-pre-wrap break-words">{summary.task}</BubbleContent></Bubble>
                      {run && run.inputFiles.length > 0 ? <MessageFooter>附件：{run.inputFiles.map((file) => file.name).join("、")}</MessageFooter> : null}
                      <MessageFooter className="user-message-actions">
                        <time dateTime={summary.createdAt}>{new Date(summary.createdAt).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</time>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="复制消息" title="复制消息" onClick={() => void copyReply(summary.task)}><CopyIcon /></Button>
                      </MessageFooter>
                    </MessageContent></Message>
                  </MessageScrollerItem>,
                  <MessageScrollerItem key={`${summary.id}-agent`} messageId={`${summary.id}-agent`}>
                    <Message><MessageContent className="w-full gap-3">
                      <MessageHeader><strong>{agent.name}</strong><RunStatusBadge status={run?.status ?? summary.status} /></MessageHeader>
                      {isCurrent ? <>
                        <Approvals runId={summary.id} approvals={approvals} onChange={setApprovals} onRunUpdated={async () => { await refreshRun(summary.id); }} />
                        <span className={`chat-connection ${connection}`} role="status">{connection === "connected" ? "实时连接正常" : connection === "connecting" ? "正在连接" : "连接中断，正在自动续传"}</span>
                        <AgentActivity events={events} running />
                      </> : <>
                        <RunHistory runId={summary.id} />
                        {finalText ? <Markdown>{finalText}</Markdown> : null}
                        {!finalText && !runError && summary.status === "completed" ? <p className="muted">本轮没有文字回复。</p> : null}
                        {runError ? <Notice tone="warning"><strong>本轮运行错误</strong><p>{runError}</p></Notice> : null}
                        <MessageFooter>
                          {finalText ? <Button variant="ghost" size="icon-sm" aria-label="复制回复" onClick={() => void copyReply(finalText)}><CopyIcon /></Button> : null}
                          {(runError || summary.status === "interrupted") ? <Button variant="ghost" size="sm" disabled={composerDisabled} onClick={() => { setTask(summary.task); document.getElementById("chat-task")?.focus(); }}>重新编辑并发送</Button> : null}
                          {options ? <span>{options.model} · {permissionBadgeLabels[options.permissionMode]}</span> : null}
                        </MessageFooter>
                      </>}
                      {run && run.files.length > 0 ? <RunFiles runId={summary.id} files={run.files} /> : null}
                    </MessageContent></Message>
                  </MessageScrollerItem>,
                ];
              })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <ConversationIndex rounds={visibleDetail?.runs ?? []} />
          <MessageScrollerButton aria-label="回到最新消息" />
        </MessageScroller>
      </MessageScrollerProvider>

      {visibleDetail ? (
        <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {active ? <p className="composer-disabled-reason">Codex 正在回复，本轮完成或停止后即可继续。</p> : null}
          {composerError ? <ErrorBanner message={composerError} /> : null}
          {codexError ? <ErrorBanner message={codexError} onRetry={() => void loadCodexConfig()} /> : null}
          {permissionMode === "full" ? <p className="composer-full-warning" role="alert">完全权限：不审批且可访问工作区外文件，请仅在可信隔离项目中使用。</p> : null}
          <InputGroup className="agent-prompt-input">
          {attachments.length > 0 ? <InputGroupAddon align="block-start"><AttachmentGroup>
            {attachments.map((attachment) => <Attachment size="sm" key={attachment.id}>
              <AttachmentMedia variant={attachment.previewUrl ? "image" : "icon"}>{attachment.previewUrl ? <img src={attachment.previewUrl} alt={attachment.file.name} /> : <FileIcon />}</AttachmentMedia>
              <AttachmentContent><AttachmentTitle>{attachment.file.name}</AttachmentTitle><AttachmentDescription>{formatBytes(attachment.file.size)}</AttachmentDescription></AttachmentContent>
              <AttachmentActions><AttachmentAction aria-label={`移除 ${attachment.file.name}`} onClick={() => removeAttachment(attachment.id)} disabled={composerDisabled}><XIcon /></AttachmentAction></AttachmentActions>
            </Attachment>)}
          </AttachmentGroup></InputGroupAddon> : null}
          <ChatComposerEditor
            ref={composerEditor}
            value={task}
            skills={training.skills}
            disabled={composerDisabled}
            onChange={setTask}
            onSkillIdsChange={setSelectedSkillIds}
            onSend={() => void send()}
            onPaste={pasteFiles}
          />
          <InputGroupAddon align="block-end" className="composer-settings-row">
            <div className="composer-attachments">
              <input
                ref={fileInput}
                id="chat-materials"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,*/*"
                multiple
                onChange={(event) => {
                  addFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = "";
                }}
                disabled={composerDisabled}
              />
              <InputGroupButton type="button" size="icon-sm" aria-label="添加附件" onClick={() => fileInput.current?.click()} disabled={composerDisabled}><PaperclipIcon /></InputGroupButton>
            </div>
            <div className="composer-skills" ref={skillsMenu}>
              <InputGroupButton type="button" size="sm" aria-expanded={skillsOpen} aria-haspopup="dialog" onMouseDown={(event) => event.preventDefault()} onClick={() => setSkillsOpen((current) => !current)} disabled={settingsDisabled}>
                @ Skills{selectedSkillIds.length > 0 ? ` ${selectedSkillIds.length}` : ""}
              </InputGroupButton>
            </div>
            <ChoiceMenu label="运行权限" value={permissionMode} options={Object.entries(permissionLabels).map(([value, label]) => ({ value, label }))} disabled={settingsDisabled} onChange={(value) => setPermissionMode(value as PermissionMode)} />
            <ChoiceMenu label="选择模型" value={model} options={codexConfig?.models.map((option) => ({ value: option.model, label: option.displayName })) ?? []} disabled={settingsDisabled || !codexConfig} onChange={(value) => { setModel(value); setEffort(""); }} />
            <ChoiceMenu label="思考强度" value={effort} options={[{ value: "", label: "跟随模型" }, ...(selectedModel?.supportedReasoningEfforts.map((value) => ({ value, label: value })) ?? [])]} disabled={settingsDisabled || !selectedModel} onChange={setEffort} />
            {active ? <InputGroupButton type="button" variant="default" size="icon-sm" className="ml-auto" aria-label="停止生成" onClick={() => void stop()} disabled={stopping}><SquareIcon /></InputGroupButton> : <InputGroupButton type="submit" variant="default" size="icon-sm" className="ml-auto" aria-label="发送消息" disabled={composerDisabled || !task.trim() || !selectedModel}><ArrowUpIcon /></InputGroupButton>}
          </InputGroupAddon>
          </InputGroup>
          {skillsOpen ? (
            <div ref={skillsPopover} className="composer-skills-popover composer-skills-toolbar-popover" role="dialog" aria-label="调用本轮 Skills">
              <div className="composer-skills-heading"><strong>调用 Skill</strong><span>插入到输入框</span></div>
              <div className="composer-skill-options">
                {training.skills.map((skill) => (
                  <Button variant="ghost"
                    type="button"
                    key={skill.skillId}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      composerEditor.current?.insertSkill(skill.skillId);
                      setSkillsOpen(false);
                    }}
                  >
                    <span><strong>@{skill.skillId}</strong><small>{skill.path}</small></span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <p className="composer-limits">Enter 发送 · Shift+Enter 换行 · @ 调用 Skills · 最多 10 个附件，每个 10 MB</p>
        </form>
      ) : null}
    </section>
  );
}
