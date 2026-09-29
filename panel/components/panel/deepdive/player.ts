import * as THREE from "three";
import { PLAYER, BUFFS, BuffId, PlayerStats, baseStats } from "./config";
import { resolveCircle } from "./collision";
import { buildSupportDrone } from "./models";
import { HeroModel } from "./hero";
import { clamp, damp, TAU } from "./util";
import type { Game } from "./game";

const _m = { x: 0, z: 0 };
const _v = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export class Player {
  model = new HeroModel();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  aim = new THREE.Vector3(0, 0, 1);
  yaw = 0;
  radius = PLAYER.radius;
  hp = PLAYER.hp;
  shield = PLAYER.shield;
  stats: PlayerStats = baseStats();
  buffs: Partial<Record<BuffId, number>> = {};
  dead = false;
  invuln = 0;
  dashT = 0;
  dashCd = 0;
  dashDir = new THREE.Vector3(0, 0, 1);
  fireCd = 0;
  sinceHit = 99;
  didDash = false;
  god = false;
  private ghostT = 0;
  private light: THREE.PointLight;
  private drone: { g: THREE.Group; t: number; cd: number } | null = null;

  constructor(private scene: THREE.Scene) {
    scene.add(this.model.root);
    this.light = new THREE.PointLight(0x67e8f9, 18, 15, 1.8);
    scene.add(this.light);
  }

  get dashing() {
    return this.dashT > 0;
  }

  get damage() {
    return PLAYER.damage * this.stats.damageMul * (this.buffs.overclock ? 1.6 : 1);
  }

  get dash01() {
    return 1 - clamp(this.dashCd / (PLAYER.dashCooldown * this.stats.dashCdMul), 0, 1);
  }

  resetRun() {
    this.stats = baseStats();
    this.buffs = {};
    this.didDash = false;
  }

  spawnAt(x: number, z: number) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.hp = this.stats.maxHp;
    this.shield = this.stats.maxShield;
    this.dead = false;
    this.invuln = 1.2;
    this.dashT = 0;
    this.dashCd = 0;
    this.model.deadT = 0;
    this.model.root.rotation.x = 0;
    this.model.root.visible = true;
    this.sinceHit = 99;
    this.buffs = {};
    this.removeDrone();
  }

  private removeDrone() {
    if (this.drone) {
      this.scene.remove(this.drone.g);
      this.drone = null;
    }
  }

  addBuff(id: BuffId, g: Game) {
    const b = BUFFS[id];
    if (id === "shield") {
      this.shield = Math.min(this.stats.maxShield, this.shield + 55);
      this.hp = Math.min(this.stats.maxHp, this.hp + 20);
    } else {
      this.buffs[id] = b.duration;
      if (id === "drone" && !this.drone) {
        const d = buildSupportDrone();
        this.scene.add(d);
        this.drone = { g: d, t: 0, cd: 0 };
      }
    }
    g.ui.toast(b.name, "exploit acquired", 1300, b.css);
    g.vfx.ring(this.pos.x, 0.06, this.pos.z, b.color, 2.4, 0.5);
    g.vfx.burst(this.pos.x, 1, this.pos.z, b.color, 18, 5, 0.1, 0.6, 0);
  }

  heal(n: number) {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  takeDamage(g: Game, amount: number, from: THREE.Vector3, knock = 7): boolean {
    if (this.dead || this.invuln > 0 || this.god) return false;
    let rest = amount;
    const s = Math.min(this.shield, rest);
    this.shield -= s;
    rest -= s;
    this.hp -= rest;
    this.invuln = PLAYER.invuln;
    this.sinceHit = 0;
    this.model.flinch();
    _v.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
    _v.normalize();
    this.vel.addScaledVector(_v, knock);
    g.vfx.sparks(this.pos.x, 1.1, this.pos.z, _v.x, _v.z, s > 0 && rest <= 0 ? 0x38bdf8 : 0xff4d6d, 12);
    g.vfx.addShake(0.22 + amount * 0.006);
    g.damageFx = Math.min(1, g.damageFx + 0.5 + amount * 0.01);
    g.hitStop(0.04);
    if (this.hp <= 0) this.die(g);
    return true;
  }

  private die(g: Game) {
    this.dead = true;
    this.hp = 0;
    g.vfx.explosion(this.pos.x, 1, this.pos.z, 0x22d3ee, 1.1);
    g.onPlayerDeath();
  }

  update(dt: number, g: Game) {
    const inp = g.input;
    this.invuln = Math.max(0, this.invuln - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.sinceHit += dt;
    for (const k of Object.keys(this.buffs) as BuffId[]) {
      const v = (this.buffs[k] ?? 0) - dt;
      if (v <= 0) delete this.buffs[k];
      else this.buffs[k] = v;
    }
    if (!this.buffs.drone) this.removeDrone();
    this.light.position.set(this.pos.x, 3.2, this.pos.z);

    if (this.dead) {
      this.model.root.position.copy(this.pos);
      this.model.update(dt, { aimYaw: this.yaw, vx: 0, vz: 0, speed01: 0, dashing: false, dead: true });
      return;
    }

    // shield regen
    if (this.sinceHit > PLAYER.shieldDelay && this.shield < this.stats.maxShield) {
      this.shield = Math.min(this.stats.maxShield, this.shield + PLAYER.shieldRegen * this.stats.shieldRegenMul * dt);
    }

    // aim direction
    _v.set(g.aimPoint.x - this.pos.x, 0, g.aimPoint.z - this.pos.z);
    if (_v.lengthSq() > 0.05) {
      const target = Math.atan2(_v.x, _v.z);
      let d = target - this.yaw;
      d = ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
      this.yaw += d * Math.min(1, dt * 26);
    }
    this.aim.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // movement
    inp.move(_m);
    if (this.dashing) {
      this.dashT -= dt;
      this.vel.copy(this.dashDir).multiplyScalar(PLAYER.dashSpeed);
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.035;
        g.vfx.burst(this.pos.x, 0.9, this.pos.z, 0x22d3ee, 4, 1.2, 0.14, 0.3, 0);
      }
      g.vfx.trail(this.pos.x, 0.9, this.pos.z, 0x67e8f9, 0.12);
    } else {
      const sp = PLAYER.speed * (inp.fire ? 0.92 : 1);
      this.vel.x = damp(this.vel.x, _m.x * sp, 16, dt);
      this.vel.z = damp(this.vel.z, _m.z * sp, 16, dt);
      if (inp.pressed("ShiftLeft", "ShiftRight", "Space") && this.dashCd <= 0) {
        if (_m.x !== 0 || _m.z !== 0) this.dashDir.set(_m.x, 0, _m.z);
        else this.dashDir.set(this.aim.x, 0, this.aim.z);
        this.dashT = PLAYER.dashTime;
        this.dashCd = PLAYER.dashCooldown * this.stats.dashCdMul;
        this.invuln = Math.max(this.invuln, PLAYER.dashTime + 0.1);
        this.didDash = true;
        g.vfx.ring(this.pos.x, 0.06, this.pos.z, 0x22d3ee, 1.8, 0.35);
        g.vfx.burst(this.pos.x, 0.8, this.pos.z, 0x67e8f9, 10, 4, 0.09, 0.4, 0);
        g.vfx.addShake(0.08);
        g.fovKick = 1;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    resolveCircle(this.pos, this.radius, g.world.colliders);
    this.model.root.position.copy(this.pos);

    // shooting
    if (inp.fire && this.fireCd <= 0 && !this.dashing) this.shoot(g);

    // helper drone
    if (this.drone) this.updateDrone(dt, g);

    const speed01 = clamp(Math.hypot(this.vel.x, this.vel.z) / PLAYER.speed, 0, 1.2);
    this.model.update(dt, { aimYaw: this.yaw, vx: this.vel.x, vz: this.vel.z, speed01: Math.min(1, speed01), dashing: this.dashing, dead: false });
  }

  private shootColor() {
    if (this.buffs.overclock) return 0xf59e0b;
    if (this.buffs.chain) return 0x67e8f9;
    if (this.buffs.freeze) return 0x93c5fd;
    if (this.buffs.pierce) return 0xf472b6;
    return 0x22d3ee;
  }

  private shoot(g: Game) {
    this.fireCd = PLAYER.fireInterval / this.stats.fireRateMul / (this.buffs.overclock ? 1.25 : 1);
    this.model.muzzle.getWorldPosition(_muzzle);
    const spread = (Math.random() - 0.5) * 0.05;
    const a = this.yaw + spread;
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const color = this.shootColor();
    g.projectiles.spawn({
      pos: _muzzle,
      vel: dir.clone().multiplyScalar(PLAYER.boltSpeed),
      dmg: this.damage,
      friendly: true,
      life: PLAYER.boltLife,
      pierce: this.stats.pierce + (this.buffs.pierce ? 2 : 0),
      chain: !!this.buffs.chain || Math.random() < this.stats.chainChance,
      freeze: !!this.buffs.freeze || Math.random() < this.stats.freezeChance,
      color,
    });
    this.model.kick();
    g.vfx.burst(_muzzle.x, _muzzle.y, _muzzle.z, color, 3, 3, 0.07, 0.15, 0);
    g.vfx.flash(_muzzle.x, _muzzle.y, _muzzle.z, color, 26, 0.06);
    g.vfx.addShake(0.018);
    g.camKick.set(-dir.x * 0.05, 0, -dir.z * 0.05);
  }

  private updateDrone(dt: number, g: Game) {
    const d = this.drone!;
    d.t += dt;
    d.cd -= dt;
    const a = d.t * 2.4;
    d.g.position.set(this.pos.x + Math.cos(a) * 1.7, 1.9 + Math.sin(d.t * 3) * 0.12, this.pos.z + Math.sin(a) * 1.7);
    d.g.rotation.y += dt * 4;
    if (d.cd <= 0) {
      let best: { pos: THREE.Vector3 } | null = null;
      let bd = 15 * 15;
      for (const e of g.enemies) {
        if (e.dead || e.spawning) continue;
        const dd = (e.pos.x - d.g.position.x) ** 2 + (e.pos.z - d.g.position.z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = e;
        }
      }
      if (best) {
        d.cd = 0.32;
        const dir = new THREE.Vector3(best.pos.x - d.g.position.x, 0, best.pos.z - d.g.position.z).normalize();
        g.projectiles.spawn({ pos: d.g.position, vel: dir.clone().multiplyScalar(38), dmg: 9 * this.stats.damageMul, friendly: true, life: 0.7, radius: 0.22, color: 0x4ade80 });
      }
    }
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.scene.remove(this.light);
    this.removeDrone();
  }
}
