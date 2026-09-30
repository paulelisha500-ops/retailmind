import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "../../api.js";
import { taskTone } from "../../lib/catalog.js";
import { paths, useStoreQuery } from "../../lib/hooks.js";
import { setQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Check } from "../../ui/controls.jsx";
import { Banner, CardSkeleton, Empty, List, ListRow, Section, Tag } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";

export default function Tasks({ onNav }) {
  const { token, activeStoreId, isAdmin } = useSession();
  const { data, loading, error: loadError } = useStoreQuery("tasks");
  const [error, setError] = useState("");
  const open = (data ?? []).filter((t) => !t.done);
  const done = (data ?? []).filter((t) => t.done);

  async function toggle(id) {
    setError("");
    try {
      const updated = await apiFetch(`/tasks/${id}/toggle`, { method: "PATCH", token });
      setQuery(paths.tasks(activeStoreId), (prev = []) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="screen screen--narrow">
      <ScreenHeader title="Tasks" subtitle={`${open.length} open today`} back={isAdmin ? { label: "Home", tid: "tasks.back", onClick: () => onNav("home") } : undefined} />
      <Banner tone="error">{error || loadError?.message}</Banner>
      {loading ? <CardSkeleton lines={4} /> : (
        <>
          <Section title="Open">
            {open.length === 0 ? <div className="card"><Empty icon={CheckCircle2}>Nothing open — great work today.</Empty></div> : (
              <List>
                {open.map((t) => (
                  <ListRow key={t.id} as="div">
                    <Check checked={t.done} label={`Mark “${t.title}” done`} tid="tasks.toggle" onChange={() => toggle(t.id)} />
                    <span className="list-row__main"><span className="list-row__title">{t.title}</span><span className="list-row__detail" style={{ display: "block" }}>{t.detail}</span></span>
                    <Tag tone={taskTone(t.source)}>{t.source}</Tag>
                  </ListRow>
                ))}
              </List>
            )}
          </Section>
          {done.length > 0 && (
            <Section title="Completed">
              <List className="is-muted">
                {done.map((t) => (
                  <ListRow key={t.id} as="div">
                    <Check checked={t.done} label={`Reopen “${t.title}”`} tid="tasks.reopen" onChange={() => toggle(t.id)} />
                    <span className="list-row__main"><span className="list-row__title is-struck">{t.title}</span></span>
                  </ListRow>
                ))}
              </List>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
