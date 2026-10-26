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
    <section className="panel" aria-labelledby={titleId}>
      <div className="section-heading">
        <div><span className="eyebrow">工作区变化</span><h2 id={titleId}>结果文件</h2></div>
        <span className="muted">{files.length} 个文件</span>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {files.length === 0 ? <EmptyState title="没有结果文件" description="测试完成后，相对于初始工作区发生变化且可记录的文件会显示在这里。" /> : (
        <div className="result-files">
          {files.map((file) => (
            <article className="result-file" key={file.id}>
              <div className="result-file-info">
                <div><span className={`badge file-${file.kind}`}>{kindLabels[file.kind]}</span><code>{file.path}</code></div>
                <div className="result-file-meta">
                  <span>{formatBytes(file.size)}</span>
                  {file.mime ? <span>{file.mime}</span> : null}
                  {file.truncated ? <span className="inline-warning">保存内容已截断或超出限制</span> : null}
                </div>
              </div>
              <div className="button-row">
                {file.previewAvailable ? <button type="button" className="button button-small button-secondary" onClick={() => void loadPreview(file)} disabled={loadingId !== null}>{loadingId === file.id ? "正在读取…" : "预览"}</button> : null}
                {file.artifactAvailable ? <a className="button button-small button-ghost" href={`/api/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(file.id)}/download`} download>下载</a> : <span className="muted">无下载副本</span>}
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
            <button type="button" className="button button-small button-ghost" onClick={() => setPreview(null)}>关闭预览</button>
          </div>
          {preview.truncated ? <p className="inline-warning">预览内容已截断，完整内容请下载查看。</p> : null}
          <pre key={preview.fileId}>{preview.content}</pre>
        </div>
      ) : null}
    </section>
  );
}
