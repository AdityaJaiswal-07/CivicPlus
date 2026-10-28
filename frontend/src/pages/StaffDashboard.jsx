
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
  formatDate,
  rollUpCounts,
  shortId,
  statusesForFilter,
  statusTone,
} from "../lib/format";
import PageStatus from "../components/PageStatus";
import ReportDetailModal from "../components/ReportDetailModal";
import "../components/ReportDetailModal.css";
import StaffActions from "../components/StaffActions";
import { CategoriesPanel, StatsPanel, UsersPanel } from "../components/AdminPanels";

const statusColors = {
  pending: { bg: "#fff1d6", color: "#a16207" },
  progress: { bg: "#dbeafe", color: "#1d4ed8" },
  resolved: { bg: "#dcfce7", color: "#15803d" },
  rejected: { bg: "#fee2e2", color: "#b91c1c" },
  cancelled: { bg: "#e2e8f0", color: "#475569" },
};

const PAGE_SIZE = 20;

function csvCell(value) {
  let text = String(value ?? "");
  // Neutralise spreadsheet formulas in user-supplied text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export default function StaffDashboard() {
  const navigate = useNavigate();
  const { api, me, role, signOut } = useAuth();
  const isAdmin = role === "admin";

  const [tab, setTab] = useState("reports");
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ total: 0, pending: 0, progress: 0, resolved: 0 });
  const [review, setReview] = useState({ loading: false, error: "", items: [] });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const name = me?.profile?.fullName || me?.email || "Staff";

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, meta } = await api.list("/reports", {
        status: statusesForFilter(filter),
        q: query,
        page,
        limit: PAGE_SIZE,
      });
      setReports(data);
      setTotal(meta?.total ?? data.length);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, filter, query, page]);

  const loadCounts = useCallback(async () => {
    try {
      setCounts(rollUpCounts((await api.get("/reports/counts")).byStatus));
    } catch {
      /* the list reports the error */
    }
  }, [api]);

  const loadReview = useCallback(async () => {
    setReview((r) => ({ ...r, loading: true, error: "" }));
    try {
      const { data } = await api.list("/reports/needs-reassignment", { limit: 100 });
      setReview({ loading: false, error: "", items: data });
    } catch (err) {
      setReview({ loading: false, error: errorMessage(err), items: [] });
    }
  }, [api]);

  useEffect(() => { loadReports(); }, [loadReports]);
  useEffect(() => { loadCounts(); loadReview(); }, [loadCounts, loadReview]);

  const refresh = () => {
    loadReports();
    loadCounts();
    loadReview();
  };

  const logout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const exportCsv = () => {
    const rows = [
      ["ID", "Issue", "Location", "Citizen", "Date", "Priority", "Assigned to", "Status"],
      ...reports.map((r) => [
        shortId(r.id), r.title, r.addressText, r.citizen?.fullName ?? "",
        formatDate(r.createdAt), PRIORITY_LABELS[r.priority], r.assignedWorker?.fullName ?? "",
        STATUS_LABELS[r.status],
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "civicplus-reports.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const styles = {
    page: {
      minHeight: "100vh",
      background: "#f3f7f4",
      color: "#18352a",
      fontFamily: "Arial, sans-serif",
    },
    header: {
      background: "#14532d",
      color: "white",
      padding: "20px 5%",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 16,
      flexWrap: "wrap",
    },
    content: {
      maxWidth: 1250,
      margin: "0 auto",
      padding: "30px 20px",
    },
    card: {
      background: "white",
      border: "1px solid #e2ebe4",
      borderRadius: 14,
      padding: 22,
      boxShadow: "0 3px 12px rgba(20,83,45,0.04)",
    },
    button: {
      border: "none",
      borderRadius: 8,
      padding: "10px 14px",
      cursor: "pointer",
      fontWeight: 600,
    },
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            CIVICPLUS · STAFF PORTAL
          </div>
          <h1 style={{ margin: "7px 0", fontSize: 26 }}>
            Staff Dashboard
          </h1>
          <div style={{ fontSize: 14 }}>
            Manage public waste complaints and cleanup activities.
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14 }}>{name}</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 5 }}>
            {isAdmin ? "Administrator" : "Municipal staff"}
          </div>
          <button
            onClick={logout}
            style={{ ...styles.button, marginTop: 10, background: "rgba(255,255,255,0.15)", color: "white" }}
          >
            Log out
          </button>
        </div>
      </header>

      <main style={styles.content}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ marginBottom: 6 }}>Overview</h2>
          <p style={{ margin: 0, color: "#64756b" }}>
            Monitor reports and keep your city clean.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 16,
            marginBottom: 28,
          }}
        >
          {[
            { label: "Total Reports", value: counts.total, icon: "📋", color: "#166534" },
            { label: "Pending", value: counts.pending, icon: "⏳", color: "#b45309" },
            { label: "In Progress", value: counts.progress, icon: "🚛", color: "#1d4ed8" },
            { label: "Resolved", value: counts.resolved, icon: "✅", color: "#15803d" },
          ].map((item) => (
            <div key={item.label} style={styles.card}>
              <div style={{ fontSize: 25 }}>{item.icon}</div>
              <div style={{ color: "#64756b", marginTop: 12, fontSize: 14 }}>
                {item.label}
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: item.color,
                  marginTop: 5,
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {[
            ["reports", "Reports"],
            ["review", `Needs reassignment${review.items.length ? ` (${review.items.length})` : ""}`],
            ...(isAdmin ? [["users", "Users"], ["categories", "Categories"], ["stats", "Statistics"]] : []),
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              style={{
                ...styles.button,
                background: tab === key ? "#166534" : "white",
                color: tab === key ? "white" : "#166534",
                border: "1px solid #cfe0d3",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "reports" && (
        <section style={styles.card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 15,
              marginBottom: 20,
            }}
          >
            <div>
              <h2 style={{ margin: "0 0 6px" }}>Citizen Reports</h2>
              <p style={{ margin: 0, color: "#64756b", fontSize: 14 }}>
                Search reports and update their progress.
              </p>
            </div>

            <button
              style={{
                ...styles.button,
                background: "#166534",
                color: "white",
              }}
              onClick={exportCsv}
            >
              ↓ Export CSV (this page)
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search issue or location..."
              aria-label="Search reports"
              style={{
                padding: 12,
                border: "1px solid #d5e1d7",
                borderRadius: 8,
                minWidth: 0,
                fontSize: 14,
              }}
            />

            <select
              value={filter}
              onChange={(event) => { setFilter(event.target.value); setPage(1); }}
              aria-label="Filter by status"
              style={{
                padding: 12,
                border: "1px solid #d5e1d7",
                borderRadius: 8,
                background: "white",
                fontSize: 14,
              }}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {loading && <PageStatus loading message="Loading reports…" />}
          {!loading && error && <PageStatus message={error} actionLabel="Try again" onAction={loadReports} />}

          {!loading && !error && (<div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ background: "#f3f7f4" }}>
                  {["Report", "Location", "Citizen", "Priority", "Assigned to", "Status", "Action"].map(
                    (heading) => (
                      <th
                        key={heading}
                        style={{
                          padding: 13,
                          borderBottom: "1px solid #e2ebe4",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>

              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td style={{ padding: 13, borderBottom: "1px solid #edf1ee" }}>
                      <strong>{report.title}</strong>
                      <div style={{ color: "#758278", marginTop: 5 }}>
                        {shortId(report.id)} · {formatDate(report.createdAt)}
                      </div>
                    </td>

                    <td style={{ padding: 13, borderBottom: "1px solid #edf1ee" }}>
                      {report.addressText}
                    </td>

                    <td style={{ padding: 13, borderBottom: "1px solid #edf1ee" }}>
                      {report.citizen?.fullName ?? "—"}
                    </td>

                    <td style={{ padding: 13, borderBottom: "1px solid #edf1ee" }}>
                      <span
                        style={{
                          color: PRIORITY_COLORS[report.priority],
                          fontWeight: 600,
                        }}
                      >
                        {PRIORITY_LABELS[report.priority]}
                      </span>
                    </td>

                    <td style={{ padding: 13, borderBottom: "1px solid #edf1ee" }}>
                      {report.assignedWorker?.fullName ?? "—"}
                    </td>

                    <td style={{ padding: 13, borderBottom: "1px solid #edf1ee" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "6px 9px",
                          borderRadius: 20,
                          whiteSpace: "nowrap",
                          background: statusColors[statusTone(report.status)].bg,
                          color: statusColors[statusTone(report.status)].color,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {STATUS_LABELS[report.status]}
                      </span>
                    </td>

                    <td style={{ padding: 13, borderBottom: "1px solid #edf1ee" }}>
                      <button
                        onClick={() => setSelectedId(report.id)}
                        style={{
                          ...styles.button,
                          background: "#e5f3e8",
                          color: "#166534",
                        }}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}

                {reports.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 30, textAlign: "center" }}>
                      No reports found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>)}

          {pages > 1 && (
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 14 }}>
              <button style={{ ...styles.button, background: "#e5f3e8", color: "#166534" }} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span style={{ alignSelf: "center" }}>Page {page} of {pages}</span>
              <button style={{ ...styles.button, background: "#e5f3e8", color: "#166534" }} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}

          <div style={{ marginTop: 14, color: "#64756b", fontSize: 13 }}>
            Showing {reports.length} of {total} reports
          </div>
        </section>

        )}
        {tab === "review" && (
        <section style={styles.card}>
          <h2 style={{ margin: "0 0 6px" }}>Needs reassignment</h2>
          <p style={{ margin: "0 0 16px", color: "#64756b", fontSize: 14 }}>
            Open reports whose worker is no longer active. Nothing is reassigned automatically.
          </p>
          {review.loading && <PageStatus loading message="Loading…" />}
          {review.error && <PageStatus message={review.error} actionLabel="Try again" onAction={loadReview} />}
          {!review.loading && !review.error && review.items.map((item) => (
            <div key={item.reportId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 0", borderBottom: "1px solid #edf1ee" }}>
              <div>
                <strong>{item.title}</strong>
                <div style={{ color: "#758278", marginTop: 4, fontSize: 13 }}>
                  {shortId(item.reportId)} · {item.addressText} · Worker: {item.worker?.fullName ?? "unknown"} ({item.reason === "worker_deactivated" ? "deactivated" : "role changed"})
                </div>
              </div>
              <button style={{ ...styles.button, background: "#e5f3e8", color: "#166534" }} onClick={() => setSelectedId(item.reportId)}>Reassign</button>
            </div>
          ))}
          {!review.loading && !review.error && review.items.length === 0 && (
            <p style={{ textAlign: "center", color: "#64756b", padding: 20 }}>All open reports have an active worker. 🎉</p>
          )}
        </section>
        )}
        {isAdmin && tab === "users" && <UsersPanel api={api} currentUserId={me?.id} />}
        {isAdmin && tab === "categories" && <CategoriesPanel api={api} />}
        {isAdmin && tab === "stats" && <StatsPanel api={api} />}

        <footer
          style={{
            textAlign: "center",
            color: "#718076",
            fontSize: 13,
            padding: "25px 0 10px",
          }}
        >
          © {new Date().getFullYear()} CivicPlus · Building a cleaner and greener city
        </footer>
      </main>

      {selectedId && (
        <ReportDetailModal
          reportId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
          renderActions={({ report, reload }) => (
            <StaffActions report={report} api={api} reload={reload} />
          )}
        />
      )}
    </div>
  );
}
