export type EnemyType = "sniffer" | "bot" | "probe" | "turret" | "warden" | "sentinel" | "pylon";

export const PLAYER = {
  hp: 100,
  shield: 60,
  shieldDelay: 3.2,
  shieldRegen: 22,
  speed: 9.2,
  radius: 0.55,
  fireInterval: 0.105,
  damage: 14,
  boltSpeed: 46,
  boltLife: 1.1,
  dashSpeed: 34,
  dashTime: 0.17,
  dashCooldown: 1.15,
  invuln: 0.5,
};

export interface EnemyDef {
  hp: number;
  radius: number;
  speed: number;
  color: number;
  score: number;
}

export const ENEMY: Record<EnemyType, EnemyDef> = {
  sniffer: { hp: 42, radius: 0.7, speed: 6.4, color: 0x22d3ee, score: 100 },
  bot: { hp: 17, radius: 0.5, speed: 7.6, color: 0xfb7185, score: 40 },
  probe: { hp: 36, radius: 0.75, speed: 4.6, color: 0xfbbf24, score: 150 },
  turret: { hp: 130, radius: 1.0, speed: 0, color: 0xf97316, score: 200 },
  warden: { hp: 900, radius: 1.5, speed: 3.6, color: 0xf43f5e, score: 1500 },
  sentinel: { hp: 2600, radius: 3.4, speed: 0, color: 0xef4444, score: 10000 },
  pylon: { hp: 110, radius: 1.0, speed: 0, color: 0x38bdf8, score: 300 },
};

export interface RoomDef {
  id: string;
  kind: "start" | "arena" | "miniboss" | "boss";
  cx: number;
  cz: number;
  w: number;
  d: number;
  west: boolean;
  east: boolean;
  color: number;
  title: string;
}

export const ROOMS: RoomDef[] = [
  { id: "start", kind: "start", cx: 0, cz: 0, w: 22, d: 18, west: false, east: true, color: 0x22d3ee, title: "ENTRY NODE" },
  { id: "arenaA", kind: "arena", cx: 38, cz: 0, w: 26, d: 20, west: true, east: true, color: 0xa855f7, title: "SWITCH HALL" },
  { id: "arenaB", kind: "arena", cx: 80, cz: 0, w: 30, d: 24, west: true, east: true, color: 0xf59e0b, title: "PATCH BAY" },
  { id: "warden", kind: "miniboss", cx: 122, cz: 0, w: 26, d: 22, west: true, east: true, color: 0xf43f5e, title: "WARDEN CELL" },
  { id: "sentinel", kind: "boss", cx: 169, cz: 0, w: 40, d: 40, west: true, east: false, color: 0xef4444, title: "FIREWALL CORE" },
];

export const CORRIDOR_HALF = 3;
export const WALL_H = 3.4;

export interface WaveDef {
  spawns: { type: EnemyType; count: number }[];
  fixed?: { type: EnemyType; dx: number; dz: number }[];
}

export const ENCOUNTERS: Record<string, WaveDef[]> = {
  arenaA: [
    { spawns: [{ type: "sniffer", count: 3 }] },
    { spawns: [{ type: "bot", count: 8 }] },
    { spawns: [{ type: "sniffer", count: 2 }, { type: "bot", count: 6 }] },
  ],
  arenaB: [
    { spawns: [{ type: "probe", count: 2 }, { type: "bot", count: 5 }] },
    { spawns: [{ type: "sniffer", count: 3 }, { type: "probe", count: 1 }], fixed: [{ type: "turret", dx: -9, dz: -8 }, { type: "turret", dx: 9, dz: 8 }] },
    { spawns: [{ type: "bot", count: 10 }, { type: "probe", count: 2 }] },
  ],
  warden: [{ spawns: [], fixed: [{ type: "warden", dx: 5, dz: 0 }] }],
  sentinel: [{ spawns: [], fixed: [{ type: "sentinel", dx: 10, dz: 0 }] }],
};

