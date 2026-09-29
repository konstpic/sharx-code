import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Flasher, glow } from "./models";
import { angleDiff, clamp, damp, TAU } from "./util";

/* ------------------------------ helpers ------------------------------ */

const rbox = (w: number, h: number, d: number, r = 0.03, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));

function armorTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#c9ccd6";
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 150 + Math.random() * 90;
    c.fillStyle = `rgba(${v},${v},${v + 6},${Math.random() * 0.16})`;
    c.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  c.strokeStyle = "rgba(20,24,34,0.55)";
  c.lineWidth = 2;
  c.strokeRect(6, 6, 244, 244);
  c.beginPath();
  c.moveTo(128, 6);
  c.lineTo(128, 60);
  c.moveTo(6, 128);
  c.lineTo(52, 128);
  c.moveTo(250, 170);
  c.lineTo(200, 170);
  c.stroke();
  c.strokeStyle = "rgba(255,255,255,0.10)";
  for (let i = 0; i < 26; i++) {
    c.beginPath();
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    c.moveTo(x, y);
    c.lineTo(x + (Math.random() - 0.5) * 34, y + (Math.random() - 0.5) * 34);
    c.stroke();
  }
  // hazard-stripe wear patches
  c.fillStyle = "rgba(0,0,0,0.16)";
  for (let i = 0; i < 6; i++) c.fillRect(Math.random() * 230, Math.random() * 230, 14 + Math.random() * 24, 5 + Math.random() * 10);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
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

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _dn = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pole = new THREE.Vector3();

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
  origin: THREE.Vector3;
  l1: number;
  l2: number;
}

/** Analytic two-bone IK in the parent's local frame. Bones point along -Y at rest. */
function solveArm(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3) {
  const d = _a.copy(target).sub(arm.origin);
  let dist = d.length();
  const max = arm.l1 + arm.l2 - 0.001;
  const min = Math.abs(arm.l1 - arm.l2) + 0.02;
  dist = clamp(dist, min, max);
  d.normalize();
  const a = (arm.l1 * arm.l1 - arm.l2 * arm.l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, arm.l1 * arm.l1 - a * a));
  _pole.copy(pole).addScaledVector(d, -pole.dot(d));
  if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0);
  _pole.normalize();
  const elbow = _b.copy(arm.origin).addScaledVector(d, a).addScaledVector(_pole, h);
  const upperDir = _c.copy(elbow).sub(arm.origin).normalize();
  arm.shoulder.quaternion.copy(_q1.setFromUnitVectors(_dn, upperDir));
  const handPos = _a.copy(arm.origin).addScaledVector(d, dist);
  const foreDir = _b.copy(handPos).sub(elbow).normalize();
  const wq = _q2.setFromUnitVectors(_dn, foreDir);
  arm.elbow.quaternion.copy(arm.shoulder.quaternion).invert().multiply(wq);
}

export interface HeroState {
  aimYaw: number;
  vx: number;
  vz: number;
  speed01: number;
  dashing: boolean;
  dead: boolean;
}

/**
 * Armoured space-marine style trooper. Skeleton-style procedural rig:
 *   root -> body(bob) -> lower (legs, faces travel direction)
 *                     -> upper (torso, faces the cursor) -> head / arms / pack / rifle
 * Arms are solved with two-bone IK onto the rifle's grips, so the weapon is always held with both hands.
 */
export class ProceduralHeroModel {
  root = new THREE.Group();
  muzzle = new THREE.Object3D();
  flasher: Flasher;
  deadT = 0;

  private body = new THREE.Group();
  private lower = new THREE.Group();
  private upper = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private gun = new THREE.Group();
  private bolt = new THREE.Group();
  private armR!: Arm;
  private armL!: Arm;
  private gripR = new THREE.Object3D();
  private gripL = new THREE.Object3D();
  private jets: THREE.Mesh[] = [];
  private cellMat: THREE.MeshBasicMaterial;
  private coilMats: THREE.MeshBasicMaterial[] = [];
  private muzzleFlash: THREE.Group;
  private flashMats: THREE.MeshBasicMaterial[] = [];
  private flashLight: THREE.PointLight;
  private visorMat: THREE.MeshBasicMaterial;
  private lampMat: THREE.MeshBasicMaterial;

