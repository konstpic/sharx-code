import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getBasePath } from "@/lib/paths";
import { Flasher } from "./models";
import { angleDiff, clamp, TAU } from "./util";
import { ProceduralHeroModel, type HeroState } from "./hero_fallback";

export type { HeroState };

/**
 * Player character: a rigged, animated GLB astronaut (Quaternius, CC0) carrying a GLB sci-fi rifle
 * attached to the right-hand bone. See README "Assets". If the files fail to load, the old
 * procedural model is used as a fallback so the game still plays.
 */

const MODEL_URL = "/assets/models/astronaut.glb";
const RIFLE_URL = "/assets/models/scifi_rifle.glb";
const HERO_HEIGHT = 2.3;
const RIFLE_LENGTH = 1.2;

let assets: Promise<{ hero: GLTF; rifle: GLTF }> | null = null;
function loadAssets() {
  if (!assets) {
    const base = getBasePath();
    const loader = new GLTFLoader();
    assets = Promise.all([loader.loadAsync(base + MODEL_URL), loader.loadAsync(base + RIFLE_URL)]).then(([hero, rifle]) => ({ hero, rifle }));
    assets.catch(() => (assets = null));
  }
  return assets;
}

function flashTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(64, 64, 2, 64, 64, 60);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(160,240,255,0.9)");
  g.addColorStop(1, "rgba(0,120,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.beginPath();
  c.moveTo(64, 0);
  c.lineTo(72, 64);
  c.lineTo(64, 128);
  c.lineTo(56, 64);
  c.fill();
  c.beginPath();
  c.moveTo(0, 64);
  c.lineTo(64, 56);
  c.lineTo(128, 64);
  c.lineTo(64, 72);
  c.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CLIP = (n: string) => `CharacterArmature|${n}`;

export class HeroModel {
  root = new THREE.Group();
  muzzle = new THREE.Object3D();
  flasher = new Flasher([]);
  deadT = 0;

  private fallback: ProceduralHeroModel | null = null;
  private ready = false;
  private mixer?: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private cur?: THREE.AnimationAction;
  private curName = "";
  private model = new THREE.Group();
  private muzzleFlash = new THREE.Group();
  private flashLight = new THREE.PointLight(0x7fe9ff, 0, 5, 2);
  private flashT = 0;
  private hitT = 0;
  private shootT = 0;
  private recoil = 0;
  private wasDead = false;
  private rifle = new THREE.Group();
  private cell?: THREE.MeshStandardMaterial;
  private t = 0;
  private disposed = false;
  private wrist?: THREE.Object3D;
  private socket = new THREE.Group();
  private armL?: { u: THREE.Object3D; l: THREE.Object3D; h: THREE.Object3D; l1: number; l2: number };
  private foregrip = new THREE.Object3D();

  constructor() {
    this.root.add(this.model);
    this.muzzle.add(this.muzzleFlash);
    this.muzzle.add(this.flashLight);
    const ft = flashTexture();
    for (const rot of [0, Math.PI / 2]) {
      const m = new THREE.MeshBasicMaterial({ map: ft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(2.4, 2.6, 3) });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), m);
      q.rotation.z = rot;
      const q2 = q.clone();
      q2.rotation.y = Math.PI / 2;
      this.muzzleFlash.add(q, q2);
    }
    this.muzzleFlash.visible = false;
    loadAssets()
      .then((a) => !this.disposed && this.build(a.hero, a.rifle))
      .catch((err) => {
        console.warn("[nettrace] hero GLB failed, using fallback", err);
        if (this.disposed) return;
        this.fallback = new ProceduralHeroModel();
        this.root.add(this.fallback.root);
        this.muzzle = this.fallback.muzzle;
        this.flasher = this.fallback.flasher;
      });
  }

  private build(hero: GLTF, rifleGltf: GLTF) {
    const obj = cloneSkinned(hero.scene);
    this.model.add(obj);
    // normalise height to the game's scale (skinned bounds are unreliable, measure the bones)
    obj.updateWorldMatrix(true, true);
    let minY = Infinity;
    let maxY = -Infinity;
    const bp = new THREE.Vector3();
    obj.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      o.getWorldPosition(bp);
      minY = Math.min(minY, bp.y);
      maxY = Math.max(maxY, bp.y);
    });
    const s = HERO_HEIGHT / ((maxY - minY) * 1.06 || 1);
    obj.scale.multiplyScalar(s);
    obj.position.y -= minY * s;

    const mats: THREE.MeshStandardMaterial[] = [];
    obj.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      const n = mat.name;
      if (n === "SciFi_Light_Accent") {
        mat.emissive = new THREE.Color(0x22d3ee);
        mat.emissiveIntensity = 0.7;
      } else if (n === "SciFi_Light") {
        mat.emissive = new THREE.Color(0x0b2a33);
        mat.emissiveIntensity = 0.3;
      }
      mat.metalness = Math.max(mat.metalness, n.includes("Main") ? 0.55 : 0.2);
      mat.roughness = Math.min(mat.roughness, 0.62);
      mat.envMapIntensity = 0.9;
      if (n !== "SciFi_Light_Accent") mat.color.multiplyScalar(0.42);
      m.material = mat;
      mats.push(mat);
    });
    this.flasher = new Flasher(mats);

    // animations
    this.mixer = new THREE.AnimationMixer(obj);
    for (const clip of hero.animations) this.actions.set(clip.name.replace("CharacterArmature|", ""), this.mixer.clipAction(clip));
    this.actions.get("Death")!.setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
    this.actions.get("Roll")!.setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
    this.play("Idle_Gun_Pointing", 0);

    // rifle on the right-hand bone
    const rifle = cloneSkinned(rifleGltf.scene);
    rifle.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.metalness = 0.7;
      mat.roughness = 0.35;
      mat.envMapIntensity = 1.4;
      if (m.name === "Magazine") {
        mat.emissive = new THREE.Color(0x22d3ee);
        mat.emissiveIntensity = 2.2;
        this.cell = mat;
      }
      m.material = mat;
    });
    // size the rifle in game units, then hang it on the wrist bone (compensating the rig's scale)
    const rb = new THREE.Box3().setFromObject(rifle);
    const size = rb.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const k = RIFLE_LENGTH / longest;
    rifle.scale.multiplyScalar(k);
    const c = rb.getCenter(new THREE.Vector3()).multiplyScalar(k);
    rifle.position.sub(c);
    this.rifle.add(rifle);
    const wrist = obj.getObjectByName("WristR") ?? obj;
    obj.updateWorldMatrix(true, true);
    const ws = new THREE.Vector3();
    wrist.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
    const socket = this.socket;
    this.wrist = wrist;
    socket.scale.setScalar(1 / (ws.x * 1 || 1));
    socket.add(this.rifle);
    wrist.add(socket);
    this.rifle.add(this.muzzle);
    this.muzzle.position.set(RIFLE_LENGTH / 2, 0.02, 0);
    this.foregrip.position.set(RIFLE_LENGTH * 0.2, -0.05, 0);
    this.rifle.add(this.foregrip);
    const U = obj.getObjectByName("UpperArmL"), L = obj.getObjectByName("LowerArmL"), H = obj.getObjectByName("WristL");
    if (U && L && H) {
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      U.getWorldPosition(a);
      L.getWorldPosition(b);
      H.getWorldPosition(c);
      this.armL = { u: U, l: L, h: H, l1: a.distanceTo(b), l2: b.distanceTo(c) };
    }
    this.ready = true;
    (window as unknown as { __ntRifle?: unknown }).__ntRifle = { rifle: this.rifle, inner: rifle, obj, size, ws, muzzle: this.muzzle };
  }

  private play(name: string, fade = 0.15, speed = 1) {
    const a = this.actions.get(name);
    if (!a) return;
    if (this.curName === name) {
      a.timeScale = speed;
      return;
    }
    a.reset().setEffectiveWeight(1).play();
    a.timeScale = speed;
    if (this.cur) this.cur.crossFadeTo(a, fade, false);
    this.cur = a;
    this.curName = name;
  }

  kick() {
    this.recoil = 1;
    this.flashT = 1;
    this.shootT = 0.22;
  }
  flinch() {
    this.hitT = 1;
  }

  update(dt: number, s: HeroState) {
    if (this.fallback) {
      this.fallback.update(dt, s);
      this.deadT = this.fallback.deadT;
      return;
    }
    if (!this.ready || !this.mixer) return;
    this.t += dt;
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.flashT = Math.max(0, this.flashT - dt * 14);
    this.hitT = Math.max(0, this.hitT - dt * 5);
    this.shootT = Math.max(0, this.shootT - dt);
    this.flasher.set(this.hitT * 0.8);
    this.muzzleFlash.visible = this.flashT > 0.02;
    if (this.muzzleFlash.visible) {
      this.muzzleFlash.scale.setScalar(0.5 + this.flashT * 0.8);
      this.muzzleFlash.rotation.z = Math.random() * TAU;
    }
    this.flashLight.intensity = this.flashT * 9;
    if (this.cell) this.cell.emissiveIntensity = 1.6 + this.recoil * 1.6 + Math.sin(this.t * 5) * 0.15;

    if (s.dead) {
      if (!this.wasDead) {
        this.wasDead = true;
        this.deadT = 0;
        this.play("Death", 0.12);
      }
      this.deadT += dt;
      this.mixer.update(dt);
      this.root.rotation.y = s.aimYaw;
      this.rifle.visible = this.deadT < 0.55;
      if (this.rifle.visible) this.holdRifle();
      return;
    }
    if (this.wasDead) {
      this.wasDead = false;
      this.actions.get("Death")!.stop();
      this.actions.get("Roll")!.stop();
      this.curName = "";
    }
    this.deadT = 0;
    this.rifle.visible = true;

    // whole body faces the cursor; legs are picked by movement direction relative to the aim
    this.root.rotation.y = s.aimYaw;
    const moving = s.speed01 > 0.08;
    const shooting = this.shootT > 0;
    let anim = "Idle_Gun_Pointing";
    let speed = 1;
    if (s.dashing) {
      anim = "Roll";
      speed = 1.9;
    } else if (moving) {
      const rel = angleDiff(s.aimYaw, Math.atan2(s.vx, s.vz));
      const a = Math.abs(rel);
      anim = a < Math.PI * 0.3 ? (shooting ? "Run_Shoot" : "Run") : a > Math.PI * 0.7 ? "Run_Back" : rel > 0 ? "Run_Left" : "Run_Right";
      speed = clamp(0.7 + s.speed01 * 0.55, 0.7, 1.35);
    } else if (shooting) anim = "Idle_Gun_Shoot";
    this.play(anim, s.dashing ? 0.08 : 0.16, speed);
    this.mixer.update(dt);
    this.holdRifle();
  }

  private holdRifle() {
    if (!this.wrist) return;
    this.root.updateWorldMatrix(true, true);
    // rifle orientation is driven by the aim (world space); position stays glued to the wrist bone
    _qRoot.setFromEuler(_e.set(0, this.root.rotation.y, 0));
    _qDes.copy(_qRoot).multiply(RIFLE_ALIGN);
    this.socket.updateWorldMatrix(true, false);
    this.socket.getWorldQuaternion(_qPar);
    this.rifle.quaternion.copy(_qPar.invert().multiply(_qDes));
    _p.copy(RIFLE_HOLD).applyQuaternion(_qRoot).multiplyScalar(1 - this.recoil * 0.12);
    this.wrist.getWorldPosition(_w);
    _w.add(_p);
    this.rifle.position.copy(this.socket.worldToLocal(_w));
    this.rifle.updateWorldMatrix(true, true);
    this.solveLeftArm();
  }

  private solveLeftArm() {
    const A = this.armL;
    if (!A) return;
    this.foregrip.getWorldPosition(_t);
    A.u.getWorldPosition(_s);
    const l1 = A.l1, l2 = A.l2;
    _d.copy(_t).sub(_s);
    let dist = _d.length();
    dist = clamp(dist, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.005);
    _d.normalize();
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    _pole.set(0, -1, 0).addScaledVector(_d, _d.y); // pole = down, made perpendicular to the reach direction
    _pole.normalize();
    _el.copy(_s).addScaledVector(_d, a).addScaledVector(_pole, h);
    aimBone(A.u, A.l, _el.clone().sub(_s));
    aimBone(A.l, A.h, _t.clone().sub(_el));
  }
}

const _qRoot = new THREE.Quaternion();
const _qDes = new THREE.Quaternion();
const _qPar = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _el = new THREE.Vector3();
const _pole = new THREE.Vector3();
/** Rifle barrel is its local +X; rotate so the barrel points along the character's +Z. */
const RIFLE_ALIGN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
/** Where the wrist sits relative to the rifle centre (character space: x right-hand side, z forward). */
const RIFLE_HOLD = new THREE.Vector3(0, 0, 0.22);

const _c0 = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
/** Rotate `bone` (in world space) so that the segment bone->child points along `dir`. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_c0);
  child.getWorldPosition(_c1);
  _c1.sub(_c0).normalize();
  _dq.setFromUnitVectors(_c1, dir.clone().normalize());
  bone.getWorldQuaternion(_bq);
  bone.parent!.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_dq.multiply(_bq)));
  bone.updateWorldMatrix(false, true);
}
