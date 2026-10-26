import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import type { TrainedSkill } from "@skillhub/shared";

export type ChatComposerEditorHandle = {
  insertSkill: (skillId: string) => void;
};

function readValue(editor: HTMLDivElement): string {
  const readNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.dataset.skillId) return `@${node.dataset.skillId}`;
    if (node.tagName === "BR") return "\n";
    return Array.from(node.childNodes).map(readNode).join("");
  };
  return Array.from(editor.childNodes).map((node, index) => {
    const value = readNode(node);
    return node instanceof HTMLElement && node.tagName === "DIV" && index > 0 ? `\n${value}` : value;
  }).join("").replace(/\u200b/g, "");
}

function readSkillIds(editor: HTMLDivElement): string[] {
  return Array.from(new Set(
    Array.from(editor.querySelectorAll<HTMLElement>("[data-skill-id]"))
      .map((element) => element.dataset.skillId)
      .filter((skillId): skillId is string => Boolean(skillId)),
  ));
}

export const ChatComposerEditor = forwardRef<ChatComposerEditorHandle, {
  value: string;
  skills: TrainedSkill[];
  disabled: boolean;
  onChange: (value: string) => void;
  onSkillIdsChange: (skillIds: string[]) => void;
  onSend: () => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
}>(function ChatComposerEditor({ value, skills, disabled, onChange, onSkillIdsChange, onSend, onPaste }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const mentionRange = useRef<Range | null>(null);
  const callbacks = useRef({ onChange, onSkillIdsChange });
  const lastSkillIds = useRef("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  callbacks.current = { onChange, onSkillIdsChange };

  const matchingSkills = mentionQuery === null ? [] : skills.filter((skill) => skill.skillId.includes(mentionQuery));
  const mentionOpen = mentionQuery !== null && !disabled;

  const syncSkills = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const skillIds = readSkillIds(editor);
    const key = skillIds.join("\n");
    if (key === lastSkillIds.current) return;
    lastSkillIds.current = key;
    callbacks.current.onSkillIdsChange(skillIds);
  }, []);

  const closeMention = useCallback(() => {
    mentionRange.current = null;
    setMentionQuery(null);
    setActiveIndex(0);
  }, []);

  const updateMention = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) {
      closeMention();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !range.collapsed || !(range.startContainer instanceof Text)) {
      closeMention();
      return;
    }
    const beforeCaret = range.startContainer.data.slice(0, range.startOffset);
    const match = beforeCaret.match(/(?:^|[\s(（])@([a-z0-9-]*)$/);
    if (!match || match.index === undefined) {
      closeMention();
      return;
    }
    const query = match[1] ?? "";
    const start = range.startOffset - query.length - 1;
    const nextRange = document.createRange();
    nextRange.setStart(range.startContainer, start);
    nextRange.setEnd(range.startContainer, range.startOffset);
    mentionRange.current = nextRange;
    setMentionQuery((current) => current === query ? current : query);
    setActiveIndex(0);
  }, [closeMention]);

  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    callbacks.current.onChange(readValue(editor));
    syncSkills();
    updateMention();
  }, [syncSkills, updateMention]);

  const insertSkill = useCallback((skillId: string) => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    editor.focus();
    const selection = window.getSelection();
    let range = mentionRange.current ?? savedRange.current;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.deleteContents();

    const chip = document.createElement("span");
    chip.className = "composer-skill-chip";
    chip.contentEditable = "false";
    chip.dataset.skillId = skillId;
    chip.textContent = `@${skillId}`;
    chip.setAttribute("aria-label", `调用 Skill ${skillId}`);
    const after = document.createTextNode(" ");
    range.insertNode(after);
    range.insertNode(chip);
    range.setStart(after, after.data.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRange.current = range.cloneRange();
    closeMention();
    emit();
  }, [closeMention, disabled, emit]);

  useImperativeHandle(ref, () => ({ insertSkill }), [insertSkill]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || readValue(editor) === value) return;
    editor.replaceChildren();
    if (value) editor.append(document.createTextNode(value));
    lastSkillIds.current = "";
    syncSkills();
    closeMention();
  }, [closeMention, syncSkills, value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const available = new Set(skills.map((skill) => skill.skillId));
    let changed = false;
    for (const chip of Array.from(editor.querySelectorAll<HTMLElement>("[data-skill-id]"))) {
      if (!available.has(chip.dataset.skillId ?? "")) {
        chip.remove();
        changed = true;
      }
    }
    if (changed) emit();
  }, [emit, skills]);

  useEffect(() => {
    if (disabled) closeMention();
  }, [closeMention, disabled]);

  useEffect(() => {
    const selectionChanged = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
    };
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!editorRef.current?.contains(target) && !mentionMenuRef.current?.contains(target)) closeMention();
    };
    document.addEventListener("selectionchange", selectionChanged);
    document.addEventListener("pointerdown", pointerDown);
    return () => {
      document.removeEventListener("selectionchange", selectionChanged);
      document.removeEventListener("pointerdown", pointerDown);
    };
  }, [closeMention]);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (mentionOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMention();
        return;
      }
      if (matchingSkills.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (current + direction + matchingSkills.length) % matchingSkills.length);
        return;
      }
      if (matchingSkills.length > 0 && (event.key === "Enter" || event.key === "Tab")) {
        event.preventDefault();
        const skill = matchingSkills[activeIndex] ?? matchingSkills[0];
        if (skill) insertSkill(skill.skillId);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (event.clipboardData.files.length > 0) {
      onPaste(event);
      return;
    }
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    emit();
  }

  return (
    <div className="composer-editor-shell">
      <div
        ref={editorRef}
        id="chat-task"
        className="composer-editor"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label="发送给员工的消息，输入 @ 调用 Skills"
        aria-disabled={disabled}
        aria-expanded={mentionOpen}
        aria-controls={mentionOpen ? "chat-skill-mentions" : undefined}
        aria-activedescendant={mentionOpen && matchingSkills[activeIndex] ? `chat-skill-option-${matchingSkills[activeIndex].skillId}` : undefined}
        data-placeholder={disabled ? "等待本轮回复完成…" : "输入消息，输入 @ 调用 Skills；Enter 发送，Shift+Enter 换行"}
        suppressContentEditableWarning
        onInput={emit}
        onKeyDown={keyDown}
        onPaste={paste}
      />
      {mentionOpen ? (
        <div ref={mentionMenuRef} id="chat-skill-mentions" className="composer-skill-mentions" role="listbox" aria-label="可调用的 Skills">
          <div className="composer-skills-heading"><strong>调用 Skill</strong><span>输入 @{mentionQuery} 筛选</span></div>
          <div className="composer-skill-options">
            {matchingSkills.map((skill, index) => (
              <button
                id={`chat-skill-option-${skill.skillId}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : ""}
                key={skill.skillId}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => insertSkill(skill.skillId)}
              >
                <span><strong>@{skill.skillId}</strong><small>{skill.path}</small></span>
              </button>
            ))}
            {matchingSkills.length === 0 ? <p className="composer-skill-empty">没有匹配的 Skill</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
