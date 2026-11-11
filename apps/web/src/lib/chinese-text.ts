const chinese = "\\p{Script=Han}";
const punctuation: Record<string, string> = { ",": "，", ":": "：", ";": "；", "!": "！", "?": "？" };

export function formatChineseText(text: string): string {
  return text.split(/(https?:\/\/[^\s<>，。！？；、“”‘’]+|`[^`]*`)/g).map((part, index) => {
    if (index % 2) return part;
    return part
      .replace(/[\u2013\u2014]+/g, "--")
      .replace(new RegExp(`([${chinese}])([A-Za-z0-9])`, "gu"), "$1 $2")
      .replace(new RegExp(`([A-Za-z0-9])([${chinese}])`, "gu"), "$1 $2")
      .replace(new RegExp(`([${chinese}])([,:;!?])`, "gu"), (_match, letter: string, mark: string) => `${letter}${punctuation[mark]}`)
      .replace(new RegExp(`([,:;!?])(?=[${chinese}])`, "gu"), (mark) => punctuation[mark]!)
      .replace(new RegExp(`([${chinese}])\\.(?=$|\\s|[${chinese}])`, "gu"), "$1。")
      .replace(/"([^"{}\n]*[\p{Script=Han}][^"{}\n]*)"/gu, "“$1”")
      .replace(/[ \t]*([，。！？：；、“”‘’（）])[ \t]*/g, "$1");
  }).join("");
}

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };

export function remarkChineseTypography() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "code" || node.type === "inlineCode" || node.type === "html") return;
      if (node.type === "text" && node.value) node.value = formatChineseText(node.value);
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