export const COVER: Record<string, { dx: number; dz: number; w: number; d: number }[]> = {
  start: [],
  arenaA: [
    { dx: -5, dz: -4, w: 2, d: 2 },
    { dx: 5, dz: 4, w: 2, d: 2 },
    { dx: 5, dz: -4, w: 2, d: 2 },
    { dx: -5, dz: 4, w: 2, d: 2 },
  ],
  arenaB: [
    { dx: 0, dz: 0, w: 3, d: 3 },
    { dx: -8, dz: 0, w: 2, d: 5 },
    { dx: 8, dz: 0, w: 2, d: 5 },
    { dx: -4, dz: -8, w: 3, d: 1.6 },
    { dx: 4, dz: 8, w: 3, d: 1.6 },
  ],
  warden: [
    { dx: -6, dz: -5, w: 2, d: 2 },
    { dx: -6, dz: 5, w: 2, d: 2 },
    { dx: 6, dz: -5, w: 2, d: 2 },
    { dx: 6, dz: 5, w: 2, d: 2 },
  ],
  sentinel: [
    { dx: -9, dz: -9, w: 2.4, d: 2.4 },
    { dx: -9, dz: 9, w: 2.4, d: 2.4 },
    { dx: 0, dz: -13, w: 2.4, d: 2.4 },
    { dx: 0, dz: 13, w: 2.4, d: 2.4 },
  ],
};

/* ------------------------------ upgrades ------------------------------ */

export interface PlayerStats {
  damageMul: number;
  fireRateMul: number;
  maxHp: number;
  maxShield: number;
  shieldRegenMul: number;
  dashCdMul: number;
  pierce: number;
  chainChance: number;
  freezeChance: number;
  killHeal: number;
}

export const baseStats = (): PlayerStats => ({
  damageMul: 1,
  fireRateMul: 1,
  maxHp: PLAYER.hp,
  maxShield: PLAYER.shield,
  shieldRegenMul: 1,
  dashCdMul: 1,
  pierce: 0,
  chainChance: 0,
  freezeChance: 0,
  killHeal: 0,
});

export interface Upgrade {
  id: string;
  name: string;
  desc: string;
  glyph: string;
  color: string;
  apply: (s: PlayerStats) => void;
}

export const UPGRADES: Upgrade[] = [
  { id: "dmg", name: "Overclocked Cache", desc: "+25% weapon damage", glyph: "⚡", color: "#f59e0b", apply: (s) => (s.damageMul *= 1.25) },
  { id: "rate", name: "Rapid Handshake", desc: "+20% rate of fire", glyph: "≫", color: "#22d3ee", apply: (s) => (s.fireRateMul *= 1.2) },
  { id: "hp", name: "Hardened Kernel", desc: "+35 max integrity, full repair", glyph: "✚", color: "#4ade80", apply: (s) => (s.maxHp += 35) },
  { id: "shield", name: "Deflector Array", desc: "+40 max shield, faster recharge", glyph: "◈", color: "#38bdf8", apply: (s) => { s.maxShield += 40; s.shieldRegenMul *= 1.35; } },
  { id: "dash", name: "Phase Shifter", desc: "Dash cooldown -35%", glyph: "➤", color: "#a78bfa", apply: (s) => (s.dashCdMul *= 0.65) },
  { id: "pierce", name: "Packet Piercer", desc: "Bolts pierce +1 target", glyph: "⟫", color: "#f472b6", apply: (s) => (s.pierce += 1) },
  { id: "chain", name: "Arc Protocol", desc: "30% chance bolts chain lightning", glyph: "ϟ", color: "#67e8f9", apply: (s) => (s.chainChance += 0.3) },
  { id: "cryo", name: "Cryo Cipher", desc: "25% chance to freeze on hit", glyph: "❄", color: "#93c5fd", apply: (s) => (s.freezeChance += 0.25) },
  { id: "siphon", name: "Data Siphon", desc: "Restore 4 integrity per kill", glyph: "♥", color: "#fb7185", apply: (s) => (s.killHeal += 4) },
];

/* ------------------------------ exploit pickups ------------------------------ */

export type BuffId = "overclock" | "chain" | "pierce" | "freeze" | "shield" | "drone";

export const BUFFS: Record<BuffId, { name: string; color: number; css: string; duration: number; glyph: string }> = {
  overclock: { name: "OVERCLOCK", color: 0xf59e0b, css: "#f59e0b", duration: 14, glyph: "⚡" },
  chain: { name: "CHAIN LIGHTNING", color: 0x67e8f9, css: "#67e8f9", duration: 16, glyph: "ϟ" },
  pierce: { name: "PIERCING ROUNDS", color: 0xf472b6, css: "#f472b6", duration: 14, glyph: "⟫" },
  freeze: { name: "CRYO LOCK", color: 0x93c5fd, css: "#93c5fd", duration: 14, glyph: "❄" },
  shield: { name: "BARRIER PATCH", color: 0x38bdf8, css: "#38bdf8", duration: 0, glyph: "◈" },
  drone: { name: "SUPPORT DRONE", color: 0x4ade80, css: "#4ade80", duration: 22, glyph: "✦" },
};

export const BUFF_IDS = Object.keys(BUFFS) as BuffId[];
