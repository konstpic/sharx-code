import { RequirePerm } from "@/components/panel/RequirePerm";
import { ClientsPage } from "@/components/ClientsPage";

export default function Page() {
  return (
    <RequirePerm perm="clients:read">
      <ClientsPage />
    </RequirePerm>
  );
}
