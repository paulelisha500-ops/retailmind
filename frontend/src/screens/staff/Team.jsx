import { Building2, Check as CheckIcon, Copy, Store, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "../../api.js";
import { DEPARTMENTS, RESPONSIBILITIES } from "../../lib/catalog.js";
import { paths, useStoreQuery } from "../../lib/hooks.js";
import { setQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Button, Chip, Field, IconButton, Input, Segmented, Select } from "../../ui/controls.jsx";
import { Avatar, Banner, CardSkeleton, Empty, List, ListRow, Section, Tag } from "../../ui/display.jsx";
import { ConfirmSheet, Sheet } from "../../ui/Sheet.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";
import { useToast } from "../../ui/Toast.jsx";

const LEVELS = [{ id: "staff", label: "Staff" }, { id: "manager", label: "Manager" }, { id: "admin", label: "Admin" }];

export default function Team() {
  const { token, stores, storeMode, setStoreMode, activeStoreId, setActiveStoreId, activeStore } = useSession();
  const toast = useToast();
  const { data: team, loading } = useStoreQuery("team");
  const [adding, setAdding] = useState(false);
  const blank = () => ({ name: "", email: "", department: DEPARTMENTS[0], title: "", store_id: activeStoreId, access_level: "staff", responsibilities: [] });
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [issued, setIssued] = useState(null); // { name, email, password } — shown once

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleResp = (r) => set({ responsibilities: form.responsibilities.includes(r) ? form.responsibilities.filter((x) => x !== r) : [...form.responsibilities, r] });

  async function submit() {
    if (!form.name.trim() || !form.email.trim()) { setFormError("Enter a name and an email address."); return; }
    setSaving(true);
    setFormError("");
    try {
      const created = await apiFetch("/team", { method: "POST", token, body: form });
      const { temporary_password: password, ...member } = created;
      if (member.store_id === activeStoreId) setQuery(paths.team(activeStoreId), (prev = []) => [member, ...prev]);
      setIssued(password ? { name: member.name, email: member.email, password } : null);
      setAdding(false);
      setForm(blank());
      toast.show(`${member.name} added to the team`);
    } catch (err) { setFormError(err.message); } finally { setSaving(false); }
  }

  async function remove() {
    setRemoveBusy(true);
    try {
      await apiFetch(`/team/${removing.id}`, { method: "DELETE", token });
      setQuery(paths.team(activeStoreId), (prev = []) => prev.filter((m) => m.id !== removing.id));
      toast.show(`${removing.name} removed`);
      setRemoving(null);
    } catch (err) { setError(err.message); setRemoving(null); } finally { setRemoveBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(issued.password); toast.show("Password copied"); } catch { toast.error("Couldn't copy — select the password instead"); }
  }

  return (
    <div className="screen screen--narrow">
      <ScreenHeader title="Team & Access" subtitle="Assign roles, departments and permissions" />
      <Banner tone="error">{error}</Banner>

      {issued && (
        <Banner tone="success">
          <div className="issued">
            <div><b>{issued.name}</b> can sign in as {issued.email} with this one-time password:<br /><code className="issued__code">{issued.password}</code><br /><span className="t-foot">It won't be shown again — share it securely.</span></div>
            <div className="row gap-2">
              <IconButton label="Copy password" tid="team.copy-password" onClick={copy}><Copy size={16} aria-hidden="true" /></IconButton>
              <IconButton label="Dismiss" tid="team.dismiss-password" onClick={() => setIssued(null)}><X size={16} aria-hidden="true" /></IconButton>
            </div>
          </div>
        </Banner>
      )}

      <div className="card mb-4">
        <div className="t-cap mb-2">Deployment mode</div>
        <Segmented options={[{ id: "single", label: "Single store" }, { id: "enterprise", label: "Enterprise" }]} value={storeMode} tid="team.mode" label="Deployment mode" onChange={setStoreMode} />
        {storeMode === "enterprise" && (
          <div className="chip-row mt-3" role="group" aria-label="Store">
            {stores.map((s) => <Chip key={s.id} icon={Store} active={s.id === activeStoreId} tid="team.store" onClick={() => setActiveStoreId(s.id)}>{s.name} {s.code}</Chip>)}
          </div>
        )}
      </div>

      <Button block icon={UserPlus} tid="team.add" onClick={() => { setForm(blank()); setFormError(""); setAdding(true); }}>Add team member</Button>

      <Section title={`${team?.length ?? 0} team member${team?.length === 1 ? "" : "s"} · ${activeStore?.name ?? ""}`}>
      {loading ? <CardSkeleton lines={4} /> : team.length === 0 ? <div className="card"><Empty icon={Building2}>No team members at this store yet.</Empty></div> : (
        <List>
          {team.map((m) => (
            <ListRow key={m.id} as="div">
              <Avatar name={m.name} />
              <span className="list-row__main">
                <span className="list-row__title">{m.name}</span>
                <span className="list-row__detail" style={{ display: "block" }}>{m.title} · {m.department}</span>
                <span className="list-row__detail" style={{ display: "block" }}>{m.responsibilities.length} module{m.responsibilities.length === 1 ? "" : "s"} assigned</span>
              </span>
              <Tag tone={m.access_level === "admin" ? "red" : m.access_level === "manager" ? "amber" : "neutral"}>{m.access_level}</Tag>
              <IconButton label={`Remove ${m.name}`} tid="team.remove" plain onClick={() => setRemoving(m)}><X size={16} aria-hidden="true" /></IconButton>
            </ListRow>
          ))}
        </List>
      )}
      </Section>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add team member" tid="team.form"
        actions={<><Button variant="gray" tid="team.form.cancel" onClick={() => setAdding(false)}>Cancel</Button><Button tid="team.form.submit" loading={saving} onClick={submit}>Add to team</Button></>}>
        <Banner tone="error">{formError}</Banner>
        <Field label="Full name"><Input tid="team.form.name" placeholder="Full name" value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Email"><Input tid="team.form.email" type="email" placeholder="name@company.com" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Department">
          <Select tid="team.form.department" value={form.department} onChange={(e) => set({ department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</Select>
        </Field>
        <Field label="Title"><Input tid="team.form.title" placeholder="e.g. Produce Lead" value={form.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Store">
          <Select tid="team.form.store" value={form.store_id ?? ""} onChange={(e) => set({ store_id: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name} {s.code}</option>)}</Select>
        </Field>
        <Field label="Access level"><Segmented options={LEVELS} value={form.access_level} tid="team.form.level" label="Access level" onChange={(v) => set({ access_level: v })} /></Field>
        <Field label="Responsibilities">
          <div className="resp-grid">
            {RESPONSIBILITIES.map((r) => <Chip key={r} icon={form.responsibilities.includes(r) ? CheckIcon : undefined} active={form.responsibilities.includes(r)} tid="team.form.responsibility" onClick={() => toggleResp(r)}>{r}</Chip>)}
          </div>
        </Field>
      </Sheet>

      <ConfirmSheet open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} busy={removeBusy} tid="team.remove-confirm"
        title="Remove this team member?" message={removing ? `${removing.name} will lose access to RetailMind. Members with orders, tasks or approvals on record can't be removed.` : ""} confirmLabel="Remove" />
    </div>
  );
}
