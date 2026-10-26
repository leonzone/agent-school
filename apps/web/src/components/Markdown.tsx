import ReactMarkdown from "react-markdown";

export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`markdown ${className}`.trim()}>
      <ReactMarkdown
        skipHtml
        components={{
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
