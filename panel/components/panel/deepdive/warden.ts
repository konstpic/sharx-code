import * as THREE from "three";
import { Enemy } from "./enemy";
import { WardenModel } from "./models";
import { angleDiff, yawOf } from "./util";
import type { Encounter, Game } from "./game";
import type { Telegraph } from "./vfx";

type WState = "walk" | "windup" | "charge" | "slam" | "recover" | "stunned";

/** Elite mini-boss: energy shield -> vulnerability window -> shield regenerates. */
export class Warden extends Enemy {
  private model = new WardenModel();
  private state: WState = "walk";
  private st = 0;
  private cd = 1.6;
  private atk: "charge" | "slam" = "charge";
  private tele: Telegraph | null = null;
  private chargeDir = new THREE.Vector3();
  private hitDone = false;
  private vulnT = 0;
  private breaks = 0;
  private windup = 0;
  private hpTriggered = false;

  constructor(x: number, z: number, enc: Encounter | null, g: Game) {
    super("warden", x, z, enc, g, 1.4);
    this.visual.add(this.model.root);
    this.flasher = this.model.flasher;
    this.maxShield = this.shield = 320;
    this.knockable = false;
    this.canFreeze = false;
    this.bossName = "WARDEN // ELITE ICE";
  }

  get shieldPct() {
    return this.maxShield > 0 ? this.shield / this.maxShield : 0;
  }
  get vulnerable() {
    return this.vulnT > 0;
  }
  get vulnerableNow() {
    return this.vulnT > 0;
  }

  protected absorb(dmg: number, g: Game): number {
    if (this.shield > 0) {
      this.shield -= dmg;
      this.model.ripple();
      if (this.shield <= 0) {
        this.shield = 0;
        this.breakShield(g);
      }
      return 0;
    }
    return this.vulnT > 0 ? dmg * 1.5 : dmg;
  }

  private breakShield(g: Game) {
    this.breaks++;
    this.vulnT = 4.6;
    this.tele?.cancel();
    this.tele = null;
    this.state = "stunned";
    this.st = 1.0;
    this.windup = 0;
    g.vfx.explosion(this.pos.x, 2, this.pos.z, 0xff8a5c, 1.6);
    g.vfx.ring(this.pos.x, 0.08, this.pos.z, 0xff8a5c, 6, 0.6);
    g.hitStop(0.09);
    g.ui.toast("SHIELD BREACHED", "damage x1.5 — punish now", 1400, "#f59e0b");
    // reinforcements
    const n = this.breaks === 1 ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      g.spawnEnemy("bot", this.pos.x + Math.cos(a) * 6, this.pos.z + Math.sin(a) * 6, this.enc);
    }
  }

  die(g: Game) {
    this.tele?.cancel();
    super.die(g);
    g.vfx.explosion(this.pos.x, 2, this.pos.z, 0xf43f5e, 2.2);
    g.vfx.addShake(0.6);
  }

  protected think(dt: number, g: Game) {
    const p = g.player;
    let dx = p.pos.x - this.pos.x;
    let dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    if (this.vulnT > 0) {
      this.vulnT -= dt;
      if (this.vulnT <= 0) {
        this.shield = this.maxShield * 0.75;
        this.model.ripple();
        g.vfx.ring(this.pos.x, 0.08, this.pos.z, 0xff5a4d, 5, 0.5);
        g.ui.toast("SHIELD RESTORED", undefined, 900, "#f43f5e");
      }
    }
    if (!this.hpTriggered && this.hp < this.maxHp * 0.5) {
      this.hpTriggered = true;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        g.spawnEnemy("sniffer", this.pos.x + Math.cos(a) * 7, this.pos.z + Math.sin(a) * 7, this.enc);
      }
    }
    switch (this.state) {
      case "walk": {
        this.windup = 0;
        const sp = this.vulnT > 0 ? this.def.speed * 0.6 : this.def.speed;
        this.vel.set(dx * sp, 0, dz * sp);
        this.face(dx, dz, dt, 5);
        this.cd -= dt;
        if (this.cd <= 0 && !p.dead) {
          this.atk = dist > 7.5 ? "charge" : Math.random() < 0.6 ? "slam" : "charge";
          this.state = "windup";
          this.st = this.atk === "charge" ? 0.95 : 0.9;
          if (this.atk === "charge") {
            this.chargeDir.set(dx, 0, dz);
            this.tele = g.vfx.telegraphRect(this.pos.x, this.pos.z, yawOf(dx, dz), 17, 2.4, this.st, undefined, 0xff3a3a);
          } else {
            this.tele = g.vfx.telegraphCircle(this.pos.x, this.pos.z, 5.4, this.st, undefined, 0xff3a3a);
          }
        }
        break;
      }
      case "windup":
        this.vel.set(0, 0, 0);
        this.st -= dt;
        this.windup = 1 - Math.max(0, this.st) / (this.atk === "charge" ? 0.95 : 0.9);
        if (this.atk === "charge") this.face(this.chargeDir.x, this.chargeDir.z, dt, 12);
        if (this.st <= 0) {
          this.tele = null;
          if (this.atk === "charge") {
            this.state = "charge";
            this.st = 0.62;
            this.hitDone = false;
          } else {
            this.state = "slam";
            this.st = 0.0;
            this.doSlam(g);
            this.state = "recover";
            this.st = 0.85;
          }
        }
        break;
      case "charge":
        this.st -= dt;
        this.windup = 0;
        this.vel.copy(this.chargeDir).multiplyScalar(24);
        g.vfx.trail(this.pos.x, 0.5, this.pos.z, 0xff4d4d, 0.22);
        g.vfx.burst(this.pos.x, 0.3, this.pos.z, 0xff8a5c, 1, 2, 0.14, 0.3, 0);
        if (!this.hitDone && dist < this.radius + p.radius + 0.4) {
          this.hitDone = p.takeDamage(g, 30, this.pos, 13);
        }
        if (this.st <= 0) {
          this.state = "recover";
          this.st = 0.95;
          g.vfx.addShake(0.15);
        }
        break;
      case "recover":
        this.vel.set(0, 0, 0);
        this.windup = 0;
        this.st -= dt;
        if (this.st <= 0) {
          this.state = "walk";
          this.cd = this.vulnT > 0 ? 3 : 1.7;
        }
        break;
      case "stunned":
        this.vel.set(0, 0, 0);
        this.st -= dt;
        if (this.st <= 0) {
          this.state = "walk";
          this.cd = 1.5;
        }
        break;
    }
  }

  private doSlam(g: Game) {
    g.vfx.explosion(this.pos.x, 0.5, this.pos.z, 0xff5a3a, 1.6);
    g.vfx.ring(this.pos.x, 0.08, this.pos.z, 0xff9a3a, 5.6, 0.5);
    g.vfx.addShake(0.5);
    const p = g.player;
    if (!p.dead && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 5.4 + p.radius) p.takeDamage(g, 28, this.pos, 12);
  }

  protected animate(dt: number) {
    const speed01 = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 8);
    this.model.update(dt, { speed01, shieldPct: this.shieldPct, vulnerable: this.vulnerable, windup: this.windup });
  }

  deathUpdate() {}
}
