import type { ReactNode } from "react";
import type { RunStatus, TestOutcome } from "@skillhub/shared";
import { outcomeLabel, runStatusLabels } from "../utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { CircleAlertIcon, CircleCheckIcon, InboxIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

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
    <Alert variant="destructive" className="my-4">
      <CircleAlertIcon />
      <AlertTitle>操作未完成</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {onRetry ? <AlertAction><Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button></AlertAction> : null}
    </Alert>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) {
  const Icon = tone === "warning" ? TriangleAlertIcon : tone === "success" ? CircleCheckIcon : InfoIcon;
  return <Alert className="my-4" role={tone === "warning" ? "alert" : "status"}><Icon /><AlertDescription>{children}</AlertDescription></Alert>;
}

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <Spinner aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function CardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="card-grid" aria-label="正在加载内容" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index}>
          <CardHeader><Skeleton className="h-4 w-1/3" /><Skeleton className="h-6 w-2/3" /></CardHeader>
          <CardContent className="flex flex-col gap-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Empty className="min-h-48">
      <EmptyHeader><EmptyMedia variant="icon"><InboxIcon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={status === "failed" ? "destructive" : status === "completed" ? "default" : "secondary"}>{runStatusLabels[status]}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: TestOutcome | null }) {
  return <Badge variant={outcome === "failed" ? "destructive" : "outline"}>{outcomeLabel(outcome)}</Badge>;
}

export function Definition({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`definition${wide ? " definition-wide" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
