"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Building2,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Package,
  Server,
  Settings,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { postJson } from "@/lib/api";
import { changeLanguage } from "@/lib/i18n";
import { applyPanelTheme, parsePanelTheme } from "@/lib/panelTheme";
import { usePanelWebSocket } from "@/lib/panelWebSocket";
import { linkP, panel, p, stripBasePath } from "@/lib/paths";
import { SETTINGS_TAB_IDS, tSettingsTabLabel } from "@/lib/settingsTabs";
import { getUiPref } from "@/lib/uiPrefs";
import { PanelHeaderAppMeta } from "@/components/panel/PanelHeaderAppMeta";
import { PanelTelegramNavLink } from "@/components/panel/PanelTelegramNavLink";
import { PanelDonateNavLink } from "@/components/panel/PanelDonateNavLink";
import { PanelGitHubStarLink } from "@/components/panel/PanelGitHubStarLink";
import { MenuCarousel } from "@/components/panel/nav/MenuCarousel";
import { MenuDock } from "@/components/panel/nav/MenuDock";
import { MenuSidebarNav } from "@/components/panel/nav/MenuSidebarNav";
import type { NavNode } from "@/components/panel/nav/navModel";
import { useMenuStyle } from "@/lib/menuStyle";
type NavItem = { key: string; href: string; icon: React.ReactNode; label: string };
type NavEntry =
  | NavItem
  | { kind: "settings" }
  | { kind: "nodes" }
  | { kind: "xray" }
  | { kind: "clients" };

function routePath(path: string) {
  return stripBasePath(path);
}

