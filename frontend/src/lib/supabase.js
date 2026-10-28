import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

const REMEMBER_KEY = "civicplus-remember";

export function getRememberPreference() {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setRememberPreference(remember) {
  try {
    window.localStorage.setItem(REMEMBER_KEY, String(Boolean(remember)));
  } catch {
    /* storage blocked: session simply will not persist */
  }
}

/**
 * Browser Supabase client. Uses ONLY the public URL + anon key.
 * "Remember me" off => session kept in sessionStorage (gone when the tab closes).
 */
export function createSupabaseClient(remember) {
  if (!config.isConfigured) return null;
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: remember ? window.localStorage : window.sessionStorage,
    },
  });
}

/** Human-readable text for Supabase Auth errors. */
export function authErrorMessage(error) {
  const msg = String(error?.message ?? "");
  if (/invalid login credentials/i.test(msg)) return "Incorrect email or password.";
  if (/email not confirmed/i.test(msg)) return "Please verify your email address first. Check your inbox for the confirmation link.";
  if (/already registered|already exists/i.test(msg)) return "An account with this email already exists. Try logging in.";
  if (/password.*(short|least|weak)/i.test(msg)) return "Password is too weak. Use at least 8 characters.";
  if (/rate limit|too many/i.test(msg) || error?.status === 429) return "Too many attempts. Please wait a few minutes and try again.";
  if (/fetch|network/i.test(msg)) return "Could not reach the authentication service. Please try again.";
  return msg || "Something went wrong. Please try again.";
}
