import { RequirePerm } from "@/components/panel/RequirePerm";
import { ClientsStatisticsPage } from "@/components/ClientsStatisticsPage";

export default function Page() {
  return (
    <RequirePerm perm="clients:read">
      <ClientsStatisticsPage />
    </RequirePerm>
  );
}
