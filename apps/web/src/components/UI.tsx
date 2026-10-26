import type { ReactNode } from "react";
import type { RunStatus, TestOutcome } from "@skillhub/shared";
import { outcomeLabel, runStatusLabels } from "../utils";

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner banner-error" role="alert">
      <div><strong>操作未完成</strong><span>{message}</span></div>
      {onRetry ? <button type="button" className="button button-small button-secondary" onClick={onRetry}>重试</button> : null}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) {
  return <div className={`banner banner-${tone}`} role={tone === "warning" ? "alert" : "status"}>{children}</div>;
}

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function CardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="card-grid" aria-label="正在加载内容" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="card skeleton-card" key={index}>
          <span className="skeleton skeleton-short" />
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">空</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <span className={`badge status-${status}`}>{runStatusLabels[status]}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: TestOutcome | null }) {
  return <span className={`badge outcome-${outcome ?? "none"}`}>{outcomeLabel(outcome)}</span>;
}

export function Definition({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`definition${wide ? " definition-wide" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
