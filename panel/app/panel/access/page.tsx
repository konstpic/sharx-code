import { RequirePerm } from "@/components/panel/RequirePerm";
import { AccessPage } from "@/components/access/AccessPage";

export default function Page() {
  return (
    <RequirePerm perm="users:read|roles:read|audit:read">
      <AccessPage />
    </RequirePerm>
  );
}
