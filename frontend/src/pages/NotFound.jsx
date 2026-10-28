import "../components/PageStatus.css";
import { Link } from "react-router-dom";
import Navbar from "../components/navbar";

function NotFound() {
  return (
    <>
      <Navbar />
      <div className="page-status" style={{ minHeight: "70vh" }}>
        <h1 style={{ fontSize: 48, margin: 0, color: "#08775e" }}>404</h1>
        <p>Sorry, we couldn't find that page.</p>
        <Link to="/" className="page-status-button" style={{ textDecoration: "none" }}>
          Back to CivicPlus+
        </Link>
      </div>
    </>
  );
}

export default NotFound;
