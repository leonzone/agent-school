import type { ReactNode } from "react";
import type { Installation, SkillSummary } from "@skillhub/shared";
import { Link } from "./Link";
import { shortCommit } from "../utils";

export function skillCategory(skill: SkillSummary): string {
  return skill.tags.find((tag) => tag !== "热门精选") ?? "其他";
}

export function SkillCard({ skill, installation, busy = false, onInstall, children }: {
  skill: SkillSummary;
  installation?: Installation | undefined;
  busy?: boolean;
  onInstall?: () => void;
  children?: ReactNode;
}) {
  const hasUpdate = installation !== undefined && installation.commit !== skill.latestVersion.commit;
  const canInstall = onInstall !== undefined && (installation === undefined || hasUpdate);

  return (
    <article className="card skill-card">
      <div className="skill-card-heading">
        <span className="skill-icon" aria-hidden="true">{skill.displayName.trim().charAt(0).toUpperCase()}</span>
        <div>
          <h3><Link to={`/skills/${encodeURIComponent(skill.id)}`}>{skill.displayName}</Link></h3>
          <span className="skill-id">{skill.id}</span>
        </div>
      </div>
      <p className="skill-description">{skill.description}</p>
      <div className="tag-list">
        <span className="tag">{skillCategory(skill)}</span>
        {skill.tags.includes("热门精选") ? <span className="tag tag-featured">热门精选</span> : null}
      </div>
      {children}
      <div className="skill-card-footer">
        <span className={`skill-state ${hasUpdate ? "has-update" : ""}`}>
          {installation?.locallyModified
            ? "本地已修改"
            : installation
              ? hasUpdate ? "已安装 · 有更新" : `已安装 · ${shortCommit(installation.commit)}`
              : skill.maintainers[0] ?? "团队课程"}
        </span>
        <div className="skill-card-links">
          <Link className="text-link" to={`/skills/${encodeURIComponent(skill.id)}`}>查看说明</Link>
          {canInstall ? (
            <button type="button" className="text-button" onClick={onInstall} disabled={busy || installation?.locallyModified}>
              {busy ? "安装中…" : installation ? "更新" : "安装"}
            </button>
          ) : null}
          {installation ? (
            <Link className="text-link" to={`/runs/new/${encodeURIComponent(skill.id)}`}>测试</Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
