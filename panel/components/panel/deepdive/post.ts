import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const StylizeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    damage: { value: 0 },
    aberration: { value: 0 },
    flash: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float damage;
    uniform float aberration;
    uniform float flash;
    uniform vec2 resolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      // moderate chromatic aberration, stronger toward the edges and on impacts
      vec2 off = c * (0.0011 + aberration * 0.006 + damage * 0.004) * (0.4 + d * 3.0);
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      // very light scanlines
      col *= 0.965 + 0.035 * sin(vUv.y * resolution.y * 1.15 + time * 2.0);
      // vignette
      float vig = smoothstep(0.85, 0.2, length(c) * 1.15);
      col *= mix(0.55, 1.0, vig);
      // damage tint
      col = mix(col, col * vec3(1.5, 0.45, 0.5), damage * smoothstep(0.15, 0.75, length(c) * 1.4));
      col += flash * vec3(1.0, 0.85, 0.7);
      // film grain
      float n = hash(vUv * resolution + fract(time) * 91.0);
      col += (n - 0.5) * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface Post {
  composer: EffectComposer;
  stylize: ShaderPass;
  bloom: UnrealBloomPass;
  setSize: (w: number, h: number, pr: number) => void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, samples = 4): Post {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 0.95);
  composer.addPass(bloom);
  const stylize = new ShaderPass(StylizeShader);
  composer.addPass(stylize);
  composer.addPass(new OutputPass());
  const setSize = (nw: number, nh: number, pr: number) => {
    composer.setPixelRatio(pr);
    composer.setSize(nw, nh);
    stylize.uniforms.resolution.value.set(nw * pr, nh * pr);
  };
  setSize(w, h, renderer.getPixelRatio());
  return { composer, stylize, bloom, setSize };
}
