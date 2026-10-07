// Particle morph scene + animated smoke background.
// Classic script (not a module) so the page also runs when opened straight from disk;
// three.js is pulled in with a dynamic import from the CDN.
//
// One THREE.Points cloud holds six target shapes as vertex attributes. The vertex shader blends
// between them (uMorph 0..5) with a per-particle stagger and a noise "flight" between shapes.
// Every shape is anchored to a DOM ".stage" element, so CSS decides where the 3D sits and it
// scrolls with the layout like any other element. Behind it, a low-resolution domain-warped
// smoke pass keeps the background alive, with a warm light that follows the active shape.
(function () {
  'use strict';

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
  const SHAPES = 6;

  /* ---------- Deterministic random + 3D gradient noise ---------- */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const perm = new Uint8Array(512);
  {
    const rnd = mulberry32(1337);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  function grad(h, x, y, z) {
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  function noise3(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(perm[AA] & 15, x, y, z), grad(perm[BA] & 15, x - 1, y, z), u),
        lerp(grad(perm[AB] & 15, x, y - 1, z), grad(perm[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1] & 15, x, y, z - 1), grad(perm[BA + 1] & 15, x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1] & 15, x, y - 1, z - 1), grad(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
      w);
  }
  function fbm(x, y, z, octaves = 4) {
    let amp = 0.5, freq = 1, sum = 0;
    for (let i = 0; i < octaves; i++) { sum += amp * noise3(x * freq, y * freq, z * freq); freq *= 2; amp *= 0.5; }
    return sum;
  }
  function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

  /* ---------- Shape generators: each fills N points inside a unit-radius volume ---------- */
  function gaussian(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function randomDir(rnd, out) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    out[0] = r * Math.cos(a); out[1] = z; out[2] = r * Math.sin(a);
    return out;
  }

  // 0. Ringed planet: noise continents (dense) over a sparse ocean, plus a banded ring with a gap.
  function planet(N, rnd) {
    const out = new Float32Array(N * 3);
    const d = [0, 0, 0];
    const nBody = Math.floor(N * 0.66), nHalo = Math.floor(N * 0.05);
    let i = 0;
    while (i < nBody) {
      randomDir(rnd, d);
      const h = fbm(d[0] * 1.9 + 4.1, d[1] * 1.9, d[2] * 1.9 - 2.3, 4);
      const land = h > 0.03;
      if (!land && rnd() > 0.24) continue;
      const r = 0.46 * (1 + (land ? (h - 0.03) * 0.22 : 0));
      out.set([d[0] * r, d[1] * r, d[2] * r], i * 3); i++;
    }
    for (let k = 0; k < nHalo; k++, i++) {
      randomDir(rnd, d);
      const r = 0.5 + rnd() * 0.05;
      out.set([d[0] * r, d[1] * r, d[2] * r], i * 3);
    }
    while (i < N) {
      const r = 0.64 + rnd() * 0.36;
      if (r > 0.8 && r < 0.835) continue; // ring gap
      const band = 0.55 + 0.45 * Math.sin(r * 95.0);
      if (rnd() > band) continue;
      const a = rnd() * Math.PI * 2;
      out.set([Math.cos(a) * r, gaussian(rnd) * 0.004, Math.sin(a) * r], i * 3); i++;
    }
    return out;
  }

  // 1. Game controller: sampled from the surface of a few primitives, area weighted.
  function controller(THREE, N, rnd) {
    const parts = [];
    const add = (geo, matrix, weight = 1) => parts.push({ geo, matrix, weight });
    const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
    const S = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
    const RZ = (a) => new THREE.Matrix4().makeRotationZ(a);
    const RX = (a) => new THREE.Matrix4().makeRotationX(a);

    add(new THREE.CapsuleGeometry(0.55, 1.3, 8, 28), S(1, 0.95, 0.42).multiply(RZ(Math.PI / 2)), 1);
    for (const s of [-1, 1]) {
      add(new THREE.CapsuleGeometry(0.36, 0.75, 8, 20), T(0.8 * s, -0.55, -0.02).multiply(RZ(0.5 * s)).multiply(S(1, 1, 0.48)), 1);
      add(new THREE.BoxGeometry(0.58, 0.1, 0.24), T(0.7 * s, 0.53, -0.03).multiply(RZ(-0.12 * s)), 2.2);
    }
    for (const [x, y] of [[-0.72, 0.12], [0.36, -0.3]]) {
      add(new THREE.CylinderGeometry(0.17, 0.2, 0.16, 28, 1, true), T(x, y, 0.28).multiply(RX(Math.PI / 2)), 4);
      add(new THREE.CircleGeometry(0.17, 28), T(x, y, 0.36), 4);
      add(new THREE.TorusGeometry(0.2, 0.02, 6, 32), T(x, y, 0.26), 5);
    }
    add(new THREE.BoxGeometry(0.34, 0.1, 0.07), T(-0.36, -0.3, 0.25), 5);
    add(new THREE.BoxGeometry(0.1, 0.34, 0.07), T(-0.36, -0.3, 0.25), 5);
    for (const [dx, dy] of [[0, 0.15], [0, -0.15], [0.15, 0], [-0.15, 0]]) {
      add(new THREE.SphereGeometry(0.072, 14, 10), T(0.74 + dx, 0.12 + dy, 0.25), 5);
    }
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.035, 10, 8), T(0.16 * s, 0.2, 0.24), 6);

    // Cumulative-area table over every triangle.
    const tris = []; const cum = []; let total = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (const part of parts) {
      const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
      g.applyMatrix4(part.matrix);
      const pos = g.attributes.position.array;
      for (let k = 0; k < pos.length; k += 9) {
        a.fromArray(pos, k); b.fromArray(pos, k + 3); c.fromArray(pos, k + 6);
        const area = e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() * 0.5 * part.weight;
        if (area <= 0) continue;
        total += area; cum.push(total); tris.push(pos, k);
      }
      part.geo.dispose();
    }
    const out = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const target = rnd() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
      const pos = tris[lo * 2], k = tris[lo * 2 + 1];
      let u = rnd(), v = rnd();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      for (let j = 0; j < 3; j++) {
        const p0 = pos[k + j];
        out[i * 3 + j] = (p0 + u * (pos[k + 3 + j] - p0) + v * (pos[k + 6 + j] - p0)) / 1.3;
      }
    }
    return out;
  }

  // 2. Level island: topographic contour lines rising out of a dotted editor grid.
  function island(N, rnd) {
    const out = new Float32Array(N * 3);
    const steps = 11, grid = 0.055;
    const height = (x, z) => {
      const r = Math.hypot(x, z);
      const mask = 1 - smooth(0.25, 0.95, r);
      return Math.max(0, fbm(x * 1.7 + 7.3, 1.7, z * 1.7 - 1.1, 4) * 1.5 + 0.32) * mask;
    };
    let i = 0;
    while (i < N) {
      const x = rnd() * 2 - 1, z = rnd() * 2 - 1;
      const r = Math.hypot(x, z);
      if (r > 1) continue;
      const h = height(x, z);
      if (h < 0.03) {
        // Sea level: a sparse dotted grid that fades toward the rim.
        if (rnd() > 0.32 * (1 - r * 0.6)) continue;
        out.set([Math.round(x / grid) * grid, 0, Math.round(z / grid) * grid], i * 3); i++; continue;
      }
      // Keep points that sit on a contour line, plus a light fill between lines.
      const f = (h * steps) % 1;
      if (!(f < 0.14 || f > 0.96) && rnd() > 0.06) continue;
      out.set([x, (Math.round(h * steps) / steps) * 0.55, z], i * 3); i++;
    }
    return out;
  }

  // 3. Voxel lattice: a 4x4x4 wireframe grid with a few highlighted voxels and bright nodes.
  function lattice(N, rnd) {
    const out = new Float32Array(N * 3);
    const n = 4, half = 0.6, step = (half * 2) / n;
    const lines = [];
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) lines.push([axis, i, j]);
    }
    const filled = [[1, 2, 1], [2, 2, 2], [2, 1, 1], [0, 3, 2], [3, 0, 3], [1, 1, 3]];
    for (let p = 0; p < N; p++) {
      const roll = rnd();
      let x, y, z;
      if (roll < 0.72) {
        const [axis, i, j] = lines[Math.floor(rnd() * lines.length)];
        const t = rnd() * 2 * half - half, u = -half + i * step, v = -half + j * step;
        [x, y, z] = axis === 0 ? [t, u, v] : axis === 1 ? [u, t, v] : [u, v, t];
      } else if (roll < 0.9) {
        const [cx, cy, cz] = filled[Math.floor(rnd() * filled.length)];
        const face = Math.floor(rnd() * 6);
        const o = [-half + cx * step, -half + cy * step, -half + cz * step];
        const axis = face % 3, side = face < 3 ? 0 : step;
        const pt = [0, 0, 0];
        pt[axis] = side; pt[(axis + 1) % 3] = rnd() * step; pt[(axis + 2) % 3] = rnd() * step;
        x = o[0] + pt[0]; y = o[1] + pt[1]; z = o[2] + pt[2];
      } else {
        const i = Math.floor(rnd() * (n + 1)), j = Math.floor(rnd() * (n + 1)), k = Math.floor(rnd() * (n + 1));
        x = -half + i * step + gaussian(rnd) * 0.012;
        y = -half + j * step + gaussian(rnd) * 0.012;
        z = -half + k * step + gaussian(rnd) * 0.012;
      }
      out[p * 3] = x; out[p * 3 + 1] = y; out[p * 3 + 2] = z;
    }
    return out;
  }

  // 4. Double helix: the career timeline, two strands with rungs and light dust.
  function helix(N, rnd) {
    const out = new Float32Array(N * 3);
    const R = 0.3, turns = 2.4, rungs = 30;
    for (let p = 0; p < N; p++) {
      const roll = rnd();
      let x, y, z;
      if (roll < 0.62) {
        y = rnd() * 2 - 1;
        const a = y * Math.PI * turns + (rnd() < 0.5 ? 0 : Math.PI);
        const j = gaussian(rnd) * 0.014;
        x = Math.cos(a) * (R + j); z = Math.sin(a) * (R + j);
      } else if (roll < 0.9) {
        const k = Math.floor(rnd() * rungs);
        y = -1 + ((k + 0.5) / rungs) * 2;
        const a = y * Math.PI * turns, t = rnd() * 2 - 1;
        x = Math.cos(a) * R * t; z = Math.sin(a) * R * t;
      } else {
        y = rnd() * 2.1 - 1.05;
        const a = rnd() * Math.PI * 2, r = R + 0.05 + rnd() * 0.3;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      }
      out[p * 3] = x; out[p * 3 + 1] = y; out[p * 3 + 2] = z;
    }
    return out;
  }

  // 5. Warp gate: a bright ring (radius 1) facing the camera, with spiral arms streaming outward.
  function gate(N, rnd) {
    const out = new Float32Array(N * 3);
    for (let p = 0; p < N; p++) {
      const roll = rnd();
      let x, y, z;
      if (roll < 0.46) {
        const a = rnd() * Math.PI * 2, r = 1 + gaussian(rnd) * 0.012;
        x = Math.cos(a) * r; y = Math.sin(a) * r; z = gaussian(rnd) * 0.015;
      } else if (roll < 0.58) {
        const a = rnd() * Math.PI * 2, r = 0.9 + rnd() * 0.08;
        x = Math.cos(a) * r; y = Math.sin(a) * r; z = gaussian(rnd) * 0.02;
      } else {
        const arm = Math.floor(rnd() * 4);
        const r = 1.03 + Math.pow(rnd(), 1.6) * 0.8;
        const a = arm * (Math.PI / 2) + (r - 1) * 2.6 + gaussian(rnd) * 0.12 * (r - 0.85);
        x = Math.cos(a) * r; y = Math.sin(a) * r; z = gaussian(rnd) * 0.03;
      }
      out[p * 3] = x; out[p * 3 + 1] = y; out[p * 3 + 2] = z;
    }
    return out;
  }

  /* ---------- Shaders ---------- */
  const NOISE_GLSL = /* glsl */`
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }`;

  const VERT = /* glsl */`
  uniform float uTime;
  uniform float uMorph;
  uniform float uIntro;
  uniform float uSize;
  uniform float uPR;
  uniform float uChaos;
  uniform mat4 uXf[${SHAPES}];
  uniform vec3 uMouse;
  attribute vec3 aP1;
  attribute vec3 aP2;
  attribute vec3 aP3;
  attribute vec3 aP4;
  attribute vec3 aP5;
  attribute vec4 aRnd;
  varying float vAlpha;
  varying float vAccent;
  ${NOISE_GLSL}
  float seg(float m, float i, float r){
    float x = clamp((m - i) * 1.8 - r * 0.8, 0.0, 1.0);
    return x * x * (3.0 - 2.0 * x);
  }
  void main(){
    vec3 p0 = (uXf[0] * vec4(position, 1.0)).xyz;
    vec3 p1 = (uXf[1] * vec4(aP1, 1.0)).xyz;
    vec3 p2 = (uXf[2] * vec4(aP2, 1.0)).xyz;
    vec3 p3 = (uXf[3] * vec4(aP3, 1.0)).xyz;
    vec3 p4 = (uXf[4] * vec4(aP4, 1.0)).xyz;
    vec3 p5 = (uXf[5] * vec4(aP5, 1.0)).xyz;

    float r = aRnd.x;
    float t1 = seg(uMorph, 0.0, r), t2 = seg(uMorph, 1.0, r), t3 = seg(uMorph, 2.0, r);
    float t4 = seg(uMorph, 3.0, r), t5 = seg(uMorph, 4.0, r);
    vec3 p = mix(p0, p1, t1);
    p = mix(p, p2, t2); p = mix(p, p3, t3); p = mix(p, p4, t4); p = mix(p, p5, t5);
    float travel = 4.0 * (t1*(1.0-t1) + t2*(1.0-t2) + t3*(1.0-t3) + t4*(1.0-t4) + t5*(1.0-t5));

    // Load-in: particles converge from a wide scatter.
    float ti = clamp(uIntro * 1.7 - aRnd.w * 0.7, 0.0, 1.0);
    ti = 1.0 - pow(1.0 - ti, 3.0);
    vec3 scatter = (aRnd.xyz - 0.5) * vec3(26.0, 16.0, 12.0);
    p = mix(scatter, p, ti);

    float flow = (travel + (1.0 - ti)) * uChaos;
    vec3 q = p * 0.35 + vec3(0.0, uTime * 0.12, aRnd.y * 4.0);
    vec3 n = vec3(snoise(q), snoise(q + vec3(19.1, 7.3, 3.7)), snoise(q + vec3(5.2, 31.4, 11.8)));
    p += n * (0.012 * uChaos + flow * 0.85);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec2 d = mv.xy - uMouse.xy;
    float dl = length(d);
    float push = (1.0 - smoothstep(0.0, 1.15, dl)) * uMouse.z;
    mv.xy += (d / (dl + 1e-4)) * push * 0.32;
    gl_Position = projectionMatrix * mv;

    float big = step(0.993, aRnd.y);
    float s = (0.5 + aRnd.z * aRnd.z * 1.15) * (1.0 + big * 2.4);
    gl_PointSize = uSize * s * uPR / -mv.z;

    float tw = 0.72 + 0.28 * sin(uTime * 1.6 + aRnd.w * 50.0);
    vAlpha = (0.3 + 0.7 * aRnd.w) * tw * mix(1.0, 0.4, big) * (0.45 + 0.55 * ti) + push * 0.35;
    vAccent = step(0.86, fract(aRnd.y * 7.31));
  }`;

  const FRAG = /* glsl */`
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vAccent;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    gl_FragColor = vec4(mix(uColA, uColB, vAccent), a * vAlpha * uOpacity);
  }`;

  const DUST_VERT = /* glsl */`
  uniform float uTime;
  uniform float uScroll;
  uniform float uPR;
  attribute float aSeed;
  varying float vA;
  void main(){
    vec3 p = position;
    p.y = mod(p.y + uTime * 0.04 + uScroll * (0.6 + aSeed) + 9.0, 18.0) - 9.0;
    p.x += sin(uTime * 0.2 + aSeed * 30.0) * 0.15;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (6.0 + aSeed * 14.0) * uPR / -mv.z;
    vA = 0.12 + aSeed * 0.3;
  }`;
  const DUST_FRAG = /* glsl */`
  varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vec3(0.93, 0.91, 0.87), smoothstep(0.5, 0.0, d) * vA);
  }`;

  // Full-screen quads write clip space directly.
  const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  // Domain-warped smoke, rendered at a third of the screen size and upscaled (it is soft anyway).
  const SMOKE_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uScroll;
  uniform float uIntro;
  uniform vec2 uRes;
  uniform vec2 uGlow;
  uniform float uGlowR;
  uniform vec2 uMouse;
  varying vec2 vUv;
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = rot * p * 2.03; a *= 0.5; }
    return v;
  }
  void main(){
    float aspect = uRes.x / uRes.y;
    vec2 uv = vUv;
    vec2 p = vec2(uv.x * aspect, uv.y) * 1.7 + vec2(0.0, -uScroll * 0.35);
    float t = uTime * 0.045;
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
    vec2 r = vec2(fbm(p + 3.6 * q + vec2(1.7, 9.2) + t * 1.4), fbm(p + 3.6 * q + vec2(8.3, 2.8) - t * 1.1));
    float f = fbm(p + 3.2 * r);

    vec3 col = vec3(0.036, 0.036, 0.04);
    float smoke = smoothstep(0.38, 0.92, f);
    col = mix(col, vec3(0.115, 0.118, 0.135), smoke * 0.85);
    col += vec3(0.07, 0.065, 0.06) * pow(clamp(length(r) - 0.55, 0.0, 1.0), 2.0);

    // Warm light behind the active shape.
    vec2 dg = (uv - uGlow) * vec2(aspect, 1.0);
    float g = exp(-dot(dg, dg) / (uGlowR * uGlowR));
    col += vec3(1.0, 0.42, 0.24) * g * (0.035 + 0.12 * smoke) * uIntro;
    col += vec3(1.0, 0.55, 0.35) * g * g * 0.025 * uIntro;

    // Cool light that follows the pointer.
    vec2 dm = (uv - uMouse) * vec2(aspect, 1.0);
    col += vec3(0.6, 0.66, 0.8) * exp(-dot(dm, dm) * 7.0) * (0.02 + 0.06 * smoke);

    gl_FragColor = vec4(col, 1.0);
  }`;

  const COMPOSITE_FRAG = /* glsl */`
  uniform sampler2D tBg;
  uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec3 col = texture2D(tBg, vUv).rgb;
    col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 160.0; // dither out banding
    gl_FragColor = vec4(col, 1.0);
  }`;

  /* ---------- Scene ---------- */
  function build(THREE, canvas, { reduced = false, stages = [] } = {}) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    } catch (err) {
      return null;
    }
    if (!renderer.getContext()) return null;

    const small = window.matchMedia('(max-width: 860px)').matches;
    const COUNT = small ? 9000 : 18000;
    const pr = Math.min(window.devicePixelRatio || 1, small ? 2 : 1.75);
    renderer.setPixelRatio(pr);
    renderer.setClearColor(0x0a0a0b, 1);

    const scene = new THREE.Scene();
    const FOV = 35, CAM_Z = 9;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
    camera.position.set(0, 0, CAM_Z);
    const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

    /* ----- Background smoke (low-res target, composited first) ----- */
    const bgTarget = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
    const smokeUniforms = {
      uTime: { value: 0 }, uScroll: { value: 0 }, uIntro: { value: reduced ? 1 : 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uGlow: { value: new THREE.Vector2(0.7, 0.5) }, uGlowR: { value: 0.35 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    };
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const smokeScene = new THREE.Scene();
    const smokeQuad = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
      uniforms: smokeUniforms, vertexShader: QUAD_VERT, fragmentShader: SMOKE_FRAG, depthTest: false, depthWrite: false,
    }));
    smokeQuad.frustumCulled = false;
    smokeScene.add(smokeQuad);

    const compositeUniforms = { tBg: { value: bgTarget.texture }, uTime: { value: 0 } };
    const bgQuad = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
      uniforms: compositeUniforms, vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    }));
    bgQuad.frustumCulled = false;
    bgQuad.renderOrder = -1;
    scene.add(bgQuad);

    /* ----- Particles ----- */
    const rnd = mulberry32(2017);
    const shapes = [
      planet(COUNT, rnd), controller(THREE, COUNT, rnd), island(COUNT, rnd),
      lattice(COUNT, rnd), helix(COUNT, rnd), gate(COUNT, rnd),
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(shapes[0], 3));
    for (let i = 1; i < SHAPES; i++) geometry.setAttribute(`aP${i}`, new THREE.BufferAttribute(shapes[i], 3));
    const rands = new Float32Array(COUNT * 4);
    for (let i = 0; i < rands.length; i++) rands[i] = rnd();
    geometry.setAttribute('aRnd', new THREE.BufferAttribute(rands, 4));

    const xf = Array.from({ length: SHAPES }, () => new THREE.Matrix4());
    const uniforms = {
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uIntro: { value: reduced ? 1 : 0 },
      uSize: { value: small ? 19 : 23 },
      uPR: { value: pr },
      uChaos: { value: reduced ? 0 : 1 },
      uXf: { value: xf },
      uMouse: { value: new THREE.Vector3(0, 0, 0) },
      uColA: { value: new THREE.Color(0.93, 0.91, 0.87) },
      uColB: { value: new THREE.Color(1.0, 0.416, 0.239) },
      uOpacity: { value: 1 },
    };
    const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    points.frustumCulled = false;
    scene.add(points);

    // Slow foreground dust for depth.
    const DUST = small ? 220 : 480;
    const dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (rnd() - 0.5) * 18;
      dustPos[i * 3 + 1] = (rnd() - 0.5) * 18;
      dustPos[i * 3 + 2] = (rnd() - 0.5) * 8;
      dustSeed[i] = rnd();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
    const dustUniforms = { uTime: { value: 0 }, uScroll: { value: 0 }, uPR: { value: pr } };
    const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
      uniforms: dustUniforms, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    dust.frustumCulled = false;
    scene.add(dust);

    /* ----- Layout: DOM stage rect -> world transform ----- */
    let W = 1, H = 1;
    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      bgTarget.setSize(Math.ceil(W / 3), Math.ceil(H / 3));
      smokeUniforms.uRes.value.set(W, H);
    }
    resize();
    window.addEventListener('resize', resize);

    const tmpT = new THREE.Matrix4(), tmpS = new THREE.Matrix4(), tmpR = new THREE.Matrix4(), tmpA = new THREE.Matrix4();
    const placed = Array.from({ length: SHAPES }, () => ({ x: 0, y: 0, s: 1 }));
    function place(i) {
      const el = stages[i];
      const out = placed[i];
      if (!el) return out;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return out;
      const halfH = halfTan * CAM_Z;
      out.x = ((r.left + r.width / 2) / W * 2 - 1) * halfH * (W / H);
      out.y = -((r.top + r.height / 2) / H * 2 - 1) * halfH;
      const size = el.dataset.scaleMode === 'width' ? r.width : Math.min(r.width, r.height);
      out.s = (size / H) * halfH * (parseFloat(el.dataset.scale) || 1);
      return out;
    }

    // Per-shape rotation, composed right-to-left: base pose then spin.
    function rotation(i, t, px, py) {
      tmpR.identity();
      const rx = (a) => tmpR.multiply(tmpA.makeRotationX(a));
      const ry = (a) => tmpR.multiply(tmpA.makeRotationY(a));
      const rz = (a) => tmpR.multiply(tmpA.makeRotationZ(a));
      rx(py * 0.18); ry(px * 0.28);
      switch (i) {
        case 0: rx(0.42); rz(-0.32); ry(t * 0.12); break;
        case 1: rx(-0.5 + Math.sin(t * 0.5) * 0.06); ry(Math.sin(t * 0.33) * 0.4); rz(Math.sin(t * 0.41) * 0.05); break;
        case 2: rx(0.62); ry(t * 0.05); break;
        case 3: rx(0.5); ry(t * 0.2 + 0.4); break;
        case 4: rz(0.22); ry(t * 0.45); break;
        case 5: rx(-0.12); ry(0.18); rz(-t * 0.16); break;
      }
      return tmpR;
    }

    /* ----- State ----- */
    const state = { morphTarget: 0, morph: 0, intro: uniforms.uIntro.value, scroll: 0 };
    const pointer = { x: 0, y: 0, sx: 0, sy: 0, on: 0, son: 0 };
    const glow = { x: 0.7, y: 0.5, r: 0.35 };

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') { pointer.on = 0; return; }
      pointer.x = (e.clientX / W) * 2 - 1;
      pointer.y = -((e.clientY / H) * 2 - 1);
      pointer.on = 1;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { pointer.on = 0; });

    const clock = new THREE.Clock();
    let time = 0;
    function frame() {
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!reduced) time += dt;
      const k = (rate) => 1 - Math.exp(-dt * rate);

      state.morph = reduced ? state.morphTarget : state.morph + (state.morphTarget - state.morph) * k(4.5);
      pointer.sx += (pointer.x - pointer.sx) * k(4);
      pointer.sy += (pointer.y - pointer.sy) * k(4);
      pointer.son += (pointer.on - pointer.son) * k(3);

      const tilt = reduced ? 0 : 1;
      for (let i = 0; i < SHAPES; i++) {
        const pl = place(i);
        tmpT.makeTranslation(pl.x, pl.y, 0);
        tmpS.makeScale(pl.s, pl.s, pl.s);
        xf[i].copy(tmpT).multiply(tmpS).multiply(rotation(i, time, pointer.sx * tilt, pointer.sy * tilt));
      }

      // Light follows the shape the particles are currently forming.
      const halfH = halfTan * CAM_Z;
      const i0 = Math.min(SHAPES - 1, Math.floor(state.morph));
      const i1 = Math.min(SHAPES - 1, i0 + 1);
      const f = state.morph - i0;
      const gx = lerp(placed[i0].x, placed[i1].x, f), gy = lerp(placed[i0].y, placed[i1].y, f);
      const gs = lerp(placed[i0].s, placed[i1].s, f);
      glow.x = (gx / (halfH * (W / H)) + 1) / 2;
      glow.y = (gy / halfH + 1) / 2;
      glow.r = Math.min(0.6, Math.max(0.2, gs / (2 * halfH) * 0.95));

      smokeUniforms.uTime.value = time;
      smokeUniforms.uScroll.value = state.scroll / H;
      smokeUniforms.uIntro.value = state.intro;
      smokeUniforms.uGlow.value.set(glow.x, glow.y);
      smokeUniforms.uGlowR.value = glow.r;
      smokeUniforms.uMouse.value.set((pointer.sx + 1) / 2, (pointer.sy + 1) / 2);
      compositeUniforms.uTime.value = time;

      uniforms.uMouse.value.set(pointer.sx * halfH * (W / H), pointer.sy * halfH, reduced ? 0 : pointer.son);
      uniforms.uTime.value = time;
      uniforms.uMorph.value = state.morph;
      uniforms.uIntro.value = state.intro;
      dustUniforms.uTime.value = time;
      dustUniforms.uScroll.value = state.scroll / H * 2.4;

      renderer.setRenderTarget(bgTarget);
      renderer.render(smokeScene, camera);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }

    let running = false;
    function start() { if (!running) { running = true; clock.getDelta(); renderer.setAnimationLoop(frame); } }
    function stop() { running = false; renderer.setAnimationLoop(null); }
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    start();

    return {
      setMorph(v) { state.morphTarget = Math.max(0, Math.min(SHAPES - 1, v)); },
      setIntro(v) { state.intro = v; },
      setScroll(y) { state.scroll = y; },
    };
  }

  window.PortfolioScene = {
    async create(canvas, opts) {
      const THREE = await import(THREE_URL);
      return build(THREE, canvas, opts);
    },
  };
})();
