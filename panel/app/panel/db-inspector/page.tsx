import { RequirePerm } from "@/components/panel/RequirePerm";
import { DatabaseInspectorPage } from "@/components/DatabaseInspectorPage";

export default function Page() {
  return (
    <RequirePerm perm="system:database">
      <DatabaseInspectorPage />
    </RequirePerm>
  );
}
