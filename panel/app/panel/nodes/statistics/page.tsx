import { RequirePerm } from "@/components/panel/RequirePerm";
import { NodesStatisticsPage } from "@/components/NodesStatisticsPage";

export default function Page() {
  return (
    <RequirePerm perm="nodes:read">
      <NodesStatisticsPage />
    </RequirePerm>
  );
}
