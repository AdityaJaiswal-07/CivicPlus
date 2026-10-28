import { Link } from "react-router-dom";
import { FaLocationDot } from "react-icons/fa6";
import "./navbar.css";

function Navbar() {
  return (
    <nav className="navbar">

      {/* Logo */}
      <Link to="/" className="navbar-logo" aria-label="CivicPlus+ home" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="logo-icon">
          <FaLocationDot />
        </div>

        <div className="logo-text">
          <h2>CivicPlus+</h2>
          <p>Smart City Management</p>
        </div>
      </Link>

      {/* Navigation */}
      <div className="navbar-links">
        <Link to="/">Home</Link>
        <a href="/#roles">Get Started</a>
        <Link to="/citizen/report">Report an Issue</Link>
      </div>

    </nav>
  );
}

export default Navbar;