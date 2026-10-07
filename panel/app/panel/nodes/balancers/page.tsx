import { RequirePerm } from "@/components/panel/RequirePerm";
import { BalancersPage } from "@/components/BalancersPage";

export default function Page() {
  return (
    <RequirePerm perm="balancers:read">
      <BalancersPage />
    </RequirePerm>
  );
}
