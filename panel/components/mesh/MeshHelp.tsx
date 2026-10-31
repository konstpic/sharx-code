"use client";
import { SectionHelpModal } from "@/components/panel";

/** Same scene player and paragraph layout as Nodes, Hosts and Balancers. */
export function MeshHelp() {
  return (
    <SectionHelpModal
      scene="mesh"
      titleKey="pages.mesh.helpTitle"
      buttonLabelKey="pages.mesh.helpButton"
      paragraphKeys={[
        "pages.mesh.helpP1",
        "pages.mesh.helpP2",
        "pages.mesh.helpP3",
        "pages.mesh.helpP4",
        "pages.mesh.helpP5",
      ]}
    />
  );
}
