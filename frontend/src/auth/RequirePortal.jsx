import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { loginPathFor, portalAllows, roleHome } from "../lib/format";
import PageStatus from "../components/PageStatus";

/**
 * Route guard. UI convenience only: the backend and database enforce every permission again.
 *  - not signed in      -> that portal's login page
 *  - wrong kind of user -> their own dashboard
 */
export default function RequirePortal({ portal, children }) {
  const { status, role } = useAuth();
  const location = useLocation();

  if (status === "loading") return <PageStatus loading message="Checking your session…" />;
  if (status !== "authenticated") {
    return <Navigate to={loginPathFor(portal)} replace state={{ from: location.pathname }} />;
  }
  if (!portalAllows(portal, role)) return <Navigate to={roleHome(role)} replace />;
  return children;
}
