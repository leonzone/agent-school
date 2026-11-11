import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeftIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, LayersIcon, RefreshCwIcon, SearchIcon, ServerIcon, UploadIcon, XIcon } from "lucide-react";
import { skillHubQuerySchema, type HubInstallation, type HubInstallPlan, type HubMcpInfo, type HubSkill, type HubSkillDetail, type SkillHubCatalog, type SkillHubQuery } from "@skillhub/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "../api";
import { Link } from "../components/Link";
import { Markdown } from "../components/Markdown";
import { CardSkeletons, EmptyState, ErrorBanner, LoadingState, Notice } from "../components/UI";
import { formatChineseText } from "../lib/chinese-text";
import { navigate, useLocation } from "../router";
import { errorMessage, formatDate } from "../utils";

const defaults = skillHubQuerySchema.parse({});
const text = formatChineseText;

function FilterRow({ label, choices, selected, onChange }: { label: string; choices: string[]; selected: string; onChange: (value: string) => void }) {
  if (!choices.length) return null;
  return <div className="skillhub-filter-row"><span>{label}</span>
    <ToggleGroup value={[selected || "__all__"]} onValueChange={(values) => { if (values[0]) onChange(values[0] === "__all__" ? "" : values[0]); }} aria-label={label} className="flex-wrap" size="sm" variant="pill">
      <ToggleGroupItem value="__all__">全部</ToggleGroupItem>
      {choices.map((choice) => <ToggleGroupItem key={choice} value={choice}>{text(choice)}</ToggleGroupItem>)}
    </ToggleGroup>
  </div>;
}

function UploadPanel({ onUpload, onClose }: { onUpload: (form: FormData) => Promise<void>; onClose: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) { setError("请选择 Skill ZIP 或 SKILL.md 文件"); return; }
    setUploading(true);
    setError(null);
    try { await onUpload(form); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setUploading(false); }
  }
  return <Card className="skillhub-upload-panel">
    <CardHeader><CardTitle role="heading" aria-level={2}>上传 Skill</CardTitle><CardDescription>保存到你的本机 SkillHub 仓库，之后可在页面安装，也可交给 AI 通过 MCP 安装。</CardDescription></CardHeader>
    <form onSubmit={(event) => void submit(event)}>
      <CardContent>
        <FieldGroup>
          <Field><FieldLabel htmlFor="hub-upload-file">Skill 文件</FieldLabel><input id="hub-upload-file" name="file" type="file" accept=".zip,.md" required disabled={uploading} /><FieldDescription>支持 ZIP 或 SKILL.md。解压后最大 50 MB、最多 1000 个文件；SKILL.md 最大 512 KB。</FieldDescription></Field>
          <FieldGroup className="skillhub-upload-fields">
            <Field><FieldLabel htmlFor="hub-upload-title">显示名称</FieldLabel><Input id="hub-upload-title" name="displayName" maxLength={100} placeholder="留空使用 Skill 名称" disabled={uploading} /></Field>
            <Field><FieldLabel htmlFor="hub-upload-version">版本</FieldLabel><Input id="hub-upload-version" name="version" maxLength={80} placeholder="自动读取；首次无版本时为 1.0.0" disabled={uploading} /></Field>
            <Field><FieldLabel htmlFor="hub-upload-author">作者</FieldLabel><Input id="hub-upload-author" name="author" maxLength={80} placeholder="可选" disabled={uploading} /></Field>
            <Field><FieldLabel htmlFor="hub-upload-category">分类</FieldLabel><Input id="hub-upload-category" name="category" maxLength={100} placeholder="例如：写作、开发、数据分析" disabled={uploading} /></Field>
          </FieldGroup>
          <Field><FieldLabel htmlFor="hub-upload-tags">标签</FieldLabel><Input id="hub-upload-tags" name="tags" maxLength={1000} placeholder="多个标签用逗号分隔" disabled={uploading} /><FieldDescription>最多 20 个标签，每个不超过 50 个字符。同名同版本不会覆盖；内容变化时请上传新版本。</FieldDescription></Field>
        </FieldGroup>
        {error ? <ErrorBanner message={error} /> : null}
      </CardContent>
      <CardFooter className="justify-end gap-2"><Button type="button" variant="ghost" disabled={uploading} onClick={onClose}>取消</Button><Button type="submit" disabled={uploading}>{uploading ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}{uploading ? "正在校验并保存" : "上传并保存"}</Button></CardFooter>
    </form>
  </Card>;
}

