import { RequirePerm } from "@/components/panel/RequirePerm";
import { MeshPage } from "@/components/MeshPage";
export default function Page() {
  return (
    <RequirePerm perm="mesh:read">
      <MeshPage />
    </RequirePerm>
  );
}
