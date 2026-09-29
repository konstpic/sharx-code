import { BUFFS, BuffId, Upgrade } from "./config";

export interface UIHandlers {
  onStart: () => void;
  onResume: () => void;
  onExit: () => void;
  onPick: (i: number) => void;
  onRespawn: () => void;
  onRestart: () => void;
  onPause: () => void;
}

export interface HudState {
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  dash: number;
  buffs: { id: BuffId; t: number }[];
  score: number;
  kills: number;
  objective: string;
  room: string;
}

const CSS = /* css */ `
.nt-root{position:absolute;inset:0;overflow:hidden;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#dbeafe;user-select:none;-webkit-user-select:none;cursor:none}
.nt-root *{box-sizing:border-box}
.nt-root canvas{display:block;width:100%;height:100%}
.nt-layer{position:absolute;inset:0;pointer-events:none}
.nt-panel{background:linear-gradient(135deg,rgba(8,12,28,.82),rgba(22,10,44,.62));border:1px solid rgba(139,92,246,.38);clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px));backdrop-filter:blur(6px)}
.nt-tl{position:absolute;left:18px;top:16px;padding:10px 16px 12px;min-width:250px;max-width:340px}
.nt-tl .nt-k{font-size:10px;letter-spacing:.24em;color:#8b5cf6;text-transform:uppercase}
.nt-tl .nt-room{font-size:15px;font-weight:700;color:#e9d5ff;margin-top:2px}
.nt-tl .nt-obj{font-size:12px;color:#7dd3fc;margin-top:6px;line-height:1.35}
.nt-tr{position:absolute;right:18px;top:16px;display:flex;gap:10px;align-items:flex-start}
.nt-stat{padding:8px 14px;text-align:right}
.nt-stat b{display:block;font-size:20px;color:#e9d5ff;letter-spacing:.04em}
.nt-stat span{font-size:9px;letter-spacing:.22em;color:#64748b;text-transform:uppercase}
.nt-x{pointer-events:auto;cursor:pointer;width:38px;height:38px;border:1px solid rgba(139,92,246,.45);background:rgba(8,12,28,.8);color:#c4b5fd;font-size:18px;line-height:1;display:grid;place-items:center;transition:.15s}
.nt-x:hover{background:rgba(139,92,246,.35);color:#fff}
.nt-bl{position:absolute;left:18px;bottom:18px;width:330px;padding:12px 16px 14px}
.nt-bar{position:relative;height:12px;background:rgba(255,255,255,.07);margin-top:6px;overflow:hidden;border:1px solid rgba(255,255,255,.12)}
.nt-bar i{position:absolute;left:0;top:0;bottom:0;transition:width .12s linear}
.nt-bar::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 14px,rgba(0,0,0,.35) 14px 15px)}
.nt-lbl{display:flex;justify-content:space-between;font-size:10px;letter-spacing:.2em;color:#94a3b8;text-transform:uppercase}
.nt-lbl b{color:#e2e8f0;letter-spacing:.06em}
.nt-hp i{background:linear-gradient(90deg,#16a34a,#4ade80)}
.nt-hp.low i{background:linear-gradient(90deg,#be123c,#fb7185);animation:nt-pulse .5s infinite alternate}
.nt-sh i{background:linear-gradient(90deg,#0ea5e9,#67e8f9)}
.nt-dash i{background:linear-gradient(90deg,#7c3aed,#c4b5fd)}
.nt-dash.ready i{box-shadow:0 0 12px #a78bfa}
.nt-buffs{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.nt-buff{position:relative;width:34px;height:34px;border:1px solid var(--c);display:grid;place-items:center;font-size:15px;color:var(--c);background:rgba(8,12,28,.7)}
.nt-buff u{position:absolute;left:0;bottom:0;height:3px;background:var(--c);text-decoration:none}
.nt-boss{position:absolute;left:50%;top:14px;transform:translateX(-50%);width:min(560px,52vw);text-align:center;opacity:0;transition:opacity .25s}
.nt-boss.on{opacity:1}
.nt-boss .nt-bn{font-size:12px;letter-spacing:.34em;color:#fca5a5;margin-bottom:4px}
.nt-boss .nt-bbar{height:14px;background:rgba(255,255,255,.08);border:1px solid rgba(248,113,113,.5);position:relative;overflow:hidden}
.nt-boss .nt-bbar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#be123c,#f43f5e,#fb923c);transition:width .1s linear}
.nt-boss .nt-bsh{height:6px;margin-top:4px;background:rgba(255,255,255,.08);border:1px solid rgba(56,189,248,.5);position:relative;overflow:hidden;display:none}
.nt-boss .nt-bsh i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#0ea5e9,#67e8f9)}
.nt-boss .nt-bst{font-size:9px;letter-spacing:.22em;color:#7dd3fc;margin-top:3px;display:none}
.nt-toast{position:absolute;left:50%;top:22%;transform:translate(-50%,0);text-align:center;opacity:0;transition:opacity .25s,transform .25s;white-space:nowrap}
.nt-toast.on{opacity:1;transform:translate(-50%,-6px)}
.nt-toast b{display:block;font-size:34px;letter-spacing:.16em;text-shadow:0 0 22px currentColor;font-weight:800}
.nt-toast span{display:block;font-size:13px;letter-spacing:.24em;color:#cbd5e1;margin-top:6px;text-transform:uppercase}
.nt-hint{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);padding:9px 20px;font-size:13px;color:#e0f2fe;letter-spacing:.06em;opacity:0;transition:opacity .2s;text-align:center}
.nt-hint.on{opacity:1}
.nt-hint kbd,.nt-prompt kbd{display:inline-block;padding:1px 7px;border:1px solid #67e8f9;color:#67e8f9;margin:0 2px;font-family:inherit;font-size:12px}
.nt-prompt{position:absolute;left:50%;bottom:122px;transform:translateX(-50%);padding:8px 18px;font-size:13px;letter-spacing:.14em;color:#fde68a;opacity:0;transition:opacity .15s}
.nt-prompt.on{opacity:1}
.nt-float{position:absolute;font-size:15px;font-weight:800;text-shadow:0 0 8px #000,0 0 10px currentColor;animation:nt-float .8s ease-out forwards;pointer-events:none}
.nt-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}
.nt-ov{position:absolute;inset:0;display:none;pointer-events:auto;cursor:default}
.nt-ov.on{display:block}
.nt-title{background:linear-gradient(90deg,rgba(3,4,10,.92) 0,rgba(3,4,10,.7) 42%,rgba(3,4,10,0) 78%)}
.nt-tin{position:absolute;left:7vw;top:50%;transform:translateY(-50%);max-width:520px}
.nt-tin .nt-eyebrow{font-size:11px;letter-spacing:.42em;color:#22d3ee}
.nt-tin h1{margin:.2em 0 0;font-size:clamp(38px,6vw,72px);line-height:.95;letter-spacing:.04em;font-weight:900;background:linear-gradient(180deg,#f5f3ff,#a78bfa 60%,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 22px rgba(139,92,246,.55))}
.nt-tin h2{margin:.5em 0 0;font-size:15px;letter-spacing:.34em;color:#c4b5fd;font-weight:500}
.nt-tin p{margin:18px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;max-width:440px}
.nt-keys{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-top:20px;font-size:12px;color:#cbd5e1}
.nt-keys kbd{border:1px solid rgba(103,232,249,.6);color:#67e8f9;padding:1px 7px;font-family:inherit;font-size:11px}
.nt-btn{pointer-events:auto;cursor:pointer;margin-top:26px;padding:13px 34px;font-family:inherit;font-size:14px;letter-spacing:.3em;font-weight:800;color:#0b0b18;background:linear-gradient(90deg,#22d3ee,#a78bfa);border:0;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px));transition:.15s;text-transform:uppercase}
.nt-btn:hover{filter:brightness(1.2) drop-shadow(0 0 14px rgba(167,139,250,.9))}
.nt-btn.alt{background:rgba(8,12,28,.8);color:#c4b5fd;border:1px solid rgba(139,92,246,.5)}
.nt-center{position:absolute;inset:0;display:none;place-items:center;text-align:center;background:radial-gradient(ellipse at center,rgba(5,6,13,.62),rgba(5,6,13,.9))}
.nt-center.on{display:grid}
.nt-center h3{margin:0;font-size:clamp(28px,4.4vw,52px);letter-spacing:.2em;font-weight:900}
.nt-center .nt-sub{font-size:13px;color:#94a3b8;letter-spacing:.16em;margin-top:10px}
.nt-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:6px}
.nt-cards{display:flex;gap:18px;margin-top:26px;justify-content:center;flex-wrap:wrap}
.nt-card{pointer-events:auto;cursor:pointer;width:230px;padding:20px 18px 22px;text-align:left;font-family:inherit;color:#dbeafe;background:linear-gradient(160deg,rgba(10,14,32,.92),rgba(24,12,50,.85));border:1px solid var(--c);transition:.16s;position:relative;clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px))}
.nt-card:hover{transform:translateY(-6px);box-shadow:0 0 30px -4px var(--c);background:linear-gradient(160deg,rgba(20,26,56,.95),rgba(48,20,90,.9))}
.nt-card .g{font-size:34px;color:var(--c);text-shadow:0 0 16px var(--c)}
.nt-card .n{font-size:15px;font-weight:800;margin-top:10px;letter-spacing:.05em}
.nt-card .d{font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.45;min-height:34px}
.nt-card .k{position:absolute;right:12px;top:10px;font-size:11px;color:#64748b}
.nt-stats{display:flex;gap:26px;justify-content:center;margin-top:20px}
.nt-stats div{font-size:10px;letter-spacing:.2em;color:#64748b}
.nt-stats b{display:block;font-size:22px;color:#e9d5ff;letter-spacing:.04em;margin-top:3px}
.nt-vig{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 160px rgba(0,0,0,.55)}
.nt-cross{position:absolute;width:0;height:0;pointer-events:none}

.nt-root{touch-action:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;overscroll-behavior:none}
.nt-keys-t{display:none}
.nt-p{display:none;font-size:12px}
.nt-touch-on .nt-p{display:grid}
.nt-touch-on .nt-keys{display:none}
.nt-touch-on .nt-keys-t{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-top:20px;font-size:12px;color:#cbd5e1}
.nt-touch-on .nt-x{width:42px;height:42px}
.nt-touch{position:absolute;inset:0;pointer-events:none;-webkit-user-select:none;user-select:none}
.nt-tz{position:absolute;top:84px;bottom:0;pointer-events:auto;touch-action:none}
.nt-tzl{left:0;width:46%}
.nt-tzr{right:0;width:54%}
.nt-stick{position:absolute;width:var(--r,116px);height:var(--r,116px);margin:calc(var(--r,116px)/-2) 0 0 calc(var(--r,116px)/-2);border-radius:50%;border:2px solid rgba(103,232,249,.35);background:radial-gradient(circle,rgba(34,211,238,.1),rgba(34,211,238,.02) 70%);opacity:0;transition:opacity .12s;pointer-events:none}
.nt-stick.on{opacity:1}
.nt-stick.aim{border-color:rgba(244,114,182,.4);background:radial-gradient(circle,rgba(244,114,182,.12),rgba(244,114,182,.02) 70%)}
.nt-stick i{position:absolute;left:50%;top:50%;width:46%;height:46%;border-radius:50%;background:rgba(190,240,255,.55);border:2px solid rgba(255,255,255,.7);transform:translate(-50%,-50%);box-shadow:0 0 14px rgba(103,232,249,.6)}
.nt-stick.aim i{background:rgba(255,190,225,.55);box-shadow:0 0 14px rgba(244,114,182,.6)}
.nt-tb{position:absolute;pointer-events:auto;touch-action:none;width:74px;height:74px;border-radius:50%;border:2px solid rgba(167,139,250,.7);background:rgba(10,12,30,.6);color:#e9d5ff;font:800 24px ui-monospace,monospace;display:grid;place-items:center;padding:0;line-height:1;backdrop-filter:blur(4px)}
.nt-tb small{display:block;font-size:9px;letter-spacing:.14em;margin-top:2px;color:#a78bfa}
.nt-tb.on{background:rgba(167,139,250,.55)}
.nt-tb.dash{right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(30% + env(safe-area-inset-bottom,0px))}
.nt-tb.use{right:calc(104px + env(safe-area-inset-right,0px));bottom:calc(34% + env(safe-area-inset-bottom,0px));border-color:rgba(253,230,138,.8);color:#fde68a;animation:nt-pulse .5s infinite alternate}
@media (max-width:900px),(max-height:520px){
  .nt-tl{left:calc(10px + env(safe-area-inset-left,0px));top:10px;min-width:0;max-width:42vw;padding:6px 10px 8px}
  .nt-tl .nt-room{font-size:12px}.nt-tl .nt-obj{font-size:10px;margin-top:3px}.nt-tl .nt-k{font-size:8px}
  .nt-tr{right:calc(10px + env(safe-area-inset-right,0px));top:10px;gap:6px}
  .nt-stat{padding:4px 9px}.nt-stat b{font-size:14px}.nt-stat span{font-size:8px}
  .nt-touch-on .nt-tr .nt-stat:nth-child(2){display:none}
  .nt-bl{left:50%;transform:translateX(-50%);bottom:calc(8px + env(safe-area-inset-bottom,0px));width:min(300px,36vw);padding:7px 10px 9px}
  .nt-bl .nt-bar{height:9px;margin-top:3px}.nt-lbl{font-size:8px}
  .nt-buffs{margin-top:6px}.nt-buff{width:26px;height:26px;font-size:12px}
  .nt-boss{top:8px;width:min(420px,40vw)}.nt-boss .nt-bn{font-size:10px}
  .nt-toast{top:16%}.nt-toast b{font-size:22px}.nt-toast span{font-size:10px}
  .nt-hint{bottom:calc(118px + env(safe-area-inset-bottom,0px));font-size:11px;padding:6px 12px;max-width:80vw}
  .nt-prompt{bottom:calc(146px + env(safe-area-inset-bottom,0px));font-size:11px}
  .nt-tin{left:5vw;max-width:62vw}.nt-tin h1{font-size:clamp(30px,8vw,54px)}.nt-tin h2{font-size:12px}
  .nt-card{width:180px;padding:12px 12px 14px}.nt-card .d{min-height:0}.nt-card .g{font-size:26px}
  .nt-center h3{font-size:clamp(20px,5vw,34px)}.nt-cards{gap:10px;margin-top:14px}
  .nt-btn{padding:11px 22px;font-size:12px}
}
@media (max-height:520px){
  .nt-bl{width:min(340px,40vw);padding:6px 10px 7px}.nt-bl .nt-lbl{display:none}.nt-bl .nt-bar{margin-top:3px}.nt-bl .nt-bar:first-of-type{margin-top:0}
  .nt-hint{bottom:calc(64px + env(safe-area-inset-bottom,0px))}.nt-prompt{bottom:calc(104px + env(safe-area-inset-bottom,0px))}
  .nt-tin p{display:none}.nt-tin .nt-keys,.nt-touch-on .nt-keys-t{margin-top:10px;gap:3px 10px}.nt-btn{margin-top:14px}
}
@media (orientation:portrait) and (max-width:700px){
  .nt-title{background:linear-gradient(0deg,rgba(3,4,10,.95) 0,rgba(3,4,10,.72) 55%,rgba(3,4,10,0) 100%)}
  .nt-tin{left:6vw;right:6vw;top:auto;bottom:5vh;transform:none;max-width:none}
  .nt-tin p{display:none}
  .nt-cards{flex-direction:column;align-items:center}.nt-card{width:min(320px,86vw)}
  .nt-bl{width:min(300px,64vw)}
  .nt-hint{bottom:calc(150px + env(safe-area-inset-bottom,0px));max-width:66vw}
  .nt-prompt{bottom:calc(196px + env(safe-area-inset-bottom,0px))}
  .nt-tl{max-width:46vw}
  .nt-boss{width:min(380px,70vw);top:58px}
}
@keyframes nt-pulse{from{opacity:.65}to{opacity:1}}
@keyframes nt-float{0%{opacity:0;transform:translate(-50%,0) scale(.7)}15%{opacity:1;transform:translate(-50%,-8px) scale(1.1)}100%{opacity:0;transform:translate(-50%,-46px) scale(1)}}
`;

