import { defaultV2 } from "../sharxSubpageConfig";
import { blockNode } from "./migrate";
import { A, ACCENT, build, buildWithI18n, gradient, glass, L, LP, MUTED, sceneItem, surface, T } from "./catalog-kit";
import type { Spec } from "./presets";
import type { Subtree } from "./tree";

export type CatalogCategory = "hero" | "traffic" | "devices" | "connect" | "steps" | "scenes" | "motion" | "info" | "decor" | "plans" | "social";
export const CATALOG_CATEGORIES: CatalogCategory[] = ["steps", "scenes", "motion", "hero", "traffic", "devices", "connect", "info", "decor", "plans", "social"];

export type CatalogItem = {
  id: string;
  cat: CatalogCategory;
  en: [string, string];
  ru: [string, string];
  icon: "frame" | "text" | "button" | "progress" | "repeat" | "badge" | "html" | "qr" | "image" | "scene";
  build: (lang: "en" | "ru") => Subtree;
};


export const CATALOG: CatalogItem[] = [
  {
    id: "greeting", cat: "hero", icon: "frame",
    en: ["Greeting banner", "Gradient card with name and status"], ru: ["Приветствие", "Градиентная карточка с именем и статусом"],
    build: (l) => build(["frame", { name: "Greeting", style: { ...gradient, pad: 28 } }, [
      T(L(l, "Welcome back", "С возвращением"), { fs: 13, upper: true, ls: 1, color: MUTED }),
      T("{{ user.username }}", { fs: 30, fw: 800, truncate: true }, "h2"),
      ["badge", { name: "Active", props: { text: "{{ user.userStatus }}", tone: "success" }, visibleIf: "user.isActive" }],
      ["badge", { name: "Inactive", props: { text: "{{ user.userStatus }}", tone: "danger" }, visibleIf: "!user.isActive" }],
    ]]),
  },
  {
    id: "profile-glass", cat: "hero", icon: "frame",
    en: ["Glass profile", "Frosted card with avatar letter"], ru: ["Стеклянный профиль", "Матовая карточка с буквой-аватаром"],
    build: (l) => build(["frame", { name: "Glass profile", style: { ...glass, dir: "row", align: "center", gap: 16 } }, [
      ["frame", { name: "Avatar", style: { mode: "stack", dir: "column", align: "center", justify: "center", w: 56, h: 56, radius: 999, bg: ACCENT } }, [T("{{ user.username | first | upper }}", { fs: 24, fw: 800, color: "#04141a" })]],
      ["frame", { name: "Info", style: { mode: "stack", dir: "column", gap: 2, pad: 0, grow: 1, w: "auto" } }, [
        T("{{ user.username }}", { fs: 18, fw: 700, truncate: true }),
        T(`${L(l, "Until", "До")} {{ user.expiresAt | date("DD.MM.YYYY") }}`, { fs: 13, color: MUTED }),
      ]],
    ]]),
  },
  {
    id: "days-left", cat: "hero", icon: "text",
    en: ["Days left", "Big number of remaining days"], ru: ["Дней осталось", "Крупное число оставшихся дней"],
    build: (l) => build(["frame", { name: "Days left", style: { ...surface, align: "center", gap: 2 } }, [
      T("{{#if user.neverExpires}}∞{{else}}{{ user.daysLeft }}{{/if}}", { fs: 56, fw: 800, lh: 1, color: ACCENT }),
      T(`{{ user.daysLeft | plural(${LP(l, "day", "день")}, ${LP(l, "days", "дня")}, ${LP(l, "days", "дней")}) }} ${L(l, "left", "осталось")}`, { fs: 14, color: MUTED }),
    ]]),
  },
  {
    id: "traffic-bar", cat: "traffic", icon: "progress",
    en: ["Traffic bar", "Used / limit with a progress bar"], ru: ["Полоса трафика", "Использовано / лимит с полосой"],
    build: (l) => build(["frame", { name: "Traffic", style: surface }, [
      ["frame", { name: "Head", style: { mode: "stack", dir: "row", justify: "between", align: "center", w: "fill", pad: 0 } }, [
        T(L(l, "Traffic", "Трафик"), { fs: 16, fw: 600 }),
        T("{{ user.percentUsed }}%", { fs: 14, color: MUTED }),
      ]],
      ["progress", { name: "Bar", props: { value: "{{ user.trafficUsedBytes }}", max: "{{ user.trafficLimitBytes }}", label: "{{ user.trafficUsed }} / {{#if user.unlimited}}∞{{else}}{{ user.trafficLimit }}{{/if}}" } }],
    ]]),
  },
  {
    id: "stat-trio", cat: "traffic", icon: "frame",
    en: ["3 stat tiles", "Traffic, days and devices"], ru: ["3 плитки", "Трафик, дни и устройства"],
    build: (l) => {
      const tile = (label: string, val: string): Spec => ["frame", { name: label, style: { ...surface, gap: 4, pad: 16 } }, [T(label, { fs: 11, upper: true, ls: 0.8, color: MUTED }), T(val, { fs: 22, fw: 700 })]];
      return build(["frame", { name: "Stats", style: { mode: "grid", colMin: 150, gap: 12, w: "fill", pad: 0 } }, [
        tile(L(l, "Traffic", "Трафик"), "{{ user.trafficUsed }}"),
        tile(L(l, "Days left", "Дней"), "{{#if user.neverExpires}}∞{{else}}{{ user.daysLeft }}{{/if}}"),
        tile(L(l, "Devices", "Устройства"), "{{ devices.count }}{{#if !devices.unlimited}} / {{ devices.max }}{{/if}}"),
      ]]);
    },
  },
  {
    id: "low-traffic", cat: "traffic", icon: "badge",
    en: ["Low traffic warning", "Shows only when 80%+ is used"], ru: ["Мало трафика", "Появляется при 80%+ расхода"],
    build: (l) => build(["frame", { name: "Low traffic", visibleIf: "!user.unlimited && user.percentUsed >= 80", style: { ...surface, bg: "color-mix(in oklab, var(--sub-danger, #f85149) 14%, transparent)", border: { w: 1, color: "var(--sub-danger, #f85149)" }, dir: "row", align: "center" } }, [
      ["icon", { name: "Icon", props: { name: "alert", size: 22 } }],
      T(L(l, "Only {{ user.remaining }} of traffic left", "Осталось всего {{ user.remaining }} трафика"), { fs: 14, fw: 600, grow: 1 }),
    ]]),
  },
  {
    id: "devices-tiles", cat: "devices", icon: "repeat",
    en: ["Device tiles", "Grid of connected devices"], ru: ["Плитки устройств", "Сетка подключённых устройств"],
    build: (l) => build(["frame", { name: "Device tiles", visibleIf: "devices.enabled", style: { mode: "stack", dir: "column", gap: 10, pad: 0, w: "fill" } }, [
      T(`${L(l, "Your devices", "Ваши устройства")} · {{ devices.count }}`, { fs: 16, fw: 600 }),
      ["repeat", { name: "Devices", props: { source: "devices", emptyText: L(l, "No devices yet", "Устройств пока нет") }, style: { mode: "grid", colMin: 150, gap: 10, w: "fill" } }, [
        ["frame", { name: "Device", style: { ...surface, gap: 6, pad: 14, radius: 14 } }, [
          ["icon", { name: "Icon", props: { name: "smartphone", size: 22 } }],
          T("{{ item.model | default(item.os) }}", { fs: 14, fw: 600, truncate: true }),
          T("{{ item.os }} {{ item.osVersion }}", { fs: 12, color: MUTED }),
          T(`${L(l, "seen", "был")} {{ item.lastSeenAt | ago }}`, { fs: 11, color: MUTED }),
        ]],
      ]],
    ]]),
  },
  {
    id: "device-slots", cat: "devices", icon: "progress",
    en: ["Device slots", "Used of allowed devices"], ru: ["Слоты устройств", "Занято из разрешённых"],
    build: (l) => build(["frame", { name: "Device slots", visibleIf: "devices.enabled && !devices.unlimited", style: surface }, [
      T(L(l, "Device slots", "Слоты устройств"), { fs: 16, fw: 600 }),
      ["progress", { name: "Slots", props: { value: "{{ devices.count }}", max: "{{ devices.max }}", label: `{{ devices.count }} / {{ devices.max }} · {{ devices.left }} ${L(l, "free", "свободно")}` } }],
    ]]),
  },
  {
    id: "cta-connect", cat: "connect", icon: "button",
    en: ["Big connect button", "Adds the subscription to the main app"], ru: ["Большая кнопка подключения", "Добавляет подписку в основное приложение"],
    build: (l) => build(["frame", { name: "Connect CTA", style: { ...gradient, align: "center", pad: 28 } }, [
      T(L(l, "Connect in one tap", "Подключение в одно касание"), { fs: 20, fw: 700, ta: "center" }, "h3"),
      T(L(l, "Pick your app and the subscription is added automatically.", "Выберите приложение — подписка добавится сама."), { fs: 14, ta: "center", color: MUTED }),
      ["apps", { name: "App buttons", props: { view: "buttons", variant: "solid" }, style: { w: "fill" } }],
    ]]),
  },
  {
    id: "app-grid", cat: "connect", icon: "button",
    en: ["App grid", "Tiles with app icons — one tap adds the subscription"], ru: ["Сетка приложений", "Плитки с иконками — подписка добавляется в одно касание"],
    build: (l) => build(["frame", { name: "App grid", style: surface }, [
      T(L(l, "Add to an app", "Добавить в приложение"), { fs: 16, fw: 600 }),
      ["apps", { name: "App tiles", props: { view: "tiles", variant: "outline" }, style: { w: "fill" } }],
    ]]),
  },
  {
    id: "app-list", cat: "connect", icon: "button",
    en: ["App list", "One app per row with icon and E2E badge"], ru: ["Список приложений", "Приложение в строке: иконка и метка E2E"],
    build: (l) => build(["frame", { name: "App list", style: surface }, [
      T(L(l, "Add to an app", "Добавить в приложение"), { fs: 16, fw: 600 }),
      ["apps", { name: "App list", props: { view: "list", variant: "outline" }, style: { w: "fill" } }],
    ]]),
  },
  {
    id: "copy-link", cat: "connect", icon: "button",
    en: ["Copy link card", "Subscription URL with Copy and QR"], ru: ["Карточка ссылки", "URL подписки с кнопками «Копировать» и QR"],
    build: (l) => build(["frame", { name: "Copy link", style: surface }, [
      T(L(l, "Subscription link", "Ссылка подписки"), { fs: 16, fw: 600 }),
      T("{{ subscription.url }}", { fs: 12, color: MUTED, truncate: true, family: "mono" }),
      ["frame", { name: "Actions", style: { mode: "stack", dir: "row", gap: 8, pad: 0, w: "fill" } }, [
        ["button", { name: "Copy", props: { label: L(l, "Copy link", "Копировать"), action: "copy", value: "{{ subscription.url }}", variant: "solid" }, style: { grow: 1, radius: 12, pad: [10, 14, 10, 14] } }],
        ["button", { name: "QR", props: { label: "QR", action: "qr", value: "{{ subscription.url }}", variant: "outline" }, style: { radius: 12, pad: [10, 14, 10, 14] } }],
      ]],
    ]]),
  },
  {
    id: "qr-card", cat: "connect", icon: "qr",
    en: ["QR card", "Scan-to-add QR of the subscription"], ru: ["QR-карточка", "QR подписки для сканирования"],
    build: (l) => build(["frame", { name: "QR card", style: { ...surface, align: "center" } }, [
      ["qr", { name: "QR", props: { value: "{{ subscription.url }}", size: 180 } }],
      T(L(l, "Scan the QR code in your VPN app", "Отсканируйте QR-код в VPN-приложении"), { fs: 13, ta: "center", color: MUTED }),
    ]]),
  },
  {
    id: "telegram", cat: "connect", icon: "button",
    en: ["Telegram button", "Uses vars.tg (set it in Variables)"], ru: ["Кнопка Telegram", "Берёт vars.tg (задайте в «Переменных»)"],
    build: (l) => build(["button", { name: "Telegram", visibleIf: "vars.tg", props: { label: L(l, "Open Telegram bot", "Открыть Telegram-бота"), action: "link", value: "{{ vars.tg }}", variant: "solid", icon: "send", newTab: true }, style: { w: "fill", radius: 14, pad: [14, 18, 14, 18], fw: 600 } }]),
  },
  {
    id: "steps", cat: "info", icon: "frame",
    en: ["3 steps", "Numbered setup instructions"], ru: ["3 шага", "Нумерованная инструкция"],
    build: (l) => {
      const step = (n: number, title: string, text: string): Spec => ["frame", { name: `Step ${n}`, style: { mode: "stack", dir: "row", gap: 12, pad: 0, w: "fill", align: "start" } }, [
        ["frame", { name: "Num", style: { mode: "stack", dir: "column", align: "center", justify: "center", w: 30, h: 30, radius: 999, bg: ACCENT } }, [T(String(n), { fs: 14, fw: 800, color: "#04141a" })]],
        ["frame", { name: "Body", style: { mode: "stack", dir: "column", gap: 2, pad: 0, grow: 1, w: "auto" } }, [T(title, { fs: 15, fw: 600 }), T(text, { fs: 13, color: MUTED })]],
      ]];
      return build(["frame", { name: "Steps", style: { ...surface, gap: 16 } }, [
        step(1, L(l, "Install the app", "Установите приложение"), L(l, "Get it from the official store.", "Скачайте из официального магазина.")),
        step(2, L(l, "Add the subscription", "Добавьте подписку"), L(l, "Tap the button above or paste the link.", "Нажмите кнопку выше или вставьте ссылку.")),
        step(3, L(l, "Connect", "Подключитесь"), L(l, "Choose a server and turn it on.", "Выберите сервер и включите.")),
      ]]);
    },
  },
  {
    id: "faq", cat: "info", icon: "html",
    en: ["FAQ accordion", "Expandable questions (custom code)"], ru: ["FAQ-аккордеон", "Раскрывающиеся вопросы (свой код)"],
    build: (l) => build(["html", { name: "FAQ", props: {
      html: `<details><summary>${L(l, "It does not connect. What to do?", "Не подключается. Что делать?")}</summary><p>${L(l, "Update the subscription in the app and try another server.", "Обновите подписку в приложении и попробуйте другой сервер.")}</p></details>
<details><summary>${L(l, "How many devices can I use?", "Сколько устройств можно подключить?")}</summary><p>{{#if devices.unlimited}}${L(l, "Unlimited.", "Без ограничений.")}{{else}}${L(l, "Up to", "До")} {{ devices.max }}.{{/if}}</p></details>`,
      css: "details{border:1px solid var(--sub-border,rgba(255,255,255,.12));border-radius:14px;padding:12px 16px;margin-bottom:8px;background:var(--sub-surface,rgba(255,255,255,.04))}summary{cursor:pointer;font-weight:600}p{margin:8px 0 0;color:var(--sub-fg-muted,#8b949e);font-size:14px}",
    }, style: { w: "fill" } }]),
  },
  {
    id: "announce", cat: "info", icon: "badge",
    en: ["Announcement", "Accent notice with icon (uses vars.notice)"], ru: ["Объявление", "Акцентное уведомление (берёт vars.notice)"],
    build: (l) => build(["frame", { name: "Announcement", visibleIf: "vars.notice", style: { ...surface, dir: "row", align: "center", bg: "var(--sub-accent-soft, rgba(34,211,238,.12))", border: { w: 1, color: ACCENT } } }, [
      ["icon", { name: "Icon", props: { name: "bell", size: 22 } }],
      T("{{ vars.notice }}", { fs: 14, fw: 500, grow: 1 }),
    ]]),
  },
  {
    id: "support-card", cat: "info", icon: "frame",
    en: ["Support card", "Text with a support button"], ru: ["Карточка поддержки", "Текст и кнопка поддержки"],
    build: (l) => build(["frame", { name: "Support", visibleIf: "branding.supportUrl", style: { ...surface, dir: "row", align: "center", wrap: true } }, [
      ["frame", { name: "Text", style: { mode: "stack", dir: "column", gap: 2, pad: 0, grow: 1, w: "auto" } }, [T(L(l, "Need help?", "Нужна помощь?"), { fs: 16, fw: 600 }), T(L(l, "We usually reply within an hour.", "Обычно отвечаем в течение часа."), { fs: 13, color: MUTED })]],
      ["button", { name: "Write", props: { label: L(l, "Contact support", "Написать в поддержку"), action: "link", value: "{{ branding.supportUrl }}", variant: "outline", newTab: true }, style: { radius: 12, pad: [10, 16, 10, 16] } }],
    ]]),
  },
  {
    id: "footer", cat: "decor", icon: "text",
    en: ["Footer", "Divider and a small note"], ru: ["Подвал", "Разделитель и мелкая подпись"],
    build: (l) => build(["frame", { name: "Footer", style: { mode: "stack", dir: "column", gap: 12, pad: 0, w: "fill", align: "center" } }, [
      ["divider", { name: "Line", style: { w: "fill" } }],
      T(`© {{ now | date("YYYY") }} {{ branding.title }}`, { fs: 12, ta: "center", color: MUTED }),
    ]]),
  },
  {
    id: "section-title", cat: "decor", icon: "text",
    en: ["Section title", "Heading with an accent bar"], ru: ["Заголовок раздела", "Заголовок с акцентной чертой"],
    build: (l) => build(["frame", { name: "Section title", style: { mode: "stack", dir: "row", gap: 10, pad: 0, w: "fill", align: "center" } }, [
      ["frame", { name: "Bar", style: { w: 4, h: 22, radius: 4, bg: ACCENT } }],
      T(L(l, "Section", "Раздел"), { fs: 18, fw: 700 }, "h3"),
    ]]),
  },
  {
    id: "live-flow", cat: "decor", icon: "html",
    en: ["Live connection", "Animated device → shield → internet flow"], ru: ["Живое подключение", "Анимация: устройство → защита → интернет"],
    build: (l) => build(["html", { name: "Live connection", props: {
      html: `<div class="f"><div class="n"><i>📱</i><b>{{ user.username | truncate(14) }}</b></div><div class="w"><s></s><s></s><s></s></div><div class="n sh"><i>🛡️</i><b>${L(l, "Protected", "Защита")}</b></div><div class="w"><s></s><s></s><s></s></div><div class="n"><i>🌐</i><b>${L(l, "Internet", "Интернет")}</b></div></div>`,
      css: "@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}.f{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:22px 16px;border-radius:22px;border:1px solid var(--sub-border,rgba(255,255,255,.12));background:var(--sub-surface,rgba(255,255,255,.05))}.n{display:grid;justify-items:center;gap:6px;font-size:12px;color:var(--sub-fg-muted,#8b949e)}.n i{font-style:normal;font-size:26px;display:grid;place-items:center;width:54px;height:54px;border-radius:18px;background:var(--sub-accent-soft,rgba(34,211,238,.14))}.sh i{animation:pulse 2.4s ease-in-out infinite;box-shadow:0 0 0 0 var(--sub-accent,#22d3ee)}.w{flex:1;display:flex;justify-content:space-around;min-width:24px}.w s{width:6px;height:6px;border-radius:99px;background:var(--sub-accent,#22d3ee);opacity:0;animation:dot 1.8s linear infinite}.w s:nth-child(2){animation-delay:.6s}.w s:nth-child(3){animation-delay:1.2s}@keyframes dot{0%{opacity:0;transform:translateX(-8px)}30%{opacity:1}100%{opacity:0;transform:translateX(8px)}}@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--sub-accent,#22d3ee) 55%,transparent)}70%,100%{box-shadow:0 0 0 14px transparent}}",
    }, style: { w: "fill" } }]),
  },
  {
    id: "traffic-ring", cat: "traffic", icon: "html",
    en: ["Traffic ring", "Animated circular gauge"], ru: ["Кольцо трафика", "Анимированный круговой индикатор"],
    build: (l) => build(["html", { name: "Traffic ring", props: {
      html: `<div class="r"><svg viewBox="0 0 120 120" width="132" height="132"><circle class="t" cx="60" cy="60" r="52"/><circle class="p" cx="60" cy="60" r="52" style="--v:{{ user.percentUsed }}"/></svg><div class="c"><b>{{#if user.unlimited}}∞{{else}}{{ user.percentUsed }}%{{/if}}</b><span>{{ user.trafficUsed }}</span></div></div>`,
      css: "@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}.r{position:relative;display:grid;place-items:center;padding:20px;border-radius:22px;border:1px solid var(--sub-border,rgba(255,255,255,.12));background:var(--sub-surface,rgba(255,255,255,.05))}svg{transform:rotate(-90deg)}circle{fill:none;stroke-width:9;stroke-linecap:round}.t{stroke:color-mix(in oklab,var(--sub-fg,#c9d1d9) 12%,transparent)}.p{stroke:var(--sub-accent,#22d3ee);stroke-dasharray:326.7;stroke-dashoffset:326.7;animation:fill 1.6s cubic-bezier(.2,.8,.2,1) .2s forwards;filter:drop-shadow(0 0 8px color-mix(in oklab,var(--sub-accent,#22d3ee) 60%,transparent))}@keyframes fill{to{stroke-dashoffset:calc(326.7 - 326.7 * var(--v) / 100)}}.c{position:absolute;display:grid;justify-items:center}.c b{font-size:26px;color:var(--sub-fg-strong,#fff)}.c span{font-size:11px;color:var(--sub-fg-muted,#8b949e)}",
    }, style: { w: "fill" } }]),
  },
  {
    id: "status-live", cat: "hero", icon: "html",
    en: ["Live status", "Pulsing status dot with expiry"], ru: ["Живой статус", "Пульсирующая точка статуса и срок"],
    build: (l) => build(["html", { name: "Live status", props: {
      html: `<div class="s {{#if user.isActive}}ok{{else}}bad{{/if}}"><span class="d"></span><div><b>{{ user.userStatus }}</b><small>${L(l, "Until", "До")} {{ user.expiresAt | date("DD.MM.YYYY") }}</small></div></div>`,
      css: "@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}.s{display:flex;align-items:center;gap:14px;padding:16px 18px;border-radius:20px;border:1px solid var(--sub-border,rgba(255,255,255,.12));background:var(--sub-surface,rgba(255,255,255,.05))}.d{width:12px;height:12px;border-radius:99px;background:var(--c);animation:p 1.8s ease-out infinite}.ok{--c:var(--sub-success,#3fb950)}.bad{--c:var(--sub-danger,#f85149)}b{display:block;font-size:16px;color:var(--sub-fg-strong,#fff)}small{color:var(--sub-fg-muted,#8b949e)}@keyframes p{0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--c) 60%,transparent)}100%{box-shadow:0 0 0 14px transparent}}",
    }, style: { w: "fill" } }]),
  },
  {
    id: "steps-live", cat: "info", icon: "html",
    en: ["Animated steps", "Steps light up one after another"], ru: ["Анимированные шаги", "Шаги загораются по очереди"],
    build: (l) => build(["html", { name: "Animated steps", props: {
      html: `<ol><li><b>${L(l, "Install the app", "Установите приложение")}</b><small>${L(l, "From the official store", "Из официального магазина")}</small></li><li><b>${L(l, "Add the subscription", "Добавьте подписку")}</b><small>${L(l, "One tap or paste the link", "Одно касание или вставьте ссылку")}</small></li><li><b>${L(l, "Connect", "Подключитесь")}</b><small>${L(l, "Choose a server and go", "Выберите сервер и вперёд")}</small></li></ol>`,
      css: "@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}ol{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:s}li{counter-increment:s;position:relative;padding:14px 16px 14px 60px;border-radius:18px;border:1px solid var(--sub-border,rgba(255,255,255,.12));background:var(--sub-surface,rgba(255,255,255,.05));animation:lit 6s ease-in-out infinite}li:nth-child(2){animation-delay:2s}li:nth-child(3){animation-delay:4s}li::before{content:counter(s);position:absolute;left:14px;top:50%;translate:0 -50%;width:34px;height:34px;border-radius:99px;display:grid;place-items:center;font-weight:800;background:var(--sub-accent,#22d3ee);color:#04141a}b{display:block;color:var(--sub-fg-strong,#fff)}small{color:var(--sub-fg-muted,#8b949e)}@keyframes lit{0%,100%{transform:none;border-color:var(--sub-border,rgba(255,255,255,.12))}10%,30%{transform:translateX(6px);border-color:var(--sub-accent,#22d3ee);box-shadow:0 10px 30px -14px var(--sub-accent,#22d3ee)}40%{transform:none}}",
    }, style: { w: "fill" } }]),
  },
  {
    id: "install", cat: "connect", icon: "frame",
    en: ["Installation guide", "Platforms, apps and steps — every text is editable"], ru: ["Инструкция по установке", "Платформы, приложения и шаги — все тексты редактируются"],
    build: () => {
      const b = defaultV2().blocks.find((x) => x.kind === "installation-guide");
      const n = blockNode(b ?? ({ id: "install", kind: "installation-guide", enabled: true } as never));
      n.name = "Installation guide";
      return { root: n.id, nodes: { [n.id]: n } };
    },
  },
  {
    id: "aurora", cat: "decor", icon: "frame",
    en: ["Aurora card", "Animated gradient background card"], ru: ["Карточка «Аврора»", "Анимированный градиентный фон"],
    build: (l) => build(["html", { name: "Aurora", props: {
      html: `<div class="a"><h3>{{ user.username }}</h3><p>${L(l, "Your private connection is ready", "Ваше приватное подключение готово")}</p></div>`,
      css: "@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}@keyframes m{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}.a{padding:28px;border-radius:24px;background:linear-gradient(120deg,#22d3ee55,#9775fa55,#f472b655,#22d3ee55);background-size:300% 300%;animation:m 10s ease infinite;border:1px solid rgba(255,255,255,.14)}h3{margin:0 0 6px;font-size:24px}p{margin:0;opacity:.75}",
    }, style: { w: "fill" } }]),
  },
];


