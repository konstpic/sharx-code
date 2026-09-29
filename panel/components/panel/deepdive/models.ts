import * as THREE from "three";

/* ------------------------------ material helpers ------------------------------ */

interface StdOpts {
  metal?: number;
  rough?: number;
  emissive?: number;
  ei?: number;
  flat?: boolean;
}

export const std = (color: number, o: StdOpts = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0.6,
    roughness: o.rough ?? 0.45,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? 1,
    flatShading: o.flat ?? true,
  });

/** Unlit HDR-bright material (blooms). */
export const glow = (color: number, k = 2, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(k * 0.68),
    toneMapped: false,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });

/** Additive translucent hologram material. */
export const holo = (color: number, k = 1.4, opacity = 0.3) =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(k * 0.75),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

const WHITE = new THREE.Color(1, 1, 1);

/** Hit-flash for a set of standard materials. */
export class Flasher {
  private items: { m: THREE.MeshStandardMaterial; e: THREE.Color; i: number }[];
  constructor(mats: THREE.MeshStandardMaterial[]) {
    this.items = mats.map((m) => ({ m, e: m.emissive.clone(), i: m.emissiveIntensity }));
  }
  set(f: number) {
    for (const it of this.items) {
      it.m.emissive.copy(it.e).lerp(WHITE, f);
      it.m.emissiveIntensity = it.i + f * 1.6;
    }
  }
}

const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function put<T extends THREE.Object3D>(child: T, parent: THREE.Object3D, x = 0, y = 0, z = 0): T {
  child.position.set(x, y, z);
  parent.add(child);
  return child;
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return put(m, parent, x, y, z);
}

/* ------------------------------ sniffer drone ------------------------------ */

export class SnifferModel {
  root = new THREE.Group();
  flasher: Flasher;
  private hover = new THREE.Group();
  private ring: THREE.Mesh;
  private fins = new THREE.Group();
  private eye: THREE.Mesh;
  private eyeMat: THREE.MeshBasicMaterial;
  private cone: THREE.Mesh;
  private coneMat: THREE.MeshBasicMaterial;
  private t = Math.random() * 10;

  constructor() {
    const hull = std(0x1b2440, { metal: 0.85, rough: 0.3 });
    const hull2 = std(0x2c375f, { metal: 0.8, rough: 0.35 });
    const cy = glow(0x22d3ee, 2.4);
    this.eyeMat = glow(0x22d3ee, 3.2);
    this.flasher = new Flasher([hull, hull2]);
    this.root.add(this.hover);
    part(new THREE.IcosahedronGeometry(0.5, 1), hull, this.hover);
    part(new THREE.CylinderGeometry(0.2, 0.34, 0.3, 6), hull2, this.hover, 0, -0.4, 0);
    this.ring = part(new THREE.TorusGeometry(0.66, 0.045, 8, 28), cy, this.hover, 0, 0, 0, false);
    this.ring.rotation.x = Math.PI / 2;
    this.eye = part(new THREE.SphereGeometry(0.17, 12, 10), this.eyeMat, this.hover, 0, 0.04, 0.44, false);
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 5), hull2, this.hover, 0, 0.6, 0);
    part(new THREE.SphereGeometry(0.06, 8, 6), cy, this.hover, 0, 0.85, 0, false);
    this.hover.add(this.fins);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const arm = part(B(0.08, 0.05, 0.62), hull2, this.fins, Math.sin(a) * 0.62, -0.05, Math.cos(a) * 0.62);
      arm.rotation.y = a;
      part(B(0.16, 0.05, 0.16), cy, this.fins, Math.sin(a) * 0.9, -0.05, Math.cos(a) * 0.9, false);
    }
    this.coneMat = holo(0xff4d6d, 1.1, 0.0);
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 7, 22, 1, true), this.coneMat);
    this.cone.rotation.x = -Math.PI / 2;
    this.cone.position.set(0, 0, 3.6);
    this.hover.add(this.cone);
    this.hover.position.y = 1.25;
  }

  setEye(color: number) {
    this.eyeMat.color.set(color).multiplyScalar(3.2);
  }

  update(dt: number, o: { scan: number; speed01: number }) {
    this.t += dt;
    this.hover.position.y = 1.25 + Math.sin(this.t * 3) * 0.1;
    this.fins.rotation.y += dt * (6 + o.speed01 * 10);
    this.ring.rotation.z += dt * 2;
    this.hover.rotation.z = Math.sin(this.t * 2.1) * 0.06;
    this.coneMat.opacity = o.scan * (0.085 + 0.03 * Math.sin(this.t * 30));
    this.cone.visible = o.scan > 0.02;
    this.eye.scale.setScalar(1 + o.scan * 0.5);
  }
}

