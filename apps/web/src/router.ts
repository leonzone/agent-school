import { useSyncExternalStore } from "react";

export type Route =
  | { name: "agents" }
  | { name: "agentNew" }
  | { name: "agent"; id: string }
  | { name: "agentEdit"; id: string }
  | { name: "agentTest"; id: string }
  | { name: "agentChat"; id: string; conversationId?: string }
  | { name: "trainings"; agentId?: string }
  | { name: "catalog" }
  | { name: "codex" }
  | { name: "skill"; id: string }
  | { name: "installed" }
  | { name: "runs" }
  | { name: "newRun"; skillId: string }
  | { name: "run"; id: string }
  | { name: "feedback" }
  | { name: "notFound" };

const listeners = new Set<() => void>();

function snapshot(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function useLocation(): { pathname: string; search: string } {
  const value = useSyncExternalStore(subscribe, snapshot);
  const searchIndex = value.indexOf("?");
  return {
    pathname: searchIndex === -1 ? value : value.slice(0, searchIndex),
    search: searchIndex === -1 ? "" : value.slice(searchIndex),
  };
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  for (const listener of listeners) listener();
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/") return { name: "agents" };
  if (path === "/agents/new") return { name: "agentNew" };
  if (path === "/trainings") return { name: "trainings" };
  if (path === "/skills") return { name: "catalog" };
  if (path === "/skills/installed") return { name: "installed" };
  if (path === "/codex") return { name: "codex" };
  if (path === "/runs") return { name: "runs" };
  if (path === "/feedback") return { name: "feedback" };

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "trainings") {
    const agentId = decode(parts[1] ?? "");
    return agentId ? { name: "trainings", agentId } : { name: "notFound" };
  }
  if (parts.length === 2 && parts[0] === "agents") {
    const id = decode(parts[1] ?? "");
    return id ? { name: "agent", id } : { name: "notFound" };
  }
  if (parts.length === 3 && parts[0] === "agents" && parts[2] === "edit") {
    const id = decode(parts[1] ?? "");
    return id ? { name: "agentEdit", id } : { name: "notFound" };
  }
  if (parts.length === 3 && parts[0] === "agents" && parts[2] === "test") {
    const id = decode(parts[1] ?? "");
    return id ? { name: "agentTest", id } : { name: "notFound" };
  }
  if ((parts.length === 4 || parts.length === 5) && parts[0] === "agents" && parts[2] === "test" && parts[3] === "chat") {
    const id = decode(parts[1] ?? "");
    if (!id) return { name: "notFound" };
    if (parts.length === 4) return { name: "agentChat", id };
    const conversationId = decode(parts[4] ?? "");
    return conversationId ? { name: "agentChat", id, conversationId } : { name: "notFound" };
  }
  if (parts.length === 2 && parts[0] === "skills") {
    const id = decode(parts[1] ?? "");
    return id ? { name: "skill", id } : { name: "notFound" };
  }
  if (parts.length === 3 && parts[0] === "runs" && parts[1] === "new") {
    const skillId = decode(parts[2] ?? "");
    return skillId ? { name: "newRun", skillId } : { name: "notFound" };
  }
  if (parts.length === 2 && parts[0] === "runs") {
    const id = decode(parts[1] ?? "");
    return id ? { name: "run", id } : { name: "notFound" };
  }
  return { name: "notFound" };
}