export class UI {
  root: HTMLDivElement;
  private q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
  private toastTimer = 0;
  private styleEl: HTMLStyleElement;
  private floats: HTMLElement[] = [];
  private floatIdx = 0;
  private last: Partial<Record<string, string>> = {};
  private choiceOn = false;

  constructor(private host: HTMLElement, private h: UIHandlers) {
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    this.root = document.createElement("div");
    this.root.className = "nt-root";
    this.root.innerHTML = /* html */ `
      <div class="nt-vig"></div>
      <div class="nt-layer" data-hud>
        <div class="nt-tl nt-panel"><div class="nt-k">Layer 01 // Physical</div><div class="nt-room" data-room></div><div class="nt-obj" data-obj></div></div>
        <div class="nt-tr">
          <div class="nt-stat nt-panel"><b data-score>0</b><span>score</span></div>
          <div class="nt-stat nt-panel"><b data-kills>0</b><span>kills</span></div>
          <button class="nt-x nt-p" data-pause aria-label="Pause">❚❚</button>
          <button class="nt-x" data-exit title="Exit (Esc = pause)">✕</button>
        </div>
        <div class="nt-boss" data-boss><div class="nt-bn" data-bn></div><div class="nt-bbar"><i data-bf></i></div><div class="nt-bsh" data-bsh><i data-bshf></i></div><div class="nt-bst" data-bst></div></div>
        <div class="nt-toast" data-toast><b></b><span></span></div>
        <div class="nt-prompt nt-panel" data-prompt></div>
        <div class="nt-hint nt-panel" data-hint></div>
        <div class="nt-bl nt-panel">
          <div class="nt-lbl"><span>Integrity</span><b data-hpt>100</b></div>
          <div class="nt-bar nt-hp" data-hp><i></i></div>
          <div class="nt-lbl" style="margin-top:8px"><span>Shield</span><b data-sht>60</b></div>
          <div class="nt-bar nt-sh" data-sh><i></i></div>
          <div class="nt-lbl" style="margin-top:8px"><span>Dash</span><b data-dt>READY</b></div>
          <div class="nt-bar nt-dash" data-dash style="height:8px"><i></i></div>
          <div class="nt-buffs" data-buffs></div>
        </div>
      </div>
      <div class="nt-layer" data-floats></div>
      <div class="nt-flash" data-flash></div>
      <div class="nt-ov nt-title" data-title>
        <div class="nt-tin">
          <div class="nt-eyebrow">SHARX // ANNIVERSARY BUILD</div>
          <h1>NETRUNNER<br/>DEEP DIVE</h1>
          <h2>LAYER 01 — PHYSICAL</h2>
          <p>Jack into the cable plant. Breach the switch hall, outgun the DPI probes, break the Warden's shield and burn down the Firewall Sentinel. You are the packet they cannot drop.</p>
          <div class="nt-keys">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>move</span>
            <span><kbd>MOUSE</kbd></span><span>aim on the ground plane</span>
            <span><kbd>LMB</kbd></span><span>fire (hold)</span>
            <span><kbd>SHIFT</kbd> / <kbd>SPACE</kbd></span><span>dash — invulnerable, short cooldown</span>
            <span><kbd>E</kbd></span><span>use terminal</span>
            <span><kbd>ESC</kbd></span><span>pause</span>
          </div>
          <div class="nt-keys-t">
            <span><kbd>LEFT STICK</kbd></span><span>move</span>
            <span><kbd>RIGHT STICK</kbd></span><span>aim &amp; fire (hold)</span>
            <span><kbd>DASH</kbd></span><span>invulnerable burst</span>
            <span><kbd>USE</kbd></span><span>hack terminals</span>
          </div>
          <button class="nt-btn" data-start>Deploy</button>
        </div>
      </div>
      <div class="nt-center nt-panel-none" data-choice><div><h3 style="color:#c4b5fd">CHOOSE AN UPGRADE</h3><div class="nt-sub">room cleared — one module for the rest of the run</div><div class="nt-cards" data-cards></div></div></div>
      <div class="nt-center" data-dead><div><h3 style="color:#fb7185">CONNECTION TERMINATED</h3><div class="nt-sub">your avatar was flatlined</div><div class="nt-row"><button class="nt-btn" data-respawn>Respawn at checkpoint <small>[ENTER]</small></button><button class="nt-btn alt" data-restart>Restart mission <small>[R]</small></button></div></div></div>
      <div class="nt-center" data-victory><div><h3 style="color:#4ade80">FIREWALL BREACHED</h3><div class="nt-sub">layer 01 // physical — complete</div><div class="nt-stats" data-vstats></div><div class="nt-sub" style="margin-top:18px;color:#a78bfa">you found the tunnel behind the tunnel. happy anniversary, SharX.</div><div class="nt-row"><button class="nt-btn" data-again>Dive again <small>[ENTER]</small></button><button class="nt-btn alt" data-vexit>Exit</button></div></div></div>
      <div class="nt-center" data-pause><div><h3 style="color:#c4b5fd">PAUSED</h3><div class="nt-row"><button class="nt-btn" data-resume>Resume <small>[ESC]</small></button><button class="nt-btn alt" data-pexit>Exit game</button></div></div></div>
    `;
    host.appendChild(this.root);
    const on = (sel: string, fn: () => void) => this.q<HTMLElement>(sel).addEventListener("click", fn);
    on("[data-exit]", h.onExit);
    on("[data-pause]", h.onPause);
    on("[data-start]", h.onStart);
    on("[data-respawn]", h.onRespawn);
    on("[data-restart]", h.onRestart);
    on("[data-again]", h.onRestart);
    on("[data-vexit]", h.onExit);
    on("[data-resume]", h.onResume);
    on("[data-pexit]", h.onExit);
    const fl = this.q<HTMLElement>("[data-floats]");
    for (let i = 0; i < 28; i++) {
      const e = document.createElement("div");
      e.className = "nt-float";
      e.style.display = "none";
      fl.appendChild(e);
      this.floats.push(e);
    }
  }

