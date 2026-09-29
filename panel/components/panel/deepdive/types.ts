import type * as THREE from "three";
import type { Game } from "./game";

export interface Hittable {
  pos: THREE.Vector3;
  radius: number;
  dead: boolean;
}

export type Ctx = Game;
