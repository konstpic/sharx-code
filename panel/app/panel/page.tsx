import { RequirePerm } from "@/components/panel/RequirePerm";
import { DashboardPage } from "@/components/DashboardPage";

export default function Page() {
  return (
    <RequirePerm perm="dashboard:read" redirectToLanding>
      <DashboardPage />
    </RequirePerm>
  );
}
