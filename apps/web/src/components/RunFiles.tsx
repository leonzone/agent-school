import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useId, useState } from "react";
import type { RunFile } from "@skillhub/shared";
import { api } from "../api";
import { errorMessage, formatBytes } from "../utils";
import { EmptyState, ErrorBanner, LoadingState } from "./UI";

const kindLabels: Record<RunFile["kind"], string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
};

type Preview = {
  fileId: string;
  path: string;
  content: string;
  truncated: boolean;
};

export function RunFiles({ runId, files }: { runId: string; files: RunFile[] }) {
  const titleId = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview(file: RunFile) {
    if (loadingId) return;
    setLoadingId(file.id);
    setError(null);
    try {
      const data = await api.filePreview(runId, file.id);
      setPreview({ fileId: file.id, path: data.path, content: data.content, truncated: data.truncated });
    } catch (previewError) {
      setError(errorMessage(previewError));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Card className="content-panel" aria-labelledby={titleId}>
      <CardHeader>
        <div><span className="eyebrow">工作区变化</span><h2 id={titleId}>结果文件</h2></div>
        <span className="muted">{files.length} 个文件</span>
      </CardHeader>
      <CardContent>
      {error ? <ErrorBanner message={error} /> : null}
      {files.length === 0 ? <EmptyState title="没有结果文件" description="测试完成后，相对于初始工作区发生变化且可记录的文件会显示在这里。" /> : (
        <div className="result-files">
          {files.map((file) => (
            <article className="result-file" key={file.id}>
              <div className="result-file-info">
                <div><Badge variant="secondary">{kindLabels[file.kind]}</Badge><code>{file.path}</code></div>
                <div className="result-file-meta">
                  <span>{formatBytes(file.size)}</span>
                  {file.mime ? <span>{file.mime}</span> : null}
                  {file.truncated ? <span className="inline-warning">保存内容已截断或超出限制</span> : null}
                </div>
              </div>
              <div className="button-row">
                {file.previewAvailable ? <Button variant="outline" size="sm" type="button" onClick={() => void loadPreview(file)} disabled={loadingId !== null}>{loadingId === file.id ? "正在读取…" : "预览"}</Button> : null}
                {file.artifactAvailable ? <Button variant="ghost" size="sm" nativeButton={false} render={<a href={`/api/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(file.id)}/download`} download></a>}>下载</Button> : <span className="muted">无下载副本</span>}
              </div>
            </article>
          ))}
        </div>
      )}
      {loadingId ? <LoadingState label="正在读取文件预览" /> : null}
      {preview ? (
        <div className="file-preview">
          <div className="section-heading">
            <div><span className="eyebrow">文本预览</span><h3>{preview.path}</h3></div>
            <Button variant="ghost" size="sm" type="button" onClick={() => setPreview(null)}>关闭预览</Button>
          </div>
          {preview.truncated ? <p className="inline-warning">预览内容已截断，完整内容请下载查看。</p> : null}
          <pre key={preview.fileId}>{preview.content}</pre>
        </div>
      ) : null}
      </CardContent>
    </Card>
  );
}
