import { useState } from "react";
import { Link } from "react-router-dom";
import { FaLock } from "react-icons/fa";

import { useAuth } from "../auth/AuthContext";
import Alert from "../components/Alert";
import Navbar from "../components/navbar";
import "../components/LoginForm.css";

/** Opened from the e-mailed reset link: Supabase signs the user in temporarily, then they choose a new password. */
function ResetPassword() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await auth.updatePassword(password);
      await auth.signOut();
      setDone(true);
    } catch (err) {
      const msg = String(err?.message ?? "");
      setError(/session/i.test(msg) ? "This reset link is invalid or has expired. Request a new one from the login page." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">🔑</div>
            <h1>Choose a new password</h1>
            <p>Enter a new password for your CivicPlus+ account</p>
          </div>

          {done ? (
            <>
              <Alert type="success">Your password has been updated. You can now log in.</Alert>
              <Link to="/citizen/login" className="back-home">Go to login</Link>
            </>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <Alert type="error">{error}</Alert>
              <div className="form-group">
                <label htmlFor="new-password">New password</label>
                <div className="input-wrapper">
                  <FaLock />
                  <input id="new-password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="confirm-password">Confirm password</label>
                <div className="input-wrapper">
                  <FaLock />
                  <input id="confirm-password" type="password" autoComplete="new-password" placeholder="Repeat the password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                </div>
              </div>
              <button type="submit" className="login-button" disabled={busy}>
                {busy ? "Saving…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

export default ResetPassword;
