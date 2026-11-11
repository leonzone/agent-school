import ReactMarkdown from "react-markdown";
import { isValidElement, type ReactNode } from "react";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "./ui/code-block";
import { useHighlightedCode } from "../hooks/use-highlighted-code";
import { remarkChineseTypography } from "../lib/chinese-text";

function HighlightedCode({ text, language }: { text: string; language: string }) {
  const lines = useHighlightedCode(text, language);
  return <CodeBlock><CodeBlockHeader><CodeBlockTitle>{language}</CodeBlockTitle><CodeBlockActions><CodeBlockCopyButton value={text} aria-label="复制代码" /></CodeBlockActions></CodeBlockHeader><CodeBlockContent lineNumbers className="max-h-96">{lines.map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)}</CodeBlockContent></CodeBlock>;
}

function MarkdownCode({ children }: { children?: ReactNode }) {
  if (!isValidElement<{ children?: ReactNode; className?: string }>(children)) return <pre>{children}</pre>;
  const text = String(children.props.children ?? "").replace(/\n$/, "");
  const language = children.props.className?.replace("language-", "") ?? "代码";
  return <HighlightedCode text={text} language={language} />;
}

export function Markdown({ children, className = "", normalizeChinese = false }: { children: string; className?: string; normalizeChinese?: boolean }) {
  return (
    <div className={`markdown ${className}`.trim()}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={normalizeChinese ? [remarkChineseTypography] : undefined}
        components={{
          pre: MarkdownCode,
          a: ({ children: label, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">{label}</a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