/* ------------------------------ DDoS bot (crawler) ------------------------------ */

export class BotModel {
  root = new THREE.Group();
  flasher: Flasher;
  private legs: THREE.Group[] = [];
  private phase = Math.random() * 6;
  private bodyG = new THREE.Group();

  constructor() {
    const shell = std(0x3a1622, { metal: 0.75, rough: 0.35 });
    const dark = std(0x140a10, { metal: 0.5, rough: 0.6 });
    const red = glow(0xff4d6d, 2.8);
    this.flasher = new Flasher([shell, dark]);
    this.root.add(this.bodyG);
    put(this.bodyG, this.root, 0, 0.42, 0);
    part(B(0.78, 0.24, 0.9), shell, this.bodyG);
    part(B(0.5, 0.16, 0.5), dark, this.bodyG, 0, 0.18, -0.05);
    part(B(0.34, 0.2, 0.26), shell, this.bodyG, 0, 0.02, 0.52);
    part(B(0.24, 0.06, 0.03), red, this.bodyG, 0, 0.06, 0.66, false);
    part(B(0.06, 0.06, 0.5), red, this.bodyG, 0, 0.12, -0.55, false);
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2) - 1;
      const g = new THREE.Group();
      put(g, this.bodyG, side * 0.4, -0.05, row * 0.32);
      part(B(0.5, 0.06, 0.07), dark, g, side * 0.22, -0.1, 0).rotation.z = side * 0.5;
      part(B(0.06, 0.34, 0.06), shell, g, side * 0.48, -0.26, 0);
      this.legs.push(g);
    }
  }

  update(dt: number, speed01: number) {
    this.phase += dt * (8 + speed01 * 22);
    this.legs.forEach((g, i) => {
      const s = i % 2 === 0 ? -1 : 1;
      g.rotation.y = Math.sin(this.phase + i * 1.3) * 0.5 * s;
      g.rotation.z = Math.max(0, Math.sin(this.phase + i * 1.3)) * 0.35 * s;
    });
    this.bodyG.position.y = 0.42 + Math.abs(Math.sin(this.phase * 0.5)) * 0.04;
    this.bodyG.rotation.z = Math.sin(this.phase * 0.5) * 0.05;
  }
}

/* ------------------------------ DPI probe ------------------------------ */

export class ProbeModel {
  root = new THREE.Group();
  flasher: Flasher;
  private hover = new THREE.Group();
  private ring: THREE.Mesh;
  private lensMat: THREE.MeshBasicMaterial;
  private lens: THREE.Mesh;
  private t = Math.random() * 10;

  constructor() {
    const hull = std(0x3a2a0c, { metal: 0.85, rough: 0.3 });
    const hull2 = std(0x1e1608, { metal: 0.7, rough: 0.4 });
    const am = glow(0xfbbf24, 2.6);
    this.lensMat = glow(0xffb020, 3);
    this.flasher = new Flasher([hull, hull2]);
    this.root.add(this.hover);
    const prism = part(new THREE.OctahedronGeometry(0.55, 0), hull, this.hover);
    prism.scale.set(0.85, 1.5, 0.85);
    this.ring = part(new THREE.TorusGeometry(0.75, 0.04, 6, 22), am, this.hover, 0, 0.1, 0, false);
    this.ring.rotation.x = Math.PI / 2;
    const barrel = part(new THREE.CylinderGeometry(0.16, 0.24, 0.7, 10), hull2, this.hover, 0, 0, 0.55);
    barrel.rotation.x = Math.PI / 2;
    this.lens = part(new THREE.SphereGeometry(0.14, 10, 8), this.lensMat, this.hover, 0, 0, 0.92, false);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = part(B(0.05, 0.7, 0.05), hull2, this.hover, Math.sin(a) * 0.32, -0.75, Math.cos(a) * 0.32);
      leg.rotation.z = Math.sin(a) * 0.5;
      leg.rotation.x = -Math.cos(a) * 0.5;
      part(new THREE.SphereGeometry(0.05, 6, 5), am, this.hover, Math.sin(a) * 0.55, -1.05, Math.cos(a) * 0.55, false);
    }
    part(B(0.04, 0.5, 0.04), hull2, this.hover, 0.25, 0.9, -0.1);
    part(B(0.04, 0.4, 0.04), hull2, this.hover, -0.25, 0.85, -0.1);
    this.hover.position.y = 1.7;
  }

  update(dt: number, charge: number) {
    this.t += dt;
    this.hover.position.y = 1.7 + Math.sin(this.t * 2.4) * 0.14;
    this.ring.rotation.z += dt * (1.5 + charge * 12);
    this.lens.scale.setScalar(1 + charge * 1.8 + Math.sin(this.t * 40) * 0.1 * charge);
    this.lensMat.color.set(charge > 0.05 ? 0xff3355 : 0xffb020).multiplyScalar(3 + charge * 3);
  }
}