CATALOG.push(
  {
    id: "scene-connect", cat: "connect", icon: "scene",
    en: ["Scene: how to connect", "Animated device → app → subscription → internet"], ru: ["Сцена: как подключиться", "Анимация: устройство → приложение → подписка → интернет"],
    build: (l) => sceneItem(l, "Scene: how to connect", {
      actors: [A("dev", "Device", "Устройство", "smartphone", 10, 55, undefined, l), A("app", "App", "Приложение", "download", 33, 55, "blue", l), A("sub", "Subscription", "Подписка", "key", 56, 55, "amber", l), A("prot", "Protected", "Защита", "shield", 78, 55, "green", l), A("net", "Internet", "Интернет", "globe", 92, 20, undefined, l)],
      links: [["dev", "app"], ["app", "sub"], ["sub", "prot"], ["prot", "net"]],
      steps: [
        { caption: L(l, "1. Take your device", "1. Возьмите устройство"), show: ["dev"], focus: ["dev"] },
        { caption: L(l, "2. Install the app", "2. Установите приложение"), show: ["dev", "app"], focus: ["app"], flows: [{ from: "dev", to: "app", tone: "blue" }] },
        { caption: L(l, "3. Add your subscription link", "3. Добавьте ссылку подписки"), show: ["dev", "app", "sub"], focus: ["sub"], flows: [{ from: "app", to: "sub", tone: "amber" }] },
        { caption: L(l, "4. Connect and you are protected", "4. Подключитесь — вы под защитой"), show: ["dev", "app", "sub", "prot"], focus: ["prot"], flows: [{ from: "sub", to: "prot", tone: "green" }] },
        { caption: L(l, "5. Open the internet freely", "5. Свободный интернет"), show: ["dev", "app", "sub", "prot", "net"], focus: ["net"], flows: [{ from: "prot", to: "net" }] },
      ],
    }),
  },
  {
    id: "scene-lifecycle", cat: "info", icon: "scene",
    en: ["Scene: subscription lifecycle", "Client, limits, traffic, expiry, renewal"], ru: ["Сцена: жизнь подписки", "Клиент, лимиты, трафик, срок, продление"],
    build: (l) => sceneItem(l, "Scene: subscription lifecycle", {
      actors: [A("cl", "You", "Вы", "user", 12, 50, undefined, l), A("lim", "Limits", "Лимиты", "gauge", 38, 22, "blue", l), A("tr", "Traffic", "Трафик", "activity", 38, 78, "accent", l), A("exp", "Expiry", "Срок", "calendar", 68, 50, "amber", l), A("ren", "Renewal", "Продление", "rocket", 90, 50, "green", l)],
      links: [["cl", "lim"], ["cl", "tr"], ["lim", "exp"], ["tr", "exp"], ["exp", "ren"]],
      steps: [
        { caption: L(l, "You have a subscription", "У вас есть подписка"), show: ["cl"], focus: ["cl"] },
        { caption: L(l, "It has a device limit", "У неё есть лимит устройств"), show: ["cl", "lim"], focus: ["lim"], flows: [{ from: "cl", to: "lim", tone: "blue" }] },
        { caption: L(l, "Traffic is counted as you use it", "Трафик считается по мере использования"), show: ["cl", "lim", "tr"], focus: ["tr"], flows: [{ from: "cl", to: "tr" }] },
        { caption: L(l, "Until the expiry date", "До даты окончания"), show: ["cl", "lim", "tr", "exp"], focus: ["exp"], flows: [{ from: "lim", to: "exp", tone: "amber" }, { from: "tr", to: "exp", tone: "amber" }] },
        { caption: L(l, "Renew in time to keep access", "Продлите вовремя, чтобы сохранить доступ"), show: ["cl", "lim", "tr", "exp", "ren"], focus: ["ren"], flows: [{ from: "exp", to: "ren", tone: "green" }] },
      ],
    }),
  },
  {
    id: "scene-devices", cat: "devices", icon: "scene",
    en: ["Scene: devices limit", "Phone, tablet, laptop and the slot limit"], ru: ["Сцена: лимит устройств", "Телефон, планшет, ноутбук и лимит слотов"],
    build: (l) => sceneItem(l, "Scene: devices limit", {
      actors: [A("ph", "Phone", "Телефон", "smartphone", 12, 22, "green", l), A("tb", "Tablet", "Планшет", "tablet", 12, 50, "green", l), A("lp", "Laptop", "Ноутбук", "laptop", 12, 78, "rose", l), A("slot", "Device slots", "Слоты устройств", "lock", 60, 50, "blue", l), A("ok", "Connected", "Подключено", "check", 90, 32, "green", l), A("no", "Rejected", "Отклонено", "x", 90, 78, "rose", l)],
      links: [["ph", "slot"], ["tb", "slot"], ["lp", "slot"], ["slot", "ok"], ["slot", "no"]],
      steps: [
        { caption: L(l, "Each subscription has a limited number of device slots", "У подписки ограниченное число слотов устройств"), show: ["slot"], focus: ["slot"] },
        { caption: L(l, "Phone takes a slot", "Телефон занимает слот"), show: ["slot", "ph", "ok"], focus: ["ph"], flows: [{ from: "ph", to: "slot", tone: "green" }, { from: "slot", to: "ok", tone: "green" }] },
        { caption: L(l, "So does the tablet", "Планшет тоже"), show: ["slot", "ph", "tb", "ok"], focus: ["tb"], flows: [{ from: "tb", to: "slot", tone: "green" }, { from: "slot", to: "ok", tone: "green" }] },
        { caption: L(l, "The laptop is over the limit and is rejected", "Ноутбук сверх лимита — отклонён"), show: ["slot", "ph", "tb", "lp", "ok", "no"], focus: ["lp", "no"], flows: [{ from: "lp", to: "slot", tone: "rose" }, { from: "slot", to: "no", tone: "rose" }] },
      ],
    }),
  },
  {
    id: "scene-traffic", cat: "traffic", icon: "scene",
    en: ["Scene: traffic journey", "Device → node → internet with a traffic meter"], ru: ["Сцена: путь трафика", "Устройство → узел → интернет со счётчиком"],
    build: (l) => sceneItem(l, "Scene: traffic journey", {
      actors: [A("dev", "Device", "Устройство", "laptop", 12, 60, undefined, l), A("node", "Server node", "Сервер", "server", 50, 60, "blue", l), A("net", "Internet", "Интернет", "globe", 88, 60, undefined, l), A("meter", "Traffic meter", "Счётчик трафика", "gauge", 50, 16, "amber", l)],
      links: [["dev", "node"], ["node", "net"], ["node", "meter"]],
      steps: [
        { caption: L(l, "Your device sends a request", "Устройство отправляет запрос"), show: ["dev"], focus: ["dev"] },
        { caption: L(l, "It goes encrypted to a server node", "Запрос идёт в зашифрованном виде на сервер"), show: ["dev", "node"], focus: ["node"], flows: [{ from: "dev", to: "node" }] },
        { caption: L(l, "The node reaches the internet for you", "Сервер выходит в интернет за вас"), show: ["dev", "node", "net"], focus: ["net"], flows: [{ from: "node", to: "net", tone: "blue" }] },
        { caption: L(l, "Every byte is counted in your traffic meter", "Каждый байт учитывается в счётчике трафика"), show: ["dev", "node", "net", "meter"], focus: ["meter"], flows: [{ from: "node", to: "meter", tone: "amber" }, { from: "net", to: "node", tone: "blue" }] },
      ],
    }),
  },
);

import { CATALOG_ANIM } from "./catalog-anim";
import { CATALOG_SCENES } from "./catalog-scenes";
import { CATALOG_STEPS } from "./catalog-steps";
import { CATALOG_PLANS } from "./catalog-more";
import { CATALOG_MORE_B } from "./catalog-more-b";
CATALOG.push(...CATALOG_STEPS, ...CATALOG_SCENES, ...CATALOG_ANIM, ...CATALOG_PLANS, ...CATALOG_MORE_B);

/** An element ready to insert: texts follow the page language. */
export function buildCatalogItem(item: CatalogItem): Subtree {
  return buildWithI18n((l) => item.build(l));
}

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((c) => c.id === id);
}
