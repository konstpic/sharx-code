import * as THREE from "three";
import { Box, pointInBoxes } from "./collision";
import { glow } from "./models";

export interface Projectile {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  dmg: number;
  friendly: boolean;
  life: number;
  pierce: number;
  chain: boolean;
  freeze: boolean;
  hitSet: Set<unknown>;
  color: number;
}

const _o = new THREE.Object3D();
const _up = new THREE.Vector3(0, 0, 1);

/** Pooled projectiles rendered with two InstancedMeshes (bolts + orbs). */
export class Projectiles {
  private list: Projectile[] = [];
  private bolts: THREE.InstancedMesh;
  private orbs: THREE.InstancedMesh;
  private max = 300;

  constructor(scene: THREE.Scene) {
    const boltGeo = new THREE.CapsuleGeometry(0.06, 0.9, 3, 6).rotateX(Math.PI / 2);
    this.bolts = new THREE.InstancedMesh(boltGeo, glow(0xffffff, 1, 1), this.max);
    this.orbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 1), glow(0xffffff, 1, 1), this.max);
    for (const m of [this.bolts, this.orbs]) {
      m.frustumCulled = false;
      m.count = 0;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(m);
    }
    for (let i = 0; i < this.max; i++) {
      this.list.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), radius: 0.2, dmg: 0, friendly: true, life: 0, pierce: 0, chain: false, freeze: false, hitSet: new Set(), color: 0xffffff });
    }
  }

  spawn(o: { pos: THREE.Vector3; vel: THREE.Vector3; radius?: number; dmg: number; friendly: boolean; life: number; pierce?: number; chain?: boolean; freeze?: boolean; color: number }) {
    const p = this.list.find((x) => !x.active);
    if (!p) return null;
    p.active = true;
    p.pos.copy(o.pos);
    p.vel.copy(o.vel);
    p.radius = o.radius ?? (o.friendly ? 0.28 : 0.3);
    p.dmg = o.dmg;
    p.friendly = o.friendly;
    p.life = o.life;
    p.pierce = o.pierce ?? 0;
    p.chain = o.chain ?? false;
    p.freeze = o.freeze ?? false;
    p.hitSet.clear();
    p.color = o.color;
    return p;
  }

  each(fn: (p: Projectile) => void) {
    for (const p of this.list) if (p.active) fn(p);
  }

  kill(p: Projectile) {
    p.active = false;
  }

  clearHostile() {
    for (const p of this.list) if (!p.friendly) p.active = false;
  }

  clearAll() {
    for (const p of this.list) p.active = false;
  }

  /** Advance and cull on walls (call several times per frame for sub-stepping). */
  step(dt: number, walls: Box[], onWall: (p: Projectile) => void) {
    for (const p of this.list) {
      if (!p.active) continue;
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      if (pointInBoxes(p.pos.x, p.pos.z, walls, 0.05, true)) {
        onWall(p);
        p.active = false;
      }
    }
  }

  /** Write instance buffers once per frame. */
  sync() {
    let nb = 0;
    let no = 0;
    const c = new THREE.Color();
    for (const p of this.list) {
      if (!p.active) continue;
      if (p.friendly) {
        _o.position.copy(p.pos);
        _o.quaternion.setFromUnitVectors(_up, _o.position.clone().set(p.vel.x, 0, p.vel.z).normalize());
        _o.scale.set(1, 1, 1);
        _o.updateMatrix();
        this.bolts.setMatrixAt(nb, _o.matrix);
        this.bolts.setColorAt(nb, c.set(p.color).multiplyScalar(1.9));
        nb++;
      } else {
        _o.position.copy(p.pos);
        _o.quaternion.identity();
        _o.scale.setScalar(p.radius / 0.22);
        _o.updateMatrix();
        this.orbs.setMatrixAt(no, _o.matrix);
        this.orbs.setColorAt(no, c.set(p.color).multiplyScalar(2.0));
        no++;
      }
    }
    this.bolts.count = nb;
    this.orbs.count = no;
    this.bolts.instanceMatrix.needsUpdate = true;
    this.orbs.instanceMatrix.needsUpdate = true;
    if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;
    if (this.orbs.instanceColor) this.orbs.instanceColor.needsUpdate = true;
  }

  dispose(scene: THREE.Scene) {
    for (const m of [this.bolts, this.orbs]) {
      scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
