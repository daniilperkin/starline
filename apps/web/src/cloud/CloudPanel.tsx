import { messages, plural } from "@starline/core";
import { useProjects } from "../data";
import { useSessionStore } from "../session";
import { useCloudStore } from "./session";

/**
 * Settings → Cloud backup (slice 15). The one place a writer turns the network on or off, with a
 * status line they can read at a glance: "No network requests — cloud backup is off" versus
 * "On — signed in as …, N snapshots in your Drive". Nothing here uploads anything by itself; the
 * snapshot triggers do that, and only once this switch is on.
 */
export function CloudPanel() {
  const session = useSessionStore((state) => state.session);
  const projects = useProjects();
  const project = projects.data?.[0] ?? null;

  const available = useCloudStore((state) => state.available);
  const enabled = useCloudStore((state) => state.enabled);
  const status = useCloudStore((state) => state.status);
  const message = useCloudStore((state) => state.message);
  const email = useCloudStore((state) => state.email);
  const manifest = useCloudStore((state) => state.manifest);
  const enable = useCloudStore((state) => state.enable);
  const disable = useCloudStore((state) => state.disable);
  const refresh = useCloudStore((state) => state.refresh);

  const library = project && session ? { id: project.id, name: session.name } : null;
  const entries = manifest?.entries ?? [];
  const last = entries[0];

  if (!available) {
    return (
      <section className="sl-card p-4">
        <h2 className="text-sm font-medium">{messages.cloud.heading}</h2>
        <p className="mt-2 text-xs text-muted" data-testid="sl-cloud-status">
          {messages.cloud.unavailable}
        </p>
      </section>
    );
  }

  return (
    <section className="sl-card p-4">
      <h2 className="text-sm font-medium">{messages.cloud.heading}</h2>

      {!enabled ? (
        <>
          <p className="mt-2 text-xs text-muted" data-testid="sl-cloud-status">
            {messages.cloud.off}
          </p>
          <p className="mt-1 text-xs text-muted">{messages.cloud.hint}</p>
          <button
            type="button"
            className="sl-btn sl-btn-primary mt-3"
            data-testid="sl-cloud-enable"
            disabled={status === "connecting" || library === null}
            onClick={() => library && void enable(library)}
          >
            {status === "connecting" ? messages.cloud.working : messages.cloud.enable}
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted" data-testid="sl-cloud-status">
            {status === "busy"
              ? messages.cloud.working
              : plural(messages.cloud.on, entries.length, { email: email ?? "" })}
          </p>
          {last ? (
            <p className="mt-1 text-xs text-muted" data-testid="sl-cloud-last">
              {messages.cloud.lastUpload} {new Date(last.uploadedAt).toLocaleString()}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="sl-btn"
              data-testid="sl-cloud-refresh"
              disabled={status === "busy" || library === null}
              onClick={() => library && void refresh(library)}
            >
              {messages.cloud.refresh}
            </button>
            <button
              type="button"
              className="sl-btn"
              data-testid="sl-cloud-disable"
              onClick={() => void disable()}
            >
              {messages.cloud.disable}
            </button>
          </div>
        </>
      )}

      {status === "error" && message ? (
        <p className="sl-notice mt-3 text-xs" role="alert" data-testid="sl-cloud-error">
          {messages.cloud.error.replace("{message}", message)}
        </p>
      ) : null}
    </section>
  );
}
