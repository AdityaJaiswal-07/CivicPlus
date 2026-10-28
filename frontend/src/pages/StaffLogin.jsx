import Navbar from "../components/navbar";
import LoginForm from "../components/LoginForm";

function StaffLogin() {
  return (
    <>
      <Navbar />
      <LoginForm role="staff" />
    </>
  );
}

export default StaffLogin;