/* ------------------------------ turret ------------------------------ */

export class TurretModel {
  root = new THREE.Group();
  flasher: Flasher;
  private head = new THREE.Group();
  private shieldRing: THREE.Mesh;
  private recoil = 0;
  private barrels: THREE.Mesh[] = [];
  muzzles: THREE.Object3D[] = [];

  constructor(color = 0xf97316) {
    const hull = std(0x2a1a10, { metal: 0.85, rough: 0.35 });
    const hull2 = std(0x463020, { metal: 0.75, rough: 0.4 });
    const gl = glow(color, 2.6);
    this.flasher = new Flasher([hull, hull2]);
    part(new THREE.CylinderGeometry(1.05, 1.25, 0.5, 8), hull, this.root, 0, 0.25, 0);
    const basering = part(new THREE.TorusGeometry(1.05, 0.05, 6, 24), gl, this.root, 0, 0.52, 0, false);
    basering.rotation.x = Math.PI / 2;
    part(new THREE.CylinderGeometry(0.42, 0.55, 1.05, 8), hull2, this.root, 0, 1.0, 0);
    put(this.head, this.root, 0, 1.75, 0);
    part(B(1.05, 0.62, 0.95), hull, this.head);
    part(B(0.8, 0.08, 0.5), gl, this.head, 0, 0.35, -0.05, false);
    for (const s of [-1, 1]) {
      const b = part(B(0.15, 0.15, 1.1), hull2, this.head, s * 0.3, 0, 0.85);
      this.barrels.push(b);
      part(B(0.11, 0.11, 0.06), gl, this.head, s * 0.3, 0, 1.43, false);
      const m = new THREE.Object3D();
      put(m, this.head, s * 0.3, 0, 1.5);
      this.muzzles.push(m);
    }
    part(new THREE.SphereGeometry(0.16, 10, 8), gl, this.head, 0, 0.05, 0.5, false);
    this.shieldRing = part(new THREE.TorusGeometry(0.85, 0.04, 6, 24), gl, this.root, 0, 1.75, 0, false);
    this.shieldRing.rotation.x = Math.PI / 2.4;
  }

  fire() {
    this.recoil = 1;
  }

  update(dt: number, yaw: number) {
    this.head.rotation.y = yaw;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.barrels.forEach((b) => (b.position.z = 0.85 - this.recoil * 0.18));
    this.shieldRing.rotation.z += dt * 1.6;
  }
}

/* ------------------------------ pylon (boss phase objects) ------------------------------ */

export class PylonModel {
  root = new THREE.Group();
  flasher: Flasher;
  private crystal: THREE.Mesh;
  private ring: THREE.Mesh;
  private t = Math.random() * 10;

  constructor() {
    const hull = std(0x0f2236, { metal: 0.85, rough: 0.3 });
    const blue = glow(0x38bdf8, 3);
    this.flasher = new Flasher([hull]);
    part(new THREE.CylinderGeometry(0.8, 1.05, 0.5, 8), hull, this.root, 0, 0.25, 0);
    part(new THREE.CylinderGeometry(0.28, 0.4, 1.7, 6), hull, this.root, 0, 1.2, 0);
    this.crystal = part(new THREE.OctahedronGeometry(0.6, 0), blue, this.root, 0, 2.5, 0, false);
    this.crystal.scale.y = 1.5;
    this.ring = part(new THREE.TorusGeometry(0.85, 0.04, 6, 24), blue, this.root, 0, 2.5, 0, false);
    this.ring.rotation.x = Math.PI / 2.3;
  }

