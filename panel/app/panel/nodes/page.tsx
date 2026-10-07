import { RequirePerm } from "@/components/panel/RequirePerm";
import { NodesPage } from "@/components/NodesPage";

export default function Page() {
  return (
    <RequirePerm perm="nodes:read">
      <NodesPage />
    </RequirePerm>
  );
}
