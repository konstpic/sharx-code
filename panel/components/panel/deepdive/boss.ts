import * as THREE from "three";
import { Enemy, Pylon } from "./enemy";
import { SentinelModel } from "./models";
import { Box, makeBox, segmentFirstHit } from "./collision";
import { angleDiff, clamp, distPointSegment2D, rand, TAU, yawOf } from "./util";
import type { Encounter, Game } from "./game";
import type { Telegraph } from "./vfx";

type ActionName = "bombs" | "ring" | "nova" | "summon" | "lasers" | "wall";

interface Action {
  name: ActionName;
  t: number;
  dur: number;
  waves?: number;
  lasers?: { a: number }[];
  dir?: number;
  gapZ?: number;
  wallX?: number;
  hit?: boolean;
  teles?: Telegraph[];
}

/** Firewall Sentinel: 3 phases, telegraphed floor hazards, rotating lasers, summons, shield + pylons. */
export class Sentinel extends Enemy {
  private model = new SentinelModel();
  phase = 1;
  shieldUp = false;
  private cd = 2.4;
  private action: Action | null = null;
  private queue: { t: number; fn: () => void }[] = [];
  private pylons: Pylon[] = [];
  private vulnT = 0;
  private charge = 0;
  private eyeYaw = 0;
  private last: ActionName | null = null;
  private box: Box;
  private arena: { minX: number; maxX: number; minZ: number; maxZ: number };
  private deathT = 0;
  private explT = 0;
  dying = false;

  constructor(x: number, z: number, enc: Encounter | null, g: Game) {
    super("sentinel", x, z, enc, g, 2.2);
    this.visual.add(this.model.root);
    this.flasher = this.model.flasher;
    this.knockable = false;
    this.canFreeze = false;
    this.collideWalls = false;
    this.bossName = "FIREWALL SENTINEL";
    this.arena = g.world.room("sentinel").inner;
    this.box = makeBox(x, z, 5.4, 5.4);
    this.box.lowCover = true;
    g.world.colliders.push(this.box);
  }

  get vulnerable() {
    return this.vulnT > 0;
  }
  get vulnerableNow() {
    return this.vulnT > 0;
  }

  /** Fraction of shield pylons still alive (phase 3), or null when the shield is down. */
  get pylonFrac(): number | null {
    if (!this.shieldUp || !this.pylons.length) return null;
    return this.pylons.filter((x) => !x.dead).length / this.pylons.length;
  }

  onRemove() {
    this.box.active = false;
  }

  protected absorb(dmg: number, _g: Game): number {
    if (this.shieldUp) {
      this.model.ripple();
      return 0;
    }
    let d = this.vulnT > 0 ? dmg * 1.6 : dmg;
    // never skip a phase gate in a single hit
    if (this.phase === 2 && this.hp - d < this.maxHp * 0.33) d = Math.max(0, this.hp - this.maxHp * 0.33 + 0.01);
    return d;
  }

  die(g: Game) {
    if (this.dying) return;
    this.dying = true;
    this.dead = true;
    this.linger = 4.2;
    this.box.active = false;
    this.action = null;
    this.queue = [];
    g.vfx.clearTelegraphs();
    for (const p of this.pylons) if (!p.dead) p.die(g);
    g.projectiles.clearHostile();
    g.onEnemyKilled(this);
  }

  deathUpdate(dt: number, g: Game) {
    this.deathT += dt;
    this.explT -= dt;
    if (this.explT <= 0) {
      this.explT = 0.11;
      const a = Math.random() * TAU;
      const r = Math.random() * 3.6;
      g.vfx.explosion(this.pos.x + Math.cos(a) * r, 1 + Math.random() * 4.5, this.pos.z + Math.sin(a) * r, Math.random() < 0.5 ? 0xff5a3a : 0xffc24d, 0.9 + Math.random());
    }
    g.vfx.addShake(0.05);
    this.visual.position.set(rand(-0.1, 0.1), 0, rand(-0.1, 0.1));
    this.model.update(dt, { yaw: this.eyeYaw, charge: 1 + this.deathT, enrage: 1 + this.deathT * 2, shield: false, vulnerable: true });
    this.flasher?.set(0.4 + Math.sin(this.deathT * 30) * 0.3);
    this.sync();
    if (this.linger - dt <= 0) {
      g.vfx.explosion(this.pos.x, 3.7, this.pos.z, 0xffe08a, 4);
      g.vfx.ring(this.pos.x, 0.1, this.pos.z, 0xffc24d, 22, 1.2);
      this.visual.visible = false;
    }
  }

  /* ------------------------------ AI ------------------------------ */