  update(dt: number) {
    this.t += dt;
    this.crystal.rotation.y += dt * 1.8;
    this.crystal.position.y = 2.5 + Math.sin(this.t * 2.5) * 0.12;
    this.ring.rotation.z += dt * 2.2;
  }
}

/* ------------------------------ Warden (elite mech) ------------------------------ */

export class WardenModel {
  root = new THREE.Group();
  flasher: Flasher;
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private domeMat: THREE.MeshBasicMaterial;
  private wireMat: THREE.MeshBasicMaterial;
  private dome: THREE.Group = new THREE.Group();
  private coreMat: THREE.MeshBasicMaterial;
  private crackMat: THREE.MeshBasicMaterial;
  private phase = 0;
  private t = 0;
  private pulse = 0;

  constructor() {
    const armor = std(0x2a1218, { metal: 0.85, rough: 0.3 });
    const armor2 = std(0x431c26, { metal: 0.8, rough: 0.34 });
    const dark = std(0x120a0c, { metal: 0.4, rough: 0.7 });
    const red = glow(0xf43f5e, 3);
    this.coreMat = glow(0xf43f5e, 3.5);
    this.crackMat = glow(0xff9d2e, 0);
    this.flasher = new Flasher([armor, armor2, dark]);

    put(this.hips, this.root, 0, 1.55, 0);
    part(B(1.2, 0.44, 0.8), armor, this.hips);
    for (const [leg, s] of [[this.legL, -1], [this.legR, 1]] as const) {
      put(leg, this.hips, s * 0.42, -0.1, 0);
      part(B(0.5, 0.8, 0.55), armor2, leg, 0, -0.42, 0);
      const shin = put(new THREE.Group(), leg, 0, -0.85, 0);
      part(B(0.42, 0.75, 0.46), dark, shin, 0, -0.38, 0);
      part(B(0.55, 0.22, 0.75), armor, shin, 0, -0.78, 0.1);
      part(B(0.08, 0.5, 0.04), red, shin, 0, -0.4, 0.25, false);
    }
    put(this.torso, this.hips, 0, 0.3, 0);
    part(B(1.9, 1.1, 1.05), armor2, this.torso, 0, 0.62, 0);
    part(B(1.3, 0.5, 0.06), armor, this.torso, 0, 0.7, 0.55);
    const core = part(new THREE.CircleGeometry(0.26, 16), this.coreMat, this.torso, 0, 0.66, 0.59, false);
    core.rotation.y = 0;
    part(B(0.9, 0.06, 0.05), red, this.torso, 0, 0.98, 0.56, false);
    this.crack(this.torso);
    part(B(1.2, 0.9, 0.5), dark, this.torso, 0, 0.7, -0.75);
    for (const s of [-1, 1]) part(B(0.16, 0.6, 0.06), red, this.torso, s * 0.3, 0.7, -1.02, false);
    part(B(0.7, 0.55, 0.65), armor, this.torso, 0, 1.4, 0.05);
    part(B(0.5, 0.09, 0.04), red, this.torso, 0, 1.42, 0.4, false);
    for (const [arm, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      put(arm, this.torso, s * 1.2, 1.0, 0);
      part(B(0.8, 0.55, 0.95), armor, arm, s * 0.05, 0.05, 0);
      part(B(0.4, 0.9, 0.4), armor2, arm, 0, -0.55, 0);
      const fore = put(new THREE.Group(), arm, 0, -1.0, 0);
      part(B(0.7, 0.85, 0.7), armor, fore, 0, -0.3, 0.05);
      part(B(0.5, 0.08, 0.5), red, fore, 0, -0.75, 0.05, false);
    }
    this.dome.position.y = 1.9;
    this.root.add(this.dome);
    this.domeMat = holo(0xff5a4d, 1.5, 0.16);
    this.wireMat = holo(0xff8a5c, 1.8, 0.28);
    this.dome.add(new THREE.Mesh(new THREE.SphereGeometry(2.7, 28, 18), this.domeMat));
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(2.74, 2), this.wireMat);
    (wire.material as THREE.MeshBasicMaterial).wireframe = true;
    this.dome.add(wire);
  }

