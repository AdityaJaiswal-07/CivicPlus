// Small fetch wrapper for the CivicPlus+ backend.
// Unwraps the { success, data, meta } envelope and turns errors into ApiError.

export class ApiError extends Error {
  constructor({ status = 0, code = "ERROR", message = "Something went wrong", details, requestId } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** { fieldName: "message" } from backend validation details ([{ path, message }]). */
  get fieldErrors() {
    const out = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details) {
        const key = String(d?.path ?? "").split(".")[0];
        if (key && !out[key]) out[key] = d.message;
      }
    }
    return out;
  }
}

function buildQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function createApi({ baseUrl, getToken, onUnauthorized, fetchImpl }) {
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));

  async function request(method, path, { query, body } = {}) {
    const headers = { Accept: "application/json" };
    const token = getToken ? await getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await doFetch(`${baseUrl}${path}${buildQuery(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "Could not reach the server. Please check your connection and try again.",
      });
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (res.ok && payload?.success) return { data: payload.data, meta: payload.meta };

    const err = payload?.error ?? {};
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    throw new ApiError({
      status: res.status,
      code: err.code ?? (res.status === 429 ? "RATE_LIMITED" : "ERROR"),
      message: err.message ?? "Something went wrong. Please try again.",
      details: err.details,
      requestId: err.requestId,
    });
  }

  return {
    request,
    get: async (path, query) => (await request("GET", path, { query })).data,
    list: (path, query) => request("GET", path, { query }),
    post: async (path, body) => (await request("POST", path, { body: body ?? {} })).data,
    patch: async (path, body) => (await request("PATCH", path, { body: body ?? {} })).data,
  };
}

/** Friendly one-line message for any error. */
export function errorMessage(err) {
  if (err instanceof ApiError) {
    if (err.status === 429) return "Too many requests. Please wait a moment and try again.";
    if (err.status === 503) return "The service is temporarily unavailable. Please try again shortly.";
    if (err.status === 500) return "Something went wrong on our side. Please try again.";
    return err.message;
  }
  return err?.message || "Something went wrong. Please try again.";
}