export function PanelShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [multi, setMulti] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [menuStyle] = useMenuStyle();
  const ws = usePanelWebSocket();
  const resyncAfterDisconnect = useRef(false);

  const loadMulti = useCallback(async () => {
    const msg = await postJson<Record<string, unknown>>(panel("setting/all"));
    if (msg.success && msg.obj) {
      setMulti(Boolean((msg.obj as { multiNodeMode?: boolean }).multiNodeMode));
    }
  }, []);

  useEffect(() => {
    void loadMulti();
  }, [loadMulti]);

  useEffect(() => {
    (async () => {
      const theme = parsePanelTheme(await getUiPref("panelTheme"));
      applyPanelTheme(theme);
      const lang = await getUiPref("panelLang");
      if (lang) {
        await changeLanguage(lang);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ws) return;
    const onDisc = () => {
      resyncAfterDisconnect.current = true;
    };
    const onConn = () => {
      if (resyncAfterDisconnect.current) {
        resyncAfterDisconnect.current = false;
        void loadMulti();
      }
    };
    ws.on("disconnected", onDisc);
    ws.on("connected", onConn);
    return () => {
      ws.off("disconnected", onDisc);
      ws.off("connected", onConn);
    };
  }, [ws, loadMulti]);

  useEffect(() => {
    setMobileNav(false);
  }, [pathname]);

  const dbInspectorHref = useMemo(() => routePath(p("panel/db-inspector")), []);
  const settingsPrefix = useMemo(() => routePath(p("panel/settings")), []);
  const inSettings = useMemo(() => {
    const u = routePath(pathname || "");
    return (
      u === settingsPrefix ||
      u.startsWith(`${settingsPrefix}/`) ||
      u === dbInspectorHref ||
      u.startsWith(`${dbInspectorHref}/`)
    );
  }, [pathname, settingsPrefix, dbInspectorHref]);

  const nodesListHref = useMemo(() => routePath(p("panel/nodes")), []);
  const nodesBalancersHref = useMemo(() => routePath(p("panel/nodes/balancers")), []);
  const nodesStatsHref = useMemo(
    () => routePath(p("panel/nodes/statistics")),
    [],
  );
  const nodesGeoHref = useMemo(
    () => routePath(p("panel/nodes/geography")),
    [],
  );
  const clientsListHref = useMemo(() => routePath(p("panel/clients")), []);
  const clientsStatsHref = useMemo(
    () => routePath(p("panel/clients/statistics")),
    [],
  );
  const inClients = useMemo(() => {
    const u = routePath(pathname || "");
    return u === clientsListHref || u.startsWith(`${clientsListHref}/`);
  }, [pathname, clientsListHref]);
  const inNodes = useMemo(() => {
    const u = routePath(pathname || "");
    return u === nodesListHref || u.startsWith(`${nodesListHref}/`);
  }, [pathname, nodesListHref]);

  const xrayListHref = useMemo(() => routePath(p("panel/xray")), []);
  const xrayProfilesHref = useMemo(
    () => routePath(p("panel/xray-core-config-profiles")),
    [],
  );
  const xrayGeoHref = useMemo(() => routePath(p("panel/xray/geo")), []);
  const inXray = useMemo(() => {
    const u = routePath(pathname || "");
    return (
      u === xrayListHref ||
      u.startsWith(`${xrayListHref}/`) ||
      u === xrayProfilesHref ||
      u.startsWith(`${xrayProfilesHref}/`) ||
      u === xrayGeoHref
    );
  }, [pathname, xrayListHref, xrayProfilesHref, xrayGeoHref]);

  const items: NavEntry[] = useMemo(() => {
    const base: NavEntry[] = [
      {
        key: p("panel/"),
        href: linkP("panel/"),
        icon: <LayoutDashboard className="size-[18px] shrink-0 opacity-90" />,
        label: t("menu.dashboard"),
      },
      {
        key: p("panel/inbounds"),
        href: linkP("panel/inbounds"),
        icon: <User className="size-[18px] shrink-0 opacity-90" />,
        label: t("menu.inbounds"),
      },
      { kind: "clients" as const },
      {
        key: p("panel/groups"),
        href: linkP("panel/groups"),
        icon: <Building2 className="size-[18px] shrink-0 opacity-90" />,
        label: t("menu.groups"),
      },
      {
        key: p("panel/bundles"),
        href: linkP("panel/bundles"),
        icon: <Package className="size-[18px] shrink-0 opacity-90" />,
        label: t("menu.bundles", { defaultValue: "Bundles" }),
      },
      { kind: "settings" as const },
      { kind: "xray" as const },
      {
        key: p("panel/api-docs"),
        href: linkP("panel/api-docs"),
        icon: <BookOpen className="size-[18px] shrink-0 opacity-90" />,
        label: t("menu.apiDocs"),
      },
    ];
    const idx = base.findIndex((x) => "key" in x && x.key === p("panel/inbounds"));
    const at = idx >= 0 ? idx + 1 : 2;
    const extraAfterInbounds: NavEntry[] = [
      {
        key: p("panel/hosts"),
        href: linkP("panel/hosts"),
        icon: <Server className="size-[18px] shrink-0 opacity-90" />,
        label: t("menu.hosts"),
      },
    ];
    if (multi) extraAfterInbounds.unshift({ kind: "nodes" as const });
    base.splice(at, 0, ...extraAfterInbounds);
    base.push({
      key: p("logout/"),
      href: p("logout/"),
      icon: <LogOut className="size-[18px] shrink-0 opacity-90" />,
      label: t("menu.logout"),
    });
    return base;
  }, [t, multi]);

  const isActive = (item: NavItem) => {
    if (item.key === p("logout/")) return false;
    const trim = (x: string) => x.replace(/\/+$/, "");
    const u = trim(routePath(pathname || ""));
    const k = trim(routePath(item.key));
    // The dashboard lives at the panel root: matching it by prefix would light it up on every page.
    if (k === trim(routePath(p("panel")))) return u === k;
    return u === k || u.startsWith(`${k}/`);
  };

  const navNodes: NavNode[] = useMemo(() => {
    const u = routePath(pathname || "");
    const icons: Record<string, NavNode["icon"]> = {
      [p("panel/")]: LayoutDashboard,
      [p("panel/inbounds")]: User,
      [p("panel/groups")]: Building2,
      [p("panel/bundles")]: Package,
      [p("panel/hosts")]: Server,
      [p("panel/api-docs")]: BookOpen,
      [p("logout/")]: LogOut,
    };
    const child = (id: string, label: string, href: string, active: boolean) => ({ id, label, href, active });
    const out: NavNode[] = [];
    for (const item of items) {
      if ("kind" in item) {
        if (item.kind === "settings") {
          out.push({
            id: "settings",
            label: t("menu.settings"),
            href: linkP("panel/settings/general"),
            icon: Settings,
            active: inSettings,
            children: [
              ...SETTINGS_TAB_IDS.map((id) =>
                child(id, tSettingsTabLabel(t, id), linkP(`panel/settings/${id}`), u === routePath(p(`panel/settings/${id}`))),
              ),
              child("db", t("menu.dbInspector"), linkP("panel/db-inspector"), u === dbInspectorHref),
            ],
          });
        } else if (item.kind === "xray") {
          out.push({
            id: "xray",
            label: t("menu.xray"),
            href: linkP("panel/xray"),
            icon: Wrench,
            active: inXray,
            children: [
              child("tpl", t("menu.xrayTemplate"), linkP("panel/xray"), u === xrayListHref),
              child("geo", t("menu.xrayGeoFiles", { defaultValue: "Geo-files" }), linkP("panel/xray/geo"), u === xrayGeoHref || u.startsWith(`${xrayGeoHref}/`)),
              child("profiles", t("menu.xrayCoreConfigProfiles"), linkP("panel/xray-core-config-profiles"), u === xrayProfilesHref || u.startsWith(`${xrayProfilesHref}/`)),
            ],
          });
        } else if (item.kind === "clients") {
          out.push({
            id: "clients",
            label: t("menu.clients"),
            href: linkP("panel/clients"),
            icon: Users,
            active: inClients,
            children: [
              child("manage", t("menu.clientsManage"), linkP("panel/clients"), u === clientsListHref),
              child("stats", t("menu.clientsStatistics"), linkP("panel/clients/statistics"), u === clientsStatsHref || u.startsWith(`${clientsStatsHref}/`)),
            ],
          });
        } else if (item.kind === "nodes") {
          out.push({
            id: "nodes",
            label: t("menu.nodes"),
            href: linkP("panel/nodes"),
            icon: Network,
            active: inNodes,
            children: [
              child("manage", t("menu.nodesManage"), linkP("panel/nodes"), u === nodesListHref),
              child("stats", t("menu.nodesStatistics"), linkP("panel/nodes/statistics"), u === nodesStatsHref || u.startsWith(`${nodesStatsHref}/`)),
              child("geo", t("menu.nodesGeography"), linkP("panel/nodes/geography"), u === nodesGeoHref),
              child("balancers", t("menu.balancers", { defaultValue: "Balancers" }), linkP("panel/nodes/balancers"), u === nodesBalancersHref),
            ],
          });
        }
        continue;
      }
      out.push({
        id: item.key,
        label: item.label,
        href: item.href,
        icon: icons[item.key] ?? LayoutDashboard,
        active: isActive(item),
        external: item.key === p("logout/"),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, t, pathname, inSettings, inXray, inClients, inNodes, dbInspectorHref, xrayListHref, xrayGeoHref, xrayProfilesHref, clientsListHref, clientsStatsHref, nodesListHref, nodesStatsHref, nodesGeoHref, nodesBalancersHref]);

  const closeMobile = () => setMobileNav(false);

  return (
    <div className="panel-root flex min-h-dvh flex-col text-[var(--fg)] md:h-dvh md:max-h-dvh md:overflow-hidden">
      <div className="panel-cinema-bg" aria-hidden>
        <span className="panel-cinema-bg__hyperspace" />
        <span className="panel-cinema-bg__stars" />
        <span className="panel-cinema-bg__lasers" />
      </div>
      <header className="panel-navbar relative z-[60] shrink-0">
        <div className="mx-auto flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              className="rounded-lg p-2 text-[var(--panel-chrome-icon)] transition-colors hover:bg-[rgba(34,211,238,0.08)] hover:text-[var(--ifm-color-primary)] md:hidden"
              aria-expanded={mobileNav}
              aria-controls="panel-doc-nav"
              aria-label={t("menu.openNavigation", { defaultValue: "Open menu" })}
              onClick={() => setMobileNav((v) => !v)}
            >
              <Menu className="size-6 shrink-0" aria-hidden />
            </button>
            <div className="panel-navbar-brand font-heading min-w-0">
              <span className="block truncate text-base font-bold tracking-[-0.5px] text-[var(--panel-chrome-fg)]">
                SharX
              </span>
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--panel-chrome-fg-muted)]">
                Panel
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <PanelGitHubStarLink />
            <PanelTelegramNavLink />
            <PanelDonateNavLink />
            <PanelHeaderAppMeta />
          </div>
        </div>
      </header>

      {menuStyle === "carousel" ? <MenuCarousel nodes={navNodes} /> : null}

      {mobileNav ? (
        <button
          type="button"
          className="fixed inset-0 z-40 animate-in fade-in bg-black/50 duration-200 md:hidden"
          aria-label={t("close")}
          onClick={closeMobile}
        />
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row md:overflow-hidden">
        <aside
          id="panel-doc-nav"
          className={`panel-doc-sidebar fixed left-0 top-16 z-50 flex h-[calc(100dvh-4rem)] w-[min(280px,92vw)] shrink-0 flex-col overflow-hidden border border-[var(--border)] shadow-2xl transition-transform duration-200 ease-out md:static md:top-auto md:z-20 md:h-full md:min-h-0 md:max-h-none md:w-[280px] md:translate-x-0 md:border-0 md:border-r md:border-[var(--border)] md:shadow-none md:transition-none ${
            mobileNav ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          } ${menuStyle === "sidebar" ? "" : "md:hidden"}`}
        >
          <MenuSidebarNav nodes={navNodes} onNavigate={closeMobile} />
        </aside>

        <div className="panel-main relative z-10 flex min-h-0 min-w-0 flex-1 flex-col md:z-10">
          <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            {/*
              No key={pathname}: a keyed remount re-ran .route-fade on every link — main
              content flashed from ~invisible and felt like a full page reload; the shell
              looked like it disappeared with the "new page" load.
            */}
            <div className={`route-fade route-fade-in min-h-0 min-w-0 ${menuStyle === "dock" ? "md:pb-28" : ""}`}>
              {children}
            </div>
          </main>
        </div>
      </div>
      {menuStyle === "dock" ? <MenuDock nodes={navNodes} /> : null}
    </div>
  );
}
