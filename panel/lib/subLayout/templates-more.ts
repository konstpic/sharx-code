import { tpl, type PageTemplate } from "./templates-kit";

const V = (o: Record<string, string>) => ({ tg: "", notice: "", renewUrl: "", referralUrl: "", ...o });

/** Scenario-driven page templates that use the plans, status, social and support elements. */
export const MORE_TEMPLATES: PageTemplate[] = [
  tpl("storefront", ["Reseller storefront", "Plans, renewal, referral and payment methods"], ["Витрина реселлера", "Тарифы, продление, рефералка и способы оплаты"], "sunset", (p) => {
    p.vars = V({ promo: "", promoEnds: "" });
    p.add("hero-gradient").add("plans-promo-banner").add("plans-renew-card");
    const g = p.grid(300, "Plans and usage");
    p.add("plans-compare", g).add("plans-data-usage", g);
    p.add("plans-referral").add("plans-payment-badges").add("connect-telegram-cta").add("faq-cards").add("legal-footer");
  }, 860),
  tpl("gamer", ["Gamer", "Ping and speed tiles, live status, neon glow"], ["Геймер", "Плитки пинга и скорости, живой статус, неон"], "neon", (p) => {
    p.vars = V({ ping: "18", down: "940", up: "880", uptime: "99.9%" });
    p.add("hero-mesh").add("status-speed-tiles").add("status-server");
    const g = p.grid(260, "Gauges");
    p.add("anim-gauge", g).add("anim-equalizer", g);
    p.add("plans-expiry-pill").add("app-grid").add("copy-link").add("legal-footer");
  }, 760),
  tpl("family", ["Family pack", "Devices, family sharing and simple steps"], ["Семейный пакет", "Устройства, семейный доступ и простые шаги"], "boreal", (p) => {
    p.add("hero-glass").add("plans-expiry-pill");
    const g = p.grid(300, "Family");
    p.add("plans-family", g).add("plans-limit-meter", g);
    p.add("devices-tiles").add("connect-qr-steps").add("info-how-it-works").add("help-checklist").add("contact-tiles").add("legal-footer");
  }, 760),
  tpl("corporate", ["Corporate", "Clean layout, security badges and support"], ["Корпоративный", "Строгий макет, значки безопасности и поддержка"], "default", (p) => {
    p.vars = V({ email: "support@example.com", termsUrl: "", privacyUrl: "" });
    p.add("hero-minimal").add("stat-trio").add("trust-badges").add("trust-shield").add("app-list").add("faq-numbered").add("contact-tiles").add("legal-footer");
  }, 720),
  tpl("mobile-one", ["Mobile-first one screen", "Everything key on a single phone screen"], ["Один экран для телефона", "Всё главное на одном экране телефона"], "ember", (p) => {
    p.add("hero-minimal").add("plans-expiry-pill").add("traffic-bar").add("app-grid").add("copy-link").add("connect-sticky-cta").add("legal-footer");
  }, 480),
  tpl("status", ["Status page", "Server status, maintenance and troubleshooting"], ["Страница статуса", "Статус серверов, работы и решение проблем"], "midnight", (p) => {
    p.vars = V({ notice: "", uptime: "99.98%", ping: "22 ms" });
    p.add("hero-glass").add("status-maintenance").add("status-notice-visible").add("status-server").add("status-speed-tiles").add("info-changelog").add("help-checklist").add("contact-tiles").add("legal-footer");
  }, 780),
  tpl("telegram", ["Telegram-first", "Bot CTA, app download cards and social links"], ["Telegram-first", "Кнопка бота, карточки скачивания и соцсети"], "vision", (p) => {
    p.vars = V({ tg: "https://t.me/example_bot", channel: "https://t.me/example", iosUrl: "https://apps.apple.com", androidUrl: "https://play.google.com", windowsUrl: "#", macUrl: "#", linuxUrl: "#" });
    p.add("hero-gradient").add("connect-telegram-cta").add("plans-renew-card").add("apps-download-cards").add("connect-qr-steps").add("social-links").add("faq-cards").add("legal-footer");
  }, 680),
  tpl("creator", ["Content creator", "Social proof, testimonials and community links"], ["Контент-мейкер", "Соцдоказательства, отзывы и ссылки на сообщество"], "barbie", (p) => {
    p.vars = V({ channel: "https://t.me/example", chatUrl: "https://t.me/example_chat" });
    p.add("hero-glass").add("social-proof-stats").add("social-testimonials").add("info-how-it-works").add("plans-referral").add("social-links").add("cta-connect").add("legal-footer");
  }, 800),
  tpl("luxe", ["Premium dark luxe", "Glowing border, mesh hero and refined cards"], ["Премиум люкс", "Светящаяся рамка, живой фон и тонкие карточки"], "starWars", (p) => {
    p.add("hero-mesh").add("anim-conic-border").add("plans-renew-card").add("plans-data-usage").add("trust-badges").add("cta-connect").add("faq-cards").add("legal-footer");
  }, 700),
  tpl("pastel", ["Pastel soft", "Gentle colors, rounded cards and clear steps"], ["Пастельный", "Нежные цвета, скруглённые карточки и понятные шаги"], "helloKitty", (p) => {
    p.add("hero-minimal").add("plans-expiry-pill").add("stat-trio").add("info-how-it-works").add("step-numbers").add("app-grid").add("faq-numbered").add("legal-footer");
  }, 620),
];
