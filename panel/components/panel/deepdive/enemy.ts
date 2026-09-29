import * as THREE from "three";
import { ENEMY, EnemyDef, EnemyType } from "./config";
import { resolveCircle, segmentFirstHit } from "./collision";
import { BotModel, Flasher, ProbeModel, PylonModel, SnifferModel, TurretModel } from "./models";
import { angleDiff, distPointSegment2D, rand, yawOf } from "./util";
import type { Encounter, Game } from "./game";
import type { Telegraph } from "./vfx";

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

/* ------------------------------ base ------------------------------ */

export abstract class Enemy {
  group = new THREE.Group();
  protected visual = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  knock = new THREE.Vector3();
  radius: number;
  hp: number;
  maxHp: number;
  shield = 0;
  maxShield = 0;
  dead = false;
  spawning = true;
  protected spawnTotal: number;
  protected spawnT: number;
  stagger = 0;
  freeze = 0;
  flash = 0;
  linger = 0;
  yaw = 0;
  contactCd = 0;
  protected knockable = true;
  /** Stationary enemies skip wall pushing (they never move). */
  protected collideWalls = true;
  protected canFreeze = true;
  protected staggerOnHit = 0;
  protected flasher?: Flasher;
  protected def: EnemyDef;
  /** Boss-style bars in the HUD. */
  bossName: string | null = null;

  constructor(public type: EnemyType, x: number, z: number, public enc: Encounter | null, g: Game, spawnDelay = 0.85) {
    this.def = ENEMY[type];
    this.radius = this.def.radius;
    this.hp = this.maxHp = this.def.hp;
    this.pos.set(x, 0, z);
    this.spawnTotal = this.spawnT = spawnDelay;
    this.group.add(this.visual);
    this.group.position.copy(this.pos);
    this.visual.scale.setScalar(0.01);
    if (spawnDelay > 0.1) {
      g.vfx.ring(x, 0.06, z, this.def.color, 2.6, spawnDelay);
      g.vfx.beam(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 7, z), this.def.color, 0.7, spawnDelay, 2.2);
      g.vfx.flash(x, 1.5, z, this.def.color, 40, spawnDelay * 0.8);
    }
  }

  /** True while the enemy takes bonus damage (shield down). */
  get vulnerableNow(): boolean {
    return false;
  }

  protected abstract think(dt: number, g: Game): void;
  protected animate(_dt: number): void {}
  protected absorb(dmg: number, _g: Game): number {
    return dmg;
  }

  /** Called when a friendly bolt hits. */
  hit(g: Game, dmg: number, dir: THREE.Vector3, knock = 4, freeze = false) {
    if (this.dead || this.spawning) return;
    const dealt = this.absorb(dmg, g);
    this.hp -= dealt;
    this.flash = 1;
    if (knock > 0 && this.knockable) {
      this.knock.x += dir.x * knock;
      this.knock.z += dir.z * knock;
    }
    if (freeze && this.canFreeze) this.freeze = Math.max(this.freeze, 1.15);
    if (dealt > 0 && this.staggerOnHit > 0) this.stagger = Math.max(this.stagger, this.staggerOnHit);
    g.vfx.sparks(this.pos.x, 1.1, this.pos.z, -dir.x, -dir.z, this.def.color, 5);
    g.addDamageNumber(this, dealt);
    if (this.hp <= 0) this.die(g);
  }

  die(g: Game) {
    if (this.dead) return;
    this.dead = true;
    g.vfx.explosion(this.pos.x, 1, this.pos.z, this.def.color, this.radius > 1 ? 1.4 : 0.7);
    g.onEnemyKilled(this);
  }

  /** Death-sequence animation for enemies that linger after dying. */
  deathUpdate(_dt: number, _g: Game) {}
  /** Called when the enemy leaves the world. */
  onRemove(_g: Game) {}

  update(dt: number, g: Game) {
    if (this.dead) return;
    if (this.spawning) {
      this.spawnT -= dt;
      const f = 1 - Math.max(0, this.spawnT) / this.spawnTotal;
      this.visual.scale.setScalar(Math.max(0.01, f * f));
      if (this.spawnT <= 0) {
        this.spawning = false;
        this.visual.scale.setScalar(1);
      }
      this.sync();
      return;
    }
    this.flash = Math.max(0, this.flash - dt * 6);
    this.contactCd -= dt;
    let slow = 1;
    if (this.freeze > 0) {
      this.freeze -= dt;
      slow = 0;
      this.vel.set(0, 0, 0);
    } else if (this.stagger > 0) {
      this.stagger -= dt;
      slow = 0;
      this.vel.set(0, 0, 0);
      this.animate(dt);
    } else {
      this.think(dt, g);
      this.animate(dt);
    }
    this.pos.x += (this.vel.x * slow + this.knock.x) * dt;
    this.pos.z += (this.vel.z * slow + this.knock.z) * dt;
    this.knock.multiplyScalar(Math.exp(-7 * dt));
    if (this.collideWalls) resolveCircle(this.pos, this.radius, g.world.colliders);
    this.sync();
    this.flasher?.set(Math.max(this.flash, this.freeze > 0 ? 0.42 : 0));
  }

  protected sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  protected face(dx: number, dz: number, dt: number, rate = 10) {
    if (dx * dx + dz * dz < 1e-6) return;
    this.yaw += angleDiff(this.yaw, yawOf(dx, dz)) * Math.min(1, dt * rate);
  }

  protected separate(g: Game, strength: number) {
    for (const o of g.enemies) {
      if (o === this || o.dead || o.spawning) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      const r = this.radius + o.radius + 0.25;
      if (d < r && d > 1e-4) {
        this.vel.x += (dx / d) * strength * (1 - d / r) * 3;
        this.vel.z += (dz / d) * strength * (1 - d / r) * 3;
      }
    }
  }
}

