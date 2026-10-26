import { useCallback, useEffect, useMemo, useState } from "react";
import type { Installation, SkillDetail, SkillVersion } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { Markdown } from "../components/Markdown";
import { EmptyState, ErrorBanner, LoadingState, Notice, PageHeader } from "../components/UI";
import { errorMessage, formatBytes, formatDate, shortCommit } from "../utils";

export function SkillDetailPage({ id }: { id: string }) {
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [selectedCommit, setSelectedCommit] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [skillData, versionData, installationData] = await Promise.all([
        api.skillDetail(id, selectedCommit || undefined),
        api.skillVersions(id),
        api.installations(),
      ]);
      setSkill(skillData);
      setVersions(versionData.versions);
      setInstallation(installationData.installations.find((item) => item.skillId === id) ?? null);
      setSelectedCommit((current) => (
        versionData.versions.some((version) => version.commit === current)
          ? current
          : skillData.latestVersion.commit
      ));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [id, selectedCommit]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.commit === selectedCommit) ?? null,
    [versions, selectedCommit],
  );

  async function install() {
    if (!selectedCommit || installing) return;
    setInstalling(true);
    setError(null);
    setCodexError(null);
    setMessage(null);
    try {
      const result = await api.install(id, selectedCommit);
      setInstallation(result.installation);
      setCodexError(result.codexError);
      setMessage(`已安装 ${result.installation.skillName} 的 ${shortCommit(result.installation.commit)} 版本`);
    } catch (installError) {
      setError(errorMessage(installError));
    } finally {
      setInstalling(false);
    }
  }

  if (loading && !skill) return <LoadingState label="正在读取课程详情" />;
  if (!skill) {
    return (
      <div>
        <Link className="back-link" to="/skills">返回课程库</Link>
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {!error ? <EmptyState title="课程不存在" description="该课程可能已从团队目录移除。" /> : null}
      </div>
    );
  }

  return (
    <div>
      <Link className="back-link" to="/skills">返回课程库</Link>
      <PageHeader
        eyebrow={skill.id}
        title={skill.displayName}
        description={skill.description}
        actions={installation ? (
          <Link className="button button-primary" to={`/runs/new/${encodeURIComponent(skill.id)}`}>执行测试</Link>
        ) : null}
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {codexError ? <Notice tone="warning">文件已安装，但 Codex 同步未完成：{codexError}</Notice> : null}
      {installation?.locallyModified ? <Notice tone="warning">本机安装目录存在修改，安装、更新和卸载会被阻止。请先自行备份并处理这些修改。</Notice> : null}

      <div className="detail-layout">
        <main className="detail-main">
          <section className="panel markdown-panel" aria-labelledby="skill-document-title">
            <div className="section-heading">
              <div><span className="eyebrow">完整课程文档</span><h2 id="skill-document-title">SKILL.md</h2></div>
            </div>
            <Markdown>{skill.skillMarkdown}</Markdown>
          </section>

          <section className="panel" aria-labelledby="skill-files-title">
            <div className="section-heading"><h2 id="skill-files-title">课程文件</h2><span className="muted">{skill.files.length} 个文件</span></div>
            <ul className="file-list plain-list">
              {skill.files.map((file) => (
                <li key={file.path}><code>{file.path}</code><span>{formatBytes(file.size)}</span></li>
              ))}
            </ul>
          </section>
        </main>

        <aside className="detail-sidebar">
          <section className="panel install-panel" aria-labelledby="install-title">
            <h2 id="install-title">安装到本机</h2>
            {installation ? (
              <div className="current-installation">
                <span className="badge status-completed">已安装</span>
                <span>当前 <code>{shortCommit(installation.commit)}</code></span>
              </div>
            ) : <p className="muted">选择一个历史版本，安装后可从本页执行测试。</p>}
            <label htmlFor="skill-version">课程版本</label>
            <select id="skill-version" value={selectedCommit} onChange={(event) => setSelectedCommit(event.target.value)} disabled={installing}>
              {versions.map((version) => (
                <option value={version.commit} key={version.commit}>
                  {shortCommit(version.commit)} · {version.subject}
                </option>
              ))}
            </select>
            {selectedVersion ? (
              <div className="selected-version">
                <strong>{selectedVersion.subject}</strong>
                <span>{formatDate(selectedVersion.committedAt)}</span>
                <code>{selectedVersion.commit}</code>
              </div>
            ) : null}
            <button type="button" className="button button-primary button-block" onClick={() => void install()} disabled={installing || !selectedCommit}>
              {installing ? "正在安装…" : installation ? "安装所选版本" : "安装此课程"}
            </button>
            <p className="field-help">安装以所选完整 commit 为准；重复安装会校验当前目录，发现本地修改时会阻止操作。</p>
          </section>

          <section className="panel" aria-labelledby="maintainers-title">
            <h2 id="maintainers-title">维护信息</h2>
            <dl className="compact-definitions">
              <div><dt>维护人</dt><dd>{skill.maintainers.length > 0 ? skill.maintainers.join("、") : "未标注"}</dd></div>
              <div><dt>标签</dt><dd>{skill.tags.length > 0 ? skill.tags.join("、") : "无标签"}</dd></div>
              <div><dt>最新提交</dt><dd><code>{shortCommit(skill.latestVersion.commit)}</code></dd></div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="history-title">
            <div className="section-heading"><h2 id="history-title">历史版本</h2><span className="muted">{versions.length} 个</span></div>
            <ol className="version-list">
              {versions.map((version) => (
                <li className={version.commit === selectedCommit ? "is-selected" : ""} key={version.commit}>
                  <button type="button" onClick={() => setSelectedCommit(version.commit)}>
                    <span><code>{version.shortCommit}</code>{version.commit === skill.latestVersion.commit ? <span className="tag">最新</span> : null}</span>
                    <strong>{version.subject}</strong>
                    <small>{formatDate(version.committedAt)}</small>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
