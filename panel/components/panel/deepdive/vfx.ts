import * as THREE from "three";
import { rand, TAU } from "./util";

const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const _d = new THREE.Object3D();

/* ------------------------------ particles ------------------------------ */

class Particles {
  readonly mesh: THREE.InstancedMesh;
  private N: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  private grav: Float32Array;
  private alive: Uint8Array;
  private next = 0;

  constructor(scene: THREE.Scene, n = 2400) {
    this.N = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.grav = new Float32Array(n);
    this.alive = new Uint8Array(n);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, _c.set(0xffffff));
    _d.scale.setScalar(0);
    _d.updateMatrix();
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, _d.matrix);
    scene.add(this.mesh);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color, k: number, grav: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.N;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.col[i * 3] = color.r * k;
    this.col[i * 3 + 1] = color.g * k;
    this.col[i * 3 + 2] = color.b * k;
    this.grav[i] = grav;
    this.alive[i] = 1;
  }

  update(dt: number) {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        _d.scale.setScalar(0);
        _d.updateMatrix();
        this.mesh.setMatrixAt(i, _d.matrix);
        continue;
      }
      const j = i * 3;
      this.vel[j] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - this.grav[i] * dt;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.03 && this.grav[i] > 0) {
        this.pos[j + 1] = 0.03;
        this.vel[j + 1] *= -0.35;
      }
      const f = this.life[i] / this.max[i];
      _d.position.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      _d.scale.setScalar(this.size[i] * (0.25 + f * 0.75));
      _d.updateMatrix();
      this.mesh.setMatrixAt(i, _d.matrix);
      _c.setRGB(this.col[j] * f, this.col[j + 1] * f, this.col[j + 2] * f);
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/* ------------------------------ beams / rings ------------------------------ */

interface Beam {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  w: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  r: number;
}

export interface Telegraph {
  group: THREE.Group;
  life: number;
  dur: number;
  fill: THREE.Mesh;
  kind: "circle" | "rect";
  radius: number;
  len: number;
  onDone?: () => void;
  cancelled: boolean;
  cancel: () => void;
}

interface Ghost {
  obj: THREE.Object3D;
  mat: THREE.MeshBasicMaterial;
  life: number;
  peak: number;
}

