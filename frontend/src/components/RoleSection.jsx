import { FaUser, FaShieldAlt, FaBroom } from "react-icons/fa";
import "./RoleSection.css";
import RoleCard from "./RoleCard";

function RoleSection() {
  return (
    <section className="role-section" id="roles">

      <RoleCard
        icon={<FaUser />}
        title="Citizen"
        description="Report garbage in your area and track cleanup progress directly from your phone."
        buttonText="Continue as Citizen"
        color="#08775e"
        iconBackground="#d9f3eb"
        path="/citizen/login"
      />

      <RoleCard
        icon={<FaShieldAlt />}
        title="Municipality Staff"
        description="Manage complaints, assign resources, and coordinate cleanup efforts for your designated ward."
        buttonText="Continue as Staff"
        color="#934337"
        iconBackground="#f6dfdb"
        path="/staff/login"
      />

      <RoleCard
        icon={<FaBroom />}
        title="Sanitation Worker"
        description="View your assigned cleanup tasks, update status, and log completed work efficiently."
        buttonText="Continue as Worker"
        color="#ffad21"
        iconBackground="#fff0cf"
        path="/worker/login"
      />

    </section>
  );
}

export default RoleSection;