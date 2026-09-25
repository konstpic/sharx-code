import type { CatalogItem } from "./catalog";
import { ACCENT, L, LP, MUTED, T, gradient, surface } from "./catalog-kit";
import { AC, AM, BAD, FM, FS, OK, WARN, mk, mkSpec } from "./catalog-more-kit";
import type { Spec } from "./presets";

const btn = (name: string, label: string, value: string, variant: "solid" | "outline", icon?: string, action = "link"): Spec =>
  ["button", { name, props: { label, action, value, variant, ...(icon ? { icon } : {}), ...(action === "link" ? { newTab: true } : {}) }, style: { radius: 12, pad: [11, 16, 11, 16], fw: 600 } }];
const row = (name: string, kids: Spec[], style: Record<string, unknown> = {}): Spec => ["frame", { name, style: { mode: "stack", dir: "row", gap: 10, pad: 0, w: "fill", align: "center", wrap: true, ...style } }, kids];

/** Plans, referral, promo and payment elements. */
export const CATALOG_PLANS: CatalogItem[] = [
  mk("plans-renew-card", "plans", ["Renewal card", "Days left progress and a Renew button (vars.renewUrl)"], ["Карточка продления", "Прогресс срока и кнопка «Продлить» (vars.renewUrl)"],
    (l) => `<div class="c"><div class="row"><h3>${L(l, "Your plan", "Ваш тариф")}</h3><span class="pill {{#if user.daysLeft <= 3}}bad{{else}}{{#if user.daysLeft <= 7}}warn{{else}}ok{{/if}}{{/if}}">{{ user.userStatus }}</span></div><div class="bar"><i style="width:{{#if user.neverExpires}}100{{else}}{{ clamp(user.daysLeft*100/30,4,100) }}{{/if}}%"></i></div><p class="m">{{#if user.neverExpires}}${L(l, "No expiry date", "Без срока окончания")}{{else}}{{ user.daysLeft }} {{ user.daysLeft | plural(${LP(l, "day", "день")}, ${LP(l, "days", "дня")}, ${LP(l, "days", "дней")}) }} ${L(l, "left, until", "осталось, до")} {{ user.expiresAt | date("DD.MM.YYYY") }}{{/if}}</p>{{#if vars.renewUrl}}<a class="b" href="{{ vars.renewUrl }}" target="_blank" rel="noopener">${L(l, "Renew", "Продлить")}</a>{{/if}}</div>`,
    `.pill{margin-left:auto;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;background:color-mix(in oklab,${OK} 18%,transparent);color:${OK}}.pill.warn{background:color-mix(in oklab,${WARN} 18%,transparent);color:${WARN}}.pill.bad{background:color-mix(in oklab,${BAD} 18%,transparent);color:${BAD}}.bar i{transition:width .8s}`),
  mk("plans-expiry-pill", "plans", ["Expiry pill", "Days left pill: green, amber, red"], ["Плашка срока", "Дней осталось: зелёная, жёлтая, красная"],
    (l) => `<div class="w"><span class="p {{#if user.daysLeft <= 3}}bad{{else}}{{#if user.daysLeft <= 7}}warn{{else}}ok{{/if}}{{/if}}"><i></i>{{#if user.neverExpires}}${L(l, "No expiry", "Бессрочно")}{{else}}{{ user.daysLeft }} {{ user.daysLeft | plural(${LP(l, "day", "день")}, ${LP(l, "days", "дня")}, ${LP(l, "days", "дней")}) }} ${L(l, "left", "осталось")}{{/if}}</span></div>`,
    `.w{display:flex;justify-content:center}.p{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:99px;font-weight:600;font-size:14px;color:${OK};background:color-mix(in oklab,${OK} 15%,transparent);border:1px solid color-mix(in oklab,${OK} 40%,transparent)}.p i{width:9px;height:9px;border-radius:50%;background:currentColor;animation:k 2s ease-in-out infinite}.p.warn{color:${WARN};background:color-mix(in oklab,${WARN} 15%,transparent);border-color:color-mix(in oklab,${WARN} 40%,transparent)}.p.bad{color:${BAD};background:color-mix(in oklab,${BAD} 15%,transparent);border-color:color-mix(in oklab,${BAD} 40%,transparent)}@keyframes k{50%{opacity:.35;transform:scale(.7)}}`),
  mk("plans-promo-banner", "plans", ["Promo banner", "Discount banner with a shimmer and countdown text (vars.promo, vars.promoEnds)"], ["Промо-баннер", "Баннер со скидкой, бликом и таймером (vars.promo, vars.promoEnds)"],
    (l) => `<div class="c pr"><span class="tag">${L(l, "Limited offer", "Ограниченное предложение")}</span><h3>{{ vars.promo | default(${LP(l, "-20% on any renewal", "-20% на любое продление")}) }}</h3>{{#if vars.promoEnds}}<p class="m">${L(l, "Ends", "Действует до")} {{ vars.promoEnds }}</p>{{/if}}{{#if vars.renewUrl}}<a class="b" href="{{ vars.renewUrl }}" target="_blank" rel="noopener">${L(l, "Get the offer", "Забрать скидку")}</a>{{/if}}</div>`,
    `.pr{background:linear-gradient(120deg,color-mix(in oklab,${AC} 28%,transparent),color-mix(in oklab,${AM} 28%,transparent));border-color:${AC}}.pr:after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.18) 50%,transparent 60%);transform:translateX(-100%);animation:sh 3.5s ease-in-out infinite}.tag{justify-self:start;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:${AC};color:#04141a}.pr h3{font-size:22px}.pr .b{justify-self:start}@keyframes sh{60%,100%{transform:translateX(100%)}}`),
  mk("plans-compare", "plans", ["Plan comparison", "Three plan tiles with a highlighted one"], ["Сравнение тарифов", "Три тарифа, один выделен"],
    (l) => `<div class="g3">${[[L(l, "Month", "Месяц"), "1", L(l, "Basic", "Базовый")], [L(l, "Quarter", "Квартал"), "3", L(l, "Popular", "Популярный")], [L(l, "Year", "Год"), "12", L(l, "Best value", "Выгодно")]].map(([n, m, tag], i) => `<div class="t${i === 1 ? " hot" : ""}"><small>${tag}</small><b>${n}</b><span class="m">${m} ${L(l, "mo.", "мес.")}</span>${i === 1 ? `<a class="b" href="{{ vars.renewUrl | default('#') }}" target="_blank" rel="noopener">${L(l, "Choose", "Выбрать")}</a>` : ""}</div>`).join("")}</div>`,
    `.g3{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.t{text-align:center;justify-items:center;padding:20px 14px}.t.hot{border-color:${AC};box-shadow:0 0 30px -10px ${AC};transform:translateY(-4px)}.t b{font-size:22px;color:${FS}}.t .b{margin-top:6px}`),
  mkSpec("plans-referral", "plans", "button", ["Referral card", "Invite link with Copy and QR (vars.referralUrl)"], ["Реферальная карточка", "Ссылка-приглашение с «Копировать» и QR (vars.referralUrl)"],
    (l) => ["frame", { name: "Referral", visibleIf: "vars.referralUrl", style: { ...gradient, gap: 12 } }, [
      ["icon", { name: "Icon", props: { name: "gift", size: 26 } }],
      T(L(l, "Invite a friend", "Пригласите друга"), { fs: 20, fw: 700 }, "h3"),
      T(L(l, "Share your link: you both get bonus days.", "Поделитесь ссылкой: вы оба получите бонусные дни."), { fs: 14, color: MUTED }),
      T("{{ vars.referralUrl }}", { fs: 12, family: "mono", truncate: true, color: MUTED }),
      row("Actions", [
        btn("Copy", L(l, "Copy link", "Копировать"), "{{ vars.referralUrl }}", "solid", undefined, "copy"),
        btn("QR", "QR", "{{ vars.referralUrl }}", "outline", undefined, "qr"),
      ]),
    ]]),
  mkSpec("plans-payment-badges", "plans", "frame", ["Payment methods", "Row of payment method badges"], ["Способы оплаты", "Ряд бейджей способов оплаты"],
    (l) => ["frame", { name: "Payments", style: { ...surface, gap: 10 } }, [
      T(L(l, "Pay the way you like", "Платите как удобно"), { fs: 15, fw: 600 }),
      row("Badges", ["Visa", "Mastercard", "Mir", "SBP", "USDT", "TON"].map((n) => ["badge", { name: n, props: { text: n === "SBP" ? L(l, "Fast payments", "СБП") : n === "Mir" ? L(l, "Mir", "Мир") : n, tone: "neutral" } }] as Spec)),
    ]]),
  mk("plans-data-usage", "plans", ["Data usage breakdown", "Used vs remaining traffic bars"], ["Расход трафика", "Полосы: использовано и осталось"],
    (l) => `<div class="c"><h3>${L(l, "Data usage", "Расход трафика")}</h3><div><div class="row"><small>${L(l, "Used", "Использовано")}</small><b class="r">{{ user.trafficUsed }}</b></div><div class="bar"><i style="width:{{ clamp(user.percentUsed,1,100) }}%"></i></div></div><div><div class="row"><small>${L(l, "Remaining", "Осталось")}</small><b class="r">{{ user.remaining }}</b></div><div class="bar rem"><i style="width:{{#if user.unlimited}}100{{else}}{{ clamp(100 - user.percentUsed,1,100) }}{{/if}}%"></i></div></div><small>${L(l, "Limit", "Лимит")}: {{#if user.unlimited}}∞{{else}}{{ user.trafficLimit }}{{/if}}</small></div>`,
    `.r{margin-left:auto}.rem i{background:${OK}}.bar i{transform-origin:left;animation:g 1.2s ease-out}@keyframes g{from{transform:scaleX(0)}}`),
  mk("plans-limit-meter", "plans", ["Device limit meter", "Segments for each device slot"], ["Счётчик устройств", "Сегменты по слотам устройств"],
    (l) => `<div class="c" ><div class="row"><h3>${L(l, "Devices", "Устройства")}</h3><b class="r">{{ devices.count }}{{#if !devices.unlimited}} / {{ devices.max }}{{/if}}</b></div>{{#if !devices.unlimited}}<div class="seg">{{#each devices.items as d}}<i class="on"></i>{{/each}}</div><small>{{ devices.left }} ${L(l, "slots free", "слотов свободно")}</small>{{else}}<small>${L(l, "No device limit", "Без ограничения устройств")}</small>{{/if}}</div>`,
    `.r{margin-left:auto}.seg{display:flex;gap:6px}.seg i{flex:1;height:12px;border-radius:6px;background:${AC};box-shadow:0 0 12px -2px ${AC}}`),
  mkSpec("plans-family", "plans", "frame", ["Family sharing", "Share one subscription with the family"], ["Семейный доступ", "Одна подписка на всю семью"],
    (l) => ["frame", { name: "Family", style: { ...surface, gap: 12 } }, [
      row("Head", [["icon", { name: "Icon", props: { name: "users", size: 24 } }], T(L(l, "Family sharing", "Семейный доступ"), { fs: 18, fw: 700 }, "h3")]),
      T(L(l, "One subscription covers up to {{ devices.max }} devices: phones, tablets and laptops of the whole family.", "Одна подписка покрывает до {{ devices.max }} устройств: телефоны, планшеты и ноутбуки всей семьи."), { fs: 14, color: MUTED }),
      ["progress", { name: "Family slots", props: { value: "{{ devices.count }}", max: "{{ devices.max }}", label: `{{ devices.count }} / {{ devices.max }} ${L(l, "devices in use", "устройств занято")}` } }],
      btn("Share", L(l, "Share the link", "Поделиться ссылкой"), "{{ subscription.url }}", "outline", undefined, "copy"),
    ]]),
];
void ACCENT; void FM;
