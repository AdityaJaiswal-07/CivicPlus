import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { FaEnvelope, FaLock } from "react-icons/fa";

import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import { loginPathFor, portalAllows, portalName, roleHome } from "../lib/format";
import Alert from "./Alert";
import "./LoginForm.css";

function LoginForm({ role }) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const isCitizen = role === "citizen";

  // Already signed in with the right kind of account: go straight to the dashboard.
  if (auth.status === "authenticated" && portalAllows(role, auth.role)) {
    return <Navigate to={roleHome(auth.role)} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const me = await auth.signIn(email, password, remember);
      if (!portalAllows(role, me.role)) {
        // The server says this account belongs to a different portal.
        await auth.signOut();
        const right = me.role === "worker" ? "worker" : me.role === "citizen" ? "citizen" : "staff";
        setError(`This is not a ${portalName(role)} account. Please use the ${portalName(right)} login (${loginPathFor(right)}).`);
        return;
      }
      const from = location.state?.from;
      navigate(typeof from === "string" && from.startsWith(`/${role}/`) ? from : roleHome(me.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    setInfo("");
    if (!email.trim()) {
      setError("Enter your email address above first, then click “Forgot password?”.");
      return;
    }
    setBusy(true);
    try {
      await auth.sendPasswordReset(email);
      setInfo("If an account exists for this email, a password reset link has been sent.");
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

          <h1>
            {isCitizen
              ? "Citizen Login"
              : role === "staff"
              ? "Municipality Staff Login"
              : "Sanitation Worker Login"}
          </h1>

          <p>
            Sign in to your CivicPlus+ account
          </p>
        </div>

        {!auth.configured && (
          <Alert type="error">
            The app is not configured yet: Supabase settings are missing. See .env.example.
          </Alert>
        )}
        <Alert type="error">{error}</Alert>
        <Alert type="success">{info}</Alert>

        <form onSubmit={handleSubmit}>

          <div className="form-group">
            <label>Email Address</label>

            <div className="input-wrapper">
              <FaEnvelope />

              <input
                type="email"
                placeholder="Enter your email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Password</label>

            <div className="input-wrapper">
              <FaLock />

              <input
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="login-options">
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember me
            </label>

            <button
              type="button"
              className="forgot-password"
              onClick={handleForgotPassword}
              disabled={busy}
            >
              Forgot password?
            </button>
          </div>

          <button type="submit" className="login-button" disabled={busy}>
            {busy ? "Please wait…" : "Login"}
          </button>

        </form>

        {isCitizen && (
          <p className="register-text">
            Don't have an account?{" "}
            <Link to="/citizen/register">
              Create an account
            </Link>
          </p>
        )}

        <Link to="/" className="back-home">
          ← Back to CivicPlus+
        </Link>

      </div>

    </div>
  );
}

export default LoginForm;