import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { BUFF_IDS, BuffId, ENCOUNTERS, ENEMY, EnemyType, UPGRADES, Upgrade, WaveDef } from "./config";
import { pointInBoxes } from "./collision";
import { Input, detectTouchDevice } from "./input";
import { TouchControls } from "./touch";
import { Player } from "./player";
import { Projectile, Projectiles } from "./weapons";
import { createPost, Post } from "./post";
import { UI } from "./ui";
import { VFX } from "./vfx";
import { RoomRT, World } from "./world";
import { Bot, Enemy, Probe, Pylon, Sniffer, Turret } from "./enemy";
import { Warden } from "./warden";
import { Sentinel } from "./boss";
import { Pickup, PickupKind } from "./pickups";
import { clamp, damp, disposeTree, pick, rand } from "./util";
import { glow } from "./models";

export interface Encounter {
  id: string;
  room: RoomRT;
  waves: WaveDef[];
  wave: number;
  state: "idle" | "active" | "cleared";
  timer: number;
}

type State = "title" | "playing" | "choice" | "dead" | "victory" | "paused";

const CAM_OFFSET = new THREE.Vector3(0, 17.5, 10.5);
const START = new THREE.Vector3(-6.5, 0, 3.2);
const _v = new THREE.Vector3();

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  post: Post;
  world: World;
  vfx: VFX;
  projectiles: Projectiles;
  input: Input;
  ui: UI;
  touch!: TouchControls;
  player: Player;
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  encounters: Encounter[] = [];

  state: State = "title";
  aimPoint = new THREE.Vector3(START.x + 3, 1, START.z);
  score = 0;
  kills = 0;
  runTime = 0;
  time = 0;
  damageFx = 0;
  fovKick = 0;
  camKick = new THREE.Vector3();

  private key: THREE.DirectionalLight;
  private reticle = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
  private camFocus = new THREE.Vector3();
  private camZoom = 1;
  private hitStopT = 0;
  private slowT = 0;
  private flashT = 0;
  private checkpoint = START.clone();
  private raf = 0;
  private last = 0;
  private running = true;
  private deadTimer = 0;
  private victoryWait = -1;
  private choiceOptions: Upgrade[] = [];
  private pendingChoice = -1;
  private resizeObs: ResizeObserver;
  private tut = { step: 0, dist: 0, last: new THREE.Vector3(), targets: [] as Enemy[] };
  private dmgAcc = new Map<Enemy, { acc: number; t: number }>();
  private titleT = 0;
  private lastAimDir = new THREE.Vector3(1, 0, 0);
  private uiTimer = 0;
  private disposed = false;

  constructor(private host: HTMLElement, private onExit: () => void) {
    const mobile = detectTouchDevice();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = mobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = "display:block;width:100%;height:100%";

    const w = Math.max(2, host.clientWidth);
    const h = Math.max(2, host.clientHeight);
    this.renderer.setSize(w, h, false);
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x05060d);
    this.scene.fog = new THREE.FogExp2(0x070814, 0.014);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0x6a7cff, 0x1a0c2e, 0.5));
    this.key = new THREE.DirectionalLight(0xa9bcff, 1.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const sc = this.key.shadow.camera;
    sc.left = -26;
    sc.right = 26;
    sc.top = 26;
    sc.bottom = -26;
    sc.near = 1;
    sc.far = 90;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.04;
    this.scene.add(this.key, this.key.target);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 400);
    this.post = createPost(this.renderer, this.scene, this.camera, w, h, mobile ? 2 : 4);

    this.ui = new UI(host, {
      onStart: () => this.startGame(),
      onResume: () => this.resume(),
      onExit: () => this.onExit(),
      onPick: (i) => this.pickUpgrade(i),
      onRespawn: () => this.respawn(),
      onRestart: () => this.restartMission(),
      onPause: () => this.pause(),
    });
    this.input = new Input(host);
    this.touch = new TouchControls(this.ui.root, this.input);
    this.input.onTouchMode = (v) => this.ui.setTouch(v);
    this.ui.setTouch(this.input.touchMode);
    this.vfx = new VFX(this.scene);
    this.projectiles = new Projectiles(this.scene);
    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.buildReticle();
    this.buildEncounters();
    this.player.spawnAt(START.x, START.z);
    this.player.yaw = Math.PI / 2;
    this.camFocus.copy(this.player.pos);
    this.ui.showTitle(true);
    this.ui.setHint(null);

    if (process.env.NODE_ENV !== "production") (window as unknown as { __nt?: Game }).__nt = this;
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ------------------------------ setup helpers ------------------------------ */

  private buildReticle() {
    const m = glow(0x67e8f9, 2.6);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 32).rotateX(-Math.PI / 2), m);
    this.reticle.add(ring);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12).rotateX(-Math.PI / 2), m);
    this.reticle.add(dot);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.22), m);
      const a = (i / 4) * Math.PI * 2;
      t.position.set(Math.sin(a) * 0.62, 0, Math.cos(a) * 0.62);
      t.rotation.y = a;
      this.reticle.add(t);
    }
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  private buildEncounters() {
    this.encounters = [];
    for (const r of this.world.rooms) {
      const waves = ENCOUNTERS[r.def.id];
      if (!waves) continue;
      this.encounters.push({ id: r.def.id, room: r, waves, wave: 0, state: "idle", timer: 0 });
    }
  }

  private resize() {
    const w = Math.max(2, this.host.clientWidth);
    const h = Math.max(2, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------------ state transitions ------------------------------ */

  startGame() {
    if (this.state !== "title") return;
    this.state = "playing";
    this.ui.showTitle(false);
    this.resetTutorial();
    this.ui.toast("LAYER 01", "physical — initiating deep dive", 2200, "#22d3ee");
    if (this.input.touchMode && this.host.clientHeight > this.host.clientWidth * 1.05) {
      window.setTimeout(() => this.ui.toast("TIP", "rotate to landscape for a wider view", 2400, "#a78bfa"), 2400);
    }
  }

  private pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.ui.showPause(true);
  }

  private resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.ui.showPause(false);
  }

  onPlayerDeath() {
    this.deadTimer = 0;
  }

  private respawn() {
    if (this.state !== "dead") return;
    this.ui.showDead(false);
    this.projectiles.clearAll();
    this.vfx.clearTelegraphs();
    const active = this.encounters.find((e) => e.state === "active");
    if (active) this.resetEncounter(active);
    this.player.spawnAt(this.checkpoint.x, this.checkpoint.z);
    this.camFocus.copy(this.player.pos);
    this.state = "playing";
    this.ui.toast("RESPAWNED", "checkpoint restored", 1400, "#4ade80");
  }

  private resetEncounter(enc: Encounter) {
    for (const e of [...this.enemies]) if (e.enc === enc) this.removeEnemy(e);
    enc.state = "idle";
    enc.wave = 0;
    enc.timer = 0;
    enc.room.westDoor?.setOpen(true);
    enc.room.eastDoor?.setOpen(false);
  }

  restartMission() {
    if (this.state === "title") return;
    for (const e of [...this.enemies]) this.removeEnemy(e);
    for (const p of this.pickups) p.dispose(this.scene);
    this.pickups = [];
    this.projectiles.clearAll();
    this.vfx.clearTelegraphs();
    this.world.dispose(this.scene);
    this.world = new World(this.scene);
    this.buildEncounters();
    this.player.resetRun();
    this.player.spawnAt(START.x, START.z);
    this.player.yaw = Math.PI / 2;
    this.checkpoint.copy(START);
    this.camFocus.copy(this.player.pos);
    this.score = 0;
    this.kills = 0;
    this.runTime = 0;
    this.victoryWait = -1;
    this.slowT = 0;
    this.dmgAcc.clear();
    this.ui.showDead(false);
    this.ui.showVictory(null);
    this.ui.showChoice(null);
    this.ui.showPause(false);
    this.ui.setBoss(null);
    this.resetTutorial();
    this.state = "playing";
    this.ui.toast("LAYER 01", "mission restarted", 1600, "#22d3ee");
  }

  /* ------------------------------ enemies / combat API ------------------------------ */

  spawnEnemy(type: EnemyType, x: number, z: number, enc: Encounter | null, opts?: { shooter?: boolean; hp?: number }): Enemy {
    let e: Enemy;
    switch (type) {
      case "sniffer":
        e = new Sniffer(x, z, enc, this);
        break;
      case "bot":
        e = new Bot(x, z, enc, this);
        break;
      case "probe":
        e = new Probe(x, z, enc, this);
        break;
      case "turret":
        e = new Turret(x, z, enc, this);
        break;
      case "warden":
        e = new Warden(x, z, enc, this);
        break;
      case "sentinel":
        e = new Sentinel(x, z, enc, this);
        break;
      default:
        e = new Pylon(x, z, enc, this, opts?.shooter ?? false, opts?.hp);
    }
    this.enemies.push(e);
    this.scene.add(e.group);
    return e;
  }

  private removeEnemy(e: Enemy) {
    e.onRemove(this);
    this.scene.remove(e.group);
    disposeTree(e.group);
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    this.dmgAcc.delete(e);
  }

  fireHostile(from: THREE.Vector3, dir: THREE.Vector3, speed: number, dmg: number, color: number, radius = 0.3) {
    this.projectiles.spawn({ pos: from, vel: dir.clone().normalize().multiplyScalar(speed), dmg, friendly: false, life: 5, radius, color });
  }

  hitStop(sec: number) {
    this.hitStopT = Math.max(this.hitStopT, sec);
  }

  addDamageNumber(e: Enemy, dealt: number) {
    if (dealt <= 0) return;
    const rec = this.dmgAcc.get(e) ?? { acc: 0, t: -9 };
    rec.acc += dealt;
    if (this.time - rec.t > 0.24) {
      _v.set(e.pos.x, 2.4, e.pos.z).project(this.camera);
      const x = (_v.x * 0.5 + 0.5) * this.host.clientWidth;
      const y = (-_v.y * 0.5 + 0.5) * this.host.clientHeight;
      this.ui.floatText(x, y, String(Math.round(rec.acc)), e.vulnerableNow ? "#fbbf24" : "#fde68a");
      rec.acc = 0;
      rec.t = this.time;
    }
    this.dmgAcc.set(e, rec);
  }

  onEnemyKilled(e: Enemy) {
    if (e.enc === null && e.type === "pylon" && e.bossName === null) return;
    this.score += ENEMY[e.type].score;
    this.kills++;
    if (this.player.stats.killHeal > 0) this.player.heal(this.player.stats.killHeal);
    const chance: Partial<Record<EnemyType, number>> = { bot: 0.05, sniffer: 0.17, probe: 0.26, turret: 0.32 };
    const c = chance[e.type];
    if (c && Math.random() < c) this.dropLoot(e.pos.x, e.pos.z);
    if (e.type === "warden") {
      this.hitStop(0.16);
      this.ui.toast("WARDEN DELETED", "elite ICE neutralised", 2000, "#f43f5e");
    } else if (e.type === "sentinel") {
      this.slowT = 2.6;
      this.hitStop(0.22);
      this.ui.toast("SENTINEL DOWN", "purging firewall core…", 3000, "#fbbf24");
    } else if (e.type === "probe" || e.type === "turret") this.hitStop(0.035);
  }

  private dropLoot(x: number, z: number, forceBuff = false) {
    let kind: PickupKind;
    if (!forceBuff && Math.random() < 0.24) kind = "repair";
    else kind = pick(BUFF_IDS) as BuffId;
    this.pickups.push(new Pickup(kind, x + rand(-0.6, 0.6), z + rand(-0.6, 0.6), this.scene));
  }

  /* ------------------------------ tutorial ------------------------------ */

  private resetTutorial() {
    for (const t of this.tut.targets) if (!t.dead) this.removeEnemy(t);
    this.tut = { step: 0, dist: 0, last: this.player.pos.clone(), targets: [] };
    this.player.didDash = false;
    for (const t of this.world.terminals) t.reset();
  }

  private updateTutorial(dt: number) {
    const t = this.tut;
    const start = this.world.room("start");
    if (!this.encounters.length) return;
    switch (t.step) {
      case 0:
        t.dist += Math.hypot(this.player.pos.x - t.last.x, this.player.pos.z - t.last.z);
        if (t.dist > 6) {
          t.step = 1;
          const cx = start.def.cx;
          const cz = start.def.cz;
          t.targets = [
            this.spawnEnemy("pylon", cx + 2.5, cz - 4, null, { hp: 45 }),
            this.spawnEnemy("pylon", cx + 5.5, cz + 3.5, null, { hp: 45 }),
          ];
          this.ui.toast("TRAINING NODES", "shoot them", 1400, "#22d3ee");
        }
        break;
      case 1:
        if (t.targets.every((e) => e.dead)) {
          t.step = 2;
          this.ui.toast("NICE", "now dash", 1000, "#4ade80");
        }
        break;
      case 2:
        if (this.player.didDash) t.step = 3;
        break;
      case 3:
        if (this.world.terminals[0].used) t.step = 4;
        break;
    }
    t.last.copy(this.player.pos);
    void dt;
  }

  private tutorialHint(): string | null {
    if (this.input.touchMode) {
      switch (this.tut.step) {
        case 0:
          return "Drag the <b>left stick</b> to move";
        case 1:
          return "Drag the <b>right stick</b> to aim — it fires automatically. Destroy both training nodes";
        case 2:
          return "Tap <b>DASH</b> — you are invulnerable while dashing";
        case 3:
          return "Walk to the terminal and tap <b>USE</b>";
        default:
          return null;
      }
    }
    switch (this.tut.step) {
      case 0:
        return "<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — move around";
      case 1:
        return "Aim with the <kbd>MOUSE</kbd>, hold <kbd>LMB</kbd> to fire — destroy both training nodes";
      case 2:
        return "<kbd>SHIFT</kbd> / <kbd>SPACE</kbd> — dash (invulnerable while dashing)";
      case 3:
        return "Walk to the terminal and press <kbd>E</kbd> to unlock the east gate";
      default:
        return null;
    }
  }

  /* ------------------------------ interaction ------------------------------ */

  private updateInteraction() {
    let best: (typeof this.world.terminals)[number] | null = null;
    let bd = 1e9;
    for (const t of this.world.terminals) {
      if (t.used) continue;
      const d = Math.hypot(t.pos.x - this.player.pos.x, t.pos.z - this.player.pos.z);
      if (d < t.radius && d < bd) {
        best = t;
        bd = d;
      }
    }
    const tm = this.input.touchMode;
    this.touch.setUseVisible(!!best && !this.player.dead && tm);
    if (best && !this.player.dead) {
      this.ui.setPrompt(tm ? `ACCESS TERMINAL — ${best.label}` : `<kbd>E</kbd> ACCESS TERMINAL — ${best.label}`);
      if (this.input.pressed("KeyE")) this.useTerminal(best);
    } else this.ui.setPrompt(null);
  }

  private useTerminal(t: (typeof this.world.terminals)[number]) {
    t.activate();
    this.vfx.ring(t.pos.x, 0.08, t.pos.z, 0x4ade80, 3.4, 0.6);
    this.vfx.burst(t.pos.x, 1.6, t.pos.z, 0x4ade80, 22, 5, 0.1, 0.7, 0);
    if (t.id === "gate1") {
      this.world.room("start").eastDoor?.setOpen(true);
      this.ui.toast("GATE 01 UNLOCKED", "proceed east", 1800, "#4ade80");
    } else {
      this.world.room("sentinel").westDoor?.setOpen(true);
      this.ui.toast("SENTINEL GATE UNLOCKED", "the firewall core awaits", 2200, "#ef4444");
    }
  }

  /* ------------------------------ encounters ------------------------------ */

  private randomSpawn(room: RoomRT, minFromPlayer = 9): THREE.Vector3 {
    const r = room.inner;
    const out = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      out.set(rand(r.minX + 3, r.maxX - 3), 0, rand(r.minZ + 3.2, r.maxZ - 3.2));
      if (pointInBoxes(out.x, out.z, this.world.colliders, 1.4)) continue;
      if (Math.hypot(out.x - this.player.pos.x, out.z - this.player.pos.z) < minFromPlayer) continue;
      return out;
    }
    return out;
  }

  private startWave(enc: Encounter) {
    const wave = enc.waves[enc.wave];
    for (const s of wave.spawns) {
      for (let k = 0; k < s.count; k++) {
        const p = this.randomSpawn(enc.room);
        this.spawnEnemy(s.type, p.x, p.z, enc);
      }
    }
    for (const f of wave.fixed ?? []) this.spawnEnemy(f.type, enc.room.def.cx + f.dx, enc.room.def.cz + f.dz, enc);
    if (enc.waves.length > 1) this.ui.toast(`WAVE ${enc.wave + 1} / ${enc.waves.length}`, enc.room.def.title, 1400, "#a78bfa");
  }

  private updateEncounters(dt: number) {
    const p = this.player;
    for (const enc of this.encounters) {
      const r = enc.room.inner;
      if (enc.state === "idle") {
        if (!p.dead && p.pos.x > r.minX + 3.4 && p.pos.x < r.maxX && p.pos.z > r.minZ && p.pos.z < r.maxZ) {
          enc.state = "active";
          enc.wave = 0;
          enc.room.westDoor?.setOpen(false);
          this.checkpoint.set(r.minX - 6, 0, enc.room.def.cz);
          const kind = enc.room.def.kind;
          this.ui.toast(enc.room.def.title, kind === "boss" ? "final protocol" : kind === "miniboss" ? "elite ICE detected" : "hostiles detected", 1800, "#" + new THREE.Color(enc.room.def.color).getHexString());
          enc.timer = kind === "boss" ? 1.4 : 0.9;
        }
      } else if (enc.state === "active") {
        if (enc.timer > 0) {
          enc.timer -= dt;
          if (enc.timer <= 0) this.startWave(enc);
          continue;
        }
        if (this.enemies.some((e) => e.enc === enc && !e.dead)) continue;
        if (enc.wave + 1 < enc.waves.length) {
          enc.wave++;
          enc.timer = 1.6;
        } else this.clearEncounter(enc);
      }
    }
  }

  private clearEncounter(enc: Encounter) {
    enc.state = "cleared";
    enc.room.eastDoor?.setOpen(true);
    this.projectiles.clearHostile();
    if (enc.room.def.kind === "boss") return;
    this.ui.toast("ROOM CLEARED", enc.room.def.title, 1800, "#4ade80");
    const c = enc.room.center;
    this.dropLoot(c.x - 1.5, c.z, true);
    this.pickups.push(new Pickup("repair", c.x + 1.5, c.z, this.scene));
    this.pendingChoice = 1.3;
  }

  /* ------------------------------ upgrades ------------------------------ */

  private openChoice() {
    const pool = [...UPGRADES].sort(() => Math.random() - 0.5);
    this.choiceOptions = pool.slice(0, 3);
    this.state = "choice";
    this.ui.showChoice(this.choiceOptions);
    this.ui.setPrompt(null);
  }

  private pickUpgrade(i: number) {
    if (this.state !== "choice") return;
    const u = this.choiceOptions[i];
    if (!u) return;
    u.apply(this.player.stats);
    if (u.id === "hp") this.player.hp = this.player.stats.maxHp;
    if (u.id === "shield") this.player.shield = this.player.stats.maxShield;
    this.ui.showChoice(null);
    this.state = "playing";
    this.ui.toast(u.name.toUpperCase(), u.desc, 1800, u.color);
    this.vfx.ring(this.player.pos.x, 0.06, this.player.pos.z, new THREE.Color(u.color).getHex(), 3, 0.6);
  }

  /* ------------------------------ projectiles ------------------------------ */

  private stepProjectiles(dt: number) {
    const steps = Math.max(1, Math.min(4, Math.ceil(dt / 0.011)));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.projectiles.step(sdt, this.world.colliders, (p) => {
        this.vfx.sparks(p.pos.x, p.pos.y, p.pos.z, -p.vel.x, -p.vel.z, p.color, p.friendly ? 4 : 3);
      });
      this.resolveProjectileHits();
    }
    this.projectiles.sync();
    this.projectiles.each((p) => {
      if (p.friendly) this.vfx.trail(p.pos.x, p.pos.y, p.pos.z, p.color, 0.05);
      else if (Math.random() < 0.5) this.vfx.trail(p.pos.x, p.pos.y, p.pos.z, p.color, 0.07);
    });
  }

  private resolveProjectileHits() {
    const player = this.player;
    this.projectiles.each((p) => {
      if (p.friendly) {
        for (const e of this.enemies) {
          if (e.dead || e.spawning || p.hitSet.has(e)) continue;
          const dx = p.pos.x - e.pos.x;
          const dz = p.pos.z - e.pos.z;
          const r = e.radius + p.radius;
          if (dx * dx + dz * dz > r * r) continue;
          const l = Math.hypot(p.vel.x, p.vel.z) || 1;
          const dir = _v.set(p.vel.x / l, 0, p.vel.z / l);
          e.hit(this, p.dmg, dir.clone(), 3.6, p.freeze);
          this.vfx.burst(p.pos.x, p.pos.y, p.pos.z, p.color, 5, 5, 0.08, 0.25, 0);
          this.vfx.flash(p.pos.x, p.pos.y + 0.4, p.pos.z, p.color, 22, 0.06);
          if (p.chain) this.chainLightning(p, e);
          p.hitSet.add(e);
          if (p.pierce > 0) p.pierce--;
          else {
            this.projectiles.kill(p);
            break;
          }
        }
      } else if (!player.dead && !player.dashing) {
        const dx = p.pos.x - player.pos.x;
        const dz = p.pos.z - player.pos.z;
        const r = p.radius + player.radius * 0.9;
        if (dx * dx + dz * dz < r * r) {
          if (player.takeDamage(this, p.dmg, p.pos, 6)) this.vfx.burst(p.pos.x, p.pos.y, p.pos.z, p.color, 8, 5, 0.09, 0.3, 0);
          this.projectiles.kill(p);
        }
      }
    });
  }

  private chainLightning(p: Projectile, from: Enemy) {
    const targets = this.enemies
      .filter((o) => o !== from && !o.dead && !o.spawning && Math.hypot(o.pos.x - from.pos.x, o.pos.z - from.pos.z) < 9.5)
      .sort((a, b) => Math.hypot(a.pos.x - from.pos.x, a.pos.z - from.pos.z) - Math.hypot(b.pos.x - from.pos.x, b.pos.z - from.pos.z))
      .slice(0, 2);
    let prev = new THREE.Vector3(from.pos.x, 1.2, from.pos.z);
    for (const t of targets) {
      const to = new THREE.Vector3(t.pos.x, 1.2, t.pos.z);
      this.vfx.lightning(prev, to, 0x8ff3ff);
      const d = new THREE.Vector3(to.x - prev.x, 0, to.z - prev.z).normalize();
      t.hit(this, p.dmg * 0.6, d, 2, false);
      prev = to;
    }
  }

  /* ------------------------------ camera / aim ------------------------------ */

  private updateAim() {
    if (this.input.touchMode) {
      const inp = this.input;
      const p = this.player;
      if (inp.touchAimActive) {
        const dir = _v.set(inp.touchAim.x, 0, inp.touchAim.z).normalize();
        let best: Enemy | null = null;
        let bs = 1e9;
        for (const e of this.enemies) {
          if (e.dead || e.spawning) continue;
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 17 || d < 0.5) continue;
          const c = (dx * dir.x + dz * dir.z) / d;
          if (c < 0.9) continue;
          const sc = d * (1.25 - c);
          if (sc < bs) {
            bs = sc;
            best = e;
          }
        }
        if (best) {
          const dx = best.pos.x - p.pos.x;
          const dz = best.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          dir.x = dir.x * 0.3 + (dx / d) * 0.7;
          dir.z = dir.z * 0.3 + (dz / d) * 0.7;
          dir.normalize();
        }
        this.lastAimDir.copy(dir);
      } else if (Math.hypot(inp.touchMove.x, inp.touchMove.z) > 0.25) {
        this.lastAimDir.set(inp.touchMove.x, 0, inp.touchMove.z).normalize();
      }
      this.aimPoint.set(p.pos.x + this.lastAimDir.x * 9, 1, p.pos.z + this.lastAimDir.z * 9);
      return;
    }
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.input.ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, _v);
    if (hit) this.aimPoint.copy(hit);
  }

  private updateCamera(raw: number) {
    const p = this.player;
    const focusTarget = _v.set(p.pos.x, 0, p.pos.z);
    if (this.state === "playing" || this.state === "dead" || this.state === "choice" || this.state === "paused") {
      const look = new THREE.Vector3(this.aimPoint.x - p.pos.x, 0, this.aimPoint.z - p.pos.z);
      const l = Math.min(look.length(), 12);
      if (look.lengthSq() > 1e-4) look.normalize().multiplyScalar(l * 0.22);
      focusTarget.add(look).add(this.camKick);
    }
    const bossE = this.enemies.find((e) => e.type === "sentinel" && !e.dead);
    if (bossE && this.state !== "title" && this.world.roomAt(p.pos.x, p.pos.z)?.def.kind === "boss") {
      focusTarget.x += (bossE.pos.x - focusTarget.x) * 0.38;
      focusTarget.z += (bossE.pos.z - focusTarget.z) * 0.38;
    }
    this.camKick.multiplyScalar(Math.exp(-9 * raw));
    this.camFocus.x = damp(this.camFocus.x, focusTarget.x, 7, raw);
    this.camFocus.z = damp(this.camFocus.z, focusTarget.z, 7, raw);

    const room = this.world.roomAt(p.pos.x, p.pos.z);
    const zoomTarget = room?.def.kind === "boss" ? 1.3 : room?.def.kind === "miniboss" ? 1.1 : 1;
    this.camZoom = damp(this.camZoom, zoomTarget, 1.6, raw);
    const asp = this.camera.aspect;
    const aspZ = asp < 1.15 ? Math.min(1.8, Math.pow(1.15 / asp, 0.7)) : 1;
    const zoom = this.camZoom * aspZ;

    if (this.state === "title") {
      this.titleT += raw;
      const a = this.titleT * 0.12 + 0.6;
      const hx = this.player.pos.x;
      const hz = this.player.pos.z;
      this.camera.position.set(hx + Math.sin(a) * 6.5, 3.4, hz + Math.cos(a) * 6.5);
      this.camera.lookAt(hx, 1.25, hz);
      this.camera.fov = 40;
      this.camera.setViewOffset(this.host.clientWidth, this.host.clientHeight, -this.host.clientWidth * 0.2, 0, this.host.clientWidth, this.host.clientHeight);
      this.camera.updateProjectionMatrix();
      return;
    }
    if (this.camera.view?.enabled) this.camera.clearViewOffset();
    const dbg = (this as unknown as { debugCam?: { pos: THREE.Vector3; look: THREE.Vector3 } }).debugCam;
    if (process.env.NODE_ENV !== "production" && dbg) {
      this.camera.position.copy(dbg.pos);
      this.camera.lookAt(dbg.look);
      return;
    }
    this.fovKick = Math.max(0, this.fovKick - raw * 4.5);
    const fov = 42 + this.fovKick * 5;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const s = this.vfx.shake;
    this.camera.position.set(
      this.camFocus.x + CAM_OFFSET.x * zoom + (Math.random() - 0.5) * s * 0.9,
      CAM_OFFSET.y * zoom + (Math.random() - 0.5) * s * 0.5,
      this.camFocus.z + CAM_OFFSET.z * zoom + (Math.random() - 0.5) * s * 0.9,
    );
    this.camera.lookAt(this.camFocus.x, 0.8, this.camFocus.z);
  }

  /* ------------------------------ HUD ------------------------------ */

  private objectiveText(): string {
    if (this.tut.step < 4) return "Complete the training sequence";
    const active = this.encounters.find((e) => e.state === "active");
    if (active) {
      if (active.room.def.kind === "boss") return "Destroy the <b style='color:#fca5a5'>FIREWALL SENTINEL</b>";
      const left = this.enemies.filter((e) => e.enc === active && !e.dead).length;
      return `Eliminate all hostiles${active.waves.length > 1 ? ` — wave ${active.wave + 1}/${active.waves.length}` : ""} <span style="color:#64748b">(${left} left)</span>`;
    }
    const next = this.encounters.find((e) => e.state === "idle");
    if (!next) return "Layer secured";
    if (next.room.def.kind === "boss") return this.world.room("sentinel").westDoor?.open ? "Enter the firewall core" : "Use the terminal to unlock the <b style='color:#fca5a5'>SENTINEL GATE</b>";
    return `Proceed east — <b style='color:#c4b5fd'>${next.room.def.title}</b>`;
  }

  private updateHud() {
    const p = this.player;
    this.ui.setHud({
      hp: p.hp,
      maxHp: p.stats.maxHp,
      shield: p.shield,
      maxShield: p.stats.maxShield,
      dash: p.dash01,
      buffs: (Object.keys(p.buffs) as BuffId[]).map((id) => ({ id, t: p.buffs[id] ?? 0 })),
      score: this.score,
      kills: this.kills,
      objective: this.objectiveText(),
      room: this.world.roomAt(p.pos.x, p.pos.z)?.def.title ?? "CORRIDOR",
    });
    this.ui.setHint(this.state === "playing" ? this.tutorialHint() : null);
    const boss = this.enemies.find((e) => !e.dead && !e.spawning && e.bossName);
    if (boss) {
      if (boss instanceof Warden) this.ui.setBoss({ name: boss.bossName!, hp: boss.hp / boss.maxHp, shield: boss.shieldPct, shieldLabel: boss.vulnerable ? "SHIELD DOWN — VULNERABLE" : "ENERGY SHIELD" });
      else if (boss instanceof Sentinel) this.ui.setBoss({ name: boss.bossName!, hp: boss.hp / boss.maxHp, shield: boss.pylonFrac, shieldLabel: "FIREWALL PYLONS" });
      else this.ui.setBoss({ name: boss.bossName!, hp: boss.hp / boss.maxHp, shield: null });
    } else this.ui.setBoss(null);
  }

  /* ------------------------------ main loop ------------------------------ */

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const raw = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    try {
      this.tick(raw);
    } catch (err) {
      console.error("[nettrace]", err);
    }
    this.input.endFrame();
  };

  private tick(raw: number) {
    const inp = this.input;

    // state-level input
    if (this.state === "title") {
      if (inp.pressed("Enter", "Space")) this.startGame();
    } else if (this.state === "playing") {
      if (inp.pressed("Escape", "KeyP")) this.pause();
    } else if (this.state === "paused") {
      if (inp.pressed("Escape", "KeyP")) this.resume();
    } else if (this.state === "choice") {
      if (inp.pressed("Digit1")) this.pickUpgrade(0);
      else if (inp.pressed("Digit2")) this.pickUpgrade(1);
      else if (inp.pressed("Digit3")) this.pickUpgrade(2);
    } else if (this.state === "dead") {
      if (inp.pressed("Enter")) this.respawn();
      else if (inp.pressed("KeyR")) this.restartMission();
    } else if (this.state === "victory") {
      if (inp.pressed("Enter", "KeyR")) this.restartMission();
    }

    // time scaling
    let dt = raw;
    if (this.slowT > 0) {
      this.slowT -= raw;
      dt = raw * 0.32;
    }
    if (this.hitStopT > 0) {
      this.hitStopT -= raw;
      dt = 0;
    }
    const simulating = this.state === "playing";
    this.damageFx = Math.max(0, this.damageFx - raw * 1.8);

    this.updateAim();
    if (simulating) this.simulate(dt);
    else if (this.state === "title" || this.state === "victory") {
      this.player.model.update(raw, { aimYaw: this.player.yaw, vx: 0, vz: 0, speed01: 0, dashing: false, dead: false });
      this.player.model.root.position.copy(this.player.pos);
    } else if (this.state === "dead") {
      this.player.update(dt, this);
      this.vfx.update(dt);
    }

    // player death -> overlay
    if (this.state === "playing" && this.player.dead) {
      this.deadTimer += raw;
      if (this.deadTimer > 1.5) {
        this.state = "dead";
        this.ui.showDead(true);
      }
    }

    // pending upgrade choice
    if (this.pendingChoice > 0 && this.state === "playing") {
      this.pendingChoice -= raw;
      if (this.pendingChoice <= 0) {
        this.pendingChoice = -1;
        this.openChoice();
      }
    }

    // victory sequence
    if (this.victoryWait > 0) {
      this.victoryWait -= raw;
      if (this.victoryWait <= 0) {
        this.victoryWait = -1;
        this.state = "victory";
        this.ui.showVictory({ score: this.score, kills: this.kills, time: this.runTime });
      }
    }

    // world ambience & lights
    this.world.update(raw, this.camFocus);
    this.updateCamera(raw);
    this.key.position.set(this.camFocus.x - 9, 30, this.camFocus.z + 9);
    this.key.target.position.set(this.camFocus.x, 0, this.camFocus.z);
    this.key.target.updateMatrixWorld();

    // reticle
    this.reticle.visible = this.state === "playing" && !this.player.dead && (!this.input.touchMode || this.input.touchAimActive);
    this.touch.setVisible(this.input.touchMode && this.state === "playing");
    this.reticle.position.set(this.aimPoint.x, 0.07, this.aimPoint.z);
    this.reticle.rotation.y += raw * 1.4;

    // HUD (throttled a bit)
    this.uiTimer -= raw;
    if (this.state !== "title" && this.uiTimer <= 0) {
      this.uiTimer = 0.05;
      this.updateHud();
    }

    // flash
    this.flashT = Math.max(0, this.flashT - raw * 1.2);
    this.ui.setFlash(this.flashT);

    // post
    const u = this.post.stylize.uniforms;
    u.time.value += raw;
    u.damage.value = this.damageFx;
    u.aberration.value = clamp(this.vfx.shake * 0.35 + this.fovKick * 0.15, 0, 0.6);
    this.post.composer.render(raw);
  }

  private simulate(dt: number) {
    this.time += dt;
    this.runTime += dt;
    this.updateInteraction();
    this.player.update(dt, this);
    this.updateEncounters(dt);
    for (const e of [...this.enemies]) {
      if (e.dead) {
        if (e.linger > 0) {
          e.linger -= dt;
          e.deathUpdate(dt, this);
          if (e.linger <= 0) {
            if (e.type === "sentinel") {
              this.flashT = 1;
              this.victoryWait = 1.6;
              this.slowT = 0;
            }
            this.removeEnemy(e);
          }
        } else this.removeEnemy(e);
        continue;
      }
      e.update(dt, this);
    }
    this.stepProjectiles(dt);
    this.pickups = this.pickups.filter((p) => {
      const keep = p.update(dt, this);
      if (!keep) p.dispose(this.scene);
      return keep;
    });
    this.updateTutorial(dt);
    this.vfx.update(dt);
  }

  /* ------------------------------ teardown ------------------------------ */

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.input.dispose();
    this.touch.dispose();
    for (const e of [...this.enemies]) this.removeEnemy(e);
    for (const p of this.pickups) p.dispose(this.scene);
    this.world.dispose(this.scene);
    this.projectiles.dispose(this.scene);
    this.vfx.dispose();
    this.player.dispose();
    this.ui.dispose();
    this.post.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
