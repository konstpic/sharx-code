import type { CatalogItem } from "./catalog";
import { L, build } from "./catalog-kit";
import { animVars, applyStdCss, stdAnimParams } from "./params";
import type { ParamDef } from "./types";

type Lang = "en" | "ru";
const RM = "@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}";
const ACD = "var(--sub-accent,#22d3ee)";
const AMD = "var(--sub-accent-ambient,#9775fa)";
/** Overridable per element through the `accent` / `second` parameters. */
const AC = `var(--p-accent,${ACD})`;
const AM = `var(--p-second,${AMD})`;
const av = animVars;
/** Delays of the 2nd and 3rd step inside one cycle (a third / two thirds of the duration). */
const D1 = "calc(var(--p-delay,0s) + var(--p-dur,9s) / 3)";
const D2 = "calc(var(--p-delay,0s) + var(--p-dur,9s) * .667)";
const P = (o: Parameters<typeof stdAnimParams>[0] = {}): ParamDef[] => stdAnimParams({ dur: 9, durMin: 2, durMax: 40, accent: ACD, secondary: AMD, ...o });
const SF = "var(--sub-surface,rgba(255,255,255,.05))";
const BD = "var(--sub-border,rgba(255,255,255,.12))";
const FG = "var(--sub-fg,#e6edf3)";
const FS = "var(--sub-fg-strong,#fff)";
const FM = "var(--sub-fg-muted,#8b949e)";
const SO = "var(--sub-accent-soft,rgba(34,211,238,.16))";
const OK = "var(--sub-success,#34d399)";

/** [title, hint] for each of the 3 steps. */
const st = (l: Lang): [string, string][] => [
  [L(l, "Install the app", "Установите приложение"), L(l, "From the official store", "Из официального магазина")],
  [L(l, "Add the subscription", "Добавьте подписку"), L(l, "Paste the link or tap once", "Вставьте ссылку или нажмите раз")],
  [L(l, "Connect", "Подключитесь"), L(l, "Choose a server and go", "Выберите сервер и вперёд")],
];
const item = (id: string, en: [string, string], ru: [string, string], html: (l: Lang) => string, css: string, params: () => ParamDef[] = () => P()): CatalogItem => ({
  id, cat: "steps", icon: "html", en, ru,
  build: (l) => build(["html", { name: en[0], props: { html: html(l), css: applyStdCss(css) + RM, params: params(), values: {} }, style: { w: "fill" } }]),
});
const each = (fn: (s: [string, string], i: number) => string, l: Lang) => st(l).map(fn).join("");

