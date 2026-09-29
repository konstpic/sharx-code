# Netrunner: Deep Dive — 3D vertical slice

A playable top-down/isometric **3D** shooter built on plain **three.js** (WebGL2). It is embedded in the
panel as a lazily loaded chunk: the engine is only downloaded the first time the overlay is opened, so it
adds nothing to the normal panel bundle.

## Run

The game is part of the panel build (no separate dev server needed):

```bash
cd panel
npm install          # installs three + @types/three
npm run build        # or: npm run dev
```

Open the overlay from the panel header (see `PanelShell.tsx`). To iterate on the game alone, create a
temporary page that renders `<NetTrace open onClose={...} />` (see `../NetTrace.tsx`) and run `npm run dev`.
In development builds the running instance is exposed as `window.__nt` (stripped from production).

## Controls

| Input | Action |
|-------|--------|
| `W A S D` | move |
| Mouse | aim on the ground plane (3D reticle) |
| `LMB` (hold) | fire |
| `Shift` / `Space` | dash — invulnerable, afterimage trail, cooldown |
| `E` | use terminal |
| `1` `2` `3` | pick an upgrade card |
| `Esc` / `P` | pause |

### Touch devices (Android / iOS / iPadOS)

Detected automatically (`(pointer: coarse)` / no-hover + touch points; also switches on at the first real
touch, e.g. hybrids). No setup needed:

| Control | Action |
|---------|--------|
| Left half — drag | floating **move stick** |
| Right half — drag | floating **aim stick**; fires automatically while pushed out, with light aim assist |
| `DASH` button | dash (haptic tick where supported) |
| `USE` button | appears next to a terminal |
| `❚❚` (top right) | pause |

The renderer uses a lighter profile on touch devices (pixel ratio ≤ 1.25, smaller shadow map, 2× MSAA),
the camera widens automatically in portrait, and the HUD/overlays are responsive with safe-area insets
(landscape is recommended; a tip is shown in portrait).

## Mission 1 — Physical Layer

1. **Entry node** — short tutorial: move, shoot two training nodes, dash, hack the gate terminal.
2. **Switch Hall** — 3 waves (sniffers, DDoS swarm, mixed). Doors seal; clear it to open the exit + pick 1 of 3 upgrades.
3. **Patch Bay** — 3 waves: DPI probes (beam/burst), fixed turrets, swarms.
4. **Warden Cell** — elite mini-boss: energy shield → break it → damage window → shield regenerates; summons adds.
5. **Sentinel gate terminal** — unlocks the boss door.
6. **Firewall Core** — Firewall Sentinel, 3 phases: floor bombs / orb rings / novas / summons → rotating lasers →
   shield + 3 firing pylons → exposed core & enraged firewall sweeps. Death sequence + mission complete.

Dying offers *respawn at checkpoint* (room encounter resets, upgrades kept) or *restart mission*.

## Enemies

| Enemy | Role |
|-------|------|
| Sniffer | drone, chases, **scans** (cone telegraph) then lunges |
| DDoS bot | crawler swarm, weaves, overwhelms by numbers |
| DPI probe | keeps distance, telegraphed piercing beam or 3-orb burst |
| Turret node | stationary, predictive burst fire |
| Warden | elite mech with a shield / vulnerability phase |
| Sentinel | multi-part boss, telegraphed AoE, lasers, shield phase |

## Exploits (timed pickups) and upgrades (per run)

Overclock (damage + rate), Chain Lightning, Piercing Rounds, Cryo Lock (freeze), Barrier Patch (shield/repair),
Support Drone. Between rooms: damage, fire rate, max integrity, shield, dash cooldown, pierce, chain, cryo, siphon.

## Code layout

| File | Responsibility |
|------|----------------|
| `index.ts` | `mountNetTrace(host, onExit)` entry, WebGL failure fallback |
| `game.ts` | renderer, scene, lights, camera, state machine, encounters, tutorial, HUD glue |
| `world.ts` | level geometry, doors, terminals, instanced racks, void shader, holograms, lights |
| `models.ts` | procedural low-poly models (drone, crawler, probe, turret, warden, sentinel, pickups) |
| `hero.ts` | player: loads the rigged GLB astronaut + GLB rifle (`GLTFLoader`), animation state machine, rifle socket + left-hand IK, muzzle flash |
| `hero_fallback.ts` | old procedural hero, used only if the GLB files fail to load |
| `player.ts` | movement, dash, weapon, shield/HP, buffs, support drone |
| `enemy.ts`, `warden.ts`, `boss.ts` | enemy AI |
| `weapons.ts` | pooled, instanced projectiles |
| `vfx.ts` | instanced particles, beams, rings, telegraphs, afterimages, lightning, camera shake |
| `collision.ts` | circle-vs-AABB resolution, segment casts |
| `post.ts` | bloom + stylize pass (vignette, subtle chromatic aberration, grain, scanlines) |
| `ui.ts` | DOM HUD, cards, overlays, responsive/touch styles |
| `touch.ts` | on-screen sticks and buttons (pointer events) |
| `input.ts` | keyboard / mouse / touch-state abstraction, touch-device detection |
| `config.ts` | balance, level layout, waves, upgrades |

## Assets (player character and weapon)

Both files are stored locally, served from `panel/public/assets/models/` (no runtime dependency on external URLs) and loaded in `hero.ts` via `GLTFLoader` (`MODEL_URL`, `RIFLE_URL`, base path aware).

| File | What | Author | License | Source |
| --- | --- | --- | --- | --- |
| `assets/models/astronaut.glb` | Rigged, animated astronaut (skeleton with finger bones; clips Idle_Gun_Pointing, Idle_Gun_Shoot, Run, Run_Back/Left/Right, Run_Shoot, Roll, HitRecieve, Death, …) — from the *Ultimate Modular Men Pack* | Quaternius | CC0 1.0 (public domain) | https://poly.pizza/m/3hC2i0CTuO · https://quaternius.com/packs/ultimatemodularcharacters.html |
| `assets/models/scifi_rifle.glb` | Sci-fi assault rifle | Quaternius | CC0 1.0 (public domain) | https://poly.pizza/m/j40c8VDdAQ |

Notes: the models use flat PBR materials (no texture maps); the game adds emissive accents, the glowing energy cell, muzzle flash/light and recoil on top. The rifle is attached to the right wrist bone (world-aligned to the aim direction) and the left arm is solved with a two-bone IK onto the foregrip.