  protected think(dt: number, g: Game) {
    const p = g.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    this.eyeYaw += angleDiff(this.eyeYaw, yawOf(dx, dz)) * Math.min(1, dt * 5);

    // delayed callbacks
    for (let i = this.queue.length - 1; i >= 0; i--) {
      this.queue[i].t -= dt;
      if (this.queue[i].t <= 0) {
        const f = this.queue[i].fn;
        this.queue.splice(i, 1);
        f();
      }
    }

    // phase gates
    if (this.phase === 1 && this.hp <= this.maxHp * 0.66) this.enterPhase2(g);
    else if (this.phase === 2 && this.hp <= this.maxHp * 0.335) this.enterPhase3(g);
    if (this.shieldUp && this.pylons.length && this.pylons.every((x) => x.dead)) this.breakShield(g);

    if (this.vulnT > 0) {
      this.vulnT -= dt;
      this.charge = 0;
      this.action = null;
      if (this.vulnT <= 0) {
        this.cd = 0.8;
        g.ui.toast("SENTINEL ENRAGED", "final protocol", 1500, "#ef4444");
      }
      return;
    }

    if (this.action) this.runAction(dt, g);
    else {
      this.charge = Math.max(0, this.charge - dt * 2);
      this.cd -= dt;
      if (this.cd <= 0 && !p.dead) this.startAction(g);
    }
  }

  private enterPhase2(g: Game) {
    this.phase = 2;
    this.action = null;
    this.cd = 1.4;
    g.vfx.explosion(this.pos.x, 3.7, this.pos.z, 0xff5a3a, 2.2);
    g.vfx.ring(this.pos.x, 0.08, this.pos.z, 0xff5a3a, 18, 0.7);
    g.ui.toast("PHASE II", "laser lattice online", 1700, "#f97316");
    g.hitStop(0.08);
  }

  private enterPhase3(g: Game) {
    this.phase = 3;
    this.shieldUp = true;
    this.action = null;
    this.cd = 2.2;
    g.vfx.explosion(this.pos.x, 3.7, this.pos.z, 0x5ad1ff, 2.6);
    g.vfx.ring(this.pos.x, 0.08, this.pos.z, 0x5ad1ff, 20, 0.8);
    g.ui.toast("PHASE III", "firewall shield up — destroy the 3 pylons", 2600, "#38bdf8");
    g.hitStop(0.1);
    const a = this.arena;
    const spots: [number, number][] = [
      [a.minX + 10, this.pos.z - 12],
      [a.minX + 10, this.pos.z + 12],
      [this.pos.x - 2, this.pos.z + (Math.random() < 0.5 ? -1 : 1) * 15],
    ];
    for (const [x, z] of spots) {
      const py = g.spawnEnemy("pylon", x, z, this.enc, { shooter: true, hp: 150 }) as Pylon;
      this.pylons.push(py);
    }
  }

  private breakShield(g: Game) {
    this.shieldUp = false;
    this.vulnT = 5.2;
    this.pylons = [];
    g.vfx.explosion(this.pos.x, 3.7, this.pos.z, 0x9be7ff, 3);
    g.vfx.ring(this.pos.x, 0.08, this.pos.z, 0x9be7ff, 20, 0.8);
    g.hitStop(0.12);
    g.ui.toast("SHIELD DOWN", "core exposed — damage x1.6", 2000, "#fbbf24");
    g.projectiles.clearHostile();
    g.vfx.clearTelegraphs();
  }

