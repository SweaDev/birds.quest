"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { savePostAction } from "@/app/admin/actions";

type Props = { id: number; csrf: string; initialTitle: string; initialMarkdown: string };

/** Side-by-side Markdown editor: source on the left, sanitised live preview on the right. */
export function PostEditor({ id, csrf, initialTitle, initialMarkdown }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const dirty = title !== initialTitle || markdown !== initialMarkdown;

  return (
    <form action={savePostAction}>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" name="title" type="text" maxLength={150} required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="editor">
        <div className="field">
          <label htmlFor="markdown">Markdown</label>
          <textarea id="markdown" name="markdown" spellCheck value={markdown} onChange={(e) => setMarkdown(e.target.value)} />
        </div>
        <div className="field">
          <span id="preview-label" className="label-text">
            Preview
          </span>
          <div className="preview prose" aria-labelledby="preview-label">
            <h2 className="preview-title">{title}</h2>
            <Markdown>{markdown}</Markdown>
          </div>
        </div>
      </div>
      <div className="row">
        <button className="btn" type="submit">
          💾 Save changes
        </button>
        {dirty && <span className="muted">Unsaved changes</span>}
      </div>
    </form>
  );
}
