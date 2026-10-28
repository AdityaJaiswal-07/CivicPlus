import { useCallback, useEffect, useState } from "react";

import { errorMessage } from "../lib/api";
import Alert from "./Alert";
import PageStatus from "./PageStatus";

const card = { background: "white", border: "1px solid #e2ebe4", borderRadius: 14, padding: 22, boxShadow: "0 3px 12px rgba(20,83,45,0.04)" };
const input = { padding: 10, border: "1px solid #d5e1d7", borderRadius: 8, font: "inherit", minWidth: 0, background: "white" };
const th = { padding: 12, borderBottom: "1px solid #e2ebe4", whiteSpace: "nowrap", textAlign: "left" };
const td = { padding: 12, borderBottom: "1px solid #edf1ee" };
const btn = (bg = "#e5f3e8", color = "#166534") => ({ border: 0, borderRadius: 8, padding: "8px 12px", fontWeight: 600, cursor: "pointer", background: bg, color });
const ROLES = ["citizen", "worker", "staff", "admin"];

function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      setState({ loading: false, error: "", data: await fn() });
    } catch (err) {
      setState({ loading: false, error: errorMessage(err), data: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    load();
  }, [load]);
  return [state, load];
}

/* -------------------------------------------------------------- Users */
export function UsersPanel({ api, currentUserId }) {
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [state, reload] = useLoad(async () => api.list("/admin/users", { role, q, page, limit: 20 }), [api, role, q, page]);

  const change = async (user, kind) => {
    const reason = window.prompt(
      kind === "role" ? `New role for ${user.fullName || "this user"}? One of: ${ROLES.join(", ")}` : `Reason for ${user.isActive ? "deactivating" : "reactivating"} ${user.fullName || "this user"}:`,
      ""
    );
    if (reason === null) return;
    let body;
    if (kind === "role") {
      const newRole = reason.trim().toLowerCase();
      if (!ROLES.includes(newRole)) return setMsg({ type: "error", text: "Not a valid role." });
      const why = window.prompt("Reason for this change (kept in the audit log):", "");
      if (!why || !why.trim()) return setMsg({ type: "error", text: "A reason is required." });
      body = { role: newRole, reason: why.trim() };
    } else {
      if (!reason.trim()) return setMsg({ type: "error", text: "A reason is required." });
      body = { isActive: !user.isActive, reason: reason.trim() };
    }
    try {
      await api.patch(`/admin/users/${user.id}/${kind}`, body);
      setMsg({ type: "success", text: "User updated." });
      reload();
    } catch (err) {
      setMsg({ type: "error", text: errorMessage(err) });
    }
  };

  const users = state.data?.data ?? [];
  const total = state.data?.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 6px" }}>User management</h2>
      <p style={{ margin: "0 0 16px", color: "#64756b", fontSize: 14 }}>
        Public sign-up always creates citizens. Promote people to worker or staff here; every change is audited.
      </p>
      <Alert type={msg.type || "info"}>{msg.text}</Alert>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
        <input style={{ ...input, flex: "1 1 200px" }} placeholder="Search by name" aria-label="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select style={input} aria-label="Filter by role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {state.loading && <PageStatus loading message="Loading users…" />}
      {state.error && <PageStatus message={state.error} actionLabel="Try again" onAction={reload} />}
      {!state.loading && !state.error && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr style={{ background: "#f3f7f4" }}>{["Name", "Email", "Role", "Status", "Actions"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={td}>{u.fullName || "—"}</td>
                  <td style={td}>{u.email ?? "—"}</td>
                  <td style={td}>{u.role}</td>
                  <td style={td}>{u.isActive ? "Active" : "Deactivated"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {u.id === currentUserId ? <span style={{ color: "#758278" }}>You</span> : (
                      <>
                        <button style={btn()} onClick={() => change(u, "role")}>Change role</button>{" "}
                        <button style={btn(u.isActive ? "#fee2e2" : "#e5f3e8", u.isActive ? "#b91c1c" : "#166534")} onClick={() => change(u, "active")}>
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", padding: 30 }}>No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12 }}>
          <button style={btn()} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button style={btn()} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- Categories */
export function CategoriesPanel({ api }) {
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [form, setForm] = useState({ name: "", slug: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [state, reload] = useLoad(() => api.get("/categories", { includeInactive: "true" }), [api]);

  const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

  const create = async (e) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return setMsg({ type: "error", text: "Name must be at least 2 characters." });
    setBusy(true);
    try {
      await api.post("/categories", {
        name: form.name.trim(),
        slug: form.slug.trim() || slugify(form.name),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      });
      setForm({ name: "", slug: "", description: "" });
      setMsg({ type: "success", text: "Category added." });
      reload();
    } catch (err) {
      setMsg({ type: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const patch = async (c, body, success) => {
    try {
      await api.patch(`/categories/${c.id}`, body);
      setMsg({ type: "success", text: success });
      reload();
    } catch (err) {
      setMsg({ type: "error", text: errorMessage(err) });
    }
  };

  const rename = (c) => {
    const name = window.prompt("New name:", c.name);
    if (name && name.trim() && name.trim() !== c.name) patch(c, { name: name.trim() }, "Category renamed.");
  };

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 6px" }}>Categories</h2>
      <p style={{ margin: "0 0 16px", color: "#64756b", fontSize: 14 }}>Categories are never deleted; deactivate them to hide them from new reports.</p>
      <Alert type={msg.type || "info"}>{msg.text}</Alert>
      <form onSubmit={create} style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0 20px" }}>
        <input style={{ ...input, flex: "1 1 160px" }} placeholder="Name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Category name" />
        <input style={{ ...input, flex: "1 1 160px" }} placeholder="Description (optional)" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} aria-label="Category description" />
        <button type="submit" style={btn("#166534", "white")} disabled={busy}>{busy ? "Adding…" : "Add category"}</button>
      </form>
      {state.loading && <PageStatus loading message="Loading categories…" />}
      {state.error && <PageStatus message={state.error} actionLabel="Try again" onAction={reload} />}
      {state.data && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr style={{ background: "#f3f7f4" }}>{["Name", "Slug", "Status", "Actions"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {state.data.map((c) => (
                <tr key={c.id}>
                  <td style={td}>{c.name}</td>
                  <td style={td}>{c.slug}</td>
                  <td style={td}>{c.isActive ? "Active" : "Inactive"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button style={btn()} onClick={() => rename(c)}>Rename</button>{" "}
                    <button style={btn(c.isActive ? "#fee2e2" : "#e5f3e8", c.isActive ? "#b91c1c" : "#166534")} onClick={() => patch(c, { isActive: !c.isActive }, c.isActive ? "Category deactivated." : "Category activated.")}>
                      {c.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
              {state.data.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: "center", padding: 30 }}>No categories yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- Statistics */
export function StatsPanel({ api }) {
  const [days, setDays] = useState(30);
  const [state, reload] = useLoad(() => api.get("/dashboard/summary", { days }), [api, days]);
  const d = state.data;
  const stat = (label, value) => (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ color: "#64756b", fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#166534", marginTop: 4 }}>{value}</div>
    </div>
  );
  const maxDay = d ? Math.max(1, ...d.createdPerDay.map((x) => x.count)) : 1;

  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Statistics</h2>
        <select style={input} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {[7, 30, 90, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}
        </select>
      </div>
      {state.loading && <PageStatus loading message="Loading statistics…" />}
      {state.error && <PageStatus message={state.error} actionLabel="Try again" onAction={reload} />}
      {d && !state.loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            {stat("Open reports", d.totals.open)}
            {stat("Awaiting assignment", d.totals.awaitingAssignment)}
            {stat(`Created (${d.periodDays}d)`, d.createdInPeriod)}
            {stat(`Resolved (${d.periodDays}d)`, d.resolvedInPeriod)}
            {stat("Avg. resolution", d.avgResolutionHours == null ? "—" : `${Math.round(d.avgResolutionHours)} h`)}
            {stat("Needs reassignment", d.needsReassignment)}
          </div>

          <h3 style={{ margin: "0 0 8px" }}>Reports created per day</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 90, marginBottom: 20 }} role="img" aria-label="Reports created per day">
            {d.createdPerDay.map((x) => (
              <div key={x.date} title={`${x.date}: ${x.count}`} style={{ flex: 1, minWidth: 2, background: "#4ade80", height: `${(x.count / maxDay) * 100}%`, minHeight: x.count ? 3 : 1, opacity: x.count ? 1 : 0.3 }} />
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
            <div>
              <h3 style={{ margin: "0 0 8px" }}>By category</h3>
              {d.byCategory.map((c) => <div key={c.categoryId} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>{c.name}</span><span>{c.total} ({c.open} open)</span></div>)}
              {d.byCategory.length === 0 && <p style={{ color: "#758278" }}>No data yet.</p>}
            </div>
            <div>
              <h3 style={{ margin: "0 0 8px" }}>Top wards</h3>
              {d.topWards.map((w) => <div key={w.ward} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>{w.ward}</span><span>{w.total} ({w.open} open)</span></div>)}
              {d.topWards.length === 0 && <p style={{ color: "#758278" }}>No wards recorded.</p>}
            </div>
            <div>
              <h3 style={{ margin: "0 0 8px" }}>Worker workload</h3>
              {d.workerWorkload.map((w) => <div key={w.workerId} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>{w.fullName}</span><span>{w.openAssigned} open</span></div>)}
              {d.workerWorkload.length === 0 && <p style={{ color: "#758278" }}>No open assignments.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