export class VFX {
  private particles: Particles;
  private beams: Beam[] = [];
  private rings: Ring[] = [];
  private lights: { l: THREE.PointLight; life: number; max: number; i: number }[] = [];
  private telegraphs: Telegraph[] = [];
  private ghosts: Ghost[] = [];
  shake = 0;
  private ringGeo = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2);
  private discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true);
  private planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);

  constructor(private scene: THREE.Scene) {
    this.particles = new Particles(scene);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.beams.push({ mesh: m, life: 0, max: 1, w: 1 });
    }
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, r: 1 });
    }
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 16, 2);
      scene.add(l);
      this.lights.push({ l, life: 0, max: 1, i: 0 });
    }
  }

  private col(c: number) {
    return _c.set(c);
  }

  burst(x: number, y: number, z: number, color: number, n: number, speed: number, size: number, life: number, grav = 0) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * TAU;
      const ph = Math.acos(rand(-1, 1));
      const s = speed * rand(0.3, 1);
      this.particles.emit(x, y, z, Math.sin(ph) * Math.cos(th) * s, Math.abs(Math.cos(ph)) * s * 0.9 + speed * 0.1, Math.sin(ph) * Math.sin(th) * s, life * rand(0.6, 1), size * rand(0.5, 1), c, 1.9, grav);
    }
  }

  sparks(x: number, y: number, z: number, dx: number, dz: number, color: number, n: number) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dz, dx) + rand(-0.8, 0.8);
      const s = rand(4, 14);
      this.particles.emit(x, y, z, Math.cos(a) * s, rand(0.5, 5), Math.sin(a) * s, rand(0.15, 0.4), rand(0.04, 0.09), c, 3, 14);
    }
  }

  trail(x: number, y: number, z: number, color: number, size = 0.07) {
    this.particles.emit(x + rand(-0.05, 0.05), y, z + rand(-0.05, 0.05), 0, 0, 0, 0.22, size, this.col(color), 2.4, 0);
  }

  beam(a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, life: number, k = 3) {
    const slot = this.beams.find((x) => x.life <= 0) ?? this.beams[0];
    _a.copy(b).sub(a);
    const len = _a.length();
    if (len < 1e-4) return;
    slot.mesh.visible = true;
    slot.mesh.position.copy(a).addScaledVector(_a, 0.5);
    slot.mesh.quaternion.copy(_q.setFromUnitVectors(Y, _a.normalize()));
    slot.mesh.scale.set(width, len, width);
    (slot.mesh.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(k * 0.5);
    slot.life = life;
    slot.max = life;
    slot.w = width;
    slot.mesh.userData.len = len;
  }

  lightning(a: THREE.Vector3, b: THREE.Vector3, color: number) {
    const segs = 6;
    let prev = _b.copy(a).clone();
    const dir = new THREE.Vector3().subVectors(b, a);
    for (let i = 1; i <= segs; i++) {
      const p = new THREE.Vector3().copy(a).addScaledVector(dir, i / segs);
      if (i < segs) {
        p.x += rand(-0.45, 0.45);
        p.y += rand(-0.3, 0.3);
        p.z += rand(-0.45, 0.45);
      }
      this.beam(prev, p, color, 0.08, 0.14, 3.6);
      prev = p;
    }
  }

  ring(x: number, y: number, z: number, color: number, radius: number, life: number) {
    const slot = this.rings.find((r) => r.life <= 0) ?? this.rings[0];
    slot.mesh.visible = true;
    slot.mesh.position.set(x, y, z);
    (slot.mesh.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(2.6);
    slot.life = life;
    slot.max = life;
    slot.r = radius;
    slot.mesh.scale.setScalar(0.1);
  }

  flash(x: number, y: number, z: number, color: number, intensity: number, life: number) {
    const slot = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    slot.l.position.set(x, y, z);
    slot.l.color.set(color);
    slot.life = life;
    slot.max = life;
    slot.i = intensity;
  }

  addShake(v: number) {
    this.shake = Math.min(1.4, this.shake + v);
  }

  explosion(x: number, y: number, z: number, color: number, scale = 1) {
    this.burst(x, y, z, color, Math.floor(26 * scale), 9 * scale, 0.16 * scale, 0.7, 6);
    this.burst(x, y, z, 0xffffff, Math.floor(8 * scale), 5 * scale, 0.1 * scale, 0.35, 0);
    this.ring(x, 0.06, z, color, 2.6 * scale, 0.45);
    this.flash(x, y + 1, z, color, 90 * scale, 0.25);
    this.addShake(0.16 * scale);
  }

  /* ---- telegraphs ---- */

  private makeTele(kind: "circle" | "rect", dur: number, color: number, onDone?: () => void): Telegraph {
    const group = new THREE.Group();
    group.position.y = 0.05;
    const base = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    let fill: THREE.Mesh;
    if (kind === "circle") {
      group.add(new THREE.Mesh(this.discGeo, base));
      group.add(new THREE.Mesh(this.ringGeo, edgeMat));
      fill = new THREE.Mesh(this.discGeo, fillMat);
      fill.scale.setScalar(0.01);
    } else {
      const b = new THREE.Mesh(this.planeGeo, base);
      group.add(b);
      fill = new THREE.Mesh(this.planeGeo, fillMat);
      const edge = new THREE.Mesh(this.planeGeo, edgeMat);
      edge.userData.edge = true;
      group.add(edge);
    }
    group.add(fill);
    this.scene.add(group);
    const t: Telegraph = {
      group,
      life: dur,
      dur,
      fill,
      kind,
      radius: 1,
      len: 1,
      onDone,
      cancelled: false,
      cancel: () => {
        t.cancelled = true;
        t.life = 0;
      },
    };
    this.telegraphs.push(t);
    return t;
  }

  telegraphCircle(x: number, z: number, radius: number, dur: number, onDone?: () => void, color = 0xff2a4a) {
    const t = this.makeTele("circle", dur, color, onDone);
    t.radius = radius;
    t.group.position.set(x, 0.05, z);
    t.group.children[0].scale.setScalar(radius);
    t.group.children[1].scale.setScalar(radius);
    return t;
  }

  /** Rectangle starting at (x,z) and extending `len` forward along `yaw`. */
  telegraphRect(x: number, z: number, yaw: number, len: number, width: number, dur: number, onDone?: () => void, color = 0xff2a4a) {
    const t = this.makeTele("rect", dur, color, onDone);
    t.len = len;
    t.radius = width;
    t.group.position.set(x, 0.05, z);
    t.group.rotation.y = yaw;
    t.group.children[0].scale.set(width, 1, len);
    // thin edge line at the far end
    t.group.children[1].scale.set(width, 1, 0.18);
    t.group.children[1].position.z = len - 0.18;
    return t;
  }

  moveTelegraph(t: Telegraph, x: number, z: number, yaw?: number) {
    t.group.position.set(x, 0.05, z);
    if (yaw !== undefined) t.group.rotation.y = yaw;
  }

  clearTelegraphs() {
    for (const t of this.telegraphs) {
      t.cancelled = true;
      t.life = 0;
    }
  }

  /* ---- ghosts ---- */

  ghost(src: THREE.Object3D, color: number) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const obj = src.clone(true);
    const drop: THREE.Object3D[] = [];
    let n = 0;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // skip unlit glow/flash/jet meshes; only the lit armour forms the silhouette
      if ((m.material as THREE.Material).type === "MeshBasicMaterial") drop.push(m);
      else n++;
      m.material = mat;
      m.castShadow = false;
    });
    drop.forEach((d) => d.parent?.remove(d));
    // many overlapping additive layers would white out: scale opacity by mesh count
    const peak = Math.max(0.035, Math.min(0.5, 9 / Math.max(n, 1)));
    mat.opacity = peak;
    src.updateWorldMatrix(true, false);
    obj.matrix.copy(src.matrixWorld);
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    this.scene.add(obj);
    this.ghosts.push({ obj, mat, life: 0.28, peak });
  }

  /* ---- update ---- */

  update(dt: number) {
    this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        continue;
      }
      const f = b.life / b.max;
      b.mesh.scale.x = b.mesh.scale.z = b.w * (0.3 + f * 0.7);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, f * 1.4);
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const f = 1 - r.life / r.max;
      r.mesh.scale.setScalar(0.1 + r.r * (1 - Math.pow(1 - f, 3)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - f;
    }
    for (const l of this.lights) {
      if (l.life > 0) {
        l.life -= dt;
        l.l.intensity = Math.max(0, (l.life / l.max) * l.i);
      } else l.l.intensity = 0;
    }
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.life -= dt;
      const p = Math.max(0, Math.min(1, 1 - t.life / t.dur));
      if (t.kind === "circle") t.fill.scale.setScalar(Math.max(0.01, t.radius * p));
      else t.fill.scale.set(t.radius, 1, Math.max(0.01, t.len * p));
      if (t.life <= 0) {
        this.scene.remove(t.group);
        t.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) (m.material as THREE.Material).dispose();
        });
        this.telegraphs.splice(i, 1);
        if (!t.cancelled) t.onDone?.();
      }
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.life -= dt;
      g.mat.opacity = Math.max(0, g.life / 0.28) * g.peak;
      if (g.life <= 0) {
        this.scene.remove(g.obj);
        g.mat.dispose();
        this.ghosts.splice(i, 1);
      }
    }
  }

  dispose() {
    this.clearTelegraphs();
    this.update(0.001);
    this.ringGeo.dispose();
    this.discGeo.dispose();
    this.beamGeo.dispose();
    this.planeGeo.dispose();
  }
}
