import { messages } from "@starline/core";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useMemo, useState } from "react";
import { useCharacters, useCreateCharacter, useProjects } from "./data";

/** People tab v1 — list, search, quick add; the dossier opens per character. */
export function PeopleScreen() {
  const projects = useProjects();
  const project = projects.data?.[0] ?? null;
  const characters = useCharacters(project?.id ?? null);
  const create = useCreateCharacter();
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");

  const list = useMemo(() => {
    const all = characters.data ?? [];
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return all;
    return all.filter(
      (character) =>
        character.name.toLowerCase().includes(needle) ||
        character.aliases.some((alias) => alias.toLowerCase().includes(needle)),
    );
  }, [characters.data, query]);

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0 || project === null) return;
    setNewName("");
    await create.mutateAsync({ projectId: project.id, name }).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{messages.people.heading}</h1>
      </header>

      <input
        className="sl-input"
        placeholder={messages.people.searchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={messages.people.searchPlaceholder}
      />

      <form className="flex gap-2" onSubmit={(event) => void onAdd(event)}>
        <input
          className="sl-input flex-1"
          placeholder={messages.people.addPlaceholder}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          aria-label={messages.people.addPlaceholder}
        />
        <button
          type="submit"
          className="sl-btn"
          aria-label={messages.step3.addButton}
          disabled={newName.trim().length === 0 || project === null}
        >
          +
        </button>
      </form>

      {list.length === 0 ? (
        <p className="text-sm text-muted">{messages.people.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((character) => (
            <li key={character.id}>
              <Link
                to="/people/$characterId"
                params={{ characterId: character.id }}
                className="sl-card flex items-center gap-3 p-4"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: character.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{character.name}</span>
                  {character.oneLine.length > 0 ? (
                    <span className="block truncate text-xs text-muted">{character.oneLine}</span>
                  ) : null}
                </span>
                <span className="sl-chip">{messages.roles[character.role]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
