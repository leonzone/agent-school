import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import type { SystemStatus } from "@skillhub/shared";
import { api, initializeSession } from "./api";
import { Link } from "./components/Link";
import { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuLink } from "@/components/ui/navigation-menu";
import { EnvironmentStatus, SystemStatusContext } from "./components/SystemStatus";
import { EmptyState, ErrorBanner, LoadingState } from "./components/UI";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { AgentFormPage } from "./pages/AgentFormPage";
import { AgentsPage } from "./pages/AgentsPage";
import { AgentTestingPage } from "./pages/AgentTestingPage";
import { CatalogPage } from "./pages/CatalogPage";
import { CodexPage } from "./pages/CodexPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { InstalledPage } from "./pages/InstalledPage";
import { NewRunPage } from "./pages/NewRunPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { RunsPage } from "./pages/RunsPage";
import { SkillDetailPage } from "./pages/SkillDetailPage";
import { SkillHubPage } from "./pages/SkillHubPage";
import { TrainingsPage } from "./pages/TrainingsPage";
import { parseRoute, useLocation, type Route } from "./router";
import { errorMessage } from "./utils";

function RouteContent({ route }: { route: Route }) {
  switch (route.name) {
    case "agents": return <AgentsPage />;
    case "agentNew": return <AgentFormPage />;
    case "agent": return <AgentDetailPage id={route.id} />;
    case "agentEdit": return <AgentFormPage id={route.id} />;
    case "agentTest": return <AgentTestingPage id={route.id} />;
    case "agentChat": return <AgentTestingPage id={route.id} chat />;
    case "trainings": return <TrainingsPage agentId={route.agentId} />;
    case "catalog": return <CatalogPage />;
    case "skillHub": return <SkillHubPage key={route.id ?? "catalog"} {...(route.id ? { id: route.id } : {})} />;
    case "codex": return <CodexPage />;
    case "skill": return <SkillDetailPage id={route.id} />;
    case "installed": return <InstalledPage />;
    case "runs": return <RunsPage />;
    case "newRun": return <NewRunPage skillId={route.skillId} />;
    case "run": return <RunDetailPage id={route.id} />;
    case "feedback": return <FeedbackPage />;
    case "notFound": return (
      <EmptyState
        title="没有找到这个页面"
        description="链接可能不完整，或页面地址已经变化。"
        action={<Button variant="default" nativeButton={false} render={<Link to="/" />}>返回学习中心</Button>}
      />
    );
  }
}

export function App() {
  const { pathname } = useLocation();
  const route = parseRoute(pathname);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.systemStatus());
      setStatusError(null);
    } catch (error) {
      setStatusError(errorMessage(error));
    }
  }, []);

  const startSession = useCallback(async () => {
    setSessionError(null);
    try {
      await initializeSession();
      setSessionReady(true);
      await refreshStatus();
    } catch (error) {
      setSessionReady(false);
      setSessionError(errorMessage(error));
    }
  }, [refreshStatus]);

  useEffect(() => {
    void startSession();
  }, [startSession]);

  useEffect(() => {
    if (!sessionReady) return;
    const timer = window.setInterval(() => void refreshStatus(), 30000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, sessionReady]);

  return (
    <SystemStatusContext.Provider value={{ status, refresh: refreshStatus }}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="site-header" data-page={route.name}>
        <div className="header-inner">
          <Link className="brand" to="/" aria-label="Agent School 学习中心首页">
            <span className="brand-mark" aria-hidden="true" />
            <span><strong>Agent School</strong><small>本机职业角色学习中心</small></span>
          </Link>
          <NavigationMenu className="main-nav" aria-label="主要导航">
            <NavigationMenuList className="flex-wrap">
              <NavigationMenuItem><NavigationMenuLink active={pathname.startsWith("/trainings")} render={<Link to="/trainings" />}>我的员工</NavigationMenuLink></NavigationMenuItem>
              <NavigationMenuItem><NavigationMenuLink active={pathname === "/" || pathname.startsWith("/agents")} render={<Link to="/" />}>培训中心</NavigationMenuLink></NavigationMenuItem>
              <NavigationMenuItem><NavigationMenuLink active={pathname.startsWith("/skills")} render={<Link to="/skills" />}>能力中心</NavigationMenuLink></NavigationMenuItem>
              <NavigationMenuItem><NavigationMenuLink active={pathname.startsWith("/skillhub")} render={<Link to="/skillhub" />}>SkillHub</NavigationMenuLink></NavigationMenuItem>
              <NavigationMenuItem><NavigationMenuLink active={pathname.startsWith("/runs")} render={<Link to="/runs" />}>培训记录</NavigationMenuLink></NavigationMenuItem>
              <NavigationMenuItem><NavigationMenuLink active={pathname === "/feedback"} render={<Link to="/feedback" />}>团队反馈</NavigationMenuLink></NavigationMenuItem>
              <NavigationMenuItem><NavigationMenuLink active={pathname === "/codex"} render={<Link to="/codex" />}>模型管理</NavigationMenuLink></NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          <EnvironmentStatus status={status} />
        </div>
      </header>

      <main id="main-content" className="app-container" tabIndex={-1}>
        {statusError && sessionReady ? <ErrorBanner message={statusError} onRetry={() => void refreshStatus()} /> : null}
        {!sessionReady && !sessionError ? <LoadingState label="正在建立本机会话并检查环境" /> : null}
        {sessionError ? (
          <div className="session-error">
            <ErrorBanner message={sessionError} onRetry={() => void startSession()} />
            <p>请确认 Agent School Bridge 已在本机启动，然后重新建立会话。</p>
          </div>
        ) : null}
        {sessionReady ? <RouteContent route={route} /> : null}
      </main>
      <footer className="site-footer">Agent School · 本机角色与培训项目 · 所有操作均需由你明确发起</footer>
    </SystemStatusContext.Provider>
  );
}