  private crack(parent: THREE.Object3D) {
    for (let i = 0; i < 4; i++) {
      const c = part(B(0.05, 0.6, 0.03), this.crackMat, parent, -0.6 + i * 0.4, 0.55 + (i % 2) * 0.2, 0.57, false);
      c.rotation.z = (i - 1.5) * 0.4;
    }
  }

  ripple() {
    this.pulse = 1;
  }

  update(dt: number, o: { speed01: number; shieldPct: number; vulnerable: boolean; windup: number }) {
    this.t += dt;
    this.phase += dt * (3 + 6 * o.speed01) * (o.speed01 > 0.05 ? 1 : 0);
    this.pulse = Math.max(0, this.pulse - dt * 4);
    const sw = Math.sin(this.phase);
    this.legL.rotation.x = sw * 0.6 * o.speed01;
    this.legR.rotation.x = -sw * 0.6 * o.speed01;
    this.hips.position.y = 1.55 + Math.abs(sw) * 0.08 * o.speed01 + Math.sin(this.t * 1.6) * 0.02;
    this.torso.rotation.x = 0.06 * o.speed01 + o.windup * -0.25;
    this.armL.rotation.x = -sw * 0.4 * o.speed01 - o.windup * 2.4;
    this.armR.rotation.x = sw * 0.4 * o.speed01 - o.windup * 2.4;
    this.dome.visible = o.shieldPct > 0.01;
    this.dome.scale.setScalar(0.9 + o.shieldPct * 0.1 + this.pulse * 0.04);
    this.domeMat.opacity = 0.07 + this.pulse * 0.3 + o.shieldPct * 0.05;
    this.wireMat.opacity = 0.16 + this.pulse * 0.5;
    this.dome.rotation.y += dt * 0.4;
    const vuln = o.vulnerable ? 1 : 0;
    this.crackMat.color.set(0xff9d2e).multiplyScalar(vuln * (3 + Math.sin(this.t * 14)));
    this.coreMat.color.set(vuln ? 0xffb020 : 0xf43f5e).multiplyScalar(3 + Math.sin(this.t * 6) * 0.8);
  }
}

/* ------------------------------ Firewall Sentinel (boss) ------------------------------ */

export class SentinelModel {
  root = new THREE.Group();
  flasher: Flasher;
  private core: THREE.Mesh;
  private coreMat: THREE.MeshBasicMaterial;
  private eyeG = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private shards = new THREE.Group();
  private dome: THREE.Group = new THREE.Group();
  private domeMat: THREE.MeshBasicMaterial;
  private wireMat: THREE.MeshBasicMaterial;
  private emitters: THREE.Mesh[] = [];
  private t = 0;
  private pulse = 0;

  constructor() {
    const hull = std(0x1a0e10, { metal: 0.9, rough: 0.28 });
    const hull2 = std(0x3a1a1c, { metal: 0.85, rough: 0.32 });
    const red = glow(0xff3d3d, 3);
    const orange = glow(0xff8a3d, 3);
    this.coreMat = glow(0xff4a2a, 2.0);
    this.flasher = new Flasher([hull, hull2]);

    part(new THREE.CylinderGeometry(3.6, 4.2, 0.7, 12), hull, this.root, 0, 0.35, 0);
    const base = part(new THREE.TorusGeometry(3.7, 0.09, 8, 48), red, this.root, 0, 0.75, 0, false);
    base.rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = part(new THREE.CylinderGeometry(0.4, 0.55, 3.2, 6), hull2, this.root, Math.sin(a) * 3.6, 1.9, Math.cos(a) * 3.6);
      part(new THREE.OctahedronGeometry(0.34, 0), orange, this.root, Math.sin(a) * 3.6, 3.85, Math.cos(a) * 3.6, false);
      this.emitters.push(p);
    }
    this.core = part(new THREE.IcosahedronGeometry(1.5, 1), this.coreMat, this.root, 0, 3.7, 0, false);
    part(new THREE.IcosahedronGeometry(1.95, 0), hull, this.root, 0, 3.7, 0).scale.setScalar(0.001);
    const cfgs: [number, number, number, number][] = [
      [2.5, 0.1, 0.9, 0],
      [3.1, 0.1, 0, 1.0],
      [3.7, 0.12, 0.5, 0.5],
    ];
    for (const [r, tube, rx, rz] of cfgs) {
      const ring = part(new THREE.TorusGeometry(r, tube, 8, 56), glow(0xff5a3a, 2.6), this.root, 0, 3.7, 0, false);
      ring.rotation.x = Math.PI / 2 + rx;
      ring.rotation.z = rz;
      this.rings.push(ring);
    }
    put(this.shards, this.root, 0, 3.7, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = part(B(1.3, 2.5, 0.28), hull2, this.shards, Math.sin(a) * 2.9, Math.sin(a * 2) * 0.5, Math.cos(a) * 2.9);
      s.rotation.y = a;
      part(B(0.06, 2.1, 0.04), red, s, 0, 0, 0.16, false);
    }
    put(this.eyeG, this.root, 0, 3.7, 0);
    const iris = part(new THREE.SphereGeometry(0.55, 16, 12), glow(0xfff1d6, 3.6), this.eyeG, 0, 0, 1.15, false);
    iris.scale.z = 0.6;

