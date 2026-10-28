
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaLeaf,
  FaThLarge,
  FaClipboardList,
  FaMapMarkerAlt,
  FaUserCircle,
  FaSignOutAlt,
  FaPlus,
  FaSearch,
  FaBell,
  FaBars,
  FaCheckCircle,
  FaClock,
  FaSyncAlt,
  FaExclamationCircle,
  FaArrowRight,
  FaTimesCircle,
} from "react-icons/fa";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import {
  STATUS_FILTERS,
  STATUS_LABELS,
  formatDate,
  rollUpCounts,
  shortId,
  statusTone,
  statusesForFilter,
} from "../lib/format";
import Alert from "../components/Alert";
import PageStatus from "../components/PageStatus";
import ReportDetailModal from "../components/ReportDetailModal";
import "../components/ReportDetailModal.css";
import "./CitizenDashboard.css";

const PAGE_SIZE = 10;

function StatusIcon({ status }) {
  const tone = statusTone(status);
  if (tone === "pending") return <FaExclamationCircle />;
  if (tone === "progress") return <FaSyncAlt />;
  if (tone === "resolved") return <FaCheckCircle />;
  return <FaTimesCircle />;
}

function CitizenDashboard() {
  const navigate = useNavigate();
  const { api, me, signOut } = useAuth();
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ total: 0, pending: 0, progress: 0, resolved: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  const name = me?.profile?.fullName || me?.email?.split("@")[0] || "Citizen";

  // Debounce the search box so we don't call the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadCounts = useCallback(async () => {
    try {
      const data = await api.get("/reports/counts");
      setCounts(rollUpCounts(data.byStatus));
    } catch {
      /* the list shows the error; counts just stay as they were */
    }
  }, [api]);

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

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const refresh = () => {
    loadReports();
    loadCounts();
  };

  const logout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="citizen-app">
      <aside className={`citizen-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="citizen-brand">
          <span className="citizen-brand-icon">
            <FaLeaf />
          </span>
          <span>CivicPlus<span className="brand-plus">+</span></span>
        </div>

        <p className="sidebar-label">MAIN MENU</p>

        <nav className="sidebar-nav">
          <a href="#dashboard" className="sidebar-link active">
            <FaThLarge /> <span>Dashboard</span>
          </a>
          <a href="#reports" className="sidebar-link" onClick={() => setSidebarOpen(false)}>
            <FaClipboardList /> <span>My Reports</span>
          </a>
          <a href="#reports" className="sidebar-link" onClick={() => setSidebarOpen(false)}>
            <FaMapMarkerAlt /> <span>Track Complaints</span>
          </a>
        </nav>

        <p className="sidebar-label account-label">ACCOUNT</p>

        <nav className="sidebar-nav">
          <button
            type="button"
            className="sidebar-link"
            onClick={() => { setShowProfile(true); setSidebarOpen(false); }}
          >
            <FaUserCircle /> <span>My Profile</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <FaLeaf />
            <strong>Keep your city clean!</strong>
            <p>Your small action makes a big difference.</p>
          </div>

          <button className="sidebar-logout" onClick={logout}>
            <FaSignOutAlt /> Logout
          </button>
        </div>
      </aside>

      <main className="citizen-main" id="dashboard">
        <header className="citizen-topbar">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            <FaBars />
          </button>

          <div className="topbar-breadcrumb">
            <span>Home</span>
            <span>/</span>
            <strong>Dashboard</strong>
          </div>

          <div className="topbar-right">
            <button
              className="notification-button"
              aria-label="Refresh reports"
              onClick={refresh}
              title="Refresh"
            >
              <FaBell />
            </button>
            <div className="topbar-user">
              <div className="user-avatar">{name.charAt(0).toUpperCase()}</div>
              <div className="user-details">
                <strong>{name}</strong>
                <span>Citizen Account</span>
              </div>
            </div>
          </div>
        </header>

        <div className="citizen-content">
          <section className="welcome-section">
            <div>
              <p className="welcome-eyebrow">CITIZEN PORTAL</p>
              <h1>Welcome back, {name}! <span>👋</span></h1>
              <p className="welcome-description">
                Together, let's make our city cleaner, greener and healthier.
              </p>
            </div>

            <button
              className="report-primary-button"
              onClick={() => navigate("/citizen/report")}
            >
              <FaPlus /> Report an Issue
            </button>
          </section>

          <section className="impact-banner">
            <div className="impact-icon"><FaLeaf /></div>
            <div>
              <h2>Your voice matters!</h2>
              <p>
                Reporting local waste problems helps your municipality take action.
              </p>
            </div>
            <span className="impact-decoration">♻</span>
          </section>

          <section className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon stat-green"><FaClipboardList /></div>
              <p>Total Reports</p>
              <h2>{counts.total}</h2>
              <span className="stat-caption">All your submitted reports</span>
            </div>

            <div className="stat-card">
              <div className="stat-icon stat-orange"><FaClock /></div>
              <p>Pending</p>
              <h2>{counts.pending}</h2>
              <span className="stat-caption">Awaiting action</span>
            </div>

            <div className="stat-card">
              <div className="stat-icon stat-blue"><FaSyncAlt /></div>
              <p>In Progress</p>
              <h2>{counts.progress}</h2>
              <span className="stat-caption">Currently being handled</span>
            </div>

            <div className="stat-card">
              <div className="stat-icon stat-purple"><FaCheckCircle /></div>
              <p>Resolved</p>
              <h2>{counts.resolved}</h2>
              <span className="stat-caption">Successfully completed</span>
            </div>
          </section>

          <section className="reports-panel" id="reports">
            <div className="reports-heading">
              <div>
                <h2>Recent Reports</h2>
                <p>Keep track of the issues you've reported.</p>
              </div>

              <button
                className="view-all-button"
                onClick={() => {
                  setFilter("All");
                  setSearch("");
                  setPage(1);
                }}
              >
                Reset filters <FaArrowRight />
              </button>
            </div>

            <div className="report-toolbar">
              <div className="report-search">
                <FaSearch />
                <input
                  type="text"
                  placeholder="Search reports or locations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select
                value={filter}
                onChange={(e) => { setFilter(e.target.value); setPage(1); }}
                aria-label="Filter reports by status"
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div className="reports-list">
              <div className="report-table-header">
                <span>REPORT DETAILS</span>
                <span>DATE</span>
                <span>STATUS</span>
              </div>

              {loading && <PageStatus loading message="Loading your reports…" />}
              {!loading && error && <PageStatus message={error} actionLabel="Try again" onAction={loadReports} />}

              {!loading && !error && reports.map((report) => (
                <div
                  className="report-row"
                  key={report.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(report.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedId(report.id)}
                >
                  <div className="report-info">
                    <div className="report-location-icon">
                      <FaMapMarkerAlt />
                    </div>
                    <div>
                      <strong>{report.title}</strong>
                      <span>{shortId(report.id)} · {report.addressText}</span>
                    </div>
                  </div>

                  <span className="report-date">{formatDate(report.createdAt)}</span>

                  <span className={`status-badge status-${statusTone(report.status)}`}>
                    <StatusIcon status={report.status} />
                    {STATUS_LABELS[report.status]}
                  </span>
                </div>
              ))}

              {!loading && !error && reports.length === 0 && (
                <div className="reports-empty">
                  {query || filter !== "All"
                    ? "No reports match your search."
                    : "You haven't reported anything yet. Use “Report an Issue” to get started."}
                </div>
              )}
            </div>

            {pages > 1 && (
              <div className="reports-pager">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {page} of {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}

            <div className="reports-footer">
              Showing {reports.length} of {total} reports
            </div>
          </section>

          <footer className="citizen-footer">
            <span>© {new Date().getFullYear()} CivicPlus+ · Building cleaner communities together.</span>
            <span>Made for a cleaner tomorrow <FaLeaf /></span>
          </footer>
        </div>
      </main>

      {selectedId && (
        <ReportDetailModal
          reportId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
          renderActions={({ report, reload }) => (
            <CitizenActions report={report} reload={reload} api={api} />
          )}
        />
      )}

      {showProfile && (
        <div className="rdm-backdrop" onClick={() => setShowProfile(false)}>
          <div className="rdm" role="dialog" aria-modal="true" aria-label="My profile" onClick={(e) => e.stopPropagation()}>
            <h2>My Profile</h2>
            <dl className="rdm-grid">
              <div><dt>Name</dt><dd>{me?.profile?.fullName || "—"}</dd></div>
              <div><dt>Email</dt><dd>{me?.email}</dd></div>
              <div><dt>Account type</dt><dd>Citizen</dd></div>
              <div><dt>Email verified</dt><dd>{me?.emailVerified ? "Yes" : "Not yet"}</dd></div>
            </dl>
            <div className="rdm-actions">
              <button onClick={() => setShowProfile(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Citizens may cancel their own report only while it is still "submitted" (the backend enforces this too). */
function CitizenActions({ report, reload, api }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (report.status !== "submitted") return null;

  const cancel = async () => {
    if (!window.confirm("Cancel this report? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/reports/${report.id}/cancel`, {});
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Alert type="error">{error}</Alert>
      <div className="rdm-actions">
        <button className="danger" onClick={cancel} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel report"}
        </button>
      </div>
    </>
  );
}

export default CitizenDashboard;
