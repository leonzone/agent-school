import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CatalogResponse, Installation } from "@skillhub/shared";
import { api } from "../api";
import { SkillCard, skillCategory } from "../components/SkillCard";
import { CardSkeletons, EmptyState, ErrorBanner, LoadingState, Notice, PageHeader } from "../components/UI";
import { errorMessage, formatDate, shortCommit } from "../utils";

export function CatalogPage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [onlyInstalled, setOnlyInstalled] = useState(false);
  const [activeTab, setActiveTab] = useState<"skills" | "mcp" | "connectors">("skills");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogData, installationData] = await Promise.all([
        api.catalog(query),
        api.installations(),
      ]);
      setCatalog(catalogData);
      setInstallations(installationData.installations);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      await api.syncCatalog();
      setMessage("课程目录同步已完成");
      await load();
    } catch (syncError) {
      setError(errorMessage(syncError));
    } finally {
      setSyncing(false);
    }
  }

  async function install(skillId: string, commit: string) {
    setInstallingId(skillId);
    setError(null);
    setMessage(null);
    try {
      const result = await api.install(skillId, commit);
      setInstallations((current) => [
        ...current.filter((item) => item.skillId !== skillId),
        result.installation,
      ]);
      setMessage(`${result.installation.skillName} 已安装到 ${shortCommit(result.installation.commit)}`);
      if (result.codexError) setError(`文件已安装，但 Codex 同步未完成：${result.codexError}`);
    } catch (installError) {
      setError(errorMessage(installError));
    } finally {
      setInstallingId(null);
    }
  }

  function search() {
    const next = input.trim();
    setCategory("全部");
    if (next === query) void load();
    else setQuery(next);
  }

  function clear() {
    setInput("");
    setMessage(null);
    if (query === "") void load();
    else setQuery("");
  }

  const categories = useMemo(() => [
    "全部",
    "热门精选",
    ...Array.from(new Set(catalog?.skills.map(skillCategory) ?? [])).sort((a, b) => a.localeCompare(b, "zh-CN")),
  ], [catalog]);

  const visibleSkills = useMemo(() => (catalog?.skills ?? []).filter((skill) => {
    if (onlyInstalled && !installations.some((item) => item.skillId === skill.id)) return false;
    if (category === "热门精选") return skill.tags.includes("热门精选");
    return category === "全部" || skillCategory(skill) === category;
  }), [catalog, installations, onlyInstalled, category]);

  const groups = useMemo(() => {
    const result = new Map<string, typeof visibleSkills>();
    for (const skill of visibleSkills) {
      const key = skillCategory(skill);
      result.set(key, [...(result.get(key) ?? []), skill]);
    }
    return Array.from(result.entries());
  }, [visibleSkills]);

  return (
    <div className="skills-page">
      <PageHeader
        title="能力中心"
        description="按任务选择团队技能，安装到本机 Codex，让日常工作更顺手。"
        actions={(
          <Button variant="outline" type="button" onClick={() => void sync()} disabled={syncing}>
            {syncing ? "正在刷新…" : "刷新目录"}
          </Button>
        )}
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
      <TabsList variant="line" aria-label="能力中心分类">
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="mcp">MCP</TabsTrigger>
        <TabsTrigger value="connectors">连接器</TabsTrigger>
      </TabsList>

      {activeTab !== "skills" ? (
        <TabsContent value={activeTab}><EmptyState
          title={activeTab === "mcp" ? "MCP 服务即将上线" : "连接器即将上线"}
          description={activeTab === "mcp" ? "后续将在这里集中管理本机可用的 MCP 服务。" : "后续将在这里集中管理外部系统的连接器。"}
        /></TabsContent>
      ) : (
      <TabsContent value="skills">

      <div className="skills-toolbar">
        <form className="search-bar" onSubmit={(event) => { event.preventDefault(); search(); }} role="search">
          <FieldLabel className="sr-only" htmlFor="catalog-search">搜索 Skills</FieldLabel>
          <Input
            id="catalog-search"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="搜索技能、描述或来源"
          />
          <Button variant="ghost" type="submit" disabled={loading || syncing}>搜索</Button>
          {input || query ? <Button variant="ghost" type="button" onClick={clear}>清空</Button> : null}
        </form>
        <FieldLabel className="installed-filter">
          <Checkbox  checked={onlyInstalled} onCheckedChange={(checked) => setOnlyInstalled(checked)} />
          仅看已安装
        </FieldLabel>
      </div>

      <ToggleGroup className="mb-4 flex-wrap" value={[category]} onValueChange={(values) => { if (values[0]) setCategory(values[0]); }} aria-label="Skill 分类">
        {categories.map((item) => (
          <ToggleGroupItem value={item} key={item}>{item}</ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="list-meta" aria-live="polite">
        <span>{catalog ? `${visibleSkills.length} 个 Skills` : "正在读取 Skills"}</span>
        {catalog?.syncedAt ? <span>最近同步：{formatDate(catalog.syncedAt)}</span> : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {loading && catalog ? <LoadingState label="正在更新 Skill 列表" /> : null}
      {loading && !catalog ? <CardSkeletons count={8} /> : null}

      {!loading && visibleSkills.length === 0 ? (
        <EmptyState
          title={onlyInstalled ? "没有符合条件的已安装 Skill" : query ? "没有匹配的 Skill" : "课程库还是空的"}
          description={query || onlyInstalled || category !== "全部" ? "试试其他关键词，或切换分类查看全部技能。" : "点击“刷新目录”从团队课程仓库同步最新内容。"}
          action={query ? <Button variant="outline" type="button" onClick={clear}>清空搜索</Button> : null}
        />
      ) : null}

      {groups.map(([group, skills]) => (
        <section className="skill-group" aria-labelledby={`skill-group-${group}`} key={group}>
          <div className="skill-group-heading">
            <h2 id={`skill-group-${group}`}>{category === "热门精选" ? `${group} · 热门精选` : group}</h2>
            <span>{skills.length}</span>
          </div>
          <div className="card-grid">
            {skills.map((skill) => {
              const installation = installations.find((item) => item.skillId === skill.id);
              return (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  installation={installation}
                  busy={installingId === skill.id}
                  onInstall={() => void install(skill.id, skill.latestVersion.commit)}
                />
              );
            })}
          </div>
        </section>
      ))}
      </TabsContent>
      )}
      </Tabs>
    </div>
  );
}
