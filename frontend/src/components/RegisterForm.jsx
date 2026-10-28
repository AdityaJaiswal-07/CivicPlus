import { useState } from "react";
import { Link } from "react-router-dom";
import { FaEnvelope, FaLock, FaUser } from "react-icons/fa";

import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import Alert from "./Alert";
import "./LoginForm.css";

/** Citizen self-registration. Staff/worker accounts are created by administrators, never here. */
export default function RegisterForm() {
  const auth = useAuth();
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.fullName.trim().length < 2) return setError("Please enter your full name.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (form.password !== form.confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      setDone(await auth.signUp(form));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">📍</div>
          <h1>Create Citizen Account</h1>
          <p>Report waste issues and track their progress</p>
        </div>

        {!auth.configured && (
          <Alert type="error">The app is not configured yet: Supabase settings are missing. See .env.example.</Alert>
        )}

        {done ? (
          <>
            <Alert type="success">
              {done.needsEmailVerification
                ? "Account created! We sent a confirmation link to your email. Open it to verify your address, then log in."
                : "Account created! You can now log in."}
            </Alert>
            <Link to="/citizen/login" className="login-button" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
              Go to login
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <Alert type="error">{error}</Alert>

            <div className="form-group">
              <label htmlFor="reg-name">Full name</label>
              <div className="input-wrapper">
                <FaUser />
                <input id="reg-name" type="text" placeholder="Enter your full name" autoComplete="name" maxLength={100} value={form.fullName} onChange={set("fullName")} required />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reg-email">Email Address</label>
              <div className="input-wrapper">
                <FaEnvelope />
                <input id="reg-email" type="email" placeholder="Enter your email" autoComplete="email" value={form.email} onChange={set("email")} required />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reg-password">Password</label>
              <div className="input-wrapper">
                <FaLock />
                <input id="reg-password" type="password" placeholder="At least 8 characters" autoComplete="new-password" value={form.password} onChange={set("password")} required />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reg-confirm">Confirm password</label>
              <div className="input-wrapper">
                <FaLock />
                <input id="reg-confirm" type="password" placeholder="Repeat your password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required />
              </div>
            </div>

            <button type="submit" className="login-button" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}

        <p className="register-text">
          Already have an account? <Link to="/citizen/login">Log in</Link>
        </p>
        <Link to="/" className="back-home">← Back to CivicPlus+</Link>
      </div>
    </div>
  );
}
