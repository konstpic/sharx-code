import * as THREE from "three";
import { BUFFS, BuffId } from "./config";
import { buildPickup } from "./models";
import type { Game } from "./game";

export type PickupKind = BuffId | "repair";

export const PICKUP_COLOR: Record<PickupKind, number> = {
  overclock: BUFFS.overclock.color,
  chain: BUFFS.chain.color,
  pierce: BUFFS.pierce.color,
  freeze: BUFFS.freeze.color,
  shield: BUFFS.shield.color,
  drone: BUFFS.drone.color,
  repair: 0x4ade80,
};

/** Floating exploit crystal. */
export class Pickup {
  group: THREE.Group;
  pos: THREE.Vector3;
  life = 24;
  private t = Math.random() * 6;
  private core: THREE.Object3D;
  private shell: THREE.Object3D;

  constructor(public kind: PickupKind, x: number, z: number, scene: THREE.Scene) {
    this.group = buildPickup(PICKUP_COLOR[kind]);
    this.pos = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.pos);
    this.core = this.group.userData.core as THREE.Object3D;
    this.shell = this.group.userData.shell as THREE.Object3D;
    scene.add(this.group);
  }

  update(dt: number, g: Game): boolean {
    this.t += dt;
    this.life -= dt;
    this.core.rotation.y += dt * 2.4;
    this.shell.rotation.y -= dt * 1.2;
    this.shell.rotation.x += dt * 0.8;
    this.group.position.set(this.pos.x, Math.sin(this.t * 2.6) * 0.12, this.pos.z);
    this.group.visible = this.life > 4 || Math.floor(this.t * 8) % 2 === 0;
    const p = g.player;
    if (p.dead) return this.life > 0;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 4.2 && d > 0.01) {
      const pull = (1 - d / 4.2) * 9 * dt;
      this.pos.x += (dx / d) * pull;
      this.pos.z += (dz / d) * pull;
    }
    if (d < 1.15) {
      this.collect(g);
      return false;
    }
    return this.life > 0;
  }

  private collect(g: Game) {
    if (this.kind === "repair") {
      g.player.heal(35);
      g.ui.toast("REPAIR NANITES", "+35 integrity", 1100, "#4ade80");
      g.vfx.ring(this.pos.x, 0.06, this.pos.z, 0x4ade80, 2.4, 0.5);
      g.vfx.burst(this.pos.x, 1, this.pos.z, 0x4ade80, 16, 4, 0.1, 0.6, 0);
    } else {
      g.player.addBuff(this.kind, g);
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
  }
}
