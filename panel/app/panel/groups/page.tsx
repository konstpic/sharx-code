import { RequirePerm } from "@/components/panel/RequirePerm";
import { GroupsPage } from "@/components/GroupsPage";

export default function Page() {
  return (
    <RequirePerm perm="groups:read">
      <GroupsPage />
    </RequirePerm>
  );
}
