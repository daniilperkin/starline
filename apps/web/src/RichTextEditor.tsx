import {
  type Mentionable,
  makeRichText,
  messages,
  type PMDoc,
  type RichText,
} from "@starline/core";
import { Extension, textInputRule } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import Typography from "@tiptap/extension-typography";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

/**
 * Rich-text v1 (PLAN slices 3 + 6): TipTap with bold / italic / heading / undo, plus optional
 * `@`-mentions when a `mentionables` list is provided (lore bodies today, every editor later).
 * Uncontrolled by design: `initial` seeds the document once, `onChange` streams the current
 * value upward. Remount (key) to replace the document wholesale (e.g. the step-4 seed).
 *
 * Mention chips store `{ entityId, entityType, label }` — ids, never names, so a rename
 * re-renders every chip (PLAN slice 6 exit) and the mention mirror stays valid.
 */

/** The mention node, extended with the entity type so backlinks know what they point at. */
// The live mentionable list, readable from the node view's closure (module scope because the
// node view renders outside the component). The component writes it on every render.
const mentionablesRef: { current: Mentionable[] } = { current: [] };

const EntityMention = Mention.extend({
  addAttributes() {
    return {
      entityId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-entity-id"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.entityId ? { "data-entity-id": attrs.entityId } : {},
      },
      entityType: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-entity-type"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.entityType ? { "data-entity-type": attrs.entityType } : {},
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-label"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.label ? { "data-label": attrs.label } : {},
      },
    };
  },
  renderText({ node }: { node: { attrs: Record<string, unknown> } }) {
    return `@${String(node.attrs.label ?? "")}`;
  },
  /**
   * The chip re-resolves its label from the live mentionables on every render (S33), so a
   * rename updates every chip that points at the entity — ids never lie, stored labels go
   * stale. The hover title shows the entity's glyph + detail as the preview.
   */
  addNodeView() {
    return (({ node }: { node: { attrs: Record<string, unknown> } }) => {
      const dom = document.createElement("span");
      dom.className = "sl-mention-chip";
      dom.dataset.entityId = String(node.attrs.entityId ?? "");
      dom.dataset.entityType = String(node.attrs.entityType ?? "");
      const resolve = () => {
        const live = mentionablesRef.current.find(
          (item) => item.id === String(node.attrs.entityId ?? ""),
        );
        const label = live?.label ?? String(node.attrs.label ?? "");
        dom.textContent = `@${label}`;
        dom.title = live ? `${live.glyph} ${live.detail}` : messages.world.mentionMissing;
      };
      resolve();
      return { dom, update: resolve };
    }) as never;
  },
});

/**
 * Fuzzy + recency scoring for the @-picker (S33, spec 4.4). Prefix beats substring beats a
 * scattered subsequence; ties go to the most recently touched entity, then the alphabet.
 * A query that matches nothing returns -1 and is filtered out.
 */
function scoreMentionable(item: Mentionable, query: string): number {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 1000 - label.length;
  const index = label.indexOf(q);
  if (index !== -1) return 500 - index * 10 - label.length;
  let pos = 0;
  for (const ch of q) {
    pos = label.indexOf(ch, pos);
    if (pos === -1) return -1;
    pos += 1;
  }
  return 100 - label.length;
}

