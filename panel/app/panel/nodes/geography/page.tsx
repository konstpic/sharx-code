import { RequirePerm } from "@/components/panel/RequirePerm";
import { NodesGeographyPage } from "@/components/NodesGeographyPage";

export default function Page() {
  return (
    <RequirePerm perm="nodes:read">
      <NodesGeographyPage />
    </RequirePerm>
  );
}
