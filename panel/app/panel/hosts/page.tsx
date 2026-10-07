import { RequirePerm } from "@/components/panel/RequirePerm";
import { HostsRoute } from "@/components/HostsRoute";

export default function Page() {
  return (
    <RequirePerm perm="hosts:read">
      <HostsRoute />
    </RequirePerm>
  );
}
