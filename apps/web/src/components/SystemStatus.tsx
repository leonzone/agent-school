import { createContext, useContext } from "react";
import type { SystemStatus } from "@skillhub/shared";
import { Link } from "./Link";

export type SystemStatusValue = {
  status: SystemStatus | null;
  refresh: () => Promise<void>;
};

export const SystemStatusContext = createContext<SystemStatusValue>({
  status: null,
  refresh: async () => undefined,
});

export function useSystemStatus(): SystemStatusValue {
  return useContext(SystemStatusContext);
}

export function EnvironmentStatus({ status }: { status: SystemStatus | null }) {
  const catalogOkay = status?.catalog.available ?? false;
  const codexOkay = (status?.codex.available && status.codex.compatible && status.codex.loggedIn) ?? false;
  const codexLabel = !status
    ? "状态未知"
    : !status.codex.available
      ? "不可用"
      : !status.codex.compatible
        ? "连接失败"
        : !status.codex.loggedIn
          ? "未登录"
          : "已就绪";
  const title = status?.codex.error ?? status?.catalog.error ?? undefined;

  return (
    <div className="environment-status" aria-label="本地环境状态" title={title}>
      <span className="environment-item">
        <span className={`status-dot ${catalogOkay ? "is-ok" : "is-bad"}`} aria-hidden="true" />
        Catalog：{status ? (catalogOkay ? "已连接" : "不可用") : "检查中"}
      </span>
      <Link className="environment-item environment-link" to="/codex">
        <span className={`status-dot ${codexOkay ? "is-ok" : "is-bad"}`} aria-hidden="true" />
        Codex：{codexLabel}
      </Link>
    </div>
  );
}
