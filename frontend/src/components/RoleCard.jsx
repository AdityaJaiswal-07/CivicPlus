import "./RoleCard.css";
import { useNavigate } from "react-router-dom";

export default function RoleCard({ title, description, icon, path }) {
  const navigate = useNavigate();

  return (
    <div
      className="role-card"
      onClick={() => navigate(path)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(path);
        }
      }}
    >
      <div className="role-card-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      <button type="button" onClick={() => navigate(path)}>
        Continue
      </button>
    </div>
  );
}
