// The neuron. Shape: a real dopamine cell from the substantia nigra of a mouse, traced under a
// microscope (NeuroMorpho.Org, Henny archive, MYUX58R; Meza et al., J. Neurosci. 38, 733, 2018).
// Branch paths and relative thickness are real; thickness is exaggerated and small bumps are added
// (research/neuron_shape.py). Each key sends one pulse from the body. Holds far from the person's
// own middle leave late, turn coral and fade. Nothing here affects timing or scoring.
import * as T from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clamp, lerp, reduced, rng } from './util';

export type View = 'home' | 'type' | 'result' | 'page';
export interface Scene {
  view(v: View): void;
  /** where the home flight is, 0 to 3 */
  fly(p: number): void;
  send(dev: number, hold: number): void;
  launch(dev: number, hold: number): void;
  clear(): void;
  tick: (t: number, dt: number) => void;
}
const BG = 0x062c36;
async function load(url: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(url);
  const b = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const [nv, nf] = new Uint32Array(b, 0, 2), [ext, far] = new Float32Array(b, 8, 2), u = new Uint8Array(b, 16);
  let o = 0;
  const plane = (n: number) => { const a = u.subarray(o, o + n); o += n; return a; }, zz = (v: number) => (v >>> 1) ^ -(v & 1);
  const pos = new Int16Array(nv * 3), nor = new Int8Array(nv * 3), d = new Uint16Array(nv), idx = new Uint32Array(nf * 3);
  for (let c = 0; c < 3; c++) { const lo = plane(nv), hi = plane(nv); for (let i = 0, v = 0; i < nv; i++) { v += zz(lo[i] | (hi[i] << 8)); pos[i * 3 + c] = v; } }
  for (let c = 0; c < 3; c++) { const p = plane(nv); for (let i = 0; i < nv; i++) nor[i * 3 + c] = p[i]; }
  { const lo = plane(nv), hi = plane(nv); for (let i = 0, v = 0; i < nv; i++) { v += zz(lo[i] | (hi[i] << 8)); d[i] = v; } }
  const ao = plane(nv).slice(), rl = plane(nv).slice();
  { const n = nf * 3, p0 = plane(n), p1 = plane(n), p2 = plane(n); for (let i = 0, v = 0; i < n; i++) { v += zz(p0[i] | (p1[i] << 8) | (p2[i] << 16)); idx[i] = v; } }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3, true)); g.setAttribute('normal', new T.BufferAttribute(nor, 3, true)); g.setAttribute('d', new T.BufferAttribute(d, 1, true)); g.setAttribute('ao', new T.BufferAttribute(ao, 1, true)); g.setAttribute('rl', new T.BufferAttribute(rl, 1, true));
  g.setIndex(new T.BufferAttribute(idx, 1)); g.boundingSphere = new T.Sphere(new T.Vector3(), 2);
  return { g, scale: ext / 10, far: far / 10 }; // ten micrometres to one unit
}
/** tiling noise with its slope, baked once so the skin stays cheap to draw */
function noise3() {
  const n = 64, P = 8, R = rng(99), G = Array.from({ length: P ** 3 }, () => new T.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize()), v = new Float32Array(n ** 3), f = new Uint16Array(n ** 3 * 4), q = (x: number) => x * x * x * (x * (x * 6 - 15) + 10), H = T.DataUtils.toHalfFloat;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const X = (x / n) * P, Y = (y / n) * P, Z = (z / n) * P, i = X | 0, j = Y | 0, k = Z | 0, a = X - i, b = Y - j, c = Z - k, u = q(a), w = q(b), s = q(c); let r = 0; for (let m = 0; m < 8; m++) { const o = m & 1, p = (m >> 1) & 1, l = m >> 2, g = G[((i + o) % P) + ((j + p) % P) * P + ((k + l) % P) * P * P]; r += (g.x * (a - o) + g.y * (b - p) + g.z * (c - l)) * (o ? u : 1 - u) * (p ? w : 1 - w) * (l ? s : 1 - s); } v[x + y * n + z * n * n] = r; }
  const at = (x: number, y: number, z: number) => v[((x + n) % n) + ((y + n) % n) * n + ((z + n) % n) * n * n], e = n / P / 2;
  for (let z = 0, o = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, o += 4) { f[o] = H((at(x + 1, y, z) - at(x - 1, y, z)) * e); f[o + 1] = H((at(x, y + 1, z) - at(x, y - 1, z)) * e); f[o + 2] = H((at(x, y, z + 1) - at(x, y, z - 1)) * e); f[o + 3] = H(at(x, y, z)); }
  const t = new T.Data3DTexture(f, n, n, n); t.format = T.RGBAFormat; t.type = T.HalfFloatType; t.minFilter = t.magFilter = T.LinearFilter; t.wrapS = t.wrapT = t.wrapR = T.RepeatWrapping; t.needsUpdate = true; return t;
}
/** depth of field and a little lens: sharp at the body, soft in front and behind */
class Lens extends Pass {
  q = new FullScreenQuad(); mat: T.ShaderMaterial;
  constructor(depth: T.DepthTexture, cam: T.PerspectiveCamera, taps: number) {
    super();
    this.mat = new T.ShaderMaterial({ defines: { TAPS: taps }, uniforms: { tex: { value: null }, dep: { value: depth }, nf: { value: new T.Vector2(cam.near, cam.far) }, focus: { value: 12 }, px: { value: new T.Vector2() }, amt: { value: 1 }, t: { value: 0 } },
      vertexShader: 'varying vec2 u;void main(){u=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D tex,dep;uniform vec2 nf,px;uniform float focus,amt,t;varying vec2 u;
      float z(vec2 p){float d=texture2D(dep,p).x;return nf.x*nf.y/(nf.y-d*(nf.y-nf.x));}
      float coc(float d){return clamp((d-focus)/d*amt,-1.,1.);}
      void main(){float zc=z(u),c0=coc(zc);float R=16.;vec3 s=texture2D(tex,u).rgb;float w=1.;float a=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))*.5;
      for(int i=0;i<TAPS;i++){float r=sqrt((float(i)+.5)/float(TAPS));a+=2.39996;vec2 p=u+vec2(cos(a),sin(a))*r*R*px;float zi=z(p),ci=abs(coc(zi));if(zi>zc+.2)ci=min(ci,abs(c0)*1.3+.02);float k=zi<zc-.25?smoothstep(r,r+.12,ci):smoothstep(r-.3,r+.15,ci);vec3 v=texture2D(tex,p).rgb;s+=v*k*(1.+dot(v,vec3(.5)));w+=k*(1.+dot(v,vec3(.5)));}
      s/=w;vec2 q=u-.5;s*=1.-dot(q,q)*.55;s+=(fract(sin(dot(u*913.+t,vec2(12.9898,78.233)))*43758.5453)-.5)*.006;gl_FragColor=vec4(max(s,0.),1.);}` });
    this.q.material = this.mat;
  }
  setSize(w: number, h: number) { this.mat.uniforms.px.value.set(1 / w, 1 / h).multiplyScalar(h / 900); }
  render(r: T.WebGLRenderer, wb: T.WebGLRenderTarget, rb: T.WebGLRenderTarget) { this.mat.uniforms.tex.value = rb.texture; r.setRenderTarget(this.renderToScreen ? null : wb); this.q.render(r); }
}
class Draw extends Pass {
  constructor(public scene: T.Scene, public cam: T.Camera, public rt: T.WebGLRenderTarget, public copy: FullScreenQuad) { super(); this.needsSwap = true; }
  setSize(w: number, h: number) { this.rt.setSize(w, h); }
  render(r: T.WebGLRenderer, wb: T.WebGLRenderTarget) { r.setRenderTarget(this.rt); r.clear(); r.render(this.scene, this.cam); (this.copy.material as T.ShaderMaterial).uniforms.tex.value = this.rt.texture; r.setRenderTarget(wb); this.copy.render(r); }
}

export function createScene(stage: HTMLElement): Scene {
    const small = innerWidth < 800, r = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); stage.append(r.domElement);
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.12; r.shadowMap.enabled = true; r.shadowMap.type = T.PCFShadowMap;
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(34, 1, 1, 90), R = rng(21); scene.background = new T.Color(BG); scene.fog = new T.FogExp2(BG, 0.030);
    // soft boxes to reflect: a cold window above, a warm one low on the left
    { const e = new T.Scene(), box = (c: number, i: number, p: number[], s: number[]) => { const m = new T.Mesh(new T.BoxGeometry(s[0], s[1], s[2]), new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(i) })); m.position.set(p[0], p[1], p[2]); m.lookAt(0, 0, 0); e.add(m); }; e.background = new T.Color(0x04181d); box(0xbfe8ee, 9, [-3, 8, 4], [7, 4, 0.1]); box(0x7fe6da, 3, [-8, -3, 2], [2, 5, 0.1]); box(0x2fb6b0, 4, [8, 1, -5], [4, 8, 0.1]); box(0xffffff, 12, [5, 5, 6], [1.2, 1.2, 0.1]); const pm = new T.PMREMGenerator(r); scene.environment = pm.fromScene(e, 0.03).texture; scene.environmentIntensity = 0.55; }
    const sun = new T.DirectionalLight(0xdff6ff, 2.6); sun.position.set(-7, 14, 9); sun.castShadow = true; sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048); Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 45 }); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4; scene.add(sun); r.shadowMap.autoUpdate = false;
    const back = new T.DirectionalLight(0x35d6c6, 1.9); back.position.set(9, 3, -10); scene.add(back); const warm = new T.DirectionalLight(0x3fb8c4, 0.8); warm.position.set(-9, -6, 5); scene.add(warm);

    const NP = 24, pulses = Array.from({ length: NP }, () => new T.Vector4(-9, 0, 0, 0)), U = { t: { value: 0 }, pu: { value: pulses }, far: { value: 30 }, live: { value: 0 }, n3: { value: noise3() } };
    const glowGLSL = `uniform float t;uniform vec4 pu[${NP}];uniform int live;
      vec3 glow(float d){vec3 s=vec3(0.);for(int i=0;i<${NP};i++){if(i>=live)break;vec4 p=pu[i];float q=d-p.x;float tail=q<0.?exp(q*p.y):exp(-q*q*26.);float a=tail*1.15*step(.01,p.y)*exp(-max(0.,p.x)*p.w);s.r+=a*p.z;s.g+=a*(1.-p.z);}return s;}`;
    const skin = (distant: boolean) => {
      const m = new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, clearcoat: distant ? 0 : 0.3, clearcoatRoughness: 0.3 });
      m.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, U);
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float d,ao,rl;uniform float far;varying float vA,vR;varying vec3 vP,vNw,vG;' + glowGLSL).replace('#include <begin_vertex>', '#include <begin_vertex>\nvG=' + (distant ? 'vec3(0.)' : 'glow(d*far)') + ';vA=ao;vR=rl;').replace('#include <project_vertex>', '#include <project_vertex>\nvP=(modelMatrix*vec4(transformed,1.)).xyz;vNw=normalize(mat3(modelMatrix)*objectNormal);');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vA,vR;varying vec3 vP,vNw,vG;uniform float t;
          uniform sampler3D n3;vec4 nz(vec3 p){return texture(n3,p/8.);}`)
          .replace('#include <map_fragment>', `
          float cav=clamp(1.-vA,0.,1.);vec4 n1=nz(vP*1.1+2.),n2=nz(vP.yzx*4.+1.);float body=smoothstep(1.9,.5,length(vP));
          // one hue, light to dark
          vec3 base=mix(vec3(.012,.135,.160),vec3(.040,.330,.345),smoothstep(-.4,.45,n1.a*.7+n2.a*.3));
          base=mix(base,vec3(.004,.050,.064),smoothstep(.12,.7,cav)*.85);base=mix(base,vec3(.09,.47,.46),body*.28);
          float hot=smoothstep(.06,.42,vG.r);base=mix(base,vec3(.20,.018,.012),hot*.92);diffuseColor.rgb=base;`)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          ${distant ? '' : `{vec3 nw=normalize(vNw+1e-5);vec3 gd=n1.rgb*.12+nz(vP*3.4).rgb*.13+nz(vP.yzx*8.+4.).brg*.085;gd-=nw*dot(gd,nw);normal=normalize((viewMatrix*vec4(normalize(nw-gd),0.)).xyz);}`}`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=clamp(.46+.14*n2.a+cav*.25,.2,.95);')
          .replace('#include <aomap_fragment>', `float aoV=mix(.16,1.,pow(clamp(vA,0.,1.),1.25));reflectedLight.indirectDiffuse*=aoV;reflectedLight.indirectSpecular*=aoV;reflectedLight.directDiffuse*=mix(.42,1.,vA);reflectedLight.directSpecular*=mix(.3,1.,vA);
          // light leaking through thin parts and glowing along every edge
          vec3 vv=normalize(cameraPosition-vP);vec3 ng=normalize(vNw+1e-5);float thin=1.-smoothstep(0.,.45,vR);float fr=1.-clamp(dot(normalize(mix(ng,(inverse(viewMatrix)*vec4(normal,0.)).xyz,.6)),vv),0.,1.);
          reflectedLight.directDiffuse+=(1.-hot*.96)*mix(.45,1.,vA)*(vec3(.10,.86,.80)*pow(fr,2.6)*.62+vec3(.02,.30,.31)*thin*.34+vec3(.015,.16,.17)*pow(fr,1.2));`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {vec3 g=vG;vec3 vv=normalize(cameraPosition-vP);float f=pow(1.-clamp(dot(normalize(vNw+1e-5),vv),0.,1.),1.6);float vein=.7+.7*nz(vP*6.+vec3(0.,t*.4,0.)).a;vec3 em=vec3(.10,.95,.72)*g.g*(1.-hot)+vec3(1.5,.13,.045)*g.r;totalEmissiveRadiance+=em*vein*(${distant ? '.10' : '.34'}+f*${distant ? '.2' : '1.05'})*mix(.55,1.,vA);}`);
      };
      m.customProgramCacheKey = () => 'n' + distant; return m;
    };
    const world = new T.Group(); scene.add(world); let cell: T.Mesh | null = null, far = 30;
    load('/neuron.dat').then(({ g, scale, far: f }) => { cell = new T.Mesh(g, skin(false)); cell.scale.setScalar(scale); cell.castShadow = cell.receiveShadow = true; cell.frustumCulled = false; cell.rotation.x = 1.2; world.add(cell); U.far.value = far = f; stage.dataset.ready = '1'; }).catch(() => { stage.dataset.ready = 'none'; });
    // other real cells, out of focus behind
    load('/neuron-far.dat').then(({ g, scale }) => { const m = skin(true); (small ? [[-9, 5, -17, 0.4]] : [[-13, 5, -19, 0.4], [13, -7, -22, 2.3], [5, 11, -27, 4.1]]).forEach(([x, y, z, a]) => { const o = new T.Mesh(g, m); o.scale.setScalar(scale); o.position.set(x, y, z); o.rotation.set(a * 0.6, a, a * 0.4); o.frustumCulled = false; scene.add(o); }); }).catch(() => {});

    // incoming threads from other cells, with uneven beads, brushing past
    { const P: number[] = [], Nn: number[] = [], D: number[] = [], I: number[] = [], q = new T.Vector3(); for (let k = 0; k < (small ? 12 : 26); k++) { const p = new T.Vector3((R() - 0.5) * 24, (R() - 0.5) * 18, -1.6 - R() * 9), v = new T.Vector3(R() - 0.5, R() - 0.5, (R() - 0.5) * 0.5).normalize(), L: T.Vector3[] = []; for (let i = 0; i < 26; i++) { v.add(q.set(R() - 0.5, R() - 0.5, (R() - 0.5) * 0.6).multiplyScalar(0.55)).normalize(); p.addScaledVector(v, 0.7); L.push(p.clone()); } const c = new T.CatmullRomCurve3(L), n = 240, fr = c.computeFrenetFrames(n), b0 = P.length / 3; let bead = 0; for (let i = 0; i <= n; i++) { if (R() < 0.035) bead = 0.5 + R(); bead *= 0.72; const rr = 0.018 + bead * 0.05 + 0.006 * R(), o = c.getPoint(i / n); for (let s = 0; s <= 6; s++) { const a = (s / 6) * 6.2832, w = fr.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(fr.binormals[i], Math.sin(a)); P.push(o.x + w.x * rr, o.y + w.y * rr, o.z + w.z * rr); Nn.push(w.x, w.y, w.z); D.push(1); if (i < n && s < 6) { const j = b0 + i * 7 + s; I.push(j, j + 1, j + 7, j + 1, j + 8, j + 7); } } } } const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(Nn, 3)); g.setIndex(I); const t = new T.Mesh(g, new T.MeshStandardMaterial({ color: 0x1b5f63, roughness: 0.6 })); t.receiveShadow = true; scene.add(t); }

    const sc = document.createElement('canvas'); sc.width = sc.height = 128; const sx = sc.getContext('2d')!, gr = sx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.2, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); sx.fillStyle = gr; sx.fillRect(0, 0, 128, 128); const dot = new T.CanvasTexture(sc);
    const spr = (c: number, s: number, o: number, z: boolean) => { const m = new T.Sprite(new T.SpriteMaterial({ map: dot, color: c, blending: T.AdditiveBlending, depthWrite: false, depthTest: z, opacity: o, fog: false })); m.scale.setScalar(s); world.add(m); return m; };
    const halo = spr(0x2fbfae, 8, 0.1, true), nuc = spr(0x9dffe6, 1.4, 0, false); halo.position.z = -1.6;
    const mg = new T.BufferGeometry(); mg.setAttribute('position', new T.Float32BufferAttribute(Array.from({ length: 420 * 3 }, (_, i) => (R() - 0.5) * (i % 3 === 0 ? 40 : i % 3 === 1 ? 22 : 26)), 3)); const motes = new T.Points(mg, new T.PointsMaterial({ map: dot, color: 0x6fb9b2, size: 0.09, transparent: true, opacity: 0.4, depthWrite: false, blending: T.AdditiveBlending })); scene.add(motes);

    const depth = new T.DepthTexture(4, 4, T.UnsignedIntType), rt = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: 4, depthTexture: depth });
    const copy = new FullScreenQuad(new T.ShaderMaterial({ uniforms: { tex: { value: null } }, vertexShader: 'varying vec2 u;void main(){u=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: 'uniform sampler2D tex;varying vec2 u;bool bad(vec3 c){return !(c.r<1e3&&c.g<1e3&&c.b<1e3&&c.r>-1.);}void main(){vec3 c=texture2D(tex,u).rgb;if(bad(c))c=vec3(.01,.03,.035);gl_FragColor=vec4(min(c,vec3(14.)),1.);}' }));
    const fx = new EffectComposer(r), lens = new Lens(depth, cam, small ? 22 : 30), bloom = new UnrealBloomPass(new T.Vector2(4, 4), 0.42, 0.6, 0.82); fx.addPass(new Draw(scene, cam, rt, copy)); fx.addPass(lens); fx.addPass(bloom); fx.addPass(new OutputPass());


    let since = 0, seen = 0, qual = 1, tick = 0, np = 0, mode: View = 'home', at = 0, fire = 0, mx = 0, my = 0, size = [0, 0, 1]; const late: { at: number; dev: number; hold: number }[] = [];
    addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });
    const want = { x: 0, y: 0.4, z: 18.5, tx: 0, ty: 0, tz: 0, roll: 0, ox: 0.17, oy: 0.02, fog: 0.03 }, c = { ...want, z: 30 };
    // the flight: the body, along one long branch on its side, further out, then back to see the whole cell
    const KEYS = [[0, 0.4, 18.5, 0, 0, 0, 0, 0.17, 0.02, 0.03], [1.2, -0.9, 12.4, 0.1, -1.2, -0.6, 1.42, 0.24, 0.0, 0.028], [1.3, -10.2, 4.0, 1.9, -9.5, -1.7, 1.1, -0.15, 0.0, 0.03], [5, 0.5, 31, 0.6, -2, 0, 0.12, 0.2, 0, 0.015]];
    const KEYM = [[0, 0.4, 21, 0, 0, 0, 0, 0, 0.27, 0.03], [1.2, -1.6, 13.5, 0.2, -1.6, -0.8, 0.9, 0, 0.27, 0.026], [1.2, -10, 6.5, 1.9, -9.4, -1.7, 1.1, 0, 0.27, 0.028], [3, 0.5, 34, 0.4, -1, 0, 0.1, 0, 0.3, 0.015]];
    const aim = () => {
      const nr = innerWidth < 800;
      if (mode === 'home') { const K = nr ? KEYM : KEYS, i = Math.min(K.length - 2, Math.floor(at)), f0 = at - i, f = f0 * f0 * (3 - 2 * f0), v = K[i].map((k, n) => lerp(k, K[i + 1][n], f)); Object.assign(want, { x: v[0], y: v[1], z: v[2] + Math.sin(f0 * Math.PI) * (i < 2 ? -1.1 : 0), tx: v[3], ty: v[4], tz: v[5], roll: v[6], ox: v[7], oy: v[8], fog: v[9] }); }
      else Object.assign(want, { x: 0, y: 0.4, tx: 0, ty: 0, tz: 0, roll: 0, fog: 0.03 }, mode === 'type' ? { z: nr ? 22 : 18, ox: 0, oy: 0.27 } : { z: nr ? 22 : 18.5, ox: nr ? 0 : mode === 'page' ? 0.26 : 0.22, oy: nr ? -0.27 : 0 });
    };
    const resize = () => { const w = innerWidth, h = innerHeight, d = devicePixelRatio || 1, q = Math.min(d, w < 800 ? 1.5 : 1.25) * qual; size = [w, h, d]; r.setPixelRatio(q); r.setSize(w, h); fx.setPixelRatio(q); fx.setSize(w, h); bloom.setSize((w * q) / 2, (h * q) / 2); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    resize(); addEventListener('resize', resize);
    const api: Scene = {
      view(v) { mode = v; }, fly(p) { at = p; }, tick() {},
      clear() { pulses.forEach((p) => p.set(-9, 0, 0, 0)); late.length = 0; },
      launch(dev, hold) { const wild = Math.max(0, Math.abs(dev) - 1.1); pulses[np++ % NP].set(0, clamp(0.19 / Math.max(hold, 0.02), 0.55, 4.5), clamp(wild / 1.3, 0, 1), wild * 0.035); fire = 1; },
      send(dev, hold) { const wild = Math.max(0, Math.abs(dev) - 1.1); if (wild > 0.4) late.push({ at: 0.06 + wild * 0.05, dev, hold }); else api.launch(dev, hold); },
    };
    const frame = (t: number, dt: number) => {
      U.t.value = t; aim();
      // if this computer cannot keep up, draw fewer pixels instead of stuttering
      if (cell && qual > 0.78) { if (!seen) since = t; seen++; if (t - since > 2.5) { if (seen / (t - since) < 50 && t - since < 4) { qual -= 0.13; resize(); } seen = 0; } }
      for (let i = late.length - 1; i >= 0; i--) if ((late[i].at -= dt) <= 0) { api.launch(late[i].dev, late[i].hold); late.splice(i, 1); }
      for (const p of pulses) if (p.y > 0) { p.x += dt * (p.z > 0.5 ? 6.2 : 7.4); if (p.x > far + 4) p.set(-9, 0, 0, 0); }
      pulses.sort((a, b) => b.y - a.y); U.live.value = np = pulses.filter((p) => p.y > 0).length;
      fire *= Math.exp(-dt * 6); (nuc.material as T.SpriteMaterial).opacity = fire * 0.3; (halo.material as T.SpriteMaterial).opacity = 0.08 + fire * 0.14;
      const f = reduced ? 1 : 1 - Math.exp(-dt * 2.8), sway = reduced ? 0 : 1; (Object.keys(c) as (keyof typeof c)[]).forEach((k) => (c[k] = lerp(c[k], want[k], f)));
      if (tick++ % 6 === 0) r.shadowMap.needsUpdate = true;
      world.rotation.set((Math.sin(t * 0.13) * 0.07 + my * 0.1) * sway, (Math.sin(t * 0.09) * 0.1 + mx * 0.16) * sway, 0); motes.position.y = Math.sin(t * 0.1) * 0.6 * sway;
      cam.position.set(c.x + Math.sin(t * 0.17) * 0.25 * sway, c.y + Math.cos(t * 0.14) * 0.2 * sway, c.z); (scene.fog as T.FogExp2).density = c.fog; cam.up.set(Math.sin(c.roll), Math.cos(c.roll), 0); cam.lookAt(c.tx, c.ty, c.tz); cam.setViewOffset(size[0], size[1], -c.ox * size[0], -c.oy * size[1], size[0], size[1]);
      lens.mat.uniforms.focus.value = Math.hypot(c.x - c.tx, c.y - c.ty, c.z - c.tz) - 0.3; lens.mat.uniforms.amt.value = 1.25; lens.mat.uniforms.t.value = t % 10; fx.render(dt);
    };
    let last = performance.now(), lost = false;
    r.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; stage.classList.add('flat'); });
    const loop = (now: number) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; api.tick(now / 1000, dt); if (!lost) frame(now / 1000, dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    return api;
}
