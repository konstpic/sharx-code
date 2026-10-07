import { RequirePerm } from "@/components/panel/RequirePerm";
import { BundlesPage } from "@/components/BundlesPage";

export default function Page() {
  return (
    <RequirePerm perm="bundles:read">
      <BundlesPage />
    </RequirePerm>
  );
}
