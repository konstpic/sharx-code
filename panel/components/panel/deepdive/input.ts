import * as THREE from "three";

const GAME_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "ShiftLeft", "ShiftRight", "KeyE", "Digit1", "Digit2", "Digit3", "Enter", "KeyR", "KeyP",
]);

/** True on phones/tablets (coarse primary pointer). */
export function detectTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
    if (window.matchMedia("(hover: none)").matches && navigator.maxTouchPoints > 0) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export class Input {
  keys = new Set<string>();
  ndc = new THREE.Vector2(0, 0);
  mouseDown = false;
  /** Touch mode: virtual sticks drive movement / aiming. */
  touchMode = detectTouchDevice();
  readonly coarse = this.touchMode;
  touchMove = { x: 0, z: 0 };
  touchAim = { x: 0, z: 0 };
  touchAimActive = false;
  onTouchMode?: (v: boolean) => void;
  private edge = new Set<string>();
  private cleanup: (() => void)[] = [];

  constructor(private el: HTMLElement) {
    const kd = (e: KeyboardEvent) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.edge.add(e.code);
      this.keys.add(e.code);
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const pm = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (this.touchMode && !this.coarse) this.setTouchMode(false);
      const r = el.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const pd = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        if (!this.touchMode) this.setTouchMode(true);
        return;
      }
      if (e.button === 0) {
        this.mouseDown = true;
        this.edge.add("Mouse0");
      }
    };
    const pu = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button === 0) this.mouseDown = false;
    };
    const blur = () => {
      this.keys.clear();
      this.mouseDown = false;
    };
    const ctx = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerdown", pd);
    window.addEventListener("pointerup", pu);
    el.addEventListener("contextmenu", ctx);
    this.cleanup.push(
      () => window.removeEventListener("keydown", kd),
      () => window.removeEventListener("keyup", ku),
      () => window.removeEventListener("blur", blur),
      () => el.removeEventListener("pointermove", pm),
      () => el.removeEventListener("pointerdown", pd),
      () => window.removeEventListener("pointerup", pu),
      () => el.removeEventListener("contextmenu", ctx),
    );
  }

  setTouchMode(v: boolean) {
    if (this.touchMode === v) return;
    this.touchMode = v;
    if (!v) {
      this.touchMove.x = this.touchMove.z = 0;
      this.touchAimActive = false;
    }
    this.onTouchMode?.(v);
  }

  /** Firing: mouse button, or the right stick pushed out. */
  get fire() {
    return this.mouseDown || (this.touchMode && this.touchAimActive);
  }

  down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** True once per key press (consumed at endFrame). */
  pressed(...codes: string[]) {
    return codes.some((c) => this.edge.has(c));
  }

  /** Inject a one-shot key press (used by on-screen buttons). */
  pulse(code: string) {
    this.edge.add(code);
  }

  move(out: { x: number; z: number }) {
    out.x = (this.down("KeyD", "ArrowRight") ? 1 : 0) - (this.down("KeyA", "ArrowLeft") ? 1 : 0);
    out.z = (this.down("KeyS", "ArrowDown") ? 1 : 0) - (this.down("KeyW", "ArrowUp") ? 1 : 0);
    const l = Math.hypot(out.x, out.z);
    if (l > 0) {
      out.x /= l;
      out.z /= l;
    } else if (this.touchMode) {
      out.x = this.touchMove.x;
      out.z = this.touchMove.z;
    }
  }

  endFrame() {
    this.edge.clear();
  }

  dispose() {
    this.cleanup.forEach((f) => f());
  }
}
