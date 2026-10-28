
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaBroom, FaClipboardList, FaCheckCircle } from "react-icons/fa";

import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import { STATUS_LABELS, formatDate, shortId } from "../lib/format";
import Alert from "../components/Alert";
import PageStatus from "../components/PageStatus";
import ReportDetailModal from "../components/ReportDetailModal";
import "../components/ReportDetailModal.css";

function WorkerDashboard() {
  const navigate = useNavigate();
  const { api, me, signOut } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({ assigned: 0, in_progress: 0, resolved: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [busyId, setBusyId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const name = me?.profile?.fullName || "Sanitation Worker";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [{ data }, c] = await Promise.all([
        api.list("/reports", { status: "assigned,in_progress", limit: 100, sort: "priority" }),
        api.get("/reports/counts"),
      ]);
      setTasks(data);
      setCounts(c.byStatus);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (task, status, text) => {
    setBusyId(task.id);
    setNotice({ type: "", text: "" });
    try {
      await api.patch(`/reports/${task.id}/status`, { status });
      setNotice({ type: "success", text: `${shortId(task.id)}: ${text}` });
      await load();
    } catch (err) {
      setNotice({ type: "error", text: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const logout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1>Worker Dashboard</h1>
          <p>Welcome, {name}</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={styles.badge}>Sanitation Worker</span>
          <button style={styles.link} onClick={logout}>Log out</button>
        </div>
      </header>

      <section style={styles.banner}>
        <FaBroom size={28} />
        <div>
          <h2>Keep your city clean!</h2>
          <p>View your assigned tasks and update your work progress.</p>
        </div>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <FaClipboardList color="#08775e" size={24} />
          <p>Assigned Tasks</p>
          <h2>{counts.assigned ?? 0}</h2>
        </article>

        <article style={styles.card}>
          <FaBroom color="#d98b22" size={24} />
          <p>Tasks In Progress</p>
          <h2>{counts.in_progress ?? 0}</h2>
        </article>

        <article style={styles.card}>
          <FaCheckCircle color="#168052" size={24} />
          <p>Completed Tasks</p>
          <h2>{counts.resolved ?? 0}</h2>
        </article>
      </section>

      <section style={styles.tasks}>
        <h2>My Assigned Tasks</h2>
        <Alert type={notice.type || "info"}>{notice.text}</Alert>
        {loading && <PageStatus loading message="Loading your tasks…" />}
        {!loading && error && <PageStatus message={error} actionLabel="Try again" onAction={load} />}
        {!loading && !error && tasks.length === 0 && <p>No tasks assigned yet.</p>}
        {!loading && !error && tasks.map((task) => (
          <div key={task.id} style={styles.task}>
            <div style={{ minWidth: 0, flex: "1 1 220px" }}>
              <strong style={{ overflowWrap: "anywhere" }}>{task.title}</strong>
              <div style={styles.meta}>
                {shortId(task.id)} · {task.addressText} · {formatDate(task.createdAt)} · {STATUS_LABELS[task.status]}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={styles.secondary} onClick={() => setSelectedId(task.id)}>Details</button>
              {task.status === "assigned" && (
                <button style={styles.primary} disabled={busyId === task.id} onClick={() => act(task, "in_progress", "work started.")}>
                  {busyId === task.id ? "Saving…" : "Start work"}
                </button>
              )}
              {task.status === "in_progress" && (
                <button style={styles.primary} disabled={busyId === task.id} onClick={() => act(task, "resolved", "marked as resolved.")}>
                  {busyId === task.id ? "Saving…" : "Mark resolved"}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      {selectedId && (
        <ReportDetailModal reportId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    padding: "32px",
    background: "#f5f8f6",
    color: "#1f2937",
    fontFamily: "Arial, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
    marginBottom: "28px",
  },
  badge: {
    padding: "10px 14px",
    borderRadius: "8px",
    background: "#e1f4eb",
    color: "#08775e",
    fontSize: "13px",
  },
  banner: {
    display: "flex",
    alignItems: "center",
    gap: "18px",
    padding: "24px",
    borderRadius: "12px",
    background: "#e5f6e9",
    color: "#08775e",
    marginBottom: "24px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "18px",
    marginBottom: "24px",
  },
  card: {
    padding: "24px",
    background: "#fff",
    border: "1px solid #e1eae3",
    borderRadius: "12px",
  },
  link: {
    border: "1px solid #08775e",
    background: "transparent",
    color: "#08775e",
    borderRadius: "8px",
    padding: "9px 14px",
    cursor: "pointer",
    fontWeight: 600,
  },
  task: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 0",
    borderTop: "1px solid #edf1ee",
  },
  meta: { color: "#758278", fontSize: "13px", marginTop: "4px", overflowWrap: "anywhere" },
  primary: { border: 0, borderRadius: "8px", padding: "10px 14px", background: "#08775e", color: "#fff", fontWeight: 600, cursor: "pointer" },
  secondary: { border: 0, borderRadius: "8px", padding: "10px 14px", background: "#e1f4eb", color: "#08775e", fontWeight: 600, cursor: "pointer" },
  tasks: {
    padding: "24px",
    background: "#fff",
    border: "1px solid #e1eae3",
    borderRadius: "12px",
  },
};

export default WorkerDashboard;
