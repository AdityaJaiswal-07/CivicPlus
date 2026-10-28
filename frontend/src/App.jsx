import { Routes, Route } from "react-router-dom";

import RequirePortal from "./auth/RequirePortal";

import Home from "./pages/Home";
import CitizenLogin from "./pages/CitizenLogin";
import CitizenRegister from "./pages/CitizenRegister";
import StaffLogin from "./pages/StaffLogin";
import WorkerLogin from "./pages/WorkerLogin";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

import CitizenDashboard from "./pages/CitizenDashboard";
import StaffDashboard from "./pages/StaffDashboard";
import WorkerDashboard from "./pages/WorkerDashboard";

import ReportIssue from "./pages/ReportIssue";

// The guards are a convenience (right page for the right person). The backend and
// database enforce every permission again on each request.
function App() {
  return (
    <Routes>
      {/* Home */}
      <Route path="/" element={<Home />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Citizen */}
      <Route path="/citizen/login" element={<CitizenLogin />} />
      <Route path="/citizen/register" element={<CitizenRegister />} />
      <Route
        path="/citizen/dashboard"
        element={<RequirePortal portal="citizen"><CitizenDashboard /></RequirePortal>}
      />
      <Route
        path="/citizen/report"
        element={<RequirePortal portal="citizen"><ReportIssue /></RequirePortal>}
      />

      {/* Municipality Staff (and admins) */}
      <Route path="/staff/login" element={<StaffLogin />} />
      <Route
        path="/staff/dashboard"
        element={<RequirePortal portal="staff"><StaffDashboard /></RequirePortal>}
      />

      {/* Sanitation Worker */}
      <Route path="/worker/login" element={<WorkerLogin />} />
      <Route
        path="/worker/dashboard"
        element={<RequirePortal portal="worker"><WorkerDashboard /></RequirePortal>}
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;
