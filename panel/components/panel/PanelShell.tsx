"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Building2,
  ChevronDown,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
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
import { PanelNavLink } from "@/components/panel/PanelNavLink";
import { PanelTelegramNavLink } from "@/components/panel/PanelTelegramNavLink";
import { PanelDonateNavLink } from "@/components/panel/PanelDonateNavLink";
import { PanelGitHubStarLink } from "@/components/panel/PanelGitHubStarLink";
type NavItem = { key: string; href: string; icon: React.ReactNode; label: string };
type NavEntry =
  | NavItem
  | { kind: "settings" }
  | { kind: "nodes" }
  | { kind: "xray" }
  | { kind: "clients" };

function navLinkClass(active: boolean) {
  return active ? "panel-menu-link panel-menu-link--active" : "panel-menu-link";
}

function routePath(path: string) {
  return stripBasePath(path);
}

export function PanelShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [multi, setMulti] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [nodesOpen, setNodesOpen] = useState(true);
  const [clientsOpen, setClientsOpen] = useState(true);
  const [xrayOpen, setXrayOpen] = useState(true);
  const prevInSettings = useRef(false);
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

  useEffect(() => {
    if (inSettings && !prevInSettings.current) {
      setSettingsOpen(true);
    }
    prevInSettings.current = inSettings;
  }, [inSettings]);

  useEffect(() => {
    if (inNodes) setNodesOpen(true);
  }, [inNodes]);

  useEffect(() => {
    if (inClients) setClientsOpen(true);
  }, [inClients]);

  useEffect(() => {
    if (inXray) setXrayOpen(true);
  }, [inXray]);

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
    const u = routePath(pathname || "");
    const k = routePath(item.key);
    return u === k || u.startsWith(`${k}/`);
  };

  const isSettingsSubActive = (id: (typeof SETTINGS_TAB_IDS)[number]) => {
    const u = routePath(pathname || "");
    const k = routePath(p(`panel/settings/${id}`));
    return u === k;
  };

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
          }`}
        >
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3 md:pt-2">
            {items.map((item) => {
              if ("kind" in item && item.kind === "settings") {
                return (
                  <div key="nav-settings" className="flex flex-col gap-0.5">
                    <div className="flex w-full min-w-0 items-stretch gap-0.5">
                      <PanelNavLink
                        href={linkP("panel/settings/general")}
                        className={`${navLinkClass(inSettings)} min-w-0 flex-1`}
                        onClick={closeMobile}
                      >
                        <Settings className="size-[18px] shrink-0 opacity-90" />
                        <span className="min-w-0">{t("menu.settings")}</span>
                      </PanelNavLink>
                      <button
                        type="button"
                        className="panel-menu-link shrink-0 rounded-xl px-2.5"
                        aria-expanded={settingsOpen}
                        aria-label={t("menu.settingsToggle", {
                          defaultValue: "Toggle settings sections",
                        })}
                        onClick={() => setSettingsOpen((o) => !o)}
                      >
                        <ChevronDown
                          className={`size-4 text-[var(--ifm-color-content)] transition-transform ${settingsOpen ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </button>
                    </div>
                    {settingsOpen ? (
                      <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
                        {SETTINGS_TAB_IDS.map((id) => (
                          <PanelNavLink
                            key={id}
                            href={linkP(`panel/settings/${id}`)}
                            className={`${navLinkClass(isSettingsSubActive(id))} panel-menu-link--sub`}
                            onClick={closeMobile}
                          >
                            <span className="min-w-0 pl-0.5">{tSettingsTabLabel(t, id)}</span>
                          </PanelNavLink>
                        ))}
                        <PanelNavLink
                          href={linkP("panel/db-inspector")}
                          className={`${navLinkClass(routePath(pathname || "") === dbInspectorHref)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <Database className="size-3.5 shrink-0 opacity-80" />
                          <span className="min-w-0 pl-0.5">
                            {t("menu.dbInspector")}
                          </span>
                        </PanelNavLink>
                      </div>
                    ) : null}
                  </div>
                );
              }
              if ("kind" in item && item.kind === "xray") {
                const u = routePath(pathname || "");
                const isTemplate = u === xrayListHref;
                const isProfiles =
                  u === xrayProfilesHref || u.startsWith(`${xrayProfilesHref}/`);
                const isGeo = u === xrayGeoHref || u.startsWith(`${xrayGeoHref}/`);
                return (
                  <div key="nav-xray" className="flex flex-col gap-0.5">
                    <div className="flex w-full min-w-0 items-stretch gap-0.5">
                      <PanelNavLink
                        href={linkP("panel/xray")}
                        className={`${navLinkClass(inXray)} min-w-0 flex-1`}
                        onClick={closeMobile}
                      >
                        <Wrench className="size-[18px] shrink-0 opacity-90" />
                        <span className="min-w-0">{t("menu.xray")}</span>
                      </PanelNavLink>
                      <button
                        type="button"
                        className="panel-menu-link shrink-0 rounded-xl px-2.5"
                        aria-expanded={xrayOpen}
                        aria-label={t("menu.xrayToggle", {
                          defaultValue: "Toggle Xray sections",
                        })}
                        onClick={() => setXrayOpen((o) => !o)}
                      >
                        <ChevronDown
                          className={`size-4 text-[var(--ifm-color-content)] transition-transform ${xrayOpen ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </button>
                    </div>
                    {xrayOpen ? (
                      <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
                        <PanelNavLink
                          href={linkP("panel/xray")}
                          className={`${navLinkClass(isTemplate)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <span className="min-w-0 pl-0.5">{t("menu.xrayTemplate")}</span>
                        </PanelNavLink>
                        <PanelNavLink
                          href={linkP("panel/xray/geo")}
                          className={`${navLinkClass(isGeo)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <span className="min-w-0 pl-0.5">
                            {t("menu.xrayGeoFiles", { defaultValue: "Geo-files" })}
                          </span>
                        </PanelNavLink>
                        <PanelNavLink
                          href={linkP("panel/xray-core-config-profiles")}
                          className={`${navLinkClass(isProfiles)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <span className="min-w-0 pl-0.5">
                            {t("menu.xrayCoreConfigProfiles")}
                          </span>
                        </PanelNavLink>
                      </div>
                    ) : null}
                  </div>
                );
              }
              if ("kind" in item && item.kind === "clients") {
                const u = routePath(pathname || "");
                const isManage = u === clientsListHref;
                const isStats = u === clientsStatsHref || u.startsWith(`${clientsStatsHref}/`);
                return (
                  <div key="nav-clients" className="flex flex-col gap-0.5">
                    <div className="flex w-full min-w-0 items-stretch gap-0.5">
                      <PanelNavLink
                        href={linkP("panel/clients")}
                        className={`${navLinkClass(inClients)} min-w-0 flex-1`}
                        onClick={closeMobile}
                      >
                        <Users className="size-[18px] shrink-0 opacity-90" />
                        <span className="min-w-0">{t("menu.clients")}</span>
                      </PanelNavLink>
                      <button
                        type="button"
                        className="panel-menu-link shrink-0 rounded-xl px-2.5"
                        aria-expanded={clientsOpen}
                        aria-label={t("menu.clientsToggle", {
                          defaultValue: "Toggle clients sections",
                        })}
                        onClick={() => setClientsOpen((o) => !o)}
                      >
                        <ChevronDown
                          className={`size-4 text-[var(--ifm-color-content)] transition-transform ${clientsOpen ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </button>
                    </div>
                    {clientsOpen ? (
                      <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
                        <PanelNavLink
                          href={linkP("panel/clients")}
                          className={`${navLinkClass(isManage)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <span className="min-w-0 pl-0.5">{t("menu.clientsManage")}</span>
                        </PanelNavLink>
                        <PanelNavLink
                          href={linkP("panel/clients/statistics")}
                          className={`${navLinkClass(isStats)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <span className="min-w-0 pl-0.5">{t("menu.clientsStatistics")}</span>
                        </PanelNavLink>
                      </div>
                    ) : null}
                  </div>
                );
              }
              if ("kind" in item && item.kind === "nodes") {
                const u = routePath(pathname || "");
                const isManage = u === nodesListHref;
                const isStats =
                  u === nodesStatsHref || u.startsWith(`${nodesStatsHref}/`);
                const isGeo = u === nodesGeoHref;
                return (
                  <div key="nav-nodes" className="flex flex-col gap-0.5">
                    <div className="flex w-full min-w-0 items-stretch gap-0.5">
                      <PanelNavLink
                        href={linkP("panel/nodes")}
                        className={`${navLinkClass(inNodes)} min-w-0 flex-1`}
                        onClick={closeMobile}
                      >
                        <Network className="size-[18px] shrink-0 opacity-90" />
                        <span className="min-w-0">{t("menu.nodes")}</span>
                      </PanelNavLink>
                      <button
                        type="button"
                        className="panel-menu-link shrink-0 rounded-xl px-2.5"
                        aria-expanded={nodesOpen}
                        aria-label={t("menu.nodesToggle", {
                          defaultValue: "Toggle nodes sections",
                        })}
                        onClick={() => setNodesOpen((o) => !o)}
                      >
                        <ChevronDown
                          className={`size-4 text-[var(--ifm-color-content)] transition-transform ${nodesOpen ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </button>
                    </div>
                    {nodesOpen ? (
                      <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
                        <PanelNavLink
                          href={linkP("panel/nodes")}
                          className={`${navLinkClass(isManage)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <span className="min-w-0 pl-0.5">
                            {t("menu.nodesManage")}
                          </span>
                        </PanelNavLink>
                        <PanelNavLink
                          href={linkP("panel/nodes/statistics")}
                          className={`${navLinkClass(isStats)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <span className="min-w-0 pl-0.5">
                            {t("menu.nodesStatistics")}
                          </span>
                        </PanelNavLink>
                        <PanelNavLink
                          href={linkP("panel/nodes/geography")}
                          className={`${navLinkClass(isGeo)} panel-menu-link--sub`}
                          onClick={closeMobile}
                        >
                          <span className="min-w-0 pl-0.5">
                            {t("menu.nodesGeography")}
                          </span>
                        </PanelNavLink>
                      </div>
                    ) : null}
                  </div>
                );
              }
              if (item.key === p("logout/")) {
                return (
                  <a
                    key={item.key}
                    id="logout-link"
                    href={item.href}
                    className="panel-menu-link"
                    onClick={closeMobile}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </a>
                );
              }
              return (
                <PanelNavLink
                  key={item.key}
                  href={item.href}
                  className={navLinkClass(isActive(item))}
                  onClick={closeMobile}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </PanelNavLink>
              );
            })}
          </nav>
        </aside>

        <div className="panel-main relative z-10 flex min-h-0 min-w-0 flex-1 flex-col md:z-10">
          <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            {/*
              No key={pathname}: a keyed remount re-ran .route-fade on every link — main
              content flashed from ~invisible and felt like a full page reload; the shell
              looked like it disappeared with the "new page" load.
            */}
            <div className="route-fade route-fade-in min-h-0 min-w-0">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