  setTouch(on: boolean) {
    this.root.classList.toggle("nt-touch-on", on);
  }

  private set(key: string, val: string, apply: () => void) {
    if (this.last[key] === val) return;
    this.last[key] = val;
    apply();
  }

  setHud(s: HudState) {
    const hpPct = Math.max(0, s.hp / s.maxHp);
    this.set("hp", hpPct.toFixed(3), () => {
      this.q<HTMLElement>("[data-hp] i").style.width = `${hpPct * 100}%`;
      this.q<HTMLElement>("[data-hp]").classList.toggle("low", hpPct < 0.28);
    });
    this.set("hpt", `${Math.ceil(s.hp)}/${s.maxHp}`, () => (this.q("[data-hpt]").textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`));
    const shPct = s.maxShield > 0 ? Math.max(0, s.shield / s.maxShield) : 0;
    this.set("sh", shPct.toFixed(3), () => (this.q<HTMLElement>("[data-sh] i").style.width = `${shPct * 100}%`));
    this.set("sht", `${Math.ceil(s.shield)}`, () => (this.q("[data-sht]").textContent = `${Math.ceil(s.shield)} / ${s.maxShield}`));
    this.set("dash", s.dash.toFixed(2), () => {
      this.q<HTMLElement>("[data-dash] i").style.width = `${s.dash * 100}%`;
      this.q("[data-dash]").classList.toggle("ready", s.dash >= 1);
      this.q("[data-dt]").textContent = s.dash >= 1 ? "READY" : "…";
    });
    this.set("score", String(s.score), () => (this.q("[data-score]").textContent = String(s.score)));
    this.set("kills", String(s.kills), () => (this.q("[data-kills]").textContent = String(s.kills)));
    this.set("obj", s.objective, () => (this.q("[data-obj]").innerHTML = s.objective));
    this.set("room", s.room, () => (this.q("[data-room]").textContent = s.room));
    const bk = s.buffs.map((b) => b.id + Math.ceil(b.t)).join(",");
    this.set("buffs", bk, () => {
      this.q("[data-buffs]").innerHTML = s.buffs
        .map((b) => {
          const d = BUFFS[b.id];
          return `<div class="nt-buff" style="--c:${d.css}" title="${d.name}">${d.glyph}<u style="width:${Math.min(100, (b.t / d.duration) * 100)}%"></u></div>`;
        })
        .join("");
    });
  }

  toast(text: string, sub?: string, ms = 1600, color = "#22d3ee") {
    const el = this.q<HTMLElement>("[data-toast]");
    el.querySelector("b")!.textContent = text;
    (el.querySelector("b") as HTMLElement).style.color = color;
    el.querySelector("span")!.textContent = sub ?? "";
    el.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove("on"), ms);
  }

  setHint(html: string | null) {
    this.set("hint", html ?? "", () => {
      const el = this.q<HTMLElement>("[data-hint]");
      el.innerHTML = html ?? "";
      el.classList.toggle("on", !!html);
    });
  }

  setPrompt(html: string | null) {
    this.set("prompt", html ?? "", () => {
      const el = this.q<HTMLElement>("[data-prompt]");
      el.innerHTML = html ?? "";
      el.classList.toggle("on", !!html);
    });
  }

  setBoss(b: { name: string; hp: number; shield: number | null; shieldLabel?: string } | null) {
    const el = this.q<HTMLElement>("[data-boss]");
    if (!b) {
      this.set("boss", "off", () => el.classList.remove("on"));
      return;
    }
    this.set("boss", "on", () => el.classList.add("on"));
    this.set("bn", b.name, () => (this.q("[data-bn]").textContent = b.name));
    this.q<HTMLElement>("[data-bf]").style.width = `${Math.max(0, b.hp) * 100}%`;
    const sh = this.q<HTMLElement>("[data-bsh]");
    const st = this.q<HTMLElement>("[data-bst]");
    if (b.shield !== null) {
      sh.style.display = "block";
      st.style.display = "block";
      this.q<HTMLElement>("[data-bshf]").style.width = `${Math.max(0, b.shield) * 100}%`;
      this.set("bst", b.shieldLabel ?? "", () => (st.textContent = b.shieldLabel ?? ""));
    } else {
      sh.style.display = "none";
      st.style.display = "none";
    }
  }

  floatText(x: number, y: number, text: string, color = "#fde68a") {
    const e = this.floats[this.floatIdx++ % this.floats.length];
    e.style.display = "block";
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    e.style.color = color;
    e.textContent = text;
    e.style.animation = "none";
    void e.offsetWidth;
    e.style.animation = "";
  }

  setFlash(v: number) {
    this.q<HTMLElement>("[data-flash]").style.opacity = String(Math.max(0, Math.min(1, v)));
  }

  private toggle(sel: string, on: boolean) {
    this.q<HTMLElement>(sel).classList.toggle("on", on);
  }

  showTitle(v: boolean) {
    this.toggle("[data-title]", v);
    this.q<HTMLElement>("[data-hud]").style.display = v ? "none" : "";
  }
  showDead(v: boolean) {
    this.toggle("[data-dead]", v);
  }
  showPause(v: boolean) {
    this.toggle("[data-pause]", v);
  }

  showChoice(list: Upgrade[] | null) {
    this.choiceOn = !!list;
    this.toggle("[data-choice]", !!list);
    const cards = this.q<HTMLElement>("[data-cards]");
    cards.innerHTML = "";
    if (!list) return;
    list.forEach((u, i) => {
      const b = document.createElement("button");
      b.className = "nt-card";
      b.style.setProperty("--c", u.color);
      b.innerHTML = `<div class="k">[${i + 1}]</div><div class="g">${u.glyph}</div><div class="n">${u.name}</div><div class="d">${u.desc}</div>`;
      b.addEventListener("click", () => this.h.onPick(i));
      cards.appendChild(b);
    });
  }
  get choosing() {
    return this.choiceOn;
  }

  showVictory(s: { score: number; kills: number; time: number } | null) {
    this.toggle("[data-victory]", !!s);
    if (!s) return;
    const m = Math.floor(s.time / 60);
    const sec = Math.floor(s.time % 60);
    this.q("[data-vstats]").innerHTML = `<div>SCORE<b>${s.score}</b></div><div>KILLS<b>${s.kills}</b></div><div>TIME<b>${m}:${String(sec).padStart(2, "0")}</b></div>`;
  }

  dispose() {
    window.clearTimeout(this.toastTimer);
    this.root.remove();
    this.styleEl.remove();
  }
}
