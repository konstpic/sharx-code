import type { Input } from "./input";

interface Stick {
  id: number;
  ox: number;
  oy: number;
  base: HTMLElement;
  knob: HTMLElement;
}

const DEAD = 0.14;

/**
 * On-screen controls for phones/tablets: floating left stick (move), floating right stick
 * (aim + auto-fire), dash / use / pause buttons. Built on pointer events with per-pointer
 * capture so both thumbs work at once.
 */
export class TouchControls {
  root = document.createElement("div");
  private useBtn: HTMLButtonElement;
  private left: Stick;
  private right: Stick;
  private R = 58;
  private visible = false;
  private cleanup: (() => void)[] = [];

  constructor(parent: HTMLElement, private input: Input) {
    this.root.className = "nt-touch";
    this.root.style.display = "none";
    this.root.innerHTML = /* html */ `
      <div class="nt-tz nt-tzl" data-zl></div>
      <div class="nt-tz nt-tzr" data-zr></div>
      <div class="nt-stick" data-bl><i></i></div>
      <div class="nt-stick aim" data-br><i></i></div>
      <button class="nt-tb dash" data-tdash aria-label="Dash">➤<small>DASH</small></button>
      <button class="nt-tb use" data-tuse aria-label="Use terminal" style="display:none">E<small>USE</small></button>
    `;
    const anchor = parent.querySelector(".nt-flash");
    parent.insertBefore(this.root, anchor);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.left = { id: -1, ox: 0, oy: 0, base: q("[data-bl]"), knob: q("[data-bl] i") };
    this.right = { id: -1, ox: 0, oy: 0, base: q("[data-br]"), knob: q("[data-br] i") };
    this.useBtn = q<HTMLButtonElement>("[data-tuse]");

    this.bindStick(q("[data-zl]"), this.left, (x, z, n) => {
      input.touchMove.x = n === 0 ? 0 : x;
      input.touchMove.z = n === 0 ? 0 : z;
    });
    this.bindStick(q("[data-zr]"), this.right, (x, z, n) => {
      input.touchAim.x = x;
      input.touchAim.z = z;
      input.touchAimActive = n > 0;
    }, true);

    const btn = (sel: string, fn: () => void) => {
      const el = q<HTMLElement>(sel);
      const h = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
        el.classList.add("on");
        window.setTimeout(() => el.classList.remove("on"), 110);
      };
      el.addEventListener("pointerdown", h);
      this.cleanup.push(() => el.removeEventListener("pointerdown", h));
    };
    btn("[data-tdash]", () => {
      input.pulse("Space");
      navigator.vibrate?.(8);
    });
    btn("[data-tuse]", () => input.pulse("KeyE"));
    this.layout();
    const onResize = () => this.layout();
    window.addEventListener("resize", onResize);
    this.cleanup.push(() => window.removeEventListener("resize", onResize));
  }

  private layout() {
    const r = this.root.parentElement?.getBoundingClientRect();
    if (!r) return;
    this.R = Math.max(42, Math.min(68, Math.min(r.width, r.height) * 0.14));
    this.root.style.setProperty("--r", `${this.R * 2}px`);
  }

  private bindStick(zone: HTMLElement, s: Stick, onChange: (x: number, z: number, n: number) => void, normalize = false) {
    const place = (x: number, y: number) => {
      const p = this.root.getBoundingClientRect();
      s.base.style.left = `${x - p.left}px`;
      s.base.style.top = `${y - p.top}px`;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || s.id !== -1) return;
      e.preventDefault();
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic/expired pointer */
      }
      s.id = e.pointerId;
      s.ox = e.clientX;
      s.oy = e.clientY;
      place(s.ox, s.oy);
      s.base.classList.add("on");
      s.knob.style.transform = "translate(-50%,-50%)";
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== s.id) return;
      e.preventDefault();
      let dx = e.clientX - s.ox;
      let dy = e.clientY - s.oy;
      const len = Math.hypot(dx, dy);
      if (len > this.R) {
        dx = (dx / len) * this.R;
        dy = (dy / len) * this.R;
      }
      s.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const n = Math.min(1, Math.hypot(dx, dy) / this.R);
      if (n < DEAD) return onChange(0, 0, 0);
      const k = (n - DEAD) / (1 - DEAD);
      const ux = dx / (Math.hypot(dx, dy) || 1);
      const uz = dy / (Math.hypot(dx, dy) || 1);
      if (normalize) onChange(ux, uz, n > 0.3 ? 1 : 0);
      else onChange(ux * k, uz * k, k);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== s.id) return;
      s.id = -1;
      s.base.classList.remove("on");
      onChange(0, 0, 0);
    };
    zone.addEventListener("pointerdown", down);
    zone.addEventListener("pointermove", move);
    zone.addEventListener("pointerup", up);
    zone.addEventListener("pointercancel", up);
    this.cleanup.push(
      () => zone.removeEventListener("pointerdown", down),
      () => zone.removeEventListener("pointermove", move),
      () => zone.removeEventListener("pointerup", up),
      () => zone.removeEventListener("pointercancel", up),
    );
  }

  setVisible(v: boolean) {
    if (this.visible === v) return;
    this.visible = v;
    this.root.style.display = v ? "" : "none";
    if (!v) {
      this.left.id = this.right.id = -1;
      this.left.base.classList.remove("on");
      this.right.base.classList.remove("on");
      this.input.touchMove.x = this.input.touchMove.z = 0;
      this.input.touchAimActive = false;
    }
  }

  setUseVisible(v: boolean) {
    this.useBtn.style.display = v ? "" : "none";
  }

  dispose() {
    this.cleanup.forEach((f) => f());
    this.root.remove();
  }
}
