import * as THREE from "three";
import { ROOMS, RoomDef, CORRIDOR_HALF, WALL_H, COVER } from "./config";
import { Box, makeBox } from "./collision";
import { std, glow, holo } from "./models";
import { rand } from "./util";

/* ------------------------------ canvas textures ------------------------------ */

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d")!;
  draw(c, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function floorTextures() {
  const map = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = "#0a0c17";
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      c.fillStyle = `rgba(${40 + Math.random() * 30},${44 + Math.random() * 30},${70 + Math.random() * 40},0.10)`;
      c.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 10 + Math.random() * 40);
    }
    c.strokeStyle = "#171b30";
    c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, w - 3, h - 3);
    c.strokeStyle = "#11142a";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(w / 2, 0);
    c.lineTo(w / 2, h);
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();
    c.fillStyle = "#1c2140";
    for (const [x, y] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) {
      c.beginPath();
      c.arc(x, y, 3, 0, Math.PI * 2);
      c.fill();
    }
  });
  const emissive = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#ffffff";
    c.lineWidth = 3;
    c.setLineDash([26, 16]);
    c.strokeRect(6, 6, w - 12, h - 12);
    c.setLineDash([]);
    c.lineWidth = 2;
    c.globalAlpha = 0.5;
    c.beginPath();
    c.moveTo(w / 2 - 14, h / 2 + 8);
    c.lineTo(w / 2, h / 2 - 8);
    c.lineTo(w / 2 + 14, h / 2 + 8);
    c.stroke();
  });
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, emissive };
}

function rackLedTexture() {
  const t = canvasTex(64, 128, (c, w, h) => {
    c.fillStyle = "#04060c";
    c.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) {
      for (let x = 4; x < w; x += 8) {
        if (Math.random() < 0.55) {
          const hue = [190, 280, 140, 30][Math.floor(Math.random() * 4)];
          c.fillStyle = `hsl(${hue} 100% ${50 + Math.random() * 25}%)`;
          c.fillRect(x, y, 4, 3);
        }
      }
    }
  });
  return t;
}

function holoTextTexture(lines: string[], color: string) {
  return canvasTex(512, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = color;
    c.font = "bold 40px ui-monospace, monospace";
    c.fillText(lines[0], 26, 64);
    c.font = "22px ui-monospace, monospace";
    c.globalAlpha = 0.85;
    for (let i = 1; i < lines.length; i++) c.fillText(lines[i], 26, 64 + i * 34);
    c.globalAlpha = 0.5;
    for (let i = 0; i < 18; i++) c.fillRect(26 + i * 26, h - 44, 16, 6 + Math.random() * 22);
  });
}

/* ------------------------------ void shader ------------------------------ */

const VoidMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec3 vW;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vW;
    uniform float time;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 g = vW.xz * 2.2;
      vec2 cell = floor(g);
      float col = h(vec2(cell.x, 7.0));
      float speed = 0.6 + col * 1.8;
      float y = fract(g.y * 0.05 - time * speed * 0.08 + col * 9.0);
      float bright = smoothstep(0.0, 1.0, 1.0 - y);
      vec2 f = fract(g);
      float glyph = step(0.18, f.x) * step(f.x, 0.82) * step(0.15, f.y) * step(f.y, 0.85);
      float flick = step(0.35, h(cell + floor(time * 2.0 * (0.5 + col))));
      float a = glyph * flick * bright * step(0.55, col);
      vec3 c1 = vec3(0.10, 0.75, 1.0);
      vec3 c2 = vec3(0.65, 0.25, 1.0);
      vec3 c = mix(c1, c2, h(cell.yx));
      float dist = length(vW.xz - cameraPosition.xz);
      float fade = smoothstep(90.0, 10.0, dist);
      gl_FragColor = vec4(c * a * 0.7 * fade, a * fade);
    }
  `,
});

/* ------------------------------ door / terminal ------------------------------ */

export class Door {
  group = new THREE.Group();
  box: Box;
  open = false;
  t = 0;
  private shutter: THREE.Mesh;
  private strip: THREE.MeshBasicMaterial;
  private tt = 0;

  constructor(public x: number, public z: number) {
    const metal = std(0x1a1f36, { metal: 0.85, rough: 0.35 });
    this.strip = glow(0xff3355, 2.6);
    this.group.position.set(x, 0, z);
    this.shutter = new THREE.Mesh(new THREE.BoxGeometry(0.7, WALL_H, CORRIDOR_HALF * 2), metal);
    this.shutter.position.y = WALL_H / 2;
    this.shutter.castShadow = true;
    this.group.add(this.shutter);
    for (const s of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, CORRIDOR_HALF * 2 - 0.4), this.strip);
      stripe.position.set(0, WALL_H * 0.5 + s * 0.9, 0);
      this.shutter.add(stripe);
      stripe.position.y = s * 0.9;
    }
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.1, WALL_H + 0.3, 0.5), metal);
      post.position.set(0, (WALL_H + 0.3) / 2, s * (CORRIDOR_HALF + 0.25));
      post.castShadow = true;
      this.group.add(post);
      const led = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.06, 0.54), this.strip);
      led.position.set(0, WALL_H, s * (CORRIDOR_HALF + 0.25));
      this.group.add(led);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, CORRIDOR_HALF * 2 + 1), metal);
    lintel.position.y = WALL_H + 0.35;
    this.group.add(lintel);
    this.box = makeBox(x, z, 1.0, CORRIDOR_HALF * 2 + 0.2);
  }

  setOpen(o: boolean) {
    this.open = o;
  }

  snap(o: boolean) {
    this.open = o;
    this.t = o ? 1 : 0;
    this.apply();
  }

  private apply() {
    this.shutter.position.y = WALL_H / 2 - (WALL_H + 0.15) * this.t;
    this.box.active = this.t < 0.85;
    this.strip.color.set(this.open ? 0x4ade80 : 0xff3355).multiplyScalar(2.4 + Math.sin(this.tt * 6) * 0.3 * (this.open ? 0 : 1));
  }

  update(dt: number) {
    this.tt += dt;
    this.t = Math.max(0, Math.min(1, this.t + (this.open ? 1 : -1) * dt * 1.8));
    this.apply();
  }
}

export class Terminal {
  group = new THREE.Group();
  used = false;
  readonly radius = 3.2;
  private screen: THREE.Mesh;
  private idleTex: THREE.CanvasTexture;
  private usedTex: THREE.CanvasTexture;
  private ring: THREE.Mesh;
  private t = 0;

  constructor(public id: string, public pos: THREE.Vector3, yaw: number, public label: string, color: number) {
    const metal = std(0x1a1f36, { metal: 0.85, rough: 0.3 });
    const cs = "#" + new THREE.Color(color).getHexString();
    this.idleTex = holoTextTexture(["TERMINAL", label, "AUTH REQUIRED", "> _"], cs);
    this.usedTex = holoTextTexture(["TERMINAL", label, "ACCESS GRANTED", "> OK"], "#4ade80");
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.0), metal);
    base.position.y = 0.45;
    base.castShadow = true;
    this.group.add(base);
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.9), metal);
    console_.position.set(0, 0.96, 0.05);
    console_.rotation.x = -0.35;
    this.group.add(console_);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.05), glow(color, 2.6));
    strip.position.set(0, 0.5, 0.52);
    this.group.add(strip);
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), holo(0xffffff, 1.3, 0.95));
    (this.screen.material as THREE.MeshBasicMaterial).map = this.idleTex;
    this.screen.position.set(0, 2.0, -0.1);
    this.screen.rotation.x = -0.15;
    this.group.add(this.screen);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 6, 32), glow(color, 2.4));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.05;
    this.group.add(this.ring);
  }

  activate() {
    this.used = true;
    (this.screen.material as THREE.MeshBasicMaterial).map = this.usedTex;
    (this.screen.material as THREE.MeshBasicMaterial).needsUpdate = true;
    (this.ring.material as THREE.MeshBasicMaterial).color.set(0x4ade80).multiplyScalar(2.4);
  }

  reset() {
    this.used = false;
    (this.screen.material as THREE.MeshBasicMaterial).map = this.idleTex;
    (this.screen.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }

  update(dt: number, near: boolean) {
    this.t += dt;
    this.screen.position.y = 2.0 + Math.sin(this.t * 1.8) * 0.06;
    this.ring.scale.setScalar(near && !this.used ? 1 + Math.sin(this.t * 6) * 0.08 : 1);
  }
}

/* ------------------------------ world ------------------------------ */

export interface RoomRT {
  def: RoomDef;
  inner: { minX: number; maxX: number; minZ: number; maxZ: number };
  center: THREE.Vector3;
  westDoor?: Door;
  eastDoor?: Door;
  cover: Box[];
}

export class World {
  group = new THREE.Group();
  colliders: Box[] = [];
  rooms: RoomRT[] = [];
  doors: Door[] = [];
  terminals: Terminal[] = [];
  roomLights: { light: THREE.PointLight; base: number; room: RoomRT }[] = [];
  private rackMats: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  private floorTex = floorTextures();
  private holos: { mesh: THREE.Object3D; y: number; ph: number }[] = [];
  private spinners: THREE.Object3D[] = [];
  private debris!: THREE.InstancedMesh;
  private debrisData: { p: THREE.Vector3; r: THREE.Vector3; s: number; sp: number }[] = [];
  private dust!: THREE.Points;
  private voidMesh!: THREE.Mesh;
  private time = 0;
  private wallMat = std(0x141830, { metal: 0.85, rough: 0.38 });
  private rackLed = rackLedTexture();

  constructor(scene: THREE.Scene) {
    this.group.name = "world";
    ROOMS.forEach((def) => this.buildRoom(def));
    for (let i = 0; i < ROOMS.length - 1; i++) this.buildCorridor(ROOMS[i], ROOMS[i + 1]);
    this.buildRacks();
    this.buildDoors();
    this.buildTerminals();
    this.buildVoid();
    this.buildHolos();
    scene.add(this.group);
  }

  roomAt(x: number, z: number): RoomRT | null {
    for (const r of this.rooms) {
      if (x >= r.inner.minX && x <= r.inner.maxX && z >= r.inner.minZ && z <= r.inner.maxZ) return r;
    }
    return null;
  }

  room(id: string) {
    return this.rooms.find((r) => r.def.id === id)!;
  }

  /* ---- builders ---- */

  private floor(cx: number, cz: number, w: number, d: number, color: number, y = 0) {
    const map = this.floorTex.map.clone();
    const em = this.floorTex.emissive.clone();
    map.needsUpdate = em.needsUpdate = true;
    map.repeat.set(w / 4, d / 4);
    em.repeat.set(w / 4, d / 4);
    const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: new THREE.Color(color), emissiveIntensity: 0.65, metalness: 0.75, roughness: 0.42 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), mat);
    m.position.set(cx, -0.5 + y, cz);
    m.receiveShadow = true;
    this.group.add(m);
    const under = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), std(0x0a0c18, { metal: 0.9, rough: 0.3 }));
    under.position.set(cx, -1.2 + y, cz);
    this.group.add(under);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.42, 0.06, d + 0.42), glow(color, 2));
    rim.position.set(cx, -0.95 + y, cz);
    this.group.add(rim);
  }

  private wall(minX: number, maxX: number, minZ: number, maxZ: number, color: number, pad: { l?: number; r?: number; t?: number; b?: number } = {}, strip: "z+" | "z-" | "x+" | "x-" | null = null, h = WALL_H) {
    const w = maxX - minX;
    const d = maxZ - minZ;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.wallMat);
    m.position.set((minX + maxX) / 2, h / 2, (minZ + maxZ) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.1, d + 0.04), std(0x232a4a, { metal: 0.9, rough: 0.25 }));
    cap.position.set((minX + maxX) / 2, h + 0.05, (minZ + maxZ) / 2);
    this.group.add(cap);
    if (strip) {
      const g = glow(color, 2.4);
      const s = new THREE.Mesh(new THREE.BoxGeometry(strip[0] === "z" ? w - 0.2 : 0.06, 0.1, strip[0] === "z" ? 0.06 : d - 0.2), g);
      const cx = strip === "x+" ? maxX : strip === "x-" ? minX : (minX + maxX) / 2;
      const cz = strip === "z+" ? maxZ : strip === "z-" ? minZ : (minZ + maxZ) / 2;
      s.position.set(cx, h - Math.min(0.35, h * 0.4), cz);
      this.group.add(s);
    }
    this.colliders.push({ minX: minX - (pad.l ?? 0), maxX: maxX + (pad.r ?? 0), minZ: minZ - (pad.t ?? 0), maxZ: maxZ + (pad.b ?? 0), active: true });
  }

  private buildRoom(def: RoomDef) {
    const { cx, cz, w, d, color } = def;
    const hw = w / 2;
    const hd = d / 2;
    this.floor(cx, cz, w, d, color);
    const P = 0.95;
    // north / south (rack lined)
    this.wall(cx - hw - 1, cx + hw + 1, cz - hd - 1, cz - hd, color, { b: P }, "z+");
    this.wall(cx - hw - 1, cx + hw + 1, cz + hd, cz + hd + 1, color, { t: 0.45 }, "z-", 1.15);
    // west / east with door gaps
    const side = (x0: number, x1: number, door: boolean, s: "x+" | "x-") => {
      if (!door) this.wall(x0, x1, cz - hd - 1, cz + hd + 1, color, { l: s === "x-" ? 0.4 : 0, r: s === "x+" ? 0.4 : 0 }, s);
      else {
        this.wall(x0, x1, cz - hd - 1, cz - CORRIDOR_HALF, color, { l: s === "x-" ? 0.4 : 0, r: s === "x+" ? 0.4 : 0 }, s);
        this.wall(x0, x1, cz + CORRIDOR_HALF, cz + hd + 1, color, { l: s === "x-" ? 0.4 : 0, r: s === "x+" ? 0.4 : 0 }, s);
      }
    };
    side(cx - hw - 1, cx - hw, def.west, "x+");
    side(cx + hw, cx + hw + 1, def.east, "x-");

    const rt: RoomRT = {
      def,
      inner: { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd },
      center: new THREE.Vector3(cx, 0, cz),
      cover: [],
    };
    this.rooms.push(rt);

    // floor floor-edge glow lines
    const edge = glow(color, 2.2);
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(w - 1.9, 0.02, 0.1), edge);
      l.position.set(cx, 0.015, cz + s * (hd - 0.95));
      this.group.add(l);
    }

    // cover blocks
    for (const c of COVER[def.id] ?? []) this.buildCover(rt, cx + c.dx, cz + c.dz, c.w, c.d, color);

    // lights
    const li = def.kind === "boss" ? 2 : 2;
    for (let i = 0; i < li; i++) {
      const L = new THREE.PointLight(color, 0, def.kind === "boss" ? 46 : 30, 1.6);
      L.position.set(cx + (i === 0 ? -1 : 1) * hw * 0.42, 4.2, cz + (i === 0 ? -1 : 1) * hd * 0.3);
      this.group.add(L);
      this.roomLights.push({ light: L, base: def.kind === "boss" ? 320 : 210, room: rt });
    }

    // boss runes
    if (def.kind === "boss") {
      const runeMat = glow(color, 1.8, 0.7);
      for (const r of [5, 9, 14]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r, 64), runeMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(cx + 10, 0.02, cz);
        this.group.add(ring);
        this.spinners.push(ring);
      }
      const star = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.7, 6), runeMat);
      star.rotation.x = -Math.PI / 2;
      star.position.set(cx + 10, 0.025, cz);
      this.group.add(star);
      this.spinners.push(star);
    }

    // rack instances along N/S inner faces
    const start = cx - hw + 1.6;
    const end = cx + hw - 1.6;
    for (let x = start; x <= end; x += 2.05) {
      for (const s of [-1]) {
        const h = 2.7 + Math.random() * 0.5;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, h / 2, cz + s * (hd - 0.5)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s < 0 ? 0 : Math.PI, 0)),
          new THREE.Vector3(1, h / 2.8, 1),
        );
        this.rackMats.push({ m, c: new THREE.Color().setHSL(rand(0, 1) > 0.5 ? 0.52 : 0.76, 1, 0.6) });
      }
    }
  }

  private buildCover(rt: RoomRT, x: number, z: number, w: number, d: number, color: number) {
    const h = 2.4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(0x1a1f3a, { metal: 0.85, rough: 0.32 }));
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.09, d + 0.06), glow(color, 2.4));
    band.position.set(x, h * 0.72, z);
    this.group.add(band);
    const band2 = band.clone();
    band2.position.y = 0.4;
    this.group.add(band2);
    const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.06, d * 0.6), glow(color, 1.6));
    top.position.set(x, h + 0.03, z);
    this.group.add(top);
    const box = makeBox(x, z, w, d);
    this.colliders.push(box);
    rt.cover.push(box);
  }

  private buildCorridor(a: RoomDef, b: RoomDef) {
    const x0 = a.cx + a.w / 2;
    const x1 = b.cx - b.w / 2;
    const cz = a.cz;
    const len = x1 - x0;
    const cx = (x0 + x1) / 2;
    const color = b.color;
    this.floor(cx, cz, len, CORRIDOR_HALF * 2, color, -0.02);
    this.wall(x0, x1, cz - CORRIDOR_HALF - 1, cz - CORRIDOR_HALF, color, { b: 0.3 }, "z+");
    this.wall(x0, x1, cz + CORRIDOR_HALF, cz + CORRIDOR_HALF + 1, color, { t: 0.3 }, "z-", 1.15);
    // chevron lights
    for (let x = x0 + 2; x < x1 - 1; x += 3) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.12), glow(color, 2.2));
      ch.position.set(x, 0.01, cz);
      ch.rotation.y = 0.6;
      const ch2 = ch.clone();
      ch2.rotation.y = -0.6;
      ch.position.z = cz - 0.24;
      ch2.position.z = cz + 0.24;
      this.group.add(ch, ch2);
    }
    // cable runs along the corridor
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(x0 + (len * i) / 8, 0.12 + Math.sin(i * 1.3) * 0.08, cz + s * (CORRIDOR_HALF - 0.6 + Math.sin(i) * 0.15)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.07, 6), std(0x0c0e18, { metal: 0.4, rough: 0.6, flat: false }));
      tube.castShadow = true;
      this.group.add(tube);
    }
  }

  private buildRacks() {
    const n = this.rackMats.length;
    const rackGeo = new THREE.BoxGeometry(1.7, 2.8, 0.9);
    const rack = new THREE.InstancedMesh(rackGeo, std(0x151a30, { metal: 0.85, rough: 0.34 }), n);
    rack.castShadow = true;
    rack.receiveShadow = true;
    const ledGeo = new THREE.PlaneGeometry(1.45, 2.2);
    const ledMat = new THREE.MeshBasicMaterial({ map: this.rackLed, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) });
    const led = new THREE.InstancedMesh(ledGeo, ledMat, n);
    const _m = new THREE.Matrix4();
    const off = new THREE.Matrix4().makeTranslation(0, 0, 0.46);
    this.rackMats.forEach((r, i) => {
      rack.setMatrixAt(i, r.m);
      _m.copy(r.m).multiply(off);
      led.setMatrixAt(i, _m);
      led.setColorAt(i, r.c.clone().lerp(new THREE.Color(1, 1, 1), 0.4));
    });
    this.group.add(rack, led);
  }

  private buildDoors() {
    const add = (room: RoomRT, side: "west" | "east") => {
      const x = side === "west" ? room.def.cx - room.def.w / 2 - 0.5 : room.def.cx + room.def.w / 2 + 0.5;
      const door = new Door(x, room.def.cz);
      this.group.add(door.group);
      this.doors.push(door);
      this.colliders.push(door.box);
      if (side === "west") room.westDoor = door;
      else room.eastDoor = door;
    };
    for (const r of this.rooms) {
      if (r.def.west) add(r, "west");
      if (r.def.east) add(r, "east");
    }
    this.resetDoors();
  }

  /** Initial door states. */
  resetDoors() {
    for (const r of this.rooms) {
      r.eastDoor?.snap(false);
      r.westDoor?.snap(r.def.id !== "sentinel");
    }
    // starting room west door does not exist; corridor doors open inward are handled by encounters
  }

  private buildTerminals() {
    const start = this.room("start");
    const t1 = new Terminal("gate1", new THREE.Vector3(start.def.cx + 7.5, 0, start.def.cz - 5.2), -Math.PI / 2 - 0.4, "GATE 01", 0x22d3ee);
    const w = this.room("warden");
    const s = this.room("sentinel");
    const t2 = new Terminal("gate2", new THREE.Vector3((w.def.cx + w.def.w / 2 + s.def.cx - s.def.w / 2) / 2, 0, w.def.cz - 2.0), 0, "SENTINEL GATE", 0xef4444);
    for (const t of [t1, t2]) {
      this.group.add(t.group);
      this.terminals.push(t);
      const base = makeBox(t.pos.x, t.pos.z, 1.5, 1.0);
      this.colliders.push(base);
    }
  }

  private buildVoid() {
    this.voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 500).rotateX(-Math.PI / 2), VoidMaterial);
    this.voidMesh.position.set(90, -9, 0);
    this.voidMesh.frustumCulled = false;
    this.voidMesh.renderOrder = -1;
    this.group.add(this.voidMesh);

    const n = 220;
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0x10142a, { metal: 0.9, rough: 0.3 }), n);
    for (let i = 0; i < n; i++) {
      this.debrisData.push({
        p: new THREE.Vector3(rand(-40, 240), rand(-16, -3), rand(-55, 55)),
        r: new THREE.Vector3(rand(0, 6), rand(0, 6), rand(0, 6)),
        s: rand(0.5, 3.5),
        sp: rand(0.05, 0.3),
      });
    }
    this.group.add(this.debris);

    const pts = 700;
    const arr = new Float32Array(pts * 3);
    for (let i = 0; i < pts; i++) {
      arr[i * 3] = rand(-30, 220);
      arr[i * 3 + 1] = rand(0.3, 11);
      arr[i * 3 + 2] = rand(-45, 45);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, color: new THREE.Color(0.5, 0.9, 1.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  private buildHolos() {
    const add = (x: number, z: number, y: number, lines: string[], color: number, yaw = 0) => {
      const cs = "#" + new THREE.Color(color).getHexString();
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.3), new THREE.MeshBasicMaterial({ map: holoTextTexture(lines, cs), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, color: new THREE.Color(1.5, 1.5, 1.5) }));
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      m.rotation.x = -0.25;
      this.group.add(m);
      this.holos.push({ mesh: m, y, ph: Math.random() * 6 });
    };
    const R = (id: string) => this.room(id);
    add(R("start").def.cx - 3, R("start").def.cz - 7.2, 3.4, ["LAYER 01", "PHYSICAL // L1", "LINK: UNSTABLE", "PACKET LOSS 41%"], 0x22d3ee);
    add(R("arenaA").def.cx, R("arenaA").def.cz - 8.4, 3.4, ["SWITCH HALL", "MAC TABLE OVERFLOW", "HOSTILES DETECTED"], 0xa855f7);
    add(R("arenaB").def.cx, R("arenaB").def.cz - 10.6, 3.4, ["PATCH BAY", "DPI PROBES ONLINE", "AUTO-DEFENSE ARMED"], 0xf59e0b);
    add(R("warden").def.cx, R("warden").def.cz - 9.4, 3.4, ["WARDEN CELL", "ELITE ICE ACTIVE", "SHIELD: 100%"], 0xf43f5e);
    add(R("sentinel").def.cx - 4, R("sentinel").def.cz - 17.4, 3.6, ["FIREWALL CORE", "SENTINEL // ROOT", "ALLOW: NOTHING"], 0xef4444);

    // wireframe globe hologram in the start room
    const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.6, 1.0), wireframe: true, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    globe.position.set(-6.5, 1.8, -5.5);
    this.group.add(globe);
    this.spinners.push(globe);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.5, 10), std(0x1a1f36, { metal: 0.85, rough: 0.3 }));
    pedestal.position.set(-6.5, 0.25, -5.5);
    this.group.add(pedestal);
    this.colliders.push(makeBox(-6.5, -5.5, 1.6, 1.6));
  }

  /* ---- runtime ---- */

  update(dt: number, camPos: THREE.Vector3) {
    this.time += dt;
    (VoidMaterial.uniforms.time as { value: number }).value = this.time;
    this.voidMesh.position.x = camPos.x + 20;
    this.voidMesh.position.z = camPos.z;
    for (const d of this.doors) d.update(dt);
    for (const h of this.holos) h.mesh.position.y = h.y + Math.sin(this.time * 1.4 + h.ph) * 0.1;
    for (const s of this.spinners) s.rotation.y += dt * 0.3;
    const _o = new THREE.Object3D();
    this.debrisData.forEach((d, i) => {
      _o.position.set(d.p.x, d.p.y + Math.sin(this.time * d.sp + i) * 0.6, d.p.z);
      _o.rotation.set(d.r.x + this.time * d.sp, d.r.y + this.time * d.sp * 0.7, d.r.z);
      _o.scale.setScalar(d.s);
      _o.updateMatrix();
      this.debris.setMatrixAt(i, _o.matrix);
    });
    this.debris.instanceMatrix.needsUpdate = true;
    const pos = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.25 + (i % 7) * 0.05);
      if (y > 11) y = 0.3;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    // room light falloff by distance to camera focus
    for (const l of this.roomLights) {
      const dx = camPos.x - l.room.center.x;
      const f = Math.max(0, 1 - Math.max(0, Math.abs(dx) - l.room.def.w * 0.4) / 30);
      l.light.intensity = l.base * f;
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const kill = (x: THREE.Material) => {
        const mm = x as THREE.MeshStandardMaterial;
        mm.map?.dispose();
        mm.emissiveMap?.dispose();
        x.dispose();
      };
      if (Array.isArray(mat)) mat.forEach(kill);
      else if (mat && mat !== VoidMaterial) kill(mat);
    });
  }
}