  private legYaw = 0;
  private phase = 0;
  private t = 0;
  private recoil = 0;
  private flashT = 0;
  private hitT = 0;
  private breath = 0;
  private lean = 0;
  private prevAim = 0;
  private aimVel = 0;

  constructor() {
    const tex = armorTexture();
    const armor = new THREE.MeshStandardMaterial({ color: 0x2a3146, map: tex, metalness: 0.55, roughness: 0.55 });
    const armor2 = new THREE.MeshStandardMaterial({ color: 0x3f4966, map: tex, metalness: 0.5, roughness: 0.5 });
    const plate = new THREE.MeshStandardMaterial({ color: 0x566082, map: tex, metalness: 0.5, roughness: 0.45 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x0f121b, metalness: 0.15, roughness: 0.92 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x171b28, metalness: 0.85, roughness: 0.5 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x232a40, map: tex, metalness: 0.6, roughness: 0.4 });
    const gunMat2 = new THREE.MeshStandardMaterial({ color: 0x4a5473, map: tex, metalness: 0.55, roughness: 0.38 });
    const visorGlass = new THREE.MeshStandardMaterial({ color: 0x03050a, metalness: 1, roughness: 0.04, envMapIntensity: 2.2 });
    const cyan = glow(0x22d3ee, 1.7);
    const cyanHi = glow(0x8be9ff, 2.0);
    const amber = glow(0xffb020, 2);
    this.visorMat = glow(0x38d4ff, 1.6);
    this.lampMat = glow(0xfff2c9, 1.8);
    this.cellMat = glow(0x38e8ff, 3);
    this.flasher = new Flasher([armor, armor2, plate, suit, dark, gunMat, gunMat2]);

    const part = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    this.root.add(this.body);
    this.root.scale.setScalar(1.0);
    this.body.position.y = 0.98;
    this.body.add(this.lower, this.upper);

    /* ---------------- legs ---------------- */
    part(rbox(0.46, 0.2, 0.32, 0.07), dark, this.lower, 0, 0.01, 0);
    part(rbox(0.2, 0.16, 0.06, 0.03), armor2, this.lower, 0, -0.02, 0.17);
    for (const [hip, knee, s] of [[this.hipL, this.kneeL, -1], [this.hipR, this.kneeR, 1]] as const) {
      hip.position.set(s * 0.15, -0.06, 0);
      this.lower.add(hip);
      part(new THREE.CapsuleGeometry(0.085, 0.32, 4, 10), suit, hip, 0, -0.22, 0);
      part(rbox(0.21, 0.36, 0.25, 0.07), armor, hip, s * 0.01, -0.2, 0.01); // thigh guard
      part(rbox(0.05, 0.28, 0.02, 0.01), cyan, hip, s * 0.108, -0.22, 0.05, false);
      part(rbox(0.16, 0.08, 0.12, 0.03), dark, hip, s * 0.05, -0.02, -0.01);
      knee.position.set(0, -0.44, 0);
      hip.add(knee);
      part(new THREE.SphereGeometry(0.095, 12, 10), dark, knee);
      part(rbox(0.2, 0.15, 0.13, 0.06), armor2, knee, 0, 0.0, 0.1); // kneepad
      part(rbox(0.09, 0.04, 0.02, 0.01), amber, knee, 0, 0.0, 0.17, false);
      part(new THREE.CapsuleGeometry(0.075, 0.28, 4, 10), suit, knee, 0, -0.24, -0.01);
      part(rbox(0.19, 0.4, 0.2, 0.06), armor, knee, 0, -0.26, 0.03); // shin greave
      part(rbox(0.05, 0.3, 0.02, 0.01), cyan, knee, s * 0.098, -0.26, 0.08, false);
      part(rbox(0.22, 0.13, 0.34, 0.06), armor2, knee, 0, -0.5, 0.06); // boot
      part(rbox(0.235, 0.05, 0.37, 0.02), dark, knee, 0, -0.565, 0.06); // sole
      part(rbox(0.16, 0.07, 0.1, 0.03), plate, knee, 0, -0.48, 0.2); // toe cap
      part(rbox(0.12, 0.09, 0.09, 0.03), dark, knee, 0, -0.46, -0.1); // heel
    }

    /* ---------------- torso ---------------- */
    part(rbox(0.5, 0.1, 0.34, 0.04), armor, this.upper, 0, 0.06, 0); // belt
    part(rbox(0.12, 0.08, 0.04, 0.02), amber, this.upper, 0, 0.06, 0.18, false);
    for (const s of [-1, 1]) {
      part(rbox(0.11, 0.13, 0.1, 0.03), dark, this.upper, s * 0.27, 0.04, 0.05); // pouches
      part(rbox(0.1, 0.16, 0.1, 0.03), dark, this.upper, s * 0.25, 0.0, -0.08);
    }
    for (let i = 0; i < 3; i++) part(rbox(0.36 - i * 0.02, 0.085, 0.26, 0.03), i % 2 ? dark : armor2, this.upper, 0, 0.16 + i * 0.09, 0); // abdomen segments
    this.upper.add(this.chest);
    this.chest.position.set(0, 0.5, 0);
    part(rbox(0.6, 0.44, 0.38, 0.11, 3), armor2, this.chest, 0, 0.03, 0); // breastplate
    part(rbox(0.5, 0.06, 0.05, 0.02), plate, this.chest, 0, 0.2, 0.19); // collar plate
    part(rbox(0.42, 0.04, 0.02, 0.01), cyan, this.chest, 0, 0.12, 0.2, false);
    part(new THREE.CircleGeometry(0.06, 16), cyanHi, this.chest, 0, -0.02, 0.196, false);
    for (const s of [-1, 1]) {
      part(rbox(0.16, 0.34, 0.06, 0.03), armor, this.chest, s * 0.2, -0.02, 0.2); // chest side plates
      part(rbox(0.04, 0.24, 0.02, 0.01), amber, this.chest, s * 0.2, -0.02, 0.235, false);
    }
    part(rbox(0.52, 0.4, 0.16, 0.06), armor, this.chest, 0, 0.03, -0.24); // back plate
    part(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 12), suit, this.chest, 0, 0.3, 0); // neck
    part(new THREE.TorusGeometry(0.13, 0.04, 8, 20), armor, this.chest, 0, 0.27, 0).rotation.x = Math.PI / 2; // gorget

