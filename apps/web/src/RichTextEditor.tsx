import { makeRichText, messages, type PMDoc, type RichText } from "@starline/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

/**
 * Rich-text v1 (PLAN slice 3): TipTap with bold / italic / heading / undo only — the smallest
 * editor that satisfies the spec's rich-text columns. Uncontrolled by design: `initial` seeds
 * the document once, `onChange` streams the current value upward. Remount (key) to replace
 * the document wholesale (e.g. the step-4 seed).
 */
export function RichTextEditor({
  initial,
  ariaLabel,
  onChange,
}: {
  initial: RichText;
  ariaLabel: string;
  onChange: (value: RichText) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2] } })],
    content: initial.json ?? undefined,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { "aria-label": ariaLabel, class: "sl-prosemirror" } },
    onUpdate: ({ editor: instance }) => {
      onChange(makeRichText(instance.getJSON() as PMDoc));
    },
  });

  if (!editor) return null;

  const buttonClass = "sl-btn";

  return (
    <div className="sl-editor">
      <div className="sl-editor-toolbar" role="toolbar" aria-label={messages.editor.toolbar}>
        <button
          type="button"
          className={buttonClass}
          aria-label={messages.editor.bold}
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong aria-hidden="true">B</strong>
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={messages.editor.italic}
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em aria-hidden="true">I</em>
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={messages.editor.headingLabel}
          aria-pressed={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <span aria-hidden="true">H2</span>
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={messages.editor.undo}
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <span aria-hidden="true">↶</span>
        </button>
      </div>
      <EditorContent editor={editor} className="sl-editor-body" />
    </div>
  );
}