function mcpPrompt(info: HubMcpInfo, skill: HubSkill | null): string {
  const target = skill ? `安装 Skill ${JSON.stringify({ skillId: skill.id, version: skill.version })}` : "搜索本机 SkillHub 中可用的 Skill";
  return `请通过 agent-school-skillhub MCP ${target}。\n\n如尚未接入，请先核对当前 AI 客户端的官方 MCP 配置方式。Codex 使用以下 TOML 配置；保留其他配置，再刷新工具列表：\n\n${info.codexConfig}\n\n其他使用 mcpServers JSON 的客户端可使用：\n${JSON.stringify(info.config, null, 2)}\n\n先调用 skillhubSearch 或 skillhubGetReadme 核对内容与版本，再调用 skillhubInstallGuide 展示整组安装计划、目标目录和必需依赖。等我明确确认后，调用 skillhubInstall，传入原 planId 和 confirm=true。不要执行包内脚本或覆盖已有目录。安装发生在运行该 MCP 服务的本机。`;
}

function McpPanel({ info, skill, onClose }: { info: HubMcpInfo; skill: HubSkill | null; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setCopied(message); setError(null); }
    catch { setError("复制未完成，请手动选择下方文本复制"); }
  }
  const prompt = mcpPrompt(info, skill);
  return <Card className="skillhub-mcp-panel">
    <CardHeader><div className="skillhub-panel-heading"><CardTitle role="heading" aria-level={2}>{skill ? `通过 MCP 安装「${text(skill.title)}」` : "MCP 接入"}</CardTitle><Button variant="ghost" size="icon-sm" aria-label="关闭 MCP 接入" onClick={onClose}><XIcon /></Button></div><CardDescription>把安装提示词交给支持 MCP 的本机 AI 客户端，AI 会核对 Skill，并在你确认计划后完成安装。</CardDescription></CardHeader>
    <CardContent>
      {!info.ready ? <Notice tone="warning">MCP 服务尚未构建，请先在项目中运行 pnpm build，再接入客户端。</Notice> : null}
      <p>{info.instructions}</p>
      <Button disabled={!info.ready} onClick={() => void copy(prompt, "MCP 安装提示词已复制")}><CopyIcon data-icon="inline-start" />{skill ? "复制 MCP 安装提示词" : "复制 MCP 接入提示词"}</Button>
      {copied ? <Notice tone="success">{copied}</Notice> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <details><summary>查看提示词与 MCP 配置</summary><pre>{prompt}</pre><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void copy(info.codexConfig, "Codex MCP 配置已复制")}><CopyIcon data-icon="inline-start" />复制 Codex 配置</Button><Button variant="outline" size="sm" onClick={() => void copy(JSON.stringify(info.config, null, 2), "通用 MCP 配置已复制")}><CopyIcon data-icon="inline-start" />复制通用 JSON 配置</Button></div></details>
      <div className="skillhub-mcp-tools">{info.tools.map((tool) => <div key={tool.name}><code>{tool.name}</code><span>{tool.description}</span></div>)}</div>
    </CardContent>
  </Card>;
}

