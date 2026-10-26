import { useCallback, useEffect, useState } from "react";
import type { Installation, SkillSummary } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { SkillCard, skillCategory } from "../components/SkillCard";
import { CardSkeletons, EmptyState, ErrorBanner, Notice, PageHeader } from "../components/UI";
import { errorMessage, formatDate, shortCommit } from "../utils";

export function InstalledPage() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const installationData = await api.installations();
      const catalogData = await api.catalog().catch(() => null);
      setInstallations(installationData.installations);
      setSkills(catalogData?.skills ?? []);
      setWarning(catalogData ? null : "课程目录暂时不可用，无法比较最新版本；其他管理操作仍可使用。");
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(installation: Installation, commit: string) {
    setOperation(`${installation.skillId}:update`);
    setError(null);
    setMessage(null);
    setWarning(null);
    try {
      const result = await api.install(installation.skillId, commit);
      setInstallations((current) => current.map((item) => item.skillId === installation.skillId ? result.installation : item));
      if (result.codexError) setWarning(`文件已更新，但 Codex 同步未完成：${result.codexError}`);
      else setMessage(`${result.installation.skillName} 已更新到 ${shortCommit(result.installation.commit)}`);
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setOperation(null);
    }
  }

  async function uninstall(installation: Installation) {
    setOperation(`${installation.skillId}:delete`);
    setError(null);
    setMessage(null);
    try {
      await api.uninstall(installation.skillId);
      setInstallations((current) => current.filter((item) => item.skillId !== installation.skillId));
      setConfirmId(null);
      setMessage(`${installation.skillName} 已从本机卸载`);
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setOperation(null);
    }
  }

  const rows = installations.map((installation) => {
    const catalogSkill = skills.find((skill) => skill.id === installation.skillId);
    const skill: SkillSummary = catalogSkill ?? {
      id: installation.skillId,
      name: installation.skillName,
      displayName: installation.skillName,
      description: "此技能仍安装在本机，但已不在当前团队目录中。你仍可查看安装信息或将其卸载。",
      tags: ["其他"],
      maintainers: [],
      latestVersion: {
        commit: installation.commit,
        shortCommit: shortCommit(installation.commit),
        committedAt: installation.updatedAt,
        subject: "本机安装版本",
      },
    };
    return { installation, skill, latest: catalogSkill?.latestVersion ?? null };
  });
  const groups = Array.from(rows.reduce((result, row) => {
    const category = skillCategory(row.skill);
    result.set(category, [...(result.get(category) ?? []), row]);
    return result;
  }, new Map<string, typeof rows>()).entries());

  return (
    <div className="skills-page">
      <PageHeader
        title="我的技能"
        description="管理安装到本机 Codex 的技能版本，执行测试、更新或卸载。"
        actions={<button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>重新检查</button>}
      />
      <div className="list-meta"><span>{installations.length} 个已安装 Skills</span><span>每台设备独立管理</span></div>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {warning ? <Notice tone="warning">{warning}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {loading ? <CardSkeletons count={2} /> : null}

      {!loading && installations.length === 0 ? (
        <EmptyState
          title="还没有安装 Skills"
          description="从团队目录选择适合工作的技能，安装后即可在这里管理和测试。"
          action={<Link className="button button-primary" to="/skills">浏览 Skills</Link>}
        />
      ) : null}

      {!loading ? groups.map(([category, items]) => (
        <section className="skill-group" aria-labelledby={`installed-group-${category}`} key={category}>
          <div className="skill-group-heading"><h2 id={`installed-group-${category}`}>{category}</h2><span>{items.length}</span></div>
          <div className="card-grid">
            {items.map(({ installation, skill, latest }) => {
              const hasUpdate = latest !== null && latest.commit !== installation.commit;
              const busy = operation?.startsWith(`${installation.skillId}:`) ?? false;
              return (
                <SkillCard skill={skill} installation={installation} busy={busy} key={installation.skillId}>
                  <details className="skill-install-details">
                    <summary>版本与安装信息</summary>
                    <dl>
                      <div><dt>当前提交</dt><dd><code>{installation.commit}</code></dd></div>
                      <div><dt>安装路径</dt><dd><code>{installation.path}</code></dd></div>
                      <div><dt>最近更新</dt><dd>{formatDate(installation.updatedAt)}</dd></div>
                      {latest ? <div><dt>目录最新</dt><dd><code>{shortCommit(latest.commit)}</code> · {latest.subject}</dd></div> : null}
                    </dl>
                  </details>
                  {installation.locallyModified ? <p className="inline-warning">检测到本地修改，更新和卸载已阻止。请先备份并处理这些修改。</p> : null}
                  {confirmId === installation.skillId ? (
                    <div className="confirm-box" role="alert">
                      <strong>确认卸载“{installation.skillName}”？</strong>
                      <p>只会移除本机 Skill，已有测试记录会保留。</p>
                      <div className="button-row">
                        <button type="button" className="button button-danger button-small" onClick={() => void uninstall(installation)} disabled={busy}>{busy ? "正在卸载…" : "确认卸载"}</button>
                        <button type="button" className="button button-secondary button-small" onClick={() => setConfirmId(null)} disabled={busy}>取消</button>
                      </div>
                    </div>
                  ) : null}
                  <div className="installed-card-actions">
                    <Link className="button button-primary button-small" to={`/runs/new/${encodeURIComponent(installation.skillId)}`}>执行测试</Link>
                    {hasUpdate && latest ? (
                      <button type="button" className="button button-secondary button-small" onClick={() => void update(installation, latest.commit)} disabled={busy || installation.locallyModified}>
                        {operation === `${installation.skillId}:update` ? "正在更新…" : `更新到 ${shortCommit(latest.commit)}`}
                      </button>
                    ) : null}
                    <button type="button" className="text-button button-danger-text" onClick={() => setConfirmId(installation.skillId)} disabled={busy || installation.locallyModified}>卸载</button>
                  </div>
                </SkillCard>
              );
            })}
          </div>
        </section>
      )) : null}
    </div>
  );
}
