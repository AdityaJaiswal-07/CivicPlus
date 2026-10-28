import { describe, it, expect, vi } from "vitest";
import { createApi, ApiError, errorMessage } from "./api";

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

describe("api client", () => {
  it("unwraps data, sends bearer token and joins array queries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { success: true, data: { a: 1 }, meta: { total: 1 } }));
    const api = createApi({ baseUrl: "http://x/api/v1", getToken: async () => "tok", fetchImpl });
    expect(await api.get("/reports", { status: ["submitted", "under_review"], q: "" })).toEqual({ a: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x/api/v1/reports?status=submitted%2Cunder_review");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("list returns data and meta; post sends JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { success: true, data: [1], meta: { total: 9 } }));
    const api = createApi({ baseUrl: "b", fetchImpl });
    expect(await api.list("/r")).toEqual({ data: [1], meta: { total: 9 } });
    await api.post("/r", { x: 1 });
    expect(fetchImpl.mock.calls[1][1].body).toBe('{"x":1}');
  });

  it("maps error envelope, field errors and calls onUnauthorized on 401 with token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(401, { success: false, error: { code: "UNAUTHORIZED", message: "no", details: [{ path: "title.x", message: "bad" }], requestId: "r1" } })
    );
    const onUnauthorized = vi.fn();
    const api = createApi({ baseUrl: "b", getToken: async () => "t", onUnauthorized, fetchImpl });
    const err = await api.get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.fieldErrors).toEqual({ title: "bad" });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("network failure becomes NETWORK_ERROR", async () => {
    const api = createApi({ baseUrl: "b", fetchImpl: async () => { throw new Error("down"); } });
    const err = await api.get("/x").catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(errorMessage(err)).toMatch(/Could not reach/);
  });

  it("errorMessage handles 429 and plain errors", () => {
    expect(errorMessage(new ApiError({ status: 429 }))).toMatch(/Too many/);
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
});