    this.dome.position.y = 3.7;
    this.root.add(this.dome);
    this.domeMat = holo(0x5ad1ff, 1.5, 0.18);
    this.wireMat = holo(0x9be7ff, 1.8, 0.3);
    this.dome.add(new THREE.Mesh(new THREE.SphereGeometry(5.2, 32, 20), this.domeMat));
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(5.25, 2), this.wireMat);
    wire.material = this.wireMat;
    this.wireMat.wireframe = true;
    this.dome.add(wire);
    this.dome.visible = false;
  }

  ripple() {
    this.pulse = 1;
  }

  update(dt: number, o: { yaw: number; charge: number; enrage: number; shield: boolean; vulnerable: boolean }) {
    this.t += dt;
    this.pulse = Math.max(0, this.pulse - dt * 4);
    this.rings[0].rotation.z += dt * (0.8 + o.enrage);
    this.rings[1].rotation.x += dt * (0.6 + o.enrage);
    this.rings[2].rotation.y += dt * (1 + o.enrage * 1.4);
    this.shards.rotation.y += dt * (0.35 + o.enrage * 0.5 + o.charge * 1.5);
    this.core.rotation.y += dt * 0.7;
    this.core.rotation.x += dt * 0.4;
    this.core.position.y = 3.7 + Math.sin(this.t * 1.4) * 0.15;
    this.eyeG.rotation.y = o.yaw;
    this.eyeG.position.y = this.core.position.y;
    const k = 1 + o.charge * 0.35 + Math.sin(this.t * (4 + o.enrage * 8)) * 0.06;
    this.core.scale.setScalar(k);
    const col = o.vulnerable ? 0xffd23d : o.enrage > 0.5 ? 0xff2a5a : 0xff4a2a;
    this.coreMat.color.set(col).multiplyScalar(1.6 + o.charge * 1.4);
    this.dome.visible = o.shield;
    this.dome.rotation.y += dt * 0.3;
    this.domeMat.opacity = 0.12 + this.pulse * 0.3;
    this.wireMat.opacity = 0.2 + this.pulse * 0.5;
  }
}

/* ------------------------------ support drone & pickups ------------------------------ */

export function buildSupportDrone(): THREE.Group {
  const g = new THREE.Group();
  const hull = std(0x123422, { metal: 0.85, rough: 0.3 });
  const gl = glow(0x4ade80, 3);
  part(new THREE.OctahedronGeometry(0.28, 0), hull, g);
  const r = part(new THREE.TorusGeometry(0.36, 0.03, 6, 18), gl, g, 0, 0, 0, false);
  r.rotation.x = Math.PI / 2;
  part(new THREE.SphereGeometry(0.09, 8, 6), gl, g, 0, 0, 0.26, false);
  return g;
}

export function buildPickup(color: number): THREE.Group {
  const g = new THREE.Group();
  const core = part(new THREE.OctahedronGeometry(0.34, 0), glow(color, 3), g, 0, 0.9, 0, false);
  core.scale.y = 1.4;
  const shell = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), holo(color, 1.6, 0.35));
  (shell.material as THREE.MeshBasicMaterial).wireframe = true;
  put(shell, g, 0, 0.9, 0);
  const ring = part(new THREE.TorusGeometry(0.55, 0.025, 6, 24), glow(color, 2.4), g, 0, 0.05, 0, false);
  ring.rotation.x = Math.PI / 2;
  g.userData.core = core;
  g.userData.shell = shell;
  return g;
}