export const CATALOG_STEPS: CatalogItem[] = [
  item("step-timeline", ["Timeline steps", "Vertical line draws itself, nodes light up"], ["Шаги-таймлайн", "Линия рисуется, узлы загораются"],
    (l) => `<ol>${each(([a, b]) => `<li><b>${a}</b><small>${b}</small></li>`, l)}</ol>`,
    `ol{list-style:none;margin:0;padding:0}li{position:relative;padding:0 0 26px 46px}li:last-child{padding-bottom:0}li::before{content:"";position:absolute;left:8px;top:6px;width:14px;height:14px;border-radius:99px;background:${SF};border:2px solid ${BD};animation:n ${av("9s")}}li::after{content:"";position:absolute;left:14px;top:22px;bottom:-2px;width:2px;background:linear-gradient(${AC},${AM});transform-origin:top;transform:scaleY(0);animation:d ${av("9s")}}li:last-child::after{display:none}li:nth-child(2)::before,li:nth-child(2)::after{animation-delay:${D1}}li:nth-child(3)::before{animation-delay:${D2}}b{display:block;color:${FS}}small{color:${FM}}@keyframes n{0%,4%{background:${SF};border-color:${BD};box-shadow:none}10%,90%{background:${AC};border-color:${AC};box-shadow:0 0 14px ${AC}}96%,100%{background:${SF};border-color:${BD};box-shadow:none}}@keyframes d{0%,8%{transform:scaleY(0)}30%,90%{transform:scaleY(1)}96%,100%{transform:scaleY(0)}}`),

  item("step-stepper", ["Progress stepper", "Bar fills, marker jumps between steps"], ["Степпер с прогрессом", "Полоса заполняется, маркер прыгает"],
    (l) => `<div class="w"><div class="t"><i></i><u></u></div><div class="g">${each(([a], i) => `<span><em>${i + 1}</em>${a}</span>`, l)}</div></div>`,
    `.w{padding:6px 4px}.t{position:relative;height:6px;border-radius:9px;background:${SF};border:1px solid ${BD};margin:14px 0 16px}i{position:absolute;inset:0;border-radius:9px;background:linear-gradient(90deg,${AC},${AM});transform-origin:left;animation:f ${av("9s", "ease-in-out")}}u{position:absolute;top:-8px;left:0;width:20px;height:20px;border-radius:99px;background:${AC};box-shadow:0 0 16px ${AC};animation:m ${av("9s", "ease-in-out")}}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;color:${FM};font-size:13px}em{display:block;font-style:normal;font-weight:800;color:${FS};font-size:18px}@keyframes f{0%,6%{transform:scaleX(.05)}30%,36%{transform:scaleX(.5)}60%,90%{transform:scaleX(1)}100%{transform:scaleX(.05)}}@keyframes m{0%,6%{left:0}30%,36%{left:calc(50% - 10px)}60%,90%{left:calc(100% - 20px)}100%{left:0}}`, () => P({ easing: "ease-in-out" })),

  item("step-carousel", ["Auto carousel", "Cards slide in turn with dots"], ["Авто-карусель шагов", "Карточки сменяются, точки внизу"],
    (l) => `<div class="c"><div class="v">${each(([a, b], i) => `<div class="k"><h4>0${i + 1}</h4><b>${a}</b><small>${b}</small></div>`, l)}</div><div class="p"><i></i><i></i><i></i></div></div>`,
    `.v{position:relative;height:130px}.k{position:absolute;inset:0;padding:20px;border-radius:20px;background:${SF};border:1px solid ${BD};opacity:0;transform:translateX(40px);animation:s ${av("9s")}}.k:nth-child(2){animation-delay:${D1}}.k:nth-child(3){animation-delay:${D2}}h4{margin:0;font-size:30px;background:linear-gradient(90deg,${AC},${AM});-webkit-background-clip:text;background-clip:text;color:transparent}b{display:block;color:${FS};font-size:17px}small{color:${FM}}.p{display:flex;gap:8px;justify-content:center;margin-top:12px}.p i{width:8px;height:8px;border-radius:9px;background:${BD};animation:o ${av("9s")}}.p i:nth-child(2){animation-delay:${D1}}.p i:nth-child(3){animation-delay:${D2}}@keyframes s{0%{opacity:0;transform:translateX(40px)}6%,30%{opacity:1;transform:none}36%,100%{opacity:0;transform:translateX(-40px)}}@keyframes o{0%,30%{background:${AC};width:22px}36%,100%{background:${BD};width:8px}}`),

  item("step-phone", ["Phone walkthrough", "Phone screen changes per step"], ["Шаги на телефоне", "Экран телефона меняется по шагам"],
    (l) => `<div class="ph"><div class="s a"><span>⬇</span><b>${st(l)[0][0]}</b></div><div class="s b"><span>🔗</span><b>${st(l)[1][0]}</b><code>{{ subscription.url }}</code></div><div class="s c"><span>🛡</span><b>${st(l)[2][0]}</b></div></div>`,
    `.ph{position:relative;width:170px;height:280px;margin:0 auto;border-radius:32px;border:6px solid ${FS};background:${SF};overflow:hidden;box-shadow:0 20px 40px -20px ${AC}}.ph::before{content:"";position:absolute;top:6px;left:50%;translate:-50% 0;width:50px;height:8px;border-radius:9px;background:${FS};z-index:2}.s{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:8px;padding:14px;text-align:center;opacity:0;animation:x ${av("9s")}}.b{animation-delay:${D1}}.c{animation-delay:${D2}}span{font-size:44px}b{color:${FS};font-size:14px}code{font-size:9px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${AC};background:${SO};padding:4px 6px;border-radius:6px}.c span{animation:pl 1.6s ease-in-out infinite}@keyframes x{0%{opacity:0}6%,30%{opacity:1}36%,100%{opacity:0}}@keyframes pl{50%{transform:scale(1.15);filter:drop-shadow(0 0 10px ${OK})}}`, () => P({ secondary: false })),

  item("step-checklist", ["Animated checklist", "Checkmarks draw one after another"], ["Чеклист с галочками", "Галочки рисуются по очереди"],
    (l) => `<ul>${each(([a, b]) => `<li><svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.5 3.5L17 9"/></svg><div><b>${a}</b><small>${b}</small></div></li>`, l)}</ul>`,
    `ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}li{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:16px;background:${SF};border:1px solid ${BD}}svg{flex:none;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}circle{stroke:${BD}}path{stroke:${OK};stroke-dasharray:20;stroke-dashoffset:20;animation:ck ${av("9s")}}li:nth-child(2) path{animation-delay:calc(var(--p-delay,0s) + var(--p-dur,9s) * .278)}li:nth-child(3) path{animation-delay:calc(var(--p-delay,0s) + var(--p-dur,9s) * .556)}b{display:block;color:${FS}}small{color:${FM}}@keyframes ck{0%{stroke-dashoffset:20}8%,85%{stroke-dashoffset:0}92%,100%{stroke-dashoffset:20}}`, () => P({ secondary: false })),

  item("step-route", ["Route with rocket", "A dot travels through pulsing stations"], ["Маршрут с ракетой", "Точка едет по станциям, они пульсируют"],
    (l) => `<div class="r"><div class="l"></div><u>🚀</u>${each(([a], i) => `<s style="left:${i * 50}%"></s>`, l)}</div><div class="n">${each(([a]) => `<span>${a}</span>`, l)}</div>`,
    `.r{position:relative;height:44px;margin:0 14px}.l{position:absolute;left:0;right:0;top:21px;border-top:3px dotted ${BD}}s{position:absolute;top:10px;width:24px;height:24px;margin-left:-12px;border-radius:99px;background:${SF};border:3px solid ${AC};animation:pu ${av("9s")}}.r s:nth-of-type(2){animation-delay:calc(var(--p-dur,9s) / -2)}s:first-of-type{margin-left:0}s:last-of-type{margin-left:-24px}u{position:absolute;top:6px;left:0;text-decoration:none;font-size:26px;animation:go ${av("9s", "linear")}}.n{display:grid;grid-template-columns:repeat(3,1fr);text-align:center;color:${FM};font-size:13px;margin-top:6px}@keyframes go{0%{left:0}90%,100%{left:calc(100% - 24px)}}@keyframes pu{0%,100%{box-shadow:0 0 0 0 transparent}10%{box-shadow:0 0 0 10px ${SO};background:${AC}}25%{box-shadow:0 0 0 0 transparent;background:${SF}}}`, () => P({ easing: "linear" })),

  item("step-accordion", ["Expanding steps", "Each step opens in turn with a glowing border"], ["Раскрывающиеся шаги", "Шаги раскрываются по очереди, рамка светится"],
    (l) => `<div class="a">${each(([a, b]) => `<div class="i"><b>${a}</b><p>${b}</p></div>`, l)}</div>`,
    `.a{display:grid;gap:10px}.i{padding:14px 16px;border-radius:16px;background:${SF};border:1px solid ${BD};animation:g ${av("9s")}}.i:nth-child(2){animation-delay:${D1}}.i:nth-child(3){animation-delay:${D2}}b{color:${FS}}p{margin:0;max-height:0;opacity:0;overflow:hidden;color:${FM};animation:e ${av("9s")}}.i:nth-child(2) p{animation-delay:${D1}}.i:nth-child(3) p{animation-delay:${D2}}@keyframes e{0%{max-height:0;opacity:0}6%,30%{max-height:60px;opacity:1;margin-top:6px}36%,100%{max-height:0;opacity:0}}@keyframes g{0%,36%,100%{border-color:${BD};box-shadow:none}6%,30%{border-color:${AC};box-shadow:0 0 22px -6px ${AC}}}`, () => P({ secondary: false })),

  item("step-terminal", ["Terminal steps", "Typing lines with a blinking caret"], ["Шаги-терминал", "Печать строк с мигающим курсором"],
    (l) => `<div class="t">${each(([a], i) => `<p style="--n:${a.length};--d:calc(var(--p-dur,8s) * ${(i * 0.325).toFixed(3)})"><i>$</i><span>${a}</span></p>`, l)}</div>`,
    `.t{padding:16px;border-radius:16px;background:#0d1117;border:1px solid ${BD};font:14px/1.9 ui-monospace,Menlo,monospace;color:#c9d1d9}p{margin:0;display:flex;gap:8px}i{color:#3fb950;font-style:normal}span{display:inline-block;overflow:hidden;white-space:nowrap;width:0;border-right:2px solid #22d3ee;animation:ty ${av("8s", "steps(24,end)")},cr .7s step-end infinite;animation-delay:var(--d),0s}@keyframes ty{0%{width:0}25%,100%{width:calc(var(--n)*1ch)}}@keyframes cr{50%{border-color:transparent}}`, () => P({ dur: 8, easing: "steps(24,end)", accent: false, secondary: false })),

  item("step-numbers", ["Big numbers", "Gradient 01/02/03 with a sliding underline"], ["Большие цифры", "Градиентные 01/02/03 и бегущая линия"],
    (l) => `<div class="g">${each(([a, b], i) => `<div><h4>0${i + 1}</h4><b>${a}</b><small>${b}</small><u></u></div>`, l)}</div>`,
    `.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}.g>div{position:relative;padding:8px 4px 14px}h4{margin:0;font-size:52px;line-height:1;background:linear-gradient(120deg,${AC},${AM});-webkit-background-clip:text;background-clip:text;color:transparent}b{display:block;color:${FS};margin-top:4px}small{color:${FM}}u{position:absolute;left:0;bottom:0;height:3px;width:30%;border-radius:9px;background:linear-gradient(90deg,${AC},${AM});animation:sl ${av("3.6s", "ease-in-out", "infinite", "alternate")}}.g>div:nth-child(2) u{animation-delay:.4s}.g>div:nth-child(3) u{animation-delay:.8s}@keyframes sl{to{transform:translateX(230%)}}`, () => P({ dur: 3.6, durMax: 20, easing: "ease-in-out", dir: "alternate" })),

  item("step-qr", ["QR scan step", "Laser scans an illustrative QR code"], ["Шаг «сканируйте QR»", "Лазер сканирует QR-подобный код"],
    (l) => `<div class="q"><div class="c"><b></b></div><div><b>${st(l)[1][0]}</b><small>${L(l, "Scan the code or use the link", "Наведите камеру или используйте ссылку")}</small></div></div>`,
    `.q{display:flex;gap:18px;align-items:center;padding:16px;border-radius:20px;background:${SF};border:1px solid ${BD}}.c{position:relative;flex:none;width:96px;height:96px;border-radius:12px;overflow:hidden;background:conic-gradient(from 0deg at 50% 50%,${FG} 0 25%,transparent 0 50%,${FG} 0 75%,transparent 0) 0 0/16px 16px,repeating-linear-gradient(90deg,${FS} 0 6px,transparent 6px 14px);box-shadow:inset 0 0 0 6px ${SF}}.c::after{content:"";position:absolute;left:0;right:0;height:3px;background:${AC};box-shadow:0 0 14px 4px ${AC};animation:sc ${av("2.4s", "ease-in-out", "infinite", "alternate")}}b{display:block;color:${FS}}small{color:${FM}}@keyframes sc{from{top:0}to{top:calc(100% - 3px)}}`, () => P({ dur: 2.4, durMax: 12, easing: "ease-in-out", dir: "alternate", secondary: false })),
];
