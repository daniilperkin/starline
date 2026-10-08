import { messages } from "@starline/core";

/** Placeholder for surfaces whose slices have not shipped yet. */
export function ComingSoonScreen({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div aria-hidden="true" className="text-3xl text-accent">
        ✧
      </div>
      <h1 className="text-xl font-semibold tracking-tight">{label}</h1>
      <p className="max-w-xs text-sm text-muted">{messages.common.comingSoonHint}</p>
      <span className="sl-chip">{messages.common.comingSoon}</span>
    </div>
  );
}
