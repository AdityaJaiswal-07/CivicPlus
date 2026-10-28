import { describe, it, expect } from "vitest";
import * as f from "./format";

describe("format helpers", () => {
  it("shortId is CP- + 8 uppercase hex", () => {
    expect(f.shortId("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe("CP-3FA85F64");
  });
  it("status filters map to backend statuses", () => {
    expect(f.statusesForFilter("Pending")).toBe("submitted,under_review");
    expect(f.statusesForFilter("In Progress")).toBe("assigned,in_progress");
  });
  it("rollUpCounts groups statuses", () => {
    const c = f.rollUpCounts({ submitted: 2, under_review: 1, assigned: 1, in_progress: 2, resolved: 4, rejected: 1, cancelled: 0 });
    expect(c).toMatchObject({ total: 11, pending: 3, progress: 3, resolved: 4, rejected: 1 });
  });
  it("portal rules: staff portal admits staff+admin only", () => {
    expect(f.portalAllows("staff", "admin")).toBe(true);
    expect(f.portalAllows("staff", "citizen")).toBe(false);
    expect(f.portalAllows("worker", "worker")).toBe(true);
    expect(f.roleHome("admin")).toBe("/staff/dashboard");
    expect(f.roleHome("worker")).toBe("/worker/dashboard");
  });
  it("normal priority is shown as Medium", () => {
    expect(f.PRIORITY_LABELS.normal).toBe("Medium");
  });
});
