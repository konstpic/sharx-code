import { RequirePerm } from "@/components/panel/RequirePerm";
import { XrayPage } from "@/components/XrayPage";

export default function Page() {
  return (
    <RequirePerm perm="xray:read">
      <XrayPage initialView="geo" />
    </RequirePerm>
  );
}
