import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { navigate } from "../router";
import { useCallback, useEffect, useState } from "react";
import type { Agent, TrainedAgent } from "@skillhub/shared";
import { api, ApiError } from "../api";
import { Link } from "../components/Link";
import { EmptyState, ErrorBanner, LoadingState, PageHeader } from "../components/UI";
import { errorMessage } from "../utils";
import { AgentChatPage } from "./AgentChatPage";
import { NewRunPage } from "./NewRunPage";

export function AgentTestingPage({ id, chat = false }: {
  id: string;
  chat?: boolean;
}) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [training, setTraining] = useState<TrainedAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setAgent(null);
    setTraining(null);
    setError(null);
    try {
      const [agentData, trainingData] = await Promise.all([
        api.agent(id),
        api.training(id).catch((trainingError: unknown) => {
          if (trainingError instanceof ApiError && trainingError.status === 404) return null;
          throw trainingError;
        }),
      ]);
      setAgent(agentData.agent);
      setTraining(trainingData?.training ?? null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const basePath = `/agents/${encodeURIComponent(id)}/test`;
  return (
    <div className="agent-testing-page">
      <Link className="back-link" to={`/agents/${encodeURIComponent(id)}`}>返回角色</Link>
      <PageHeader
        eyebrow="测试中心"
        title={agent?.name ?? "角色测试"}
        description="用自动化测试验证明确任务，或在固定培训项目中与角色连续对话。"
      />
      <Tabs value={chat ? "chat" : "test"} onValueChange={(value) => navigate(value === "chat" ? `${basePath}/chat` : basePath)}>
      <TabsList aria-label="测试方式">
        <TabsTrigger value="test">自动化测试</TabsTrigger>
        <TabsTrigger value="chat">自由试用</TabsTrigger>
      </TabsList>
      <TabsContent value={chat ? "chat" : "test"}>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading && !agent ? <LoadingState label="正在读取角色培训项目" /> : null}
      {!loading && !agent && !error ? <EmptyState title="角色不存在" description="该角色可能已从本机删除。" /> : null}
      {agent && !chat ? <NewRunPage agentId={id} embedded /> : null}
      {agent && chat && !training ? (
        <EmptyState
          title="完成培训后即可自由试用"
          description="自由试用只支持 Agent 已培训项目，请先在角色详情页创建本机培训项目。"
          action={<Button variant="default" nativeButton={false} render={<Link to={`/agents/${encodeURIComponent(id)}`} />}>前往培训</Button>}
        />
      ) : null}
      {agent && chat && training ? (
        <AgentChatPage agent={agent} training={training} />
      ) : null}
      </TabsContent>
      </Tabs>
    </div>
  );
}