/* ------------------------------ Sniffer ------------------------------ */

type SnifferState = "chase" | "scan" | "lunge" | "recover";

export class Sniffer extends Enemy {
  private model = new SnifferModel();
  private state: SnifferState = "chase";
  private st = 0;
  private cd = rand(0.6, 1.6);
  private scan = 0;
  private lunge = new THREE.Vector3();
  private hitDone = false;

  constructor(x: number, z: number, enc: Encounter | null, g: Game) {
    super("sniffer", x, z, enc, g);
    this.visual.add(this.model.root);
    this.flasher = this.model.flasher;
    this.staggerOnHit = 0.05;
  }

  protected think(dt: number, g: Game) {
    const p = g.player;
    let dx = p.pos.x - this.pos.x;
    let dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    this.cd -= dt;
    switch (this.state) {
      case "chase":
        this.scan = 0;
        this.vel.set(dx * this.def.speed, 0, dz * this.def.speed);
        this.separate(g, 2.2);
        this.face(this.vel.x, this.vel.z, dt);
        if (dist < 8.5 && this.cd <= 0 && !p.dead) {
          this.state = "scan";
          this.st = 0.95;
          this.model.setEye(0xff3355);
        }
        break;
      case "scan":
        this.st -= dt;
        this.scan = 1 - this.st / 0.95;
        this.vel.set(dx * 1.4, 0, dz * 1.4);
        this.face(dx, dz, dt, 14);
        if (this.st <= 0) {
          this.state = "lunge";
          this.st = 0.36;
          this.lunge.set(dx, 0, dz);
          this.hitDone = false;
          this.scan = 0;
          g.vfx.burst(this.pos.x, 1.2, this.pos.z, 0xff3355, 8, 5, 0.09, 0.3, 0);
        }
        break;
      case "lunge":
        this.st -= dt;
        this.vel.copy(this.lunge).multiplyScalar(22);
        this.face(this.lunge.x, this.lunge.z, dt, 30);
        g.vfx.trail(this.pos.x, 1.2, this.pos.z, 0xff5577, 0.14);
        if (!this.hitDone && dist < this.radius + p.radius + 0.45) {
          this.hitDone = true;
          p.takeDamage(g, 16, this.pos, 10);
        }
        if (this.st <= 0) {
          this.state = "recover";
          this.st = 0.9;
          this.cd = rand(1.2, 2);
          this.model.setEye(0x22d3ee);
        }
        break;
      case "recover":
        this.st -= dt;
        this.vel.set(0, 0, 0);
        if (this.st <= 0) this.state = "chase";
        break;
    }
  }

  protected animate(dt: number) {
    this.model.update(dt, { scan: this.scan, speed01: Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 10) });
  }
}

/* ------------------------------ DDoS bot ------------------------------ */

export class Bot extends Enemy {
  private model = new BotModel();
  private ph = rand(0, 6);
  private speedK = rand(0.9, 1.15);

  constructor(x: number, z: number, enc: Encounter | null, g: Game) {
    super("bot", x, z, enc, g, 0.7);
    this.visual.add(this.model.root);
    this.flasher = this.model.flasher;
    this.staggerOnHit = 0.06;
  }

