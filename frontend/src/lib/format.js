// Presentation helpers shared by all dashboards.

export const STATUS_LABELS = {
  submitted: "Pending",
  under_review: "Under Review",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** CSS class suffix for the existing badge styles (pending / progress / resolved) plus rejected / cancelled. */
export function statusTone(status) {
  if (status === "submitted" || status === "under_review") return "pending";
  if (status === "assigned" || status === "in_progress") return "progress";
  if (status === "resolved") return "resolved";
  return status === "rejected" ? "rejected" : "cancelled";
}

/** Filters the dashboards offer: label -> backend status list (comma separated). */
export const STATUS_FILTERS = [
  { label: "All Statuses", value: "All", statuses: undefined },
  { label: "Pending", value: "Pending", statuses: "submitted,under_review" },
  { label: "In Progress", value: "In Progress", statuses: "assigned,in_progress" },
  { label: "Resolved", value: "Resolved", statuses: "resolved" },
  { label: "Rejected", value: "Rejected", statuses: "rejected" },
  { label: "Cancelled", value: "Cancelled", statuses: "cancelled" },
];

export function statusesForFilter(value) {
  return STATUS_FILTERS.find((f) => f.value === value)?.statuses;
}

/** Roll the 7 backend statuses up into the 3 headline numbers the dashboards show. */
export function rollUpCounts(byStatus = {}) {
  const n = (k) => byStatus[k] ?? 0;
  return {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    pending: n("submitted") + n("under_review"),
    progress: n("assigned") + n("in_progress"),
    resolved: n("resolved"),
    rejected: n("rejected"),
    cancelled: n("cancelled"),
  };
}

export const PRIORITY_LABELS = { low: "Low", normal: "Medium", high: "High", urgent: "Urgent" };
export const PRIORITY_COLORS = { low: "#15803d", normal: "#a16207", high: "#b91c1c", urgent: "#7f1d1d" };

/** Short display ID derived from the UUID, e.g. CP-1A2B3C4D. */
export function shortId(id) {
  return id ? `CP-${String(id).replace(/-/g, "").slice(0, 8).toUpperCase()}` : "";
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Which portal a role belongs to, and where its home page is. */
export function roleHome(role) {
  if (role === "worker") return "/worker/dashboard";
  if (role === "staff" || role === "admin") return "/staff/dashboard";
  return "/citizen/dashboard";
}

export function loginPathFor(portal) {
  return `/${portal}/login`;
}

/** Portals: citizen -> citizen, worker -> worker, staff -> staff + admin. */
export function portalAllows(portal, role) {
  if (portal === "citizen") return role === "citizen";
  if (portal === "worker") return role === "worker";
  if (portal === "staff") return role === "staff" || role === "admin";
  return false;
}

export function portalName(portal) {
  return portal === "staff" ? "Municipality Staff" : portal === "worker" ? "Sanitation Worker" : "Citizen";
}
