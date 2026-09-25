import type { CatalogItem } from "./catalog";
import { L, build } from "./catalog-kit";
import { animVars, applyStdCss, stdAnimParams } from "./params";
import type { ParamDef } from "./types";

const RM = "@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}";
/** Theme colors, overridable per element through the `accent` / `second` parameters (`--p-accent`, `--p-second`). */
const ACD = "var(--sub-accent,#22d3ee)";
const AMD = "var(--sub-accent-ambient,#9775fa)";
const AC = `var(--p-accent,${ACD})`;
const AM = `var(--p-second,${AMD})`;
const SUC = "var(--sub-success,#3fb950)";
const av = animVars;
const P = (o: Parameters<typeof stdAnimParams>[0] = {}, ...extra: ParamDef[]): ParamDef[] => [...stdAnimParams({ secondary: AMD, accent: ACD, ...o }), ...extra];
const N = (key: string, label: string, def: number, min: number, max: number, step: number, unit?: string, group = "Look"): ParamDef => ({ key, label, type: "range", default: def, min, max, step, ...(unit ? { unit } : {}), group });
const TX = (key: string, label: string, def: string): ParamDef => ({ key, label, type: "text", default: def, group: "Text" });
const BD = "var(--sub-border,rgba(255,255,255,.12))";
const SF = "var(--sub-surface,rgba(255,255,255,.05))";
const FG = "var(--sub-fg,#c9d1d9)";
const FS = "var(--sub-fg-strong,#fff)";
const FM = "var(--sub-fg-muted,#8b949e)";
const OK = `var(--p-accent,${SUC})`;
const card = `.c{position:relative;overflow:hidden;padding:20px;border-radius:22px;border:1px solid ${BD};background:${SF};color:${FG}}`;

type Cat = CatalogItem["cat"];
const mk = (id: string, cat: Cat, en: [string, string], ru: [string, string], html: (l: "en" | "ru") => string, css: string, params?: (l: "en" | "ru") => ParamDef[]): CatalogItem => ({
  id: `anim-${id}`, cat, icon: "html", en, ru,
  build: (l) => build(["html", { name: en[0], props: { html: html(l), css: (params ? applyStdCss(css) : css) + RM, ...(params ? { params: params(l), values: {} } : {}) }, style: { w: "fill" } }]),
});