    // pauldrons
    for (const s of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(s * 0.4, 0.2, 0);
      this.chest.add(p);
      const dome = part(new THREE.SphereGeometry(0.15, 16, 10, 0, TAU, 0, Math.PI * 0.62), plate, p, s * 0.01, -0.03, 0);
      dome.scale.set(0.9, 1.0, 1.2);
      dome.rotation.z = -s * 0.5;
      part(rbox(0.16, 0.1, 0.26, 0.04), armor, p, s * 0.05, -0.1, 0).rotation.z = -s * 0.25;
      const stripe = part(new THREE.TorusGeometry(0.17, 0.014, 6, 24, Math.PI * 0.7), amber, p, s * 0.005, 0.02, 0, false);
      stripe.rotation.set(Math.PI / 2 - 0.3, 0, s * 0.3 + (s < 0 ? Math.PI * 0.15 : Math.PI * 0.15));
    }

    /* ---------------- head / helmet ---------------- */
    this.chest.add(this.head);
    this.head.position.set(0, 0.5, 0.02);
    const shell = part(new THREE.SphereGeometry(0.19, 22, 16), armor2, this.head);
    shell.scale.set(1.0, 1.0, 1.1);
    const visor = part(new THREE.SphereGeometry(0.196, 22, 14, Math.PI / 2 - 0.85, 1.7, 1.08, 0.78), visorGlass, this.head);
    visor.scale.set(1.0, 1.0, 1.1);
    visor.castShadow = false;
    const hud = part(new THREE.PlaneGeometry(0.15, 0.05), this.visorMat, this.head, 0, 0.0, 0.208, false);
    hud.material = this.visorMat;
    // contour lights around the visor
    part(rbox(0.29, 0.012, 0.02, 0.005), cyan, this.head, 0, -0.065, 0.205, false);
    for (const s of [-1, 1]) {
      const side = part(rbox(0.012, 0.09, 0.02, 0.005), cyan, this.head, s * 0.15, 0.0, 0.16, false);
      side.rotation.y = -s * 0.7;
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), dark, this.head, s * 0.19, -0.01, 0).rotation.z = Math.PI / 2; // comms pods
      part(new THREE.TorusGeometry(0.048, 0.008, 6, 14), cyanHi, this.head, s * 0.218, -0.01, 0, false).rotation.y = Math.PI / 2;
    }
    part(rbox(0.09, 0.06, 0.26, 0.025), plate, this.head, 0, 0.19, -0.01); // crest
    part(rbox(0.05, 0.025, 0.05, 0.01), this.lampMat, this.head, 0, 0.225, 0.07, false).name = "lamp"; // top lamp (top-down readability)
    part(rbox(0.17, 0.07, 0.1, 0.03), armor, this.head, 0, -0.14, 0.11); // jaw guard
    part(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), dark, this.head, -0.13, 0.28, -0.1); // antenna
    part(rbox(0.14, 0.09, 0.05, 0.02), dark, this.head, 0, -0.02, -0.19); // rear vents

    /* ---------------- life-support pack ---------------- */
    const pack = new THREE.Group();
    pack.position.set(0, 0.02, -0.36);
    this.chest.add(pack);
    part(rbox(0.42, 0.52, 0.2, 0.06), armor, pack);
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 12), glow(0x2fe0ff, 1.6), pack, 0, 0.02, -0.11, false); // reactor core
    for (const s of [-1, 1]) {
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.38, 10), dark, pack, s * 0.19, 0.0, -0.06);
      part(new THREE.TorusGeometry(0.052, 0.01, 6, 14), cyan, pack, s * 0.19, 0.12, -0.06, false).rotation.x = Math.PI / 2;
      part(new THREE.TorusGeometry(0.052, 0.01, 6, 14), cyan, pack, s * 0.19, -0.12, -0.06, false).rotation.x = Math.PI / 2;
      const nozzle = part(new THREE.CylinderGeometry(0.04, 0.06, 0.12, 10), dark, pack, s * 0.12, -0.32, -0.02);
      nozzle.rotation.x = 0.15;
      const jet = part(new THREE.ConeGeometry(0.06, 0.55, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.1, 2), transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), pack, s * 0.12, -0.6, -0.08, false);
      jet.rotation.x = Math.PI - 0.3;
      this.jets.push(jet);
    }
    part(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 5), dark, pack, 0.16, 0.42, -0.08);

    /* ---------------- rifle ---------------- */
    this.upper.add(this.gun);
    this.gun.position.set(0.02, 0.54, 0.16);
    this.gun.rotation.y = 0;
    // receiver
    part(rbox(0.17, 0.2, 0.6, 0.05), gunMat, this.gun, 0, 0, 0.16);
    part(rbox(0.19, 0.06, 0.36, 0.02), gunMat2, this.gun, 0, 0.11, 0.2); // top rail cover
    part(rbox(0.05, 0.03, 0.34, 0.01), cyan, this.gun, 0, 0.145, 0.2, false);
    // stock into the shoulder
    part(rbox(0.13, 0.19, 0.3, 0.04), gunMat, this.gun, 0, -0.01, -0.25);
    part(rbox(0.15, 0.24, 0.05, 0.02), dark, this.gun, 0, -0.01, -0.42); // butt pad
    part(rbox(0.05, 0.04, 0.2, 0.015), amber, this.gun, 0, 0.09, -0.26, false);
    // barrel & coils
    const barrel = part(new THREE.CylinderGeometry(0.038, 0.045, 0.62, 12), dark, this.gun, 0, 0.02, 0.78);
    barrel.rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const coilMat = glow(0x36e3ff, 1.6);
      this.coilMats.push(coilMat);
      const coil = part(new THREE.TorusGeometry(0.06, 0.014, 6, 16), coilMat, this.gun, 0, 0.02, 0.56 + i * 0.16, false);
      coil.rotation.x = 0;
    }
    const shroud = part(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 12), gunMat2, this.gun, 0, 0.02, 0.5);
    shroud.rotation.x = Math.PI / 2;
    const muzzleBrake = part(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 10), gunMat2, this.gun, 0, 0.02, 1.1);
    muzzleBrake.rotation.x = Math.PI / 2;
    // energy cell magazine (glowing)
    part(rbox(0.14, 0.3, 0.2, 0.04), gunMat, this.gun, 0, -0.24, 0.24);
    part(rbox(0.05, 0.22, 0.24, 0.02), this.cellMat, this.gun, 0, -0.24, 0.24, false);
    part(rbox(0.16, 0.05, 0.22, 0.02), gunMat2, this.gun, 0, -0.1, 0.24);
    // grip + foregrip
    const grip = part(rbox(0.09, 0.22, 0.11, 0.035), dark, this.gun, 0, -0.18, -0.06);
    grip.rotation.x = 0.28;
    part(rbox(0.13, 0.1, 0.24, 0.035), gunMat2, this.gun, 0, -0.14, 0.52); // handguard
    // scope + light module
    const scope = part(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 12), gunMat2, this.gun, 0, 0.2, 0.22);
    scope.rotation.x = Math.PI / 2;
    part(new THREE.CircleGeometry(0.036, 14), glow(0xff5a5a, 2.6), this.gun, 0, 0.2, 0.395, false);
    part(rbox(0.05, 0.07, 0.05, 0.015), dark, this.gun, 0, 0.16, 0.08);
    part(rbox(0.06, 0.06, 0.1, 0.02), gunMat, this.gun, 0.11, 0.0, 0.62);
    part(new THREE.CircleGeometry(0.022, 10), glow(0xe8f8ff, 3.4), this.gun, 0.11, 0.0, 0.672, false);
    // charging bolt
    this.gun.add(this.bolt);
    this.bolt.position.set(0.1, 0.06, 0.05);
    part(rbox(0.05, 0.05, 0.14, 0.015), plate, this.bolt);
    part(rbox(0.04, 0.03, 0.03, 0.01), cyan, this.bolt, 0, 0.03, -0.06, false);
    // muzzle + flash
    this.gun.add(this.muzzle);
    this.muzzle.position.set(0, 0.02, 1.18);
    this.muzzleFlash = new THREE.Group();
    this.muzzle.add(this.muzzleFlash);
    const ft = flashTexture();
    for (const rot of [0, Math.PI / 2]) {
      const m = new THREE.MeshBasicMaterial({ map: ft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(2.4, 2.6, 3) });
      this.flashMats.push(m);
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), m);
      q.rotation.z = rot;
      this.muzzleFlash.add(q);
      const q2 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), m);
      q2.rotation.y = Math.PI / 2;
      q2.rotation.z = rot;
      this.muzzleFlash.add(q2);
    }
    this.muzzleFlash.visible = false;
    this.flashLight = new THREE.PointLight(0x7fe9ff, 0, 5, 2);
    this.muzzle.add(this.flashLight);
    this.flashLight.position.set(0, 0.1, -0.35);

    // grip targets (hand IK goals) live on the gun
    this.gun.add(this.gripR, this.gripL);
    this.gripR.position.set(0, -0.2, -0.05);
    this.gripL.position.set(0, -0.14, 0.52);

    /* ---------------- arms (IK) ---------------- */
    const makeArm = (side: number): Arm => {
      const shoulder = new THREE.Group();
      const origin = new THREE.Vector3(side * 0.37, 0.7, 0);
      this.upper.add(shoulder);
      shoulder.position.copy(origin);
      part(new THREE.CapsuleGeometry(0.075, 0.2, 4, 10), suit, shoulder, 0, -0.16, 0);
      part(rbox(0.14, 0.24, 0.15, 0.05), armor, shoulder, 0, -0.14, 0); // upper-arm sleeve
      part(rbox(0.04, 0.16, 0.02, 0.01), cyan, shoulder, side * 0.075, -0.14, 0.05, false);
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.33, 0);
      shoulder.add(elbow);
      part(new THREE.SphereGeometry(0.085, 12, 10), dark, elbow);
      part(rbox(0.13, 0.1, 0.16, 0.05), armor2, elbow, 0, 0.01, -0.06); // elbow guard
      part(new THREE.CapsuleGeometry(0.065, 0.16, 4, 10), suit, elbow, 0, -0.15, 0);
      part(rbox(0.14, 0.22, 0.14, 0.05), armor, elbow, 0, -0.16, 0); // bracer
      part(rbox(0.05, 0.14, 0.02, 0.01), amber, elbow, side * 0.07, -0.16, 0.04, false);
      const hand = new THREE.Group();
      hand.position.set(0, -0.31, 0);
      elbow.add(hand);
      part(rbox(0.1, 0.1, 0.13, 0.04), dark, hand, 0, -0.02, 0.0); // glove
      for (let i = 0; i < 3; i++) part(rbox(0.1, 0.022, 0.03, 0.01), suit, hand, 0, -0.06 + i * 0.001, -0.05 + i * 0.035);
      part(rbox(0.03, 0.03, 0.08, 0.01), dark, hand, side * -0.06, -0.01, 0.02);
      return { shoulder, elbow, hand, origin, l1: 0.33, l2: 0.31 };
    };
    this.armR = makeArm(1);
    this.armL = makeArm(-1);
  }

  kick() {
    this.recoil = 1;
    this.flashT = 1;
  }
  flinch() {
    this.hitT = 1;
  }

  update(dt: number, s: HeroState) {
    this.t += dt;
    const speed = clamp(s.speed01, 0, 1.2);
    const moving = speed > 0.06;
    this.recoil = Math.max(0, this.recoil - dt * 10);
    this.flashT = Math.max(0, this.flashT - dt * 14);
    this.hitT = Math.max(0, this.hitT - dt * 5);
    this.flasher.set(this.hitT * 0.85);
    this.breath += dt * 1.9;

    // muzzle flash + face/hand light
    this.muzzleFlash.visible = this.flashT > 0.02;
    if (this.muzzleFlash.visible) {
      const k = 0.5 + this.flashT * 0.8;
      this.muzzleFlash.scale.setScalar(k);
      this.muzzleFlash.rotation.z = Math.random() * TAU;
    }
    this.flashLight.intensity = this.flashT * 9;
    this.cellMat.color.setRGB(0.2, 0.9, 1.2).multiplyScalar(1.3 + this.recoil * 1.8 + Math.sin(this.t * 5) * 0.2);
    this.coilMats.forEach((m, i) => m.color.setRGB(0.2, 0.85, 1).multiplyScalar(1.0 + this.recoil * (2.2 - i * 0.6)));
    this.lampMat.color.setRGB(1, 0.95, 0.8).multiplyScalar(1.5 + Math.sin(this.t * 6) * 0.3);

    if (s.dead) {
      this.deadT += dt;
      const f = Math.min(1, this.deadT / 0.7);
      const e = 1 - Math.pow(1 - f, 3);
      this.root.rotation.x = -e * 1.45;
      this.body.position.y = 0.98 - e * 0.5;
      this.hipL.rotation.x = 0.5 * e;
      this.hipR.rotation.x = 0.1 * e;
      this.kneeL.rotation.x = 1.0 * e;
      this.kneeR.rotation.x = 0.4 * e;
      this.upper.rotation.set(0.3 * e, s.aimYaw, 0.2 * e);
      this.gun.rotation.x = 0.5 * e;
      this.jets.forEach((j) => ((j.material as THREE.MeshBasicMaterial).opacity = 0));
      this.solveArms(0.3);
      return;
    }
    this.deadT = 0;
    this.root.rotation.x = 0;

    /* ---- leg facing: legs follow travel direction, torso follows the cursor ---- */
    const moveYaw = Math.atan2(s.vx, s.vz);
    let target = s.aimYaw;
    let dir = 1;
    if (moving) {
      const rel = angleDiff(s.aimYaw, moveYaw);
      if (Math.abs(rel) > 1.9) {
        target = moveYaw + Math.PI;
        dir = -1;
      } else target = moveYaw;
    } else {
      const twist = angleDiff(this.legYaw, s.aimYaw);
      target = Math.abs(twist) > 0.9 ? s.aimYaw : this.legYaw;
    }
    this.legYaw += angleDiff(this.legYaw, target) * Math.min(1, dt * (moving ? 14 : 6));
    this.lower.rotation.y = this.legYaw;
    this.upper.rotation.y = s.aimYaw;

    this.aimVel = damp(this.aimVel, angleDiff(this.prevAim, s.aimYaw) / Math.max(dt, 1e-3), 10, dt);
    this.prevAim = s.aimYaw;

    /* ---- gait ---- */
    this.phase += dt * (5 + 8.5 * speed) * (moving ? 1 : 0) * dir;
    const sw = Math.sin(this.phase);
    const cs = Math.cos(this.phase);
    const stride = 0.95 * Math.min(1, speed);
    let hipL = sw * stride;
    let hipR = -sw * stride;
    let kL = Math.max(0, -cs) * 1.15 * Math.min(1, speed) + 0.06;
    let kR = Math.max(0, cs) * 1.15 * Math.min(1, speed) + 0.06;
    if (s.dashing) {
      hipL = 0.95;
      hipR = -0.85;
      kL = 0.1;
      kR = 0.55;
    }
    this.hipL.rotation.x = damp(this.hipL.rotation.x, hipL, 30, dt);
    this.hipR.rotation.x = damp(this.hipR.rotation.x, hipR, 30, dt);
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, kL, 30, dt);
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, kR, 30, dt);

    const bob = Math.abs(sw) * 0.055 * Math.min(1, speed);
    this.body.position.y = 0.98 - 0.02 * Math.min(1, speed) + bob + Math.sin(this.breath) * 0.006 - (s.dashing ? 0.05 : 0);

    /* ---- torso ---- */
    const leanTarget = (s.dashing ? 0.6 : 0.14 * Math.min(1, speed)) + this.hitT * -0.32 - this.recoil * 0.05;
    this.lean = damp(this.lean, leanTarget, 16, dt);
    this.upper.rotation.x = this.lean + Math.sin(this.breath) * 0.006;
    this.upper.rotation.z = clamp(-this.aimVel * 0.012, -0.12, 0.12) + sw * 0.03 * Math.min(1, speed);
    this.chest.scale.set(1 + Math.sin(this.breath) * 0.012, 1 + Math.sin(this.breath) * 0.016, 1);
    this.chest.rotation.y = sw * 0.07 * Math.min(1, speed) * dir;
    this.head.rotation.x = -this.lean * 0.6 + Math.sin(this.breath * 0.5) * 0.01;
    this.head.rotation.y = -this.chest.rotation.y * 0.8;

    /* ---- rifle: idle sway, run bob, recoil, bolt slide ---- */
    const idleSway = Math.sin(this.breath * 0.9) * 0.012;
    this.gun.position.set(0.02 + idleSway * 0.5, 0.54 + Math.sin(this.breath) * 0.006 + bob * 0.5, 0.16 - this.recoil * 0.13);
    this.gun.rotation.set(-this.recoil * 0.1 + idleSway, sw * 0.02 * Math.min(1, speed), 0);
    this.bolt.position.z = 0.05 - Math.sin(Math.min(1, this.recoil * 1.4) * Math.PI) * 0.13;

    // dash thrusters
    const jet = s.dashing ? 1 : 0;
    this.jets.forEach((j, i) => {
      const m = j.material as THREE.MeshBasicMaterial;
      m.opacity = damp(m.opacity, jet * (0.55 + 0.25 * Math.sin(this.t * 60 + i)), 30, dt);
      j.scale.y = 0.6 + jet * (0.6 + 0.3 * Math.sin(this.t * 50 + i));
    });

    this.solveArms(this.recoil);
  }

  private solveArms(recoil: number) {
    this.gun.updateMatrix();
    this.gripR.updateMatrix();
    this.gripL.updateMatrix();
    const gm = this.gun.matrix;
    const tR = _a.copy(this.gripR.position).applyMatrix4(gm).clone();
    const tL = _b.copy(this.gripL.position).applyMatrix4(gm).clone();
    // slight hand shake with recoil
    tR.z += recoil * 0.01;
    solveArm(this.armR, tR, new THREE.Vector3(0.5, -1, -0.2));
    solveArm(this.armL, tL, new THREE.Vector3(-0.6, -1, -0.2));
    // hands wrap the grips
    this.armR.hand.rotation.set(-0.35, 0, 0);
    this.armL.hand.rotation.set(-0.15, 0, 0.25);
  }
}
