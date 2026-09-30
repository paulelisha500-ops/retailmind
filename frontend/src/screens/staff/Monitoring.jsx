import { MapPin, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api.js";
import { fmtTime } from "../../lib/format.js";
import { paths, useStoreQuery } from "../../lib/hooks.js";
import { setQuery, useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Button, Field, Input, Segmented } from "../../ui/controls.jsx";
import { Banner, CardSkeleton, Empty, List, ListRow, Meter, Section, Tag } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";
import { useToast } from "../../ui/Toast.jsx";

const CAMERA_KEY = "rm_camera_source";
const readSource = () => { try { return JSON.parse(localStorage.getItem(CAMERA_KEY) || "null"); } catch { return null; } };
const writeSource = (value) => { try { localStorage.setItem(CAMERA_KEY, JSON.stringify(value)); } catch { /* not persisted in private windows */ } };

function CameraFeed({ source }) {
  const videoRef = useRef(null);
  // The error belongs to the source that produced it, so switching sources clears it without any reset logic.
  const [failure, setFailure] = useState(null);
  const error = failure && failure.source === source ? failure.message : "";

  useEffect(() => {
    if (source?.type !== "webcam") return undefined;
    let stream;
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => setFailure({ source, message: "This connection can't use the camera — camera access needs https:// or localhost." }));
      return undefined;
    }
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch((err) => setFailure({ source, message: err.message || "Couldn't access this device's camera — check browser permissions." }));
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [source]);

  if (!source) return null;
  return (
    <div className="card camera">
      <Banner tone="error">{error}</Banner>
      {source.type === "webcam" && !error && <video ref={videoRef} autoPlay playsInline muted className="camera__view" aria-label="Live camera" />}
      {source.type === "url" && !error && (
        <img src={source.url} alt="Live camera feed" className="camera__view"
          onError={() => setFailure({ source, message: "Couldn't load that stream. It needs to be a direct HTTP(S) MJPEG or snapshot URL — rtsp:// links can't play in a browser without a streaming gateway." })} />
      )}
    </div>
  );
}

export default function Monitoring() {
  const { token, activeStoreId, storeLabel } = useSession();
  const toast = useToast();
  const alerts = useStoreQuery("alerts");
  const team = useStoreQuery("team");
  const fill = useQuery(`/inventory/shelf-fill?store_id=${activeStoreId}`, { token, enabled: !!activeStoreId });
  const [source, setSource] = useState(readSource);
  const [urlDraft, setUrlDraft] = useState(source?.type === "url" ? source.url : "");
  const [urlError, setUrlError] = useState("");
  const [error, setError] = useState("");

  const mode = source?.type === "webcam" ? "webcam" : source?.type === "url" ? "url" : "off";
  const [editingUrl, setEditingUrl] = useState(false);
  const all = alerts.data ?? [];
  const open = all.filter((a) => a.status !== "resolved");
  const reviewed = all.filter((a) => a.status === "resolved");
  const assignee = (id) => (id ? team.data?.find((m) => m.id === id)?.name ?? "Team member" : "Unassigned");

  const choose = (next) => {
    setUrlError("");
    if (next === "off") { setSource(null); writeSource(null); setEditingUrl(false); }
    else if (next === "webcam") { const s = { type: "webcam" }; setSource(s); writeSource(s); setEditingUrl(false); }
    else setEditingUrl(true);
  };

  function saveUrl() {
    const url = urlDraft.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { setUrlError("Enter a full http:// or https:// camera URL."); return; }
    const s = { type: "url", url };
    setSource(s);
    writeSource(s);
    setUrlError("");
    setEditingUrl(false);
  }

  async function resolve(id) {
    setError("");
    try {
      const updated = await apiFetch(`/alerts/${id}/resolve`, { method: "PATCH", token });
      setQuery(paths.alerts(activeStoreId), (prev = []) => prev.map((a) => (a.id === id ? updated : a)));
      toast.show("Alert marked as reviewed");
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="screen">
      <ScreenHeader title="Monitoring" subtitle={storeLabel} />
      <Banner tone="error">{error || alerts.error?.message}</Banner>

      <div className="card mb-4">
        <div className="t-cap mb-2">Camera source</div>
        <Segmented options={[{ id: "off", label: "Off" }, { id: "webcam", label: "This device" }, { id: "url", label: "IP camera" }]} value={editingUrl ? "url" : mode} tid="monitoring.camera" label="Camera source" onChange={choose} />
        {editingUrl && (
          <div className="mt-3">
            <Banner tone="error">{urlError}</Banner>
            <Field label="Camera URL" hint="Use your camera's HTTP MJPEG or snapshot URL — most IP cameras expose one alongside RTSP. A plain rtsp:// link needs a streaming gateway to play in a browser.">
              <Input tid="monitoring.camera-url" placeholder="http://camera-ip/video.mjpg" aria-label="IP camera URL" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} />
            </Field>
            <Button tid="monitoring.camera-save" block onClick={saveUrl}>Save &amp; connect</Button>
          </div>
        )}
      </div>
      <CameraFeed source={source} />

      <Banner tone="plain">Alerts come from the vision pipeline and are always closed by a person — nothing here is auto-actioned. Shelf tiles below are computed from live inventory, not from video.</Banner>

      <Section title="Shelf fill">
        {fill.loading ? <CardSkeleton /> : fill.data?.length ? (
          <div className="fill-grid">
            {fill.data.map((f) => {
              const tone = f.pct < 30 ? "red" : f.pct < 60 ? "amber" : "green";
              return (
                <div key={f.location} className="fill">
                  <div className="row between"><span className="strong">{f.location}</span><Tag tone={tone}>{f.pct}%</Tag></div>
                  <div className="t-foot mb-2">{f.category}</div>
                  <Meter pct={f.pct} tone={tone === "green" ? undefined : tone} />
                </div>
              );
            })}
          </div>
        ) : <div className="card"><Empty>No inventory recorded for this store yet.</Empty></div>}
      </Section>

      <Section title={`Alerts (${open.length} open)`}>
        {alerts.loading ? <CardSkeleton lines={4} /> : open.length === 0 ? (
          <div className="card"><Empty icon={ShieldCheck}>No open alerts — all clear.</Empty></div>
        ) : (
          <div className="stack gap-3">
            {open.map((a) => (
              <article key={a.id} className="card alert">
                <div className="row between mb-2">
                  <Tag tone={a.severity}>{a.kind === "theft" ? "Loss prevention" : a.kind === "quality" ? "Quality" : "Stock"}</Tag>
                  <span className="t-foot">{Math.round(a.confidence)}% confidence</span>
                </div>
                <div className="t-headline mb-2">{a.message}</div>
                <div className="t-foot row gap-1 mb-3"><MapPin size={13} aria-hidden="true" />{a.location} · {a.model_source} · {fmtTime(a.created_at)}</div>
                <div className="row between gap-3">
                  <span className="t-foot">Notified: {assignee(a.assigned_to)}</span>
                  <Button variant="tint" size="sm" tid="monitoring.resolve" onClick={() => resolve(a.id)}>Mark reviewed</Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      {reviewed.length > 0 && (
        <Section title={`Reviewed (${reviewed.length})`}>
          <List className="is-muted">
            {reviewed.map((a) => <ListRow key={a.id} as="div" title={a.message} detail={`${a.location} · ${a.model_source}`} />)}
          </List>
        </Section>
      )}
    </div>
  );
}