  protected think(dt: number, g: Game) {
    const p = g.player;
    let dx = p.pos.x - this.pos.x;
    let dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    this.ph += dt;
    const w = dist > 3 ? Math.sin(this.ph * 4) * 0.5 : 0;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const sp = this.def.speed * this.speedK;
    this.vel.set((dx * c - dz * s) * sp, 0, (dx * s + dz * c) * sp);
    this.separate(g, 4);
    this.face(this.vel.x, this.vel.z, dt, 14);
    if (!p.dead && this.contactCd <= 0 && dist < this.radius + p.radius + 0.2) {
      this.contactCd = 0.75;
      p.takeDamage(g, 7, this.pos, 5);
    }
  }

  protected animate(dt: number) {
    this.model.update(dt, Math.min(1, Math.hypot(this.vel.x, this.vel.z) / this.def.speed));
  }
}

/* ------------------------------ DPI probe ------------------------------ */

type ProbeState = "kite" | "aim" | "cool";

export class Probe extends Enemy {
  private model = new ProbeModel();
  private state: ProbeState = "kite";
  private cd = rand(1, 2.2);
  private strafe = Math.random() < 0.5 ? -1 : 1;
  private strafeT = rand(1.5, 3);
  private atk: "beam" | "burst" = "beam";
  private atkT = 0;
  private atkTotal = 1;
  private lockYaw = 0;
  private tele: Telegraph | null = null;
  private charge = 0;

  constructor(x: number, z: number, enc: Encounter | null, g: Game) {
    super("probe", x, z, enc, g);
    this.visual.add(this.model.root);
    this.flasher = this.model.flasher;
    this.staggerOnHit = 0.04;
  }

  die(g: Game) {
    this.tele?.cancel();
    super.die(g);
  }

  protected think(dt: number, g: Game) {
    const p = g.player;
    let dx = p.pos.x - this.pos.x;
    let dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    switch (this.state) {
      case "kite": {
        this.charge = 0;
        const sp = this.def.speed;
        if (dist < 7.5) this.vel.set(-dx * sp * 1.25, 0, -dz * sp * 1.25);
        else if (dist > 13) this.vel.set(dx * sp, 0, dz * sp);
        else this.vel.set(-dz * this.strafe * sp * 0.75, 0, dx * this.strafe * sp * 0.75);
        this.separate(g, 2);
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafe *= -1;
          this.strafeT = rand(1.5, 3.2);
        }
        this.face(dx, dz, dt, 8);
        this.cd -= dt;
        if (this.cd <= 0 && dist < 22 && !p.dead) {
          this.state = "aim";
          this.atk = Math.random() < 0.55 ? "beam" : "burst";
          this.atkTotal = this.atk === "beam" ? 1.1 : 0.6;
          this.atkT = this.atkTotal;
          if (this.atk === "beam") this.tele = g.vfx.telegraphRect(this.pos.x, this.pos.z, this.yaw, 28, 0.9, this.atkTotal, undefined, 0xff5533);
        }
        break;
      }
      case "aim": {
        this.vel.set(0, 0, 0);
        this.atkT -= dt;
        this.charge = 1 - this.atkT / this.atkTotal;
        if (this.atkT > 0.32) {
          this.lockYaw = yawOf(dx, dz);
          this.yaw += angleDiff(this.yaw, this.lockYaw) * Math.min(1, dt * 14);
        }
        if (this.tele) g.vfx.moveTelegraph(this.tele, this.pos.x, this.pos.z, this.atkT > 0.32 ? this.yaw : this.lockYaw);
        if (this.atkT <= 0) {
          if (this.atk === "beam") this.fireBeam(g);
          else this.fireBurst(g, dx, dz);
          this.tele = null;
          this.state = "cool";
          this.atkT = 0.9;
          this.cd = rand(2.2, 3.4);
        }
        break;
      }
      case "cool":
        this.charge = 0;
        this.vel.set(0, 0, 0);
        this.atkT -= dt;
        if (this.atkT <= 0) this.state = "kite";
        break;
    }
  }

  private fireBeam(g: Game) {
    const yaw = this.yaw;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    let len = 28;
    const t = segmentFirstHit(this.pos.x, this.pos.z, this.pos.x + dx * len, this.pos.z + dz * len, g.world.colliders);
    if (t !== null) len *= t;
    const ex = this.pos.x + dx * len;
    const ez = this.pos.z + dz * len;
    _p.set(this.pos.x + dx * 0.9, 1.7, this.pos.z + dz * 0.9);
    _q.set(ex, 1.0, ez);
    g.vfx.beam(_p, _q, 0xff4422, 0.55, 0.24, 3.4);
    g.vfx.beam(_p, _q, 0xffffff, 0.18, 0.18, 4);
    g.vfx.sparks(ex, 0.6, ez, -dx, -dz, 0xff7744, 10);
    g.vfx.flash(ex, 1, ez, 0xff5533, 40, 0.15);
    g.vfx.addShake(0.08);
    const p = g.player;
    if (!p.dead && distPointSegment2D(this.pos.x, this.pos.z, ex, ez, p.pos.x, p.pos.z) < 0.5 + p.radius) p.takeDamage(g, 22, this.pos, 9);
  }

  private fireBurst(g: Game, dx: number, dz: number) {
    const base = Math.atan2(dx, dz);
    for (const off of [-0.2, 0, 0.2]) {
      _p.set(this.pos.x + Math.sin(base + off) * 0.9, 1.6, this.pos.z + Math.cos(base + off) * 0.9);
      g.fireHostile(_p, new THREE.Vector3(Math.sin(base + off), 0, Math.cos(base + off)), 15, 10, 0xffb020);
    }
    g.vfx.flash(this.pos.x, 1.8, this.pos.z, 0xffb020, 30, 0.1);
  }

  protected animate(dt: number) {
    this.model.update(dt, this.charge);
  }
}

