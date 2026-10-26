import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
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
    <Card className="h-full">
      <CardHeader>
      <div className="skill-card-heading">
        <span className="skill-icon" aria-hidden="true">{skill.displayName.trim().charAt(0).toUpperCase()}</span>
        <div>
          <CardTitle><Link to={`/skills/${encodeURIComponent(skill.id)}`}>{skill.displayName}</Link></CardTitle>
          <span className="skill-id">{skill.id}</span>
        </div>
      </div>
      <CardDescription>{skill.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
      <div className="tag-list">
        <Badge variant="secondary">{skillCategory(skill)}</Badge>
        {skill.tags.includes("热门精选") ? <Badge variant="secondary">热门精选</Badge> : null}
      </div>
      {children}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2">
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
            <Button variant="ghost" type="button" onClick={onInstall} disabled={busy || installation?.locallyModified}>
              {busy ? "安装中…" : installation ? "更新" : "安装"}
            </Button>
          ) : null}
          {installation ? (
            <Link className="text-link" to={`/runs/new/${encodeURIComponent(skill.id)}`}>测试</Link>
          ) : null}
        </div>
      </CardFooter>
    </Card>
  );
}
