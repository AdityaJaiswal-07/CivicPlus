import { useEffect, useState } from "react";

import { errorMessage } from "../lib/api";
import { PRIORITY_LABELS } from "../lib/format";
import Alert from "./Alert";

const ASSIGNABLE = ["submitted", "under_review", "assigned", "in_progress"];
const field = { width: "100%", padding: 10, border: "1px solid #d5e1d7", borderRadius: 8, background: "white", boxSizing: "border-box", font: "inherit" };

/**
 * Staff/admin controls shown inside the report detail dialog.
 * The UI only offers sensible actions; the backend/database re-check every rule.
 */
export default function StaffActions({ report, api, reload }) {
  const [workers, setWorkers] = useState([]);
  const [workerId, setWorkerId] = useState("");
  const [assignNote, setAssignNote] = useState("");
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const canAssign = ASSIGNABLE.includes(report.status);

  useEffect(() => {
    if (!canAssign) return;
    let alive = true;
    api
      .get("/admin/users", { role: "worker", isActive: "true", limit: 100 })
      .then((list) => alive && setWorkers(list))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [api, canAssign]);

  const run = async (fn, success) => {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await fn();
      setOk(success);
      await reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const needNote = (label) => {
    if (note.trim().length < 3) {
      setError(`Please add a note explaining why you are ${label}.`);
      return false;
    }
    return true;
  };

  const setStatus = (status, success, requireNote) => {
    if (requireNote && !needNote(requireNote)) return;
    run(async () => {
      await api.patch(`/reports/${report.id}/status`, { status, ...(note.trim() ? { note: note.trim() } : {}) });
      setNote("");
    }, success);
  };

  const assign = () => {
    if (!workerId) return setError("Please choose a worker.");
    run(async () => {
      await api.post(`/reports/${report.id}/assign`, { workerId, ...(assignNote.trim() ? { note: assignNote.trim() } : {}) });
      setAssignNote("");
      setWorkerId("");
    }, report.status === "assigned" || report.status === "in_progress" ? "Report reassigned." : "Worker assigned.");
  };

  const addInternal = async () => {
    if (!internal.trim()) return setError("Write a note first.");
    await run(async () => {
      await api.post(`/reports/${report.id}/internal-notes`, { note: internal.trim() });
      setInternal("");
    }, "Internal note added (visible to staff only).");
  };

  const btn = (bg, color = "white") => ({ border: 0, borderRadius: 8, padding: "10px 14px", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.65 : 1, background: bg, color });
  const label = { display: "block", margin: "16px 0 6px", fontWeight: 600, fontSize: 14 };

  return (
    <div style={{ marginTop: 20, borderTop: "1px solid #e2ebe4", paddingTop: 4 }}>
      <Alert type="error">{error}</Alert>
      <Alert type="success">{ok}</Alert>

      {report.needsReassignment && (
        <Alert type="error">
          The assigned worker is no longer active. Please reassign this report.
        </Alert>
      )}

      <label style={label} htmlFor="mr-priority">Priority</label>
      <select
        id="mr-priority"
        style={field}
        value={report.priority}
        disabled={busy || ["rejected", "cancelled"].includes(report.status)}
        onChange={(e) => run(() => api.patch(`/reports/${report.id}/priority`, { priority: e.target.value }), "Priority updated.")}
      >
        {Object.entries(PRIORITY_LABELS).map(([value, text]) => (
          <option key={value} value={value}>{text}</option>
        ))}
      </select>

      {canAssign && (
        <>
          <label style={label} htmlFor="mr-worker">
            {report.status === "assigned" || report.status === "in_progress" ? `Reassign (currently ${report.assignment?.workerName ?? "assigned"})` : "Assign to worker"}
          </label>
          <select id="mr-worker" style={field} value={workerId} onChange={(e) => setWorkerId(e.target.value)} disabled={busy}>
            <option value="">{workers.length ? "Select a worker" : "No active workers available"}</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>{w.fullName || w.id.slice(0, 8)}</option>
            ))}
          </select>
          <input style={{ ...field, marginTop: 8 }} placeholder="Note for the worker (optional)" maxLength={500} value={assignNote} onChange={(e) => setAssignNote(e.target.value)} />
          <button style={{ ...btn("#166534"), marginTop: 8 }} disabled={busy || !workerId} onClick={assign}>
            {busy ? "Saving…" : report.status === "assigned" || report.status === "in_progress" ? "Reassign" : "Assign"}
          </button>
        </>
      )}

      {["submitted", "under_review", "resolved"].includes(report.status) && (
        <>
          <label style={label} htmlFor="mr-note">Note (required to reject or reopen)</label>
          <textarea id="mr-note" rows={2} maxLength={500} style={field} value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {report.status === "submitted" && (
              <button style={btn("#1d4ed8")} disabled={busy} onClick={() => setStatus("under_review", "Moved to review.")}>Start review</button>
            )}
            {["submitted", "under_review"].includes(report.status) && (
              <button style={btn("#b91c1c")} disabled={busy} onClick={() => setStatus("rejected", "Report rejected.", "rejecting this report")}>Reject</button>
            )}
            {report.status === "resolved" && (
              <button style={btn("#a16207")} disabled={busy} onClick={() => setStatus("under_review", "Report reopened.", "reopening this report")}>Reopen</button>
            )}
          </div>
        </>
      )}

      <label style={label} htmlFor="mr-internal">Internal note (staff only — citizens never see this)</label>
      <textarea id="mr-internal" rows={2} maxLength={500} style={field} value={internal} onChange={(e) => setInternal(e.target.value)} />
      <button style={{ ...btn("#e5f3e8", "#166534"), marginTop: 8 }} disabled={busy || !internal.trim()} onClick={addInternal}>Add internal note</button>
    </div>
  );
}