/* ------------------------------ Turret ------------------------------ */

export class Turret extends Enemy {
  private model = new TurretModel();
  private headYaw = 0;
  private cd = rand(1, 2);
  private burstLeft = 0;
  private burstT = 0;
  private alt = 0;

  constructor(x: number, z: number, enc: Encounter | null, g: Game) {
    super("turret", x, z, enc, g, 1.1);
    this.visual.add(this.model.root);
    this.flasher = this.model.flasher;
    this.knockable = false;
    this.collideWalls = false;
  }

  protected think(dt: number, g: Game) {
    const p = g.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    this.headYaw += angleDiff(this.headYaw, yawOf(dx, dz)) * Math.min(1, dt * 5);
    this.cd -= dt;
    if (this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burstT = 0.17;
        this.burstLeft--;
        const m = this.model.muzzles[this.alt++ % 2];
        m.getWorldPosition(_p);
        const lead = 0.35;
        const tx = p.pos.x + p.vel.x * lead - _p.x;
        const tz = p.pos.z + p.vel.z * lead - _p.z;
        const l = Math.hypot(tx, tz) || 1;
        g.fireHostile(_p, new THREE.Vector3(tx / l, 0, tz / l), 15, 9, 0xff7a1a);
        this.model.fire();
        g.vfx.flash(_p.x, _p.y, _p.z, 0xff7a1a, 25, 0.07);
      }
    } else if (dist < 24 && this.cd <= 0 && !p.dead) {
      this.burstLeft = 3;
      this.burstT = 0;
      this.cd = 2.3 + rand(0, 0.7);
    }
  }

  protected animate(dt: number) {
    this.model.update(dt, this.headYaw);
  }
}

/* ------------------------------ Pylon (tutorial target / boss shield node) ------------------------------ */

export class Pylon extends Enemy {
  private model = new PylonModel();
  private cd = rand(1.5, 3);

  constructor(x: number, z: number, enc: Encounter | null, g: Game, private shooter = false, hp?: number) {
    super("pylon", x, z, enc, g, 0.9);
    this.visual.add(this.model.root);
    this.flasher = this.model.flasher;
    this.knockable = false;
    this.canFreeze = false;
    this.collideWalls = false;
    if (hp) this.hp = this.maxHp = hp;
  }

  protected think(dt: number, g: Game) {
    if (!this.shooter) return;
    const p = g.player;
    this.cd -= dt;
    if (this.cd <= 0 && !p.dead) {
      this.cd = rand(2.4, 3.4);
      const dx = p.pos.x - this.pos.x;
      const dz = p.pos.z - this.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      _p.set(this.pos.x, 2.5, this.pos.z);
      g.fireHostile(_p, new THREE.Vector3(dx / l, 0, dz / l), 11, 11, 0x38bdf8, 0.34);
      g.vfx.flash(_p.x, _p.y, _p.z, 0x38bdf8, 25, 0.1);
    }
  }

  protected animate(dt: number) {
    this.model.update(dt);
  }
}
