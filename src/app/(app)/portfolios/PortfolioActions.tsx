"use client";
import { useActionState, useState } from "react";
import { deleteAction, renameAction, type ActionState } from "@/app/portfolio-actions";
import { MAX_NAME } from "@/lib/limits";

/** Rename and delete for one saved portfolio, each behind its own small inline form. */
export function PortfolioActions({ id, name }: { id: number; name: string }) {
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [state, rename, renaming] = useActionState<ActionState, FormData>(async (prev, form) => {
    const result = await renameAction(id, prev, form);
    if (result?.ok) setMode("idle");
    return result;
  }, undefined);

  if (mode === "rename")
    return (
      <form action={rename} className="flex items-center justify-end gap-2">
        <input name="name" defaultValue={name} maxLength={MAX_NAME} aria-label="New name" className="input w-48" autoFocus required />
        <button className="btn btn-sm" disabled={renaming}>Save</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode("idle")}>Cancel</button>
        {state?.error && <span className="text-xs text-red-700">{state.error}</span>}
      </form>
    );
  if (mode === "delete")
    return (
      <form action={deleteAction.bind(null, id)} className="flex items-center justify-end gap-2 whitespace-nowrap">
        <span className="text-xs text-slate-600">Delete &ldquo;{name}&rdquo;? This can&rsquo;t be undone.</span>
        <button className="btn btn-sm bg-red-700 hover:bg-red-800">Delete</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode("idle")}>Cancel</button>
      </form>
    );
  return (
    <div className="flex justify-end gap-2">
      <button className="btn btn-secondary btn-sm" onClick={() => setMode("rename")}>Rename</button>
      <button className="btn btn-secondary btn-sm" onClick={() => setMode("delete")}>Delete</button>
    </div>
  );
}