  private startAction(g: Game) {
    let pool: ActionName[];
    if (this.phase === 1) pool = ["bombs", "ring", "nova", "bombs", "ring", "summon"];
    else if (this.phase === 2) pool = ["bombs", "ring", "lasers", "nova", "summon", "lasers"];
    else if (this.shieldUp) pool = ["ring", "bombs", "nova"];
    else pool = ["lasers", "wall", "bombs", "ring", "nova", "wall"];
    let name = pool[Math.floor(Math.random() * pool.length)];
    if (name === this.last) name = pool[Math.floor(Math.random() * pool.length)];
    if (name === "summon") {
      const alive = g.enemies.filter((e) => !e.dead && e.type !== "sentinel" && e.type !== "pylon").length;
      if (alive > 5) name = "bombs";
    }
    this.last = name;
    const a: Action = { name, t: 0, dur: 2 };
    switch (name) {
      case "bombs":
        a.dur = 1.9;
        this.scheduleBombs(g);
        break;
      case "ring":
        a.dur = this.phase === 1 ? 1.9 : 2.5;
        a.waves = this.phase === 1 ? 2 : 3;
        break;
      case "nova": {
        a.dur = 2.2;
        const tele = g.vfx.telegraphCircle(this.pos.x, this.pos.z, 8.6, 1.5, () => this.detonateNova(g), 0xff2a4a);
        a.teles = [tele];
        break;
      }
      case "summon":
        a.dur = 1.6;
        this.doSummon(g);
        break;
      case "lasers": {
        const n = this.phase === 2 ? 2 : 3;
        const base = yawOf(g.player.pos.x - this.pos.x, g.player.pos.z - this.pos.z);
        a.lasers = Array.from({ length: n }, (_, i) => ({ a: base + (i / n) * TAU }));
        a.dir = Math.random() < 0.5 ? -1 : 1;
        a.dur = 5.6;
        a.teles = a.lasers.map((l) => g.vfx.telegraphRect(this.pos.x, this.pos.z, l.a, 30, 0.9, 1.4, undefined, 0xff3a3a));
        break;
      }
      case "wall": {
        const ar = this.arena;
        a.dur = 6.6;
        a.gapZ = clamp(g.player.pos.z + rand(-6, 6), ar.minZ + 6, ar.maxZ - 6);
        a.wallX = ar.maxX - 1;
        const gap = 3.6;
        a.teles = [
          g.vfx.telegraphRect(a.wallX, ar.minZ, 0, a.gapZ - gap - ar.minZ, 2.2, 1.3, undefined, 0xff2a2a),
          g.vfx.telegraphRect(a.wallX, a.gapZ + gap, 0, ar.maxZ - (a.gapZ + gap), 2.2, 1.3, undefined, 0xff2a2a),
        ];
        g.ui.toast("FIREWALL SWEEP", "find the gap — dash through", 1300, "#ef4444");
        break;
      }
    }
    this.action = a;
  }

  private runAction(dt: number, g: Game) {
    const a = this.action!;
    a.t += dt;
    const enr = this.phase === 3 && !this.shieldUp ? 0.7 : 1;
    const cdBase = this.phase === 1 ? 2.3 : this.phase === 2 ? 1.9 : this.shieldUp ? 2.6 : 1.3;
    switch (a.name) {
      case "bombs":
        this.charge = Math.min(1, a.t / 1.0);
        break;
      case "ring": {
        this.charge = Math.min(1, a.t / 0.5);
        const wave = a.waves ?? 2;
        const i = Math.floor(a.t / 0.75);
        if (i < wave && (a as Action & { fired?: number }).fired !== i) {
          (a as Action & { fired?: number }).fired = i;
          this.fireRing(g, i);
        }
        break;
      }
      case "nova":
        this.charge = Math.min(1, a.t / 1.5);
        break;
      case "summon":
        this.charge = Math.min(1, a.t / 0.8);
        break;
      case "lasers": {
        const active = a.t > 1.4;
        this.charge = active ? 1 : a.t / 1.4;
        if (!active) {
          a.teles?.forEach((t, i) => {
            if (a.lasers) g.vfx.moveTelegraph(t, this.pos.x, this.pos.z, a.lasers[i].a);
          });
        } else if (a.lasers) {
          const w = (0.62 + (this.phase === 3 ? 0.25 : 0)) * (a.dir ?? 1);
          const p = g.player;
          for (const l of a.lasers) {
            l.a += w * dt;
            const dx = Math.sin(l.a);
            const dz = Math.cos(l.a);
            let len = 34;
            const t = segmentFirstHit(this.pos.x, this.pos.z, this.pos.x + dx * len, this.pos.z + dz * len, g.world.colliders, true);
            if (t !== null) len *= t;
            const ex = this.pos.x + dx * len;
            const ez = this.pos.z + dz * len;
            const from = new THREE.Vector3(this.pos.x, 3.4, this.pos.z);
            const to = new THREE.Vector3(ex, 0.7, ez);
            g.vfx.beam(from, to, 0xff3a2a, 0.55, 0.06, 3.4);
            g.vfx.beam(from, to, 0xffffff, 0.16, 0.05, 4);
            if (Math.random() < 0.6) g.vfx.sparks(ex, 0.4, ez, -dx, -dz, 0xff7a3a, 2);
            if (!p.dead && distPointSegment2D(this.pos.x, this.pos.z, ex, ez, p.pos.x, p.pos.z) < 0.42 + p.radius) p.takeDamage(g, 20, this.pos, 9);
          }
          g.vfx.addShake(0.02);
        }
        break;
      }
      case "wall": {
        const ar = this.arena;
        this.charge = 0.6;
        if (a.t > 1.3 && a.wallX !== undefined && a.gapZ !== undefined) {
          a.wallX -= 12.5 * dt;
          const gap = 3.6;
          const p = g.player;
          const wx = a.wallX;
          const segs: [number, number][] = [
            [ar.minZ, a.gapZ - gap],
            [a.gapZ + gap, ar.maxZ],
          ];
          for (const [z0, z1] of segs) {
            g.vfx.beam(new THREE.Vector3(wx, 1.3, z0), new THREE.Vector3(wx, 1.3, z1), 0xff2a2a, 2.2, 0.07, 3);
          }
          g.vfx.burst(wx, 0.6, a.gapZ, 0xff6a3a, 1, 3, 0.1, 0.3, 0);
          if (!p.dead && !a.hit && Math.abs(p.pos.x - wx) < 1.1 + p.radius) {
            const inGap = p.pos.z > a.gapZ - gap && p.pos.z < a.gapZ + gap;
            if (!inGap) a.hit = p.takeDamage(g, 34, new THREE.Vector3(wx + 1, 0, p.pos.z), 14);
          }
          if (wx < ar.minX + 0.5) a.t = a.dur;
        }
        break;
      }
    }
    if (a.t >= a.dur) {
      this.action = null;
      this.charge = 0;
      this.cd = cdBase * (enr < 1 ? 0.75 : 1) * rand(0.9, 1.15);
    }
  }

