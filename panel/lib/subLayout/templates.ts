import { tpl, type PageTemplate } from "./templates-kit";
import { MORE_TEMPLATES } from "./templates-more";

export type { PageTemplate } from "./templates-kit";

export const PAGE_TEMPLATES: PageTemplate[] = [
  tpl("wow", ["Wow showcase", "Animated rings, live status, scene, one-tap connect"], ["Вау-шоукейс", "Кольца, живой статус, сцена, подключение в одно касание"], "web", (p) => {
    p.add("greeting");
    const top = p.grid(230, "Ring and status");
    p.add("traffic-ring", top);
    const col = p.column(top, "Status column");
    p.add("status-live", col).add("days-left", col);
    p.add("low-traffic").add("stat-trio").add("devices-tiles").add("scene-connect").add("cta-connect").add("step-timeline").add("copy-link").add("support-card").add("footer");
  }),
  tpl("zen", ["Minimal zen", "Only what matters: status, traffic, connect"], ["Минимал Дзен", "Только главное: статус, трафик, подключение"], "default", (p) => {
    p.add("status-live").add("traffic-bar").add("cta-connect").add("copy-link").add("footer");
  }, 560),
  tpl("dashboard", ["Pro dashboard", "Two columns on desktop: gauges, devices, traffic scene"], ["Дашборд Pro", "Две колонки на десктопе: индикаторы, устройства, сцена трафика"], "midnight", (p) => {
    p.add("profile-glass");
    const g = p.grid(300, "Gauges");
    p.add("anim-gauge", g).add("anim-days-ring", g).add("traffic-bar", g).add("device-slots", g);
    p.add("stat-trio").add("devices-tiles").add("scene-traffic").add("app-grid").add("support-card").add("footer");
  }, 1000),
  tpl("kawaii", ["Kawaii", "Soft pink, confetti and friendly steps"], ["Кавай", "Нежно-розовый, конфетти и дружелюбные шаги"], "helloKitty", (p) => {
    p.add("greeting").add("days-left").add("traffic-ring").add("anim-confetti").add("step-carousel").add("cta-connect").add("announce").add("footer");
  }, 620),
  tpl("neon", ["Cyber neon", "Sonar, terminal steps and glowing gauges"], ["Кибер-неон", "Сонар, шаги-терминал и светящиеся индикаторы"], "neon", (p) => {
    p.add("anim-sonar").add("anim-gauge").add("anim-conic-border").add("step-terminal").add("scene-connect").add("cta-connect").add("copy-link").add("footer");
  }, 700),
  tpl("glass", ["Liquid glass", "Light frosted cards with a phone walkthrough"], ["Жидкое стекло", "Светлые матовые карточки и шаги на телефоне"], "vision", (p) => {
    p.add("profile-glass").add("stat-trio").add("devices-tiles").add("step-phone").add("copy-link").add("support-card").add("footer");
  }, 680),
  tpl("sunset", ["Sunset", "Warm gradients, waves and a route to connect"], ["Закат", "Тёплые градиенты, волны и маршрут подключения"], "sunset", (p) => {
    p.add("anim-waves").add("anim-days-ring").add("traffic-bar").add("step-route").add("app-grid").add("support-card").add("footer");
  }, 680),
  tpl("guide", ["Onboarding guide", "Guide first: stepper, setup scenes, FAQ"], ["Онбординг", "Сначала инструкция: степпер, сцены настройки, FAQ"], "boreal", (p) => {
    p.add("status-live").add("step-stepper").add("scene-setup-ios").add("scene-setup-android").add("cta-connect").add("faq").add("support-card").add("footer");
  }, 720),
  tpl("compact", ["Compact", "A dense layout that fits one phone screen"], ["Компактный", "Плотный макет для одного экрана телефона"], "ember", (p) => {
    p.add("profile-glass").add("stat-trio").add("app-list").add("copy-link").add("footer");
  }, 520),
  tpl("glam", ["Glam", "Bold pink and gold with sparkles"], ["Гламур", "Яркий розовый и золото с искрами"], "barbie", (p) => {
    p.add("greeting").add("anim-particles").add("traffic-ring").add("step-numbers").add("cta-connect").add("announce").add("footer");
  }, 620),
  tpl("story", ["Storyteller", "Explains the service with animated scenes"], ["Рассказчик", "Объясняет сервис анимированными сценами"], "starWars", (p) => {
    p.add("greeting").add("scene-connect").add("scene-security").add("scene-lifecycle").add("scene-devices").add("cta-connect").add("support-card").add("footer");
  }, 720),
];

PAGE_TEMPLATES.push(...MORE_TEMPLATES);

export function templateById(id: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((t) => t.id === id);
}
