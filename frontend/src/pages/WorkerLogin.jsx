import Navbar from "../components/navbar";
import LoginForm from "../components/LoginForm";

function WorkerLogin() {
  return (
    <>
      <Navbar />
      <LoginForm role="worker" />
    </>
  );
}

export default WorkerLogin;