  private scheduleBombs(g: Game) {
    const n = this.phase === 1 ? 4 : 6;
    for (let i = 0; i < n; i++) {
      this.queue.push({
        t: i * 0.3,
        fn: () => {
          const p = g.player;
          let x = p.pos.x + p.vel.x * 0.45 * (i > 0 ? 1 : 0);
          let z = p.pos.z + p.vel.z * 0.45 * (i > 0 ? 1 : 0);
          if (i > 1) {
            x += rand(-5.5, 5.5);
            z += rand(-5.5, 5.5);
          }
          const a = this.arena;
          x = clamp(x, a.minX + 2, a.maxX - 2);
          z = clamp(z, a.minZ + 2, a.maxZ - 2);
          g.vfx.telegraphCircle(x, z, 3.1, 1.25, () => this.detonate(g, x, z, 3.1, 30), 0xff2a4a);
        },
      });
    }
  }

  private detonate(g: Game, x: number, z: number, r: number, dmg: number) {
    g.vfx.explosion(x, 0.6, z, 0xff5a2a, 1.5);
    g.vfx.ring(x, 0.08, z, 0xffaa55, r * 1.1, 0.4);
    g.vfx.addShake(0.25);
    const p = g.player;
    if (!p.dead && Math.hypot(p.pos.x - x, p.pos.z - z) < r + p.radius * 0.6) p.takeDamage(g, dmg, new THREE.Vector3(x, 0, z), 12);
  }

  private detonateNova(g: Game) {
    g.vfx.explosion(this.pos.x, 1, this.pos.z, 0xff4a2a, 2.6);
    g.vfx.ring(this.pos.x, 0.08, this.pos.z, 0xff9a55, 9, 0.6);
    g.vfx.addShake(0.6);
    const p = g.player;
    if (!p.dead && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 8.6 + p.radius * 0.6) p.takeDamage(g, 26, this.pos, 14);
  }

  private fireRing(g: Game, wave: number) {
    const n = this.phase === 1 ? 16 : 20;
    const off = wave * (TAU / n / 2) + rand(0, 0.2);
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const from = new THREE.Vector3(this.pos.x + dir.x * 3.4, 1.4, this.pos.z + dir.z * 3.4);
      g.fireHostile(from, dir, 9.5 + (this.phase - 1) * 1.2, 12, 0xff5a3a, 0.36);
    }
    g.vfx.ring(this.pos.x, 0.08, this.pos.z, 0xff5a3a, 5, 0.4);
    g.vfx.flash(this.pos.x, 3.5, this.pos.z, 0xff5a3a, 90, 0.2);
    g.vfx.addShake(0.12);
  }

  private doSummon(g: Game) {
    const a = this.arena;
    const n = this.phase === 1 ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const x = rand(a.minX + 5, a.maxX - 12);
      const z = rand(a.minZ + 5, a.maxZ - 5);
      g.spawnEnemy(this.phase === 1 ? "sniffer" : "bot", x, z, this.enc);
    }
    g.ui.toast("HOSTILES INCOMING", undefined, 900, "#f97316");
  }

  protected animate(dt: number) {
    this.model.update(dt, {
      yaw: this.eyeYaw,
      charge: this.charge,
      enrage: this.phase === 3 ? (this.shieldUp ? 0.4 : 1) : this.phase === 2 ? 0.35 : 0,
      shield: this.shieldUp,
      vulnerable: this.vulnT > 0,
    });
  }
}
