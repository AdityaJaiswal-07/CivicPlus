import { useCallback, useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";

import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import { PRIORITY_LABELS, STATUS_LABELS, formatDateTime, shortId, statusTone } from "../lib/format";
import Alert from "./Alert";
import "./ReportDetailModal.css";

/**
 * Read-only report detail + timeline, shared by all portals.
 * `renderActions({ report, history, reload })` lets a portal add its own buttons.
 * The backend decides what each role may see (e.g. internal notes are staff-only).
 */
export default function ReportDetailModal({ reportId, onClose, onChanged, renderActions }) {
  const { api } = useAuth();
  const [state, setState] = useState({ loading: true, error: "", report: null, history: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const [report, history] = await Promise.all([
        api.get(`/reports/${reportId}`),
        api.get(`/reports/${reportId}/history`),
      ]);
      setState({ loading: false, error: "", report, history });
    } catch (err) {
      setState({ loading: false, error: errorMessage(err), report: null, history: [] });
    }
  }, [api, reportId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reload = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  const { loading, error, report, history } = state;

  return (
    <div className="rdm-backdrop" onClick={onClose}>
      <div className="rdm" role="dialog" aria-modal="true" aria-label="Report details" onClick={(e) => e.stopPropagation()}>
        <button className="rdm-close" onClick={onClose} aria-label="Close"><FaTimes /></button>

        {loading && !report && <p className="rdm-muted">Loading report…</p>}
        {error && <Alert type="error">{error}</Alert>}

        {report && (
          <>
            <p className="rdm-id">{shortId(report.id)}</p>
            <h2>{report.title}</h2>
            <div className="rdm-badges">
              <span className={`status-badge status-${statusTone(report.status)}`}>{STATUS_LABELS[report.status]}</span>
              {report.priority && <span className="rdm-chip">{PRIORITY_LABELS[report.priority]} priority</span>}
              {report.category && <span className="rdm-chip">{report.category.name}</span>}
            </div>

            <dl className="rdm-grid">
              <div><dt>Location</dt><dd>{report.addressText}{report.ward ? ` · Ward ${report.ward}` : ""}</dd></div>
              <div><dt>Submitted</dt><dd>{formatDateTime(report.createdAt)}</dd></div>
              {report.citizen?.fullName && <div><dt>Reported by</dt><dd>{report.citizen.fullName}</dd></div>}
              {report.resolvedAt && <div><dt>Resolved</dt><dd>{formatDateTime(report.resolvedAt)}</dd></div>}
            </dl>

            <h3>Description</h3>
            <p className="rdm-text">{report.description}</p>

            {report.photos?.length > 0 && (
              <>
                <h3>Photos</h3>
                <div className="rdm-photos">
                  {report.photos.map((p) =>
                    p.url ? (
                      <a key={p.path} href={p.url} target="_blank" rel="noopener noreferrer">
                        <img src={p.url} alt="Report attachment" loading="lazy" />
                      </a>
                    ) : (
                      <span key={p.path} className="rdm-muted">Photo temporarily unavailable</span>
                    )
                  )}
                </div>
              </>
            )}

            <h3>Timeline</h3>
            <ol className="rdm-timeline">
              {history.map((h) => (
                <li key={h.id} className={h.isInternal ? "internal" : ""}>
                  <strong>
                    {h.isInternal ? "Internal note" : h.oldStatus ? `${STATUS_LABELS[h.oldStatus]} → ${STATUS_LABELS[h.newStatus]}` : `Submitted`}
                  </strong>
                  <span className="rdm-muted">
                    {formatDateTime(h.createdAt)}{h.changedBy?.fullName ? ` · ${h.changedBy.fullName}` : ""}
                  </span>
                  {h.note && <p>{h.note}</p>}
                </li>
              ))}
              {history.length === 0 && <li className="rdm-muted">No updates yet.</li>}
            </ol>

            {renderActions?.({ report, history, reload })}
          </>
        )}
      </div>
    </div>
  );
}