/** Minimal suggestion popup: a list under the caret, keyboard-driven (no tippy dependency). */
function mentionSuggestion() {
  let popup: HTMLDivElement | null = null;
  let active = 0;
  let current: Mentionable[] = [];
  let pick: (item: Mentionable) => void = () => undefined;

  const draw = () => {
    if (!popup) return;
    popup.replaceChildren();
    if (current.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sl-mention-empty";
      empty.textContent = messages.world.mentionEmpty;
      popup.append(empty);
      return;
    }
    current.forEach((item, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sl-mention-row";
      row.dataset.active = index === active ? "true" : "false";
      const glyph = document.createElement("span");
      glyph.className = "sl-mention-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = item.glyph;
      const label = document.createElement("span");
      label.className = "sl-mention-label";
      label.textContent = item.label;
      const detail = document.createElement("span");
      detail.className = "sl-mention-detail";
      detail.textContent = item.detail;
      row.append(glyph, label, detail);
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        pick(item);
      });
      popup?.append(row);
    });
  };

  let lastRect: DOMRect | null = null;

  const place = (rect: DOMRect | null | undefined) => {
    if (!popup || !rect) return;
    lastRect = rect;
    // The picker must sit inside the VISUAL viewport. With the soft keyboard up a popup placed
    // at rect.bottom + 6 runs under the IME — invisible and untappable (real-device finding on
    // the Redmi 14C, decision 31). Flip above the caret when there is no room below it.
    const vv = window.visualViewport;
    const viewLeft = vv?.offsetLeft ?? 0;
    const viewTop = vv?.offsetTop ?? 0;
    const viewRight = viewLeft + (vv?.width ?? window.innerWidth);
    const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
    const width = popup.offsetWidth || 260;
    const height = popup.offsetHeight || 200;
    popup.style.left = `${Math.max(viewLeft + 8, Math.min(rect.left, viewRight - width - 8))}px`;
    const below = rect.bottom + 6;
    popup.style.top =
      below + height <= viewBottom - 8
        ? `${below}px`
        : `${Math.max(viewTop + 8, rect.top - height - 6)}px`;
  };

  // The keyboard can open or close while the picker is up; re-place against the new viewport.
  const reposition = () => {
    if (lastRect) place(lastRect);
  };

  // The suggestion option wants a RENDERER here — an object with onStart/onUpdate/onKeyDown/
  // onExit. Wrapping it one level deeper (returning `{ render: () => … }`) fails silently:
  // the plugin calls render() and finds no lifecycle hooks, so no popup ever appears.
  return {
    onStart: (props: {
      items: Mentionable[];
      clientRect?: (() => DOMRect | null) | null;
      command: (item: Mentionable) => void;
    }) => {
      current = props.items;
      active = 0;
      pick = props.command;
      popup = document.createElement("div");
      popup.className = "sl-mention-popup";
      popup.setAttribute("role", "listbox");
      popup.setAttribute("aria-label", messages.world.mentionsTitle);
      document.body.append(popup);
      window.visualViewport?.addEventListener("resize", reposition);
      draw();
      place(props.clientRect?.());
    },
    onUpdate: (props: {
      items: Mentionable[];
      clientRect?: (() => DOMRect | null) | null;
      command: (item: Mentionable) => void;
    }) => {
      current = props.items;
      pick = props.command;
      active = Math.min(active, Math.max(current.length - 1, 0));
      draw();
      place(props.clientRect?.());
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (props.event.key === "Escape") {
        window.visualViewport?.removeEventListener("resize", reposition);
        popup?.remove();
        popup = null;
        return true;
      }
      if (current.length === 0) return false;
      if (props.event.key === "ArrowDown") {
        active = (active + 1) % current.length;
        draw();
        return true;
      }
      if (props.event.key === "ArrowUp") {
        active = (active - 1 + current.length) % current.length;
        draw();
        return true;
      }
      if (props.event.key === "Enter" || props.event.key === "Tab") {
        const item = current[active];
        if (item) pick(item);
        return true;
      }
      return false;
    },
    onExit: () => {
      window.visualViewport?.removeEventListener("resize", reposition);
      popup?.remove();
      popup = null;
    },
  };
}

