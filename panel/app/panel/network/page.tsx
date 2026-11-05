import { RequirePerm } from "@/components/panel/RequirePerm";
import { NetworkPage } from "@/components/network/NetworkPage";

export default function Page() {
  return (
    <RequirePerm perm="network:read">
      <NetworkPage />
    </RequirePerm>
  );
}