export const CATALOG_ANIM: CatalogItem[] = [
  mk("conic-border", "motion", ["Glowing border card", "Rotating gradient border"], ["Светящаяся рамка", "Вращающаяся градиентная рамка"],
    (l) => `<div class="w"><div class="i"><small>${L(l, "Welcome back", "С возвращением")}</small><b>{{ user.username | truncate(18) }}</b><span>{{ user.daysLeft }} ${L(l, "days left", "дн. осталось")}</span></div></div>`,
    `@property --a{syntax:"<angle>";inherits:false;initial-value:0deg}.w{padding:2px;border-radius:24px;background:conic-gradient(from var(--a),${AC},${AM},transparent 40%,${AC});animation:r ${av("4s", "linear")};box-shadow:0 0 30px -8px ${AC}}.i{display:grid;gap:4px;padding:22px;border-radius:22px;background:var(--sub-surface-solid,var(--sub-bg,#0d1117));color:${FM}}.i b{font-size:22px;color:${FS}}@keyframes r{to{--a:360deg}}`,
    () => P({ dur: 4, easing: "linear", durMin: 0.5, durMax: 20 })),
  mk("sonar", "hero", ["Sonar secured", "Radar pulse: connection secured"], ["Сонар защиты", "Радар: соединение защищено"],
    (l) => `<div class="c"><div class="s"><i></i><i></i><i></i><em>🛡️</em></div><b>${L(l, "Connection secured", "Соединение защищено")}</b></div>`,
    `${card}.c{display:grid;justify-items:center;gap:14px}.s{position:relative;width:calc(120px * var(--p-size,1));height:calc(120px * var(--p-size,1));display:grid;place-items:center}.s i{position:absolute;inset:0;border-radius:50%;border:2px solid ${AC};opacity:0;animation:p ${av("3s", "ease-out")}}.s i:nth-child(2){animation-delay:calc(var(--p-delay,0s) + var(--p-dur,3s) / 3)}.s i:nth-child(3){animation-delay:calc(var(--p-delay,0s) + var(--p-dur,3s) * .667)}.s em{font-style:normal;font-size:38px}b{color:${FS}}@keyframes p{0%{transform:scale(.2);opacity:.9}100%{transform:scale(1);opacity:0}}`,
    () => P({ dur: 3, easing: "ease-out", size: true })),
  mk("orbit", "devices", ["Orbit apps", "App icons orbiting a shield"], ["Орбита приложений", "Иконки приложений вокруг щита"],
    () => `<div class="c"><div class="o"><em>🛡️</em>{{#each apps as a}}<span><img src="{{ a.iconUrl }}" alt="{{ a.label }}"></span>{{/each}}</div></div>`,
    `${card}.o{position:relative;width:200px;height:200px;margin:auto;border-radius:50%;border:1px dashed ${BD};animation:o ${av("18s", "linear", "infinite", "normal")}}.o em{position:absolute;inset:0;display:grid;place-items:center;font-style:normal;font-size:40px;animation:o var(--p-dur,18s) var(--p-easing,linear) var(--p-delay,0s) var(--p-iter,infinite) reverse}.o span{position:absolute;left:50%;top:50%;width:36px;height:36px;margin:-18px;display:grid;place-items:center;border-radius:12px;background:${SF};border:1px solid ${BD};animation:o var(--p-dur,18s) var(--p-easing,linear) var(--p-delay,0s) var(--p-iter,infinite) reverse}.o span:nth-of-type(1){transform:rotate(0deg) translateY(-100px)}.o span:nth-of-type(2){transform:rotate(90deg) translateY(-100px)}.o span:nth-of-type(3){transform:rotate(180deg) translateY(-100px)}.o span:nth-of-type(4){transform:rotate(270deg) translateY(-100px)}.o span:nth-of-type(n+5){display:none}.o img{width:24px;height:24px;border-radius:6px}@keyframes o{to{rotate:360deg}}`,
    () => P({ dur: 18, easing: "linear", durMin: 2, durMax: 60, omit: ["dir"], accent: false })),
  mk("gauge", "traffic", ["Speedometer", "Gauge needle sweep"], ["Спидометр", "Стрелка индикатора"],
    (l) => `<div class="c"><div class="g"><u></u><i style="--v:{{ user.percentUsed }}"></i></div><b>{{ user.percentUsed }}%</b><small>${L(l, "of traffic used", "трафика использовано")}</small></div>`,
    `${card}.c{display:grid;justify-items:center;gap:2px}.g{position:relative;width:180px;height:90px;overflow:hidden}.g u{position:absolute;left:0;top:0;width:180px;height:180px;border-radius:50%;background:conic-gradient(from 270deg,var(--sub-success,#3fb950),${AC},var(--sub-danger,#f85149) 50%,transparent 50%);-webkit-mask:radial-gradient(circle,transparent 58%,#000 60%);mask:radial-gradient(circle,transparent 58%,#000 60%)}.g i{position:absolute;left:88px;bottom:0;width:4px;height:78px;border-radius:4px;background:${FS};transform-origin:50% 100%;rotate:-90deg;animation:n ${av("1.8s", "cubic-bezier(.3,1.4,.4,1)", "1", "normal", ".2s")} forwards}b{font-size:26px;color:${FS}}small{color:${FM}}@keyframes n{to{rotate:calc(var(--v) * 1.8deg - 90deg)}}`,
    () => P({ dur: 1.8, easing: "cubic-bezier(.3,1.4,.4,1)", iter: "1", delay: 0.2, durMax: 6, secondary: false })),
  mk("equalizer", "traffic", ["Traffic equalizer", "Animated bar chart"], ["Эквалайзер трафика", "Анимированные столбики"],
    (l) => `<div class="c"><div class="e"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><small>${L(l, "Used", "Использовано")}: <b>{{ user.trafficUsed }}</b></small></div>`,
    `${card}.e{display:flex;align-items:flex-end;gap:6px;height:calc(80px * var(--p-size,1))}.e i{flex:1;height:100%;border-radius:6px;background:linear-gradient(${AC},${AM});transform-origin:bottom;animation:q ${av("1.2s", "ease-in-out", "infinite", "alternate")}}.e i:nth-child(2n){animation-duration:calc(var(--p-dur,1.2s) * .75);animation-delay:calc(var(--p-delay,0s) - var(--p-dur,1.2s) * .25)}.e i:nth-child(3n){animation-duration:calc(var(--p-dur,1.2s) * 1.25);animation-delay:calc(var(--p-delay,0s) - var(--p-dur,1.2s) * .6)}.e i:nth-child(5n){animation-delay:calc(var(--p-delay,0s) - var(--p-dur,1.2s) * .4)}small{display:block;margin-top:10px;color:${FM}}b{color:${FS}}@keyframes q{from{transform:scaleY(var(--p-min,.15))}to{transform:scaleY(1)}}`,
    () => P({ dur: 1.2, easing: "ease-in-out", dir: "alternate", size: true }, N("min", "Lowest bar", 0.15, 0.05, 0.9, 0.05))),
  mk("days-ring", "traffic", ["Days ring", "Ring with days left"], ["Кольцо дней", "Кольцо с остатком дней"],
    (l) => `<div class="c"><div class="r"><svg viewBox="0 0 100 100"><circle class="t" cx="50" cy="50" r="42"/><circle class="p" cx="50" cy="50" r="42" pathLength="100"/></svg><b>{{ user.daysLeft }}</b></div><small>${L(l, "days left", "дней осталось")}</small></div>`,
    `${card}.c{display:grid;justify-items:center;gap:6px}.r{position:relative;width:120px;height:120px;display:grid;place-items:center}svg{position:absolute;inset:0;rotate:-90deg}circle{fill:none;stroke-width:8;stroke-linecap:round}.t{stroke:${BD}}.p{stroke:${AC};stroke-dasharray:100;stroke-dashoffset:100;animation:f ${av("2s", "ease-out", "infinite", "alternate")};filter:drop-shadow(0 0 6px ${AC})}b{font-size:32px;color:${FS}}small{color:${FM}}@keyframes f{to{stroke-dashoffset:var(--p-end,15)}}`,
    () => P({ dur: 2, easing: "ease-out", dir: "alternate" }, N("end", "Gap left in the ring (%)", 15, 0, 100, 1))),
  mk("marquee", "motion", ["App marquee", "Scrolling ticker of app names"], ["Бегущая строка", "Лента названий приложений"],
    () => `<div class="c"><div class="m"><div>{{#each apps as a}}<span>{{ a.label }}</span>{{/each}}{{#each apps as a}}<span>{{ a.label }}</span>{{/each}}</div></div></div>`,
    `${card}.c{padding:14px 0}.m{overflow:hidden;-webkit-mask:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);mask:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}.m div{display:flex;gap:10px;width:max-content;animation:s ${av("20s", "linear")}}.m span{padding:8px 16px;border-radius:99px;border:1px solid ${BD};background:${SF};color:${FS};white-space:nowrap}@keyframes s{to{transform:translateX(-50%)}}`,
    () => P({ dur: 20, easing: "linear", durMin: 3, durMax: 90, accent: false, secondary: false })),
  mk("skeleton", "motion", ["Shimmer loader", "Skeleton shimmer placeholder"], ["Загрузка с бликом", "Скелетон с переливом"],
    () => `<div class="c"><div class="a"></div><div class="l"><i></i><i></i><i></i></div></div>`,
    `${card}.c{display:flex;gap:14px;align-items:center}.a,.l i{background:linear-gradient(100deg,${BD} 30%,color-mix(in oklab,${AC} 35%,transparent) 50%,${BD} 70%) 0 0/300% 100%;animation:h ${av("1.6s", "linear")}}.a{width:56px;height:56px;border-radius:50%}.l{flex:1;display:grid;gap:8px}.l i{display:block;height:12px;border-radius:6px}.l i:nth-child(2){width:70%}.l i:nth-child(3){width:45%}@keyframes h{to{background-position:-300% 0}}`,
    () => P({ dur: 1.6, easing: "linear", secondary: false })),
  mk("typewriter", "hero", ["Typewriter greeting", "Typing greeting line"], ["Печатающееся приветствие", "Строка печатается"],
    (l) => `<div class="c"><h3>${L(l, "Hello", "Привет")}, {{ user.username | truncate(14) }}!</h3></div>`,
    `${card}h3{margin:0;width:max-content;max-width:100%;overflow:hidden;white-space:nowrap;font:600 var(--p-fs,20px) ui-monospace,monospace;color:${FS};border-right:2px solid ${AC};animation:t ${av("3.5s", "steps(24)", "infinite", "alternate")},b .7s step-end infinite}@keyframes t{from{width:0}60%,to{width:100%}}@keyframes b{50%{border-color:transparent}}`,
    () => P({ dur: 3.5, easing: "steps(24)", dir: "alternate", secondary: false }, N("fs", "Font size", 20, 12, 48, 1, "px"))),
  mk("particles", "hero", ["Floating particles", "Hero with drifting glow dots"], ["Плавающие частицы", "Герой с парящими огоньками"],
    (l) => `<div class="c"><i></i><i></i><i></i><i></i><i></i><i></i><h3>${L(l, "You are protected", "Вы под защитой")}</h3><small>{{ user.username | truncate(18) }}</small></div>`,
    `${card}.c{min-height:150px;display:grid;align-content:center;justify-items:center;gap:4px}.c i{position:absolute;bottom:-10px;width:8px;height:8px;border-radius:50%;background:${AC};box-shadow:0 0 12px ${AC};opacity:0;animation:u ${av("6s", "ease-in")}}.c i:nth-child(1){left:10%}.c i:nth-child(2){left:28%;animation-delay:calc(var(--p-delay,0s) + var(--p-dur,6s) * .17);background:${AM}}.c i:nth-child(3){left:46%;animation-delay:calc(var(--p-delay,0s) + var(--p-dur,6s) * .42)}.c i:nth-child(4){left:64%;animation-delay:calc(var(--p-delay,0s) + var(--p-dur,6s) * .08);background:${AM}}.c i:nth-child(5){left:80%;animation-delay:calc(var(--p-delay,0s) + var(--p-dur,6s) * .5)}.c i:nth-child(6){left:92%;animation-delay:calc(var(--p-delay,0s) + var(--p-dur,6s) * .67)}h3{margin:0;color:${FS};font-size:22px}small{color:${FM}}@keyframes u{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(calc(var(--p-rise,170) * -1px));opacity:0}}`,
    () => P({ dur: 6, easing: "ease-in", durMax: 30 }, N("rise", "Rise height (px)", 170, 40, 400, 5))),
  mk("waves", "decor", ["Wave banner", "Ocean gradient waves"], ["Волны", "Градиентный океан"],
    (l) => `<div class="c"><h3>${L(l, "Smooth connection", "Плавное соединение")}</h3><svg viewBox="0 0 400 40" preserveAspectRatio="none"><path d="M0 20 Q50 0 100 20 T200 20 T300 20 T400 20 V40 H0Z"/></svg><svg class="b" viewBox="0 0 400 40" preserveAspectRatio="none"><path d="M0 20 Q50 40 100 20 T200 20 T300 20 T400 20 V40 H0Z"/></svg></div>`,
    `${card}.c{padding:26px 0 0;min-height:120px}h3{margin:0 20px 34px;color:${FS}}svg{position:absolute;left:0;bottom:0;width:200%;height:46px;animation:w ${av("7s", "linear", "infinite", "normal")}}svg path{fill:color-mix(in oklab,${AC} 45%,transparent)}.b{animation-duration:calc(var(--p-dur,7s) * 1.57);animation-direction:reverse}.b path{fill:color-mix(in oklab,${AM} 40%,transparent)}@keyframes w{to{transform:translateX(-50%)}}`,
    () => P({ dur: 7, easing: "linear", durMin: 1, durMax: 40, omit: ["dir"] })),
  mk("tilt", "motion", ["3D tilt card", "Perspective tilt on hover"], ["3D-карточка", "Наклон при наведении"],
    (l) => `<div class="p"><div class="c"><small>${L(l, "Devices", "Устройства")}</small><b>{{ devices.count }} / {{ devices.max }}</b></div></div>`,
    `${card}.p{perspective:700px}.c{transform:rotateX(calc(var(--p-tilt,6) * 1deg)) rotateY(calc(var(--p-tilt,6) * -1.33deg));transition:transform .5s;animation:fl ${av("5s", "ease-in-out")};box-shadow:0 24px 40px -24px ${AC}}.p:hover .c{transform:rotateX(0) rotateY(0);animation-play-state:paused}b{display:block;font-size:30px;color:${FS}}small{color:${FM}}@keyframes fl{50%{transform:rotateX(calc(var(--p-tilt,6) * -.67deg)) rotateY(calc(var(--p-tilt,6) * 1.33deg))}}`,
    () => P({ dur: 5, easing: "ease-in-out", secondary: false }, N("tilt", "Tilt (degrees)", 6, 0, 20, 1))),
  mk("toasts", "motion", ["Toast stack", "Notification toasts sliding in"], ["Стопка уведомлений", "Всплывающие уведомления"],
    (l) => `<div class="c"><p>✅ ${L(l, "Connected", "Подключено")}</p><p>🔒 ${L(l, "Encryption on", "Шифрование включено")}</p><p>⚡ ${L(l, "Fast server", "Быстрый сервер")}</p></div>`,
    `${card}.c{display:grid;gap:8px;min-height:130px;align-content:start}p{margin:0;padding:10px 14px;border-radius:14px;border:1px solid ${BD};color:${FS};background:color-mix(in oklab,${AC} 10%,${SF});opacity:0;animation:i ${av("6s", "ease-out")}}p:nth-child(2){animation-delay:calc(var(--p-delay,0s) + var(--p-dur,6s) / 6)}p:nth-child(3){animation-delay:calc(var(--p-delay,0s) + var(--p-dur,6s) / 3)}@keyframes i{0%{opacity:0;transform:translateX(40px)}8%,80%{opacity:1;transform:none}95%,100%{opacity:0;transform:translateY(-8px)}}`,
    () => P({ dur: 6, easing: "ease-out", durMax: 30, secondary: false })),
  mk("online", "decor", ["ONLINE badge", "Glowing pulse badge"], ["Бейдж ONLINE", "Пульсирующий бейдж"],
    () => `<div class="c"><span class="d"></span><b>{{ p.label }}</b><small>{{ now | date("HH:mm") }}</small></div>`,
    `${card}.c{display:inline-flex;align-items:center;gap:10px;padding:10px 18px;border-radius:99px;box-shadow:0 0 24px -6px ${OK}}.d{width:10px;height:10px;border-radius:50%;background:${OK};animation:p ${av("1.6s", "ease-out")}}b{letter-spacing:.14em;color:${OK};font-size:13px}small{color:${FM}}@keyframes p{0%{box-shadow:0 0 0 0 color-mix(in oklab,${OK} 70%,transparent)}100%{box-shadow:0 0 0 12px transparent}}`,
    (l) => P({ dur: 1.6, easing: "ease-out", accent: SUC, secondary: false }, TX("label", "Label", L(l, "ONLINE", "ОНЛАЙН")))),
  mk("countup", "traffic", ["Count-up stat", "Number counting up to usage %"], ["Счётчик", "Число растёт до % трафика"],
    (l) => `<div class="c" style="--to:{{ user.percentUsed }}"><div class="n"></div><small>${L(l, "traffic used", "трафика использовано")}</small></div>`,
    `@property --n{syntax:"<integer>";inherits:false;initial-value:0}${card}.n{font-size:calc(54px * var(--p-size,1));font-weight:800;line-height:1;background:linear-gradient(90deg,${AC},${AM});-webkit-background-clip:text;background-clip:text;color:transparent;counter-reset:n var(--n);animation:c ${av("2s", "ease-out", "1")} forwards}.n::after{content:counter(n) "%"}small{color:${FM}}@keyframes c{from{--n:0}to{--n:var(--to)}}`,
    () => P({ dur: 2, easing: "ease-out", iter: "1", size: true })),
  mk("shine", "motion", ["Shine title", "Gradient text shine"], ["Блик на тексте", "Переливающийся заголовок"],
    () => `<div class="c"><h2>{{ user.username | truncate(20) }}</h2></div>`,
    `${card}h2{margin:0;font-size:30px;background:linear-gradient(100deg,${FM} 35%,${FS} 50%,${AC} 55%,${FM} 70%) 0 0/250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:s ${av("3.5s", "linear")}}@keyframes s{to{background-position:-250% 0}}`,
    () => P({ dur: 3.5, easing: "linear", secondary: false })),
  mk("ripple-cta", "motion", ["Ripple button", "CTA look with ripple"], ["Кнопка с волной", "Вид CTA с волнами"],
    () => `<div class="c"><span class="b">{{ p.label }}<i></i><i></i></span></div>`,
    `.c{display:grid;place-items:center;padding:14px}.b{position:relative;padding:14px 34px;border-radius:99px;font-weight:700;color:#04141a;background:linear-gradient(90deg,${AC},${AM})}.b i{position:absolute;inset:0;border-radius:99px;border:2px solid ${AC};animation:r ${av("2.4s", "ease-out")}}.b i+i{animation-delay:calc(var(--p-delay,0s) + var(--p-dur,2.4s) / 2)}@keyframes r{to{transform:scale(1.5,1.9);opacity:0}}`,
    (l) => P({ dur: 2.4, easing: "ease-out" }, TX("label", "Label", L(l, "Connect now", "Подключиться")))),
  mk("lock", "hero", ["Unlocking lock", "Lock opens and closes"], ["Замок", "Замок открывается и закрывается"],
    (l) => `<div class="c"><div class="k"><u></u><i></i></div><b>${L(l, "Private & secure", "Приватно и безопасно")}</b></div>`,
    `${card}.c{display:grid;justify-items:center;gap:14px}.k{position:relative;width:56px;height:64px}.k i{position:absolute;bottom:0;width:56px;height:38px;border-radius:10px;background:linear-gradient(${AC},${AM})}.k u{position:absolute;left:11px;top:0;width:34px;height:34px;border:6px solid ${AC};border-bottom:0;border-radius:20px 20px 0 0;transform-origin:100% 100%;animation:l ${av("4s", "ease-in-out")}}b{color:${FS}}@keyframes l{0%,20%{transform:translateY(-9px) rotateY(160deg)}45%,90%{transform:none}100%{transform:translateY(-9px) rotateY(160deg)}}`,
    () => P({ dur: 4, easing: "ease-in-out", durMax: 20 })),
  mk("heartbeat", "decor", ["Heartbeat line", "Pulse line drawing"], ["Кардиограмма", "Линия пульса"],
    (l) => `<div class="c"><svg viewBox="0 0 300 60"><path pathLength="100" d="M0 30H90l10-22 14 46 12-30 8 6H300"/></svg><small>${L(l, "Stable connection", "Стабильное соединение")}</small></div>`,
    `${card}svg{width:100%;height:60px}path{fill:none;stroke:${AC};stroke-width:2.5;stroke-linecap:round;stroke-dasharray:40 60;animation:d ${av("2.4s", "linear")};filter:drop-shadow(0 0 5px ${AC})}small{color:${FM}}@keyframes d{from{stroke-dashoffset:40}to{stroke-dashoffset:-60}}`,
    () => P({ dur: 2.4, easing: "linear", secondary: false })),
  mk("confetti", "decor", ["Confetti burst", "Confetti on load"], ["Конфетти", "Салют при загрузке"],
    (l) => `<div class="c"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><h3>🎉 ${L(l, "All set!", "Всё готово!")}</h3></div>`,
    `${card}.c{min-height:130px;display:grid;place-items:center}.c i{position:absolute;left:50%;top:50%;width:8px;height:12px;border-radius:2px;background:${AC};opacity:0;animation:x ${av("2.4s", "ease-out")}}.c i:nth-child(2n){background:${AM}}.c i:nth-child(3n){background:var(--sub-success,#3fb950)}${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `.c i:nth-child(${n + 1}){--x:${Math.round(Math.cos(n * 0.785) * 110)}px;--y:${Math.round(Math.sin(n * 0.785) * 70)}px;--r:${n * 70}deg}`).join("")}h3{margin:0;color:${FS};z-index:1}@keyframes x{0%{transform:translate(0,0);opacity:1}80%{opacity:1}100%{transform:translate(calc(var(--x) * var(--p-spread,1)),calc(var(--y) * var(--p-spread,1))) rotate(var(--r));opacity:0}}`,
    () => P({ dur: 2.4, easing: "ease-out" }, N("spread", "Spread", 1, 0.3, 3, 0.1))),
];