function InstallPlanPanel({ plan, busy, onConfirm, onCancel }: { plan: HubInstallPlan; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <Card className="skillhub-install-plan">
    <CardHeader><CardTitle role="heading" aria-level={2}>确认安装计划</CardTitle><CardDescription>按以下顺序安装必需依赖和 Skill。已有文件不会被覆盖，包内脚本不会执行。</CardDescription></CardHeader>
    <CardContent><ol>{plan.nodes.map((node) => <li key={node.skillId}>
      <div className="skillhub-plan-node"><strong>{text(node.title)}</strong><Badge variant="secondary">{node.alreadyInstalled ? "保留已安装版本" : "新安装"}</Badge></div>
      <p><code>{node.skillId}</code>，版本 {node.version}，{node.fileCount} 个文件，{(node.bytes / 1024).toFixed(1)} KB。</p><p>安装目录：<code>{node.path}</code></p>
      {node.dependencies.length ? <details><summary>依赖声明</summary><ul>{node.dependencies.map((dependency) => <li key={`${dependency.id}@${dependency.version}`}><code>{dependency.id}@{dependency.version}</code>：{dependency.required ? "必需" : "可选，不自动安装"}</li>)}</ul></details> : null}
    </li>)}</ol><p>此计划 10 分钟内有效，确认后仅可使用一次。</p></CardContent>
    <CardFooter className="justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>取消</Button><Button disabled={busy} onClick={onConfirm}>{busy ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}{busy ? "正在安装" : "确认安装"}</Button></CardFooter>
  </Card>;
}

function HubCard({ skill, installed, busy, onInstall, onMcp }: { skill: HubSkill; installed: HubInstallation | undefined; busy: boolean; onInstall: () => void; onMcp: () => void }) {
  const current = installed?.version === skill.version;
  return <Card className="h-full">
    <CardHeader><div className="skillhub-card-meta"><span>本地上传</span><Badge variant="outline">v{skill.version}</Badge></div><CardTitle role="heading" aria-level={3}><Link to={`/skillhub/${skill.id}`}>{text(skill.title)}</Link></CardTitle><CardDescription className="line-clamp-3">{text(skill.description)}</CardDescription></CardHeader>
    <CardContent className="flex-1"><div className="skillhub-tags">{[skill.category, ...skill.tags].filter(Boolean).map((tag) => <Badge variant="secondary" key={tag}>{text(tag)}</Badge>)}</div><div className="skillhub-package-meta">{skill.fileCount} 个文件 · {(skill.bytes / 1024).toFixed(1)} KB</div></CardContent>
    <CardFooter className="flex-wrap justify-between gap-2"><span className="skillhub-card-author">{text(skill.author)}</span><div className="skillhub-card-actions"><Button size="sm" variant="ghost" disabled={busy} onClick={onMcp}><ServerIcon data-icon="inline-start" />MCP 安装</Button><Button size="sm" variant="outline" disabled={busy || current} onClick={onInstall} aria-label={text(`${current ? "已安装" : "安装"}${skill.title}`)}>{current ? <CheckIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}{current ? "已安装" : "安装"}</Button></div></CardFooter>
  </Card>;
}

export function SkillHubPage({ id }: { id?: string }) {
  const { search } = useLocation();
  const parameters = new URLSearchParams(search);
  const parsed = skillHubQuerySchema.safeParse(Object.fromEntries(parameters));
  const query = parsed.success ? parsed.data : defaults;
  const queryKey = JSON.stringify(query);
  const selectedVersion = parameters.get("version") || undefined;
  const [input, setInput] = useState(query.keyword);
  const [catalog, setCatalog] = useState<SkillHubCatalog | null>(null);
  const [detail, setDetail] = useState<HubSkillDetail | null>(null);
  const [installations, setInstallations] = useState<HubInstallation[]>([]);
  const [mcpInfo, setMcpInfo] = useState<HubMcpInfo | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpSkill, setMcpSkill] = useState<HubSkill | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [plan, setPlan] = useState<HubInstallPlan | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setInput(query.keyword); }, [query.keyword]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const primary = id ? api.hubSkillDetail(id, selectedVersion) : api.skillHubCatalog(JSON.parse(queryKey) as SkillHubQuery);
    void Promise.all([primary, api.hubInstallations(), api.skillHubMcp()]).then(([response, installed, info]) => {
      if (cancelled) return;
      if ("skills" in response) setCatalog(response); else setDetail(response);
      setInstallations(installed.installations);
      setMcpInfo(info);
    }).catch((caught: unknown) => { if (!cancelled) setError(errorMessage(caught)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, selectedVersion, queryKey, refreshKey]);
  useEffect(() => {
    if (!plan && !uploadOpen && !mcpOpen) return;
    panelRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    panelRef.current?.focus({ preventScroll: true });
  }, [plan, uploadOpen, mcpOpen]);

  function updateQuery(changes: Partial<SkillHubQuery>) {
    const next = { ...query, page: 1, ...changes };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value !== defaults[key as keyof SkillHubQuery]) params.set(key, String(value));
    navigate(`/skillhub${params.size ? `?${params}` : ""}`);
  }
  async function upload(form: FormData) {
    const skill = await api.uploadHubSkill(form);
    setUploadOpen(false);
    setMessage(`${text(skill.title)} ${skill.version} 已上传保存，可安装到本机或通过 MCP 安装`);
    navigate(`/skillhub/${skill.id}?version=${encodeURIComponent(skill.version)}`);
    setRefreshKey((key) => key + 1);
  }
  function showMcp(skill: HubSkill | null) { if (preparing || installing || uploadOpen) return; setMcpSkill(skill); setMcpOpen(true); setUploadOpen(false); setPlan(null); }
  async function prepare(skill: HubSkill) {
    if (preparing || installing || uploadOpen) return;
    setPreparing(true); setPlan(null); setError(null); setMessage(null); setUploadOpen(false); setMcpOpen(false);
    try { setPlan(await api.hubInstallPlan(skill.id, skill.version)); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setPreparing(false); }
  }
  async function install() {
    if (!plan || installing) return;
    setInstalling(true); setError(null);
    try {
      const result = await api.installHubSkill(plan.id);
      setPlan(null);
      setInstallations((current) => [...current.filter((item) => !result.installations.some((entry) => entry.skillId === item.skillId)), ...result.installations]);
      if (result.installations.length) setMessage(result.installations.map((item) => `${item.name} ${item.version} 已安装到 ${item.path}`).join("；"));
      const failures = [result.error, ...result.codexErrors, result.skipped.length ? `未执行：${result.skipped.join("、")}` : ""].filter(Boolean);
      if (failures.length) setError(failures.join("；"));
    } catch (caught) { setError(errorMessage(caught)); setPlan(null); }
    finally { setInstalling(false); }
  }
  const currentInstallation = installations.find((item) => item.skillId === id);
  const detailInstalled = currentInstallation?.version === detail?.version;

  return <div className="skillhub-page">
    <div className="skillhub-topline"><Link to="/skillhub" className="skillhub-wordmark"><LayersIcon aria-hidden="true" />SkillHub</Link><div className="skillhub-connection"><Badge variant="secondary">本机技能仓库</Badge><Button variant="outline" size="sm" disabled={preparing || installing || uploadOpen} onClick={() => { setUploadOpen(true); setMcpOpen(false); setPlan(null); }}><UploadIcon data-icon="inline-start" />上传 Skill</Button><Button variant="ghost" size="sm" disabled={!mcpInfo || preparing || installing || uploadOpen} onClick={() => showMcp(null)}><ServerIcon data-icon="inline-start" />MCP 接入</Button></div></div>
    {!id ? <section className="skillhub-hero" aria-labelledby="skillhub-heading"><h1 id="skillhub-heading">把你的经验，变成随时可用的能力</h1><p>上传、管理和安装 Skills，让 AI 学会你的工作方法。</p><form role="search" onSubmit={(event) => { event.preventDefault(); updateQuery({ keyword: input.trim() }); }}><FieldGroup><Field><FieldLabel className="sr-only" htmlFor="skillhub-search">搜索 Skill 名称或介绍</FieldLabel><InputGroup className="h-12"><InputGroupInput id="skillhub-search" type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder="搜索 Skill 名称或介绍" /><InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon><InputGroupAddon align="inline-end"><InputGroupButton type="submit" size="sm" disabled={loading}>搜索</InputGroupButton></InputGroupAddon></InputGroup></Field></FieldGroup></form><div className="skillhub-hero-meta"><span>{catalog ? `${catalog.total} 个符合条件的 Skill` : "正在读取仓库"}</span><span>{installations.length} 个已安装到本机</span></div></section> : <div className="skillhub-back"><Button variant="ghost" nativeButton={false} render={<Link to="/skillhub" />}><ArrowLeftIcon data-icon="inline-start" />返回 SkillHub</Button></div>}
    <div className="skillhub-source"><span>上传一次，在页面或 AI 客户端通过 MCP 安装。内容保存在你的本机仓库。</span><Button variant="ghost" size="sm" disabled={!mcpInfo || preparing || installing || uploadOpen} onClick={() => showMcp(detail)}><ServerIcon data-icon="inline-start" />了解 MCP 安装</Button></div>
    {error ? <ErrorBanner message={error} onRetry={() => setRefreshKey((key) => key + 1)} /> : null}
    {message ? <Notice tone="success">{message}</Notice> : null}
    {preparing ? <LoadingState label="正在校验版本、依赖和本机安装目录" /> : null}
    <div className="skillhub-plan-anchor" ref={panelRef} tabIndex={-1}>
      {uploadOpen ? <UploadPanel onUpload={upload} onClose={() => setUploadOpen(false)} /> : null}
      {mcpOpen && mcpInfo ? <McpPanel key={mcpSkill ? `${mcpSkill.id}@${mcpSkill.version}` : "connection"} info={mcpInfo} skill={mcpSkill} onClose={() => setMcpOpen(false)} /> : null}
      {plan ? <InstallPlanPanel plan={plan} busy={installing} onConfirm={() => void install()} onCancel={() => setPlan(null)} /> : null}
    </div>
    {!id ? <>
      <div className="skillhub-results-heading"><div><h2>我的 Skill 仓库</h2><span>版本与附件完整保存，按需安装</span></div><div className="skillhub-results-controls"><ToggleGroup value={[query.scope]} onValueChange={(values) => { if (values[0]) updateQuery({ scope: values[0] as SkillHubQuery["scope"] }); }} aria-label="显示范围" variant="outline" size="sm"><ToggleGroupItem value="all">全部 Skills</ToggleGroupItem><ToggleGroupItem value="installed">已安装</ToggleGroupItem></ToggleGroup><ToggleGroup value={[query.sort]} onValueChange={(values) => { if (values[0]) updateQuery({ sort: values[0] as SkillHubQuery["sort"] }); }} aria-label="排序" size="sm"><ToggleGroupItem value="latest">最近更新</ToggleGroupItem><ToggleGroupItem value="name">名称排序</ToggleGroupItem></ToggleGroup><Button variant="ghost" size="icon-sm" aria-label="刷新 Skill 仓库" disabled={loading} onClick={() => setRefreshKey((key) => key + 1)}><RefreshCwIcon /></Button></div></div>
      {catalog ? <div className="skillhub-filters"><FilterRow label="分类" choices={catalog.facets.categories} selected={query.category} onChange={(category) => updateQuery({ category })} /><FilterRow label="标签" choices={catalog.facets.tags} selected={query.tag} onChange={(tag) => updateQuery({ tag })} /></div> : null}
      {loading ? <CardSkeletons count={3} /> : null}
      {!loading && catalog?.skills.length === 0 ? <EmptyState title={query.keyword || query.scope !== "all" || query.category || query.tag ? "没有符合条件的 Skill" : "上传你的第一个 Skill"} description="选择一个 Skill ZIP 或 SKILL.md 文件，上传后即可查看内容、管理版本，并通过 MCP 安装。" action={<Button onClick={() => { setUploadOpen(true); setMcpOpen(false); }}><UploadIcon data-icon="inline-start" />上传 Skill</Button>} /> : null}
      {!loading && catalog ? <><div className="skillhub-grid">{catalog.skills.map((skill) => <HubCard key={skill.id} skill={skill} installed={installations.find((item) => item.skillId === skill.id)} busy={preparing || installing || uploadOpen} onInstall={() => void prepare(skill)} onMcp={() => showMcp(skill)} />)}</div>{catalog.total > catalog.pageSize ? <nav className="skillhub-pagination" aria-label="Skill 分页"><Button variant="outline" size="sm" disabled={catalog.page <= 1} onClick={() => updateQuery({ page: catalog.page - 1 })}><ChevronLeftIcon data-icon="inline-start" />上一页</Button><span>第 {catalog.page} 页，共 {Math.ceil(catalog.total / catalog.pageSize)} 页</span><Button variant="outline" size="sm" disabled={catalog.page * catalog.pageSize >= catalog.total} onClick={() => updateQuery({ page: catalog.page + 1 })}>下一页<ChevronRightIcon data-icon="inline-end" /></Button></nav> : null}</> : null}
    </> : null}
    {id && loading ? <LoadingState label="正在读取 Skill 内容与版本" /> : null}
    {id && detail && !loading ? <div className="skillhub-detail"><section><div className="skillhub-detail-heading"><div><h1>{text(detail.title)}</h1><p>{text(detail.description)}</p></div><Badge variant="outline">本地上传</Badge></div><div className="skillhub-tags">{[detail.category, ...detail.tags].filter(Boolean).map((tag) => <Badge variant="secondary" key={tag}>{text(tag)}</Badge>)}</div><div className="skillhub-detail-meta"><span>作者：{text(detail.author)}</span><span>保存于 {formatDate(detail.uploadedAt)}</span><span>{detail.fileCount} 个文件</span></div><Markdown normalizeChinese>{detail.markdown}</Markdown><details className="skillhub-files"><summary>查看完整 SKILL.md 与文件清单</summary><ul>{detail.files.map((file) => <li key={file.path}><code>{file.path}</code><span>{file.size.toLocaleString("zh-CN")} B</span></li>)}</ul><pre>{detail.skillMarkdown}</pre></details></section><aside><Card><CardHeader><CardTitle>安装 Skill</CardTitle><CardDescription>在本机安装，或让 AI 客户端通过 MCP 安装这个版本。</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="hub-skill-version">版本</FieldLabel><NativeSelect id="hub-skill-version" value={detail.version} onChange={(event) => { setPlan(null); setMcpOpen(false); navigate(`/skillhub/${detail.id}?version=${encodeURIComponent(event.target.value)}`); }} className="w-full">{detail.versions.map((version) => <NativeSelectOption key={version.version} value={version.version}>{version.version}</NativeSelectOption>)}</NativeSelect></Field></FieldGroup>{currentInstallation ? <p className="skillhub-installed-path">本机已安装 {currentInstallation.version}：<code>{currentInstallation.path}</code></p> : null}</CardContent><CardFooter className="flex-col items-stretch gap-2"><Button className="w-full" disabled={detailInstalled || preparing || installing || uploadOpen} onClick={() => void prepare(detail)}>{detailInstalled ? <CheckIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}{detailInstalled ? "已安装到本机" : "安装到本机"}</Button><Button className="w-full" variant="outline" disabled={!mcpInfo || preparing || installing || uploadOpen} onClick={() => showMcp(detail)}><ServerIcon data-icon="inline-start" />通过 MCP 安装</Button></CardFooter></Card>{detail.dependencies.length ? <div className="skillhub-detail-dependencies"><h2>依赖</h2>{detail.dependencies.map((dependency) => <p key={`${dependency.id}@${dependency.version}`}><code>{dependency.id}@{dependency.version}</code><br />{dependency.required ? "安装时一并处理" : "可选，不自动安装"}</p>)}</div> : null}</aside></div> : null}
  </div>;
}