const PAIRS: Array<[string, string]> = [
  ['"', "”"],
  ["'", "’"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
];

/** The auto-pair input rules: an opening mark typed at a line's end closes itself. */
const AutoPair = Extension.create({
  name: "starlineAutoPair",
  addInputRules() {
    return PAIRS.map(([open, close]) =>
      textInputRule({
        find: new RegExp(`${open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        replace: close,
      }),
    );
  },
});

export function RichTextEditor({
  initial,
  ariaLabel,
  onChange,
  mentionables,
  plain = false,
  onEditor,
  smartQuotes = true,
  autoPair = true,
  spellcheck = true,
}: {
  initial: RichText;
  ariaLabel: string;
  onChange: (value: RichText) => void;
  /** When provided, typing `@` opens the entity picker and inserts id-based chips. */
  mentionables?: Mentionable[];
  /** Writing mode (PLAN slice 13): no toolbar — the prose is the whole surface. */
  plain?: boolean;
  /** Hands the TipTap instance to the host so it can restore and persist the caret. */
  onEditor?: (editor: Editor | null) => void;
  /** Slice 30's Editor settings; all default on, matching the method's prose-first stance. */
  smartQuotes?: boolean;
  autoPair?: boolean;
  spellcheck?: boolean;
}) {
  // The suggestion reads items at call time; a ref keeps the editor instance stable while the
  // entity list refreshes underneath it.
  mentionablesRef.current = mentionables ?? [];
  const withMentions = mentionables !== undefined;

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [2] } }),
        // Slice 30's Editor settings: smart quotes come from TipTap's typography extension, the
        // auto-pair rules are ours (TipTap ships none), spellcheck rides the DOM attribute below.
        ...(smartQuotes ? [Typography] : []),
        ...(autoPair ? [AutoPair] : []),
        ...(withMentions
          ? [
              EntityMention.configure({
                HTMLAttributes: { class: "sl-mention-chip" },
                suggestion: {
                  char: "@",
                  // The suggestion callbacks are typed against TipTap's MentionNodeAttrs; the
                  // runtime objects are our richer Mentionables (id/label/type/glyph/detail).
                  items: ({ query }) => {
                    const scored = mentionablesRef.current
                      .map((item) => ({ item, score: scoreMentionable(item, query) }))
                      .filter((row) => row.score >= 0)
                      .sort(
                        (a, b) =>
                          b.score - a.score ||
                          (b.item.updatedAt ?? 0) - (a.item.updatedAt ?? 0) ||
                          a.item.label.localeCompare(b.item.label),
                      )
                      .slice(0, 8)
                      .map((row) => row.item);
                    return scored as never;
                  },
                  command: ({ editor: instance, range, props }) => {
                    const item = props as unknown as Mentionable;
                    instance
                      .chain()
                      .focus()
                      .insertContentAt(range, [
                        {
                          type: "mention",
                          attrs: {
                            entityId: item.id,
                            entityType: item.type,
                            label: item.label,
                          },
                        },
                        { type: "text", text: " " },
                      ])
                      .run();
                  },
                  render: (() => mentionSuggestion()) as never,
                },
              }),
            ]
          : []),
      ],
      content: initial.json ?? undefined,
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: {
          "aria-label": ariaLabel,
          class: "sl-prosemirror",
          spellcheck: spellcheck ? "true" : "false",
        },
      },
      onUpdate: ({ editor: instance }) => {
        onChange(makeRichText(instance.getJSON() as PMDoc));
      },
    },
    [withMentions],
  );

  // The host reads and restores the caret through the instance; a ref keeps the callback from
  // re-firing on every parent render (it is an inline arrow in writing mode).
  const onEditorRef = useRef(onEditor);
  onEditorRef.current = onEditor;
  useEffect(() => {
    if (!editor) return undefined;
    onEditorRef.current?.(editor);
    return () => onEditorRef.current?.(null);
  }, [editor]);

  if (!editor) return null;

  const buttonClass = "sl-btn";

  return (
    <div className={plain ? "sl-editor sl-editor-plain" : "sl-editor"}>
      {plain ? null : (
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
      )}
      <EditorContent editor={editor} className="sl-editor-body" />
    </div>
  );
}
