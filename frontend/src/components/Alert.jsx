import "./PageStatus.css";

/** type: "error" | "success" | "info" */
export default function Alert({ type = "info", children }) {
  if (!children) return null;
  return (
    <div className={`inline-alert ${type}`} role={type === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
