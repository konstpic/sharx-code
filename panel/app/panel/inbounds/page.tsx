import { RequirePerm } from "@/components/panel/RequirePerm";
import { InboundsPage } from "@/components/InboundsPage";

export default function Page() {
  return (
    <RequirePerm perm="inbounds:read">
      <InboundsPage />
    </RequirePerm>
  );
}
