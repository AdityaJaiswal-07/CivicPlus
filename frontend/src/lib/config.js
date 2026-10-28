// Public configuration only (Vite exposes VITE_* variables to the browser).
// NEVER put a Supabase service-role key or any other secret here.
const env = import.meta.env ?? {};

export const config = {
  apiBaseUrl: (env.VITE_API_BASE_URL || "http://localhost:4000/api/v1").replace(/\/$/, ""),
  supabaseUrl: env.VITE_SUPABASE_URL || "",
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || "",
};

config.isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
