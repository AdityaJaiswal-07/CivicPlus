import "./PageStatus.css";

/** Full-page loading / error / empty message that matches the existing look. */
export default function PageStatus({ loading = false, message, actionLabel, onAction }) {
  return (
    <div className="page-status" role={loading ? "status" : "alert"}>
      {loading && <span className="page-status-spinner" aria-hidden="true" />}
      <p>{message}</p>
      {actionLabel && (
        <button type="button" className="page-status-button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
