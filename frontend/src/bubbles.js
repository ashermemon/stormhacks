import * as THREE from "three";
import { atmosphereUniforms } from "./atmosphere.js";
import { WATER_SURFACE_Y } from "./world.js";

// Breath bubbles: little shiny rings that wobble up through the water, swell a bit
// and pop at the surface. Fish (fish.js) and underwater otters (game.js) emit them.
// One instanced draw for all of them.
//
//   const bubbles = createBubbles(scene);
//   bubbles.emit(position, 2);     // a couple of bubbles from a mouth or nose
//   bubbles.update(dt, elapsed);   // every frame

const MAX_BUBBLES = 400;
const RISE_SPEED = [0.7, 1.2]; // units per second, slowest to fastest
const SIZE = [0.05, 0.11]; // starting radius
const LIFE = 6; // seconds, in case one never reaches the surface

const vert = /* glsl */ `
  attribute vec4 aBubble; // xyz centre, w radius
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = aBubble.xyz + (right * position.x + up * position.y) * aBubble.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform vec3 atmoSceneTint;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;
    // a bright rim, a faint fill and a little highlight up and to the left
    float rim = smoothstep(0.62, 0.82, d) * (1.0 - smoothstep(0.9, 1.0, d));
    float fill = 0.12;
    float shine = 1.0 - smoothstep(0.0, 0.22, length(p - vec2(-0.35, 0.35)));
    float a = clamp(rim + fill + shine, 0.0, 1.0);
    vec3 col = mix(vec3(0.75, 0.9, 1.0), vec3(1.0), shine) * atmoSceneTint;
    gl_FragColor = vec4(col * a, a * 0.85); // premultiplied
    #include <colorspace_fragment>
  }
`;

export function createBubbles(scene) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.attributes.position);
  geometry.setAttribute("uv", quad.attributes.uv);
  const data = new Float32Array(MAX_BUBBLES * 4);
  const attribute = new THREE.InstancedBufferAttribute(data, 4);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aBubble", attribute);
  geometry.instanceCount = 0;

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: { atmoSceneTint: atmosphereUniforms.atmoSceneTint },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }),
  );
  mesh.frustumCulled = false;
  mesh.userData.toon = false;
  scene.add(mesh);

  const live = [];
  const between = ([a, b]) => a + Math.random() * (b - a);

  return {
    /** Release `count` bubbles at `position`, a little scattered and staggered. */
    emit(position, count = 1) {
      for (let i = 0; i < count && live.length < MAX_BUBBLES; i++) {
        live.push({
          x: position.x + (Math.random() - 0.5) * 0.08,
          y: position.y - i * 0.06,
          z: position.z + (Math.random() - 0.5) * 0.08,
          rise: between(RISE_SPEED),
          size: between(SIZE),
          age: 0,
          phase: Math.random() * Math.PI * 2,
        });
      }
    },

    update(dt, elapsed) {
      let n = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const b = live[i];
        b.age += dt;
        b.y += b.rise * dt;
        b.x += Math.sin(elapsed * 4 + b.phase) * 0.12 * dt; // wobble on the way up
        b.z += Math.cos(elapsed * 3.3 + b.phase) * 0.12 * dt;
        const radius = b.size * (1 + Math.min(b.age, 3) * 0.12);
        if (b.y + radius > WATER_SURFACE_Y || b.age > LIFE) {
          live.splice(i, 1); // popped at the surface
          continue;
        }
        data.set([b.x, b.y, b.z, radius], n * 4);
        n++;
      }
      geometry.instanceCount = n;
      attribute.needsUpdate = true;
    },
  };
}
