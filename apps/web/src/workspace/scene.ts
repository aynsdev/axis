import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Character, lookFor, type Wander } from './character';
import { allDesks, MAX_POOL, type Desk, type Office } from './model';
import { ACCENTS, STATUS_COLORS, type DeskStatus } from './palette';
import { backdropTexture, screenTexture, signTexture, textTexture, type ScreenKind } from './textures';
import { disposeTree, hash, rng, VoxelBatch } from './voxels';

const C = {
  floor: '#352e29',
  plazaFloor: '#26272b',
  plank: '#6a4c36',
  plankVacant: '#5e4632',
  brick: '#3a3029',
  brickDark: '#2c241f',
  trim: '#57483c',
  wood: '#6b4b35',
  woodDark: '#3b2a1f',
  bezel: '#15171c',
  chair: '#2a2a30',
  leaf: '#3f8f3a',
  leafDark: '#2f6f2c',
  pot: '#7a4a2c',
  lampGlow: '#ffc978',
  stone: '#3a3a40',
  holo: '#59d0ff',
};

// ---------- Layout ----------

const CW = 18;
const CD = 16;
const LOUNGE = 9;

interface Grid {
  cols: [number, number];
  rows: [number, number];
  cells: Array<[number, number]>;
}

function gridFor(rooms: number): Grid {
  const [cols, rows]: [[number, number], [number, number]] =
    rooms <= 8 ? [[-1, 1], [-1, 1]] : rooms <= 14 ? [[-2, 2], [-1, 1]] : [[-2, 2], [-2, 2]];
  const cells: Array<[number, number]> = [];
  for (let r = rows[0]; r <= rows[1]; r++) for (let c = cols[0]; c <= cols[1]; c++) if (c || r) cells.push([c, r]);
  // Inner ring first so the first agents sit next to the plaza.
  cells.sort((a, b) => Math.max(Math.abs(a[0]), Math.abs(a[1])) - Math.max(Math.abs(b[0]), Math.abs(b[1])) || a[1] - b[1] || a[0] - b[0]);
  return { cols, rows, cells };
}

const SUB_X: Record<number, number[]> = { 1: [0], 2: [-3.2, 3.2], 3: [-5.6, 0, 5.6], 4: [-6.4, -2.15, 2.15, 6.4] };
const MAIN_SEAT = new THREE.Vector3(0, 0, -2.3);
const SUB_SEAT_Z = 4.7;

export interface LabelPos {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

interface Seat {
  id: string;
  status: DeskStatus;
  character: Character;
  screens: THREE.Texture[];
  screenMat: THREE.MeshBasicMaterial;
  light: THREE.MeshBasicMaterial;
  /** Height of the name plate above the character's feet. */
  labelY: number;
}

type RoomKind = 'team' | 'pool' | 'vacant' | 'plaza';

interface Room {
  kind: RoomKind;
  key: string;
  group: THREE.Group;
  seats: Seat[];
  lamp: THREE.Vector3 | null;
}

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

/** Open floor in a team office: the aisle right of the desk and the front of the room. */
const TEAM_WANDER: Wander = { stand: v(1.6, -2.3), spots: [v(4.2, -1.2), v(6, 1.5), v(4.6, 4.6), v(6.2, 5.2), v(3, 2), v(2.6, 0.2)] };
/** The open band in front of the hot desks. */
const POOL_SPOTS = [v(-6, 3.2), v(-2, 3.6), v(2, 3), v(6, 3.4), v(0, 5), v(-2.4, 5.2), v(2.6, 5)];
/** Session desks only have room to pace behind the chair. */
const PLAZA_WANDER: Wander = { stand: v(0, 1.6), spots: [v(-1.5, 1.5), v(1.5, 1.6), v(0, 1.9)] };

/** Room id for the session desks around the hologram. */
const PLAZA = -1;
/** Command desk spots around the hologram, each turned to face it. */
const SESSION_SPOTS = [
  new THREE.Vector3(-7.3, 0, -6.2),
  new THREE.Vector3(7.3, 0, -6.2),
  new THREE.Vector3(-7.3, 0, 6.3),
  new THREE.Vector3(7.3, 0, 6.3),
];

const LAMP_LIGHTS = 10;

export class WorkspaceScene {
  onPick: (id: string | null) => void = () => {};
  onFrame: (labels: LabelPos[], pxPerUnit: number) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.5, 900);
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private container: HTMLElement;

  private litMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  private glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private colorMats = new Map<string, THREE.MeshStandardMaterial>();
  private shared = new Set<THREE.Material | THREE.Texture>([this.litMat, this.glowMat]);

  private ambient = new THREE.AmbientLight('#ffffff', 0.3);
  private hemi = new THREE.HemisphereLight('#5b6fa8', '#2a1e14', 0.5);
  private sun = new THREE.DirectionalLight('#9fb4ff', 1);
  private lampLights: THREE.PointLight[] = [];
  private holoLight = new THREE.PointLight(C.holo, 30, 18, 2);
  private loungeLight = new THREE.PointLight(C.lampGlow, 30, 16, 2);

  private grid: Grid = gridFor(0);
  private env: THREE.Group | null = null;
  private backdrop: THREE.MeshBasicMaterial | null = null;
  private rooms = new Map<number, Room>();
  private office: Office = { team: [], pool: [], sessions: [] };
  private onlineAnchor = new THREE.Vector3(0, 1, 4.3);

  private globe: THREE.Group | null = null;
  private holoPanels: THREE.Mesh[] = [];
  private cat: { group: THREE.Group; legs: THREE.Object3D[]; tail: THREE.Object3D; s: number; rest: number } | null = null;
  private selection: THREE.Mesh;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private pickables: THREE.Mesh[] = [];
  private pickMat = new THREE.MeshBasicMaterial({ visible: false });
  private raycaster = new THREE.Raycaster();
  private focus: { from: THREE.Vector3; to: THREE.Vector3; fromDist: number; toDist: number; fromDir: THREE.Vector3; toDir: THREE.Vector3; t: number } | null = null;

  private insetRight = 0;
  private night = true;
  private motion = true;
  private running = false;
  private visible = true;
  private io: IntersectionObserver;
  private ro: ResizeObserver;
  private down: { x: number; y: number } | null = null;
  private disposed = false;

  constructor(container: HTMLElement, opts: { night: boolean; reducedMotion: boolean }) {
    this.container = container;
    this.night = opts.night;
    this.motion = !opts.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.42;
    this.controls.maxPolarAngle = 1.22;
    this.controls.minAzimuthAngle = -0.35;
    this.controls.maxAzimuthAngle = 1.35;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 260;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => (this.focus = null));

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.ambient, this.hemi, this.sun, this.sun.target, this.holoLight, this.loungeLight);
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const l = new THREE.PointLight(C.lampGlow, 0, 22, 1.6);
      this.lampLights.push(l);
      this.scene.add(l);
    }

    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.75, 4, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.9 }));
    ring.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    ring.visible = false;
    this.selection = ring;
    this.scene.add(ring);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.syncLoop);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      this.syncLoop();
    });
    this.io.observe(container);

    this.rebuildEnvironment();
    this.applyTheme();
    this.resize();
    this.resetView(false);
    this.syncLoop();
  }

  // ---------- Public API ----------

  setOffice(office: Office) {
    this.office = office;
    // Every team member keeps an office; one more room holds the hot desks.
    const grid = gridFor(office.team.length + 1);
    if (grid.cells.length !== this.grid.cells.length) {
      this.grid = grid;
      for (const r of this.rooms.values()) this.disposeRoom(r);
      this.rooms.clear();
      this.rebuildEnvironment();
      this.applyTheme();
      this.resetView(false);
    }

    const desks = new Map(allDesks(office).map((d) => [d.id, d]));
    const plan = new Map<number, { kind: RoomKind; desks: Desk[] }>();
    for (let i = 0; i < this.grid.cells.length; i++) {
      const member = office.team[i];
      plan.set(i, member ? { kind: 'team', desks: [member] } : i === office.team.length ? { kind: 'pool', desks: office.pool } : { kind: 'vacant', desks: [] });
    }
    plan.set(PLAZA, { kind: 'plaza', desks: office.sessions });

    for (const [i, spec] of plan) {
      // Rebuild a room only when who sits in it changes; status changes animate in place.
      const key = `${spec.kind}:${spec.desks.map((d) => d.id).join('|')}`;
      const existing = this.rooms.get(i);
      if (existing && existing.key === key) {
        for (const seat of existing.seats) {
          const d = desks.get(seat.id);
          if (d) this.setSeatStatus(seat, d.status);
        }
        continue;
      }
      if (existing) this.disposeRoom(existing);
      this.rooms.set(i, i === PLAZA ? this.buildPlaza(spec.desks, key) : this.buildRoom(i, spec.kind, spec.desks, key));
    }
    this.assignLamps();
    this.refreshPickables();
    if (this.selectedId && !this.seatOf(this.selectedId)) this.select(null);
    else if (this.selectedId) this.placeSelection();
  }

  select(id: string | null, focus = true) {
    this.selectedId = id;
    this.placeSelection();
    const seat = id ? this.seatOf(id) : null;
    if (seat && focus) this.focusOn(this.feet(seat).setY(1.5), Math.min(this.distance(), 52));
  }

  setTheme(night: boolean) {
    if (night === this.night) return;
    this.night = night;
    this.applyTheme();
  }

  /** Pixels of canvas covered by an overlay on the right; the view centers in what's left. */
  setInsetRight(px: number) {
    if (px === this.insetRight) return;
    this.insetRight = px;
    this.resize();
    this.resetView(false);
  }

  setReducedMotion(reduced: boolean) {
    this.motion = !reduced;
  }

  resetView(animate = true) {
    const { center, radius } = this.bounds();
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const free = this.container.clientWidth - Math.min(this.insetRight, this.container.clientWidth * 0.5);
    const aspect = Math.max(free / Math.max(1, this.container.clientHeight), 0.5);
    const fit = aspect < 1.2 ? Math.atan(Math.tan(vfov / 2) * aspect) : vfov / 2;
    const dist = (radius * 0.72) / Math.sin(fit);
    const target = center.clone().setY(0);
    const view = new THREE.Spherical(dist, 0.95, 0.62);
    if (animate && this.motion) {
      this.focusOn(target, dist, view);
      return;
    }
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(view));
    this.controls.update();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener('visibilitychange', this.syncLoop);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    for (const r of this.rooms.values()) this.disposeRoom(r);
    if (this.env) disposeTree(this.env);
    disposeTree(this.selection);
    for (const m of this.colorMats.values()) m.dispose();
    this.litMat.dispose();
    this.glowMat.dispose();
    this.pickMat.dispose();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
  }

  // ---------- Loop ----------

  private syncLoop = () => {
    const run = this.visible && !document.hidden && !this.disposed;
    if (run === this.running) return;
    this.running = run;
    if (run) this.clock.getDelta();
    this.renderer.setAnimationLoop(run ? this.frame : null);
  };

  private frame = () => {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    if (this.focus) {
      const f = this.focus;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = 1 - Math.pow(1 - f.t, 3);
      const dir = f.fromDir.clone().lerp(f.toDir, e).normalize();
      this.controls.target.lerpVectors(f.from, f.to, e);
      this.camera.position.copy(this.controls.target).addScaledVector(dir, THREE.MathUtils.lerp(f.fromDist, f.toDist, e));
      if (f.t >= 1) this.focus = null;
    }
    this.controls.update();
    this.clampTarget();

    for (const room of this.rooms.values()) {
      for (const seat of room.seats) {
        seat.character.update(t, dt, seat.status, this.motion);
        if (this.motion && seat.status === 'working') for (const tex of seat.screens) tex.offset.y = (tex.offset.y + dt * 0.12) % 1;
      }
    }

    if (this.globe && this.motion) this.globe.rotation.y += dt * 0.25;
    this.holoPanels.forEach((p, i) => {
      const a = (this.motion ? t * 0.18 : 0) + (i / this.holoPanels.length) * Math.PI * 2;
      p.position.set(Math.cos(a) * 2.35, 3.3 + Math.sin((this.motion ? t : 0) * 0.8 + i) * 0.35, Math.sin(a) * 2.35);
      p.rotation.y = -a + Math.PI / 2;
    });
    this.updateCat(dt);
    if (this.selection.visible) {
      this.placeSelection();
      const s = 1 + (this.motion ? Math.sin(t * 3) * 0.06 : 0);
      this.selection.scale.set(s, s, 1);
    }

    this.composer.render(dt);
    this.emitLabels();
  };

  private emitLabels() {
    const labels: LabelPos[] = [];
    const p = new THREE.Vector3();
    for (const room of this.rooms.values())
      for (const seat of room.seats) labels.push({ id: seat.id, ...this.project(this.feet(seat, p).setY(seat.labelY + seat.character.rise * 0.8)) });
    labels.push({ id: '__online', ...this.project(this.onlineAnchor) });
    const a = this.project(this.controls.target);
    const b = this.project(this.controls.target.clone().add(new THREE.Vector3(1, 0, -1).normalize()));
    this.onFrame(labels, Math.hypot(a.x - b.x, a.y - b.y));
  }

  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2 };
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    // Render the right-hand slice of a wider virtual frame, so its center lands mid free area.
    const inset = Math.min(this.insetRight, w * 0.5);
    this.camera.aspect = (w + inset) / h;
    if (inset) this.camera.setViewOffset(w + inset, h, inset, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
  }

  private distance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  private focusOn(to: THREE.Vector3, dist: number, spherical?: THREE.Spherical) {
    const fromDir = this.camera.position.clone().sub(this.controls.target).normalize();
    const toDir = spherical ? new THREE.Vector3().setFromSpherical(spherical).normalize() : fromDir.clone();
    if (!this.motion) {
      this.controls.target.copy(to);
      this.camera.position.copy(to).addScaledVector(toDir, dist);
      this.controls.update();
      return;
    }
    this.focus = { from: this.controls.target.clone(), to, fromDist: this.distance(), toDist: dist, fromDir, toDir, t: 0 };
  }

  private bounds() {
    const [c0, c1] = this.grid.cols;
    const [r0, r1] = this.grid.rows;
    const x0 = c0 * CW - CW / 2;
    const x1 = c1 * CW + CW / 2;
    const z0 = r0 * CD - CD / 2;
    const z1 = r1 * CD + CD / 2 + LOUNGE;
    const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    return { x0, x1, z0, z1, center, radius: Math.hypot(x1 - x0, z1 - z0) / 2 };
  }

  private clampTarget() {
    const { x0, x1, z0, z1 } = this.bounds();
    const t = this.controls.target;
    const clamped = t.clone().set(THREE.MathUtils.clamp(t.x, x0, x1), THREE.MathUtils.clamp(t.y, 0, 6), THREE.MathUtils.clamp(t.z, z0, z1));
    if (!clamped.equals(t)) {
      this.camera.position.add(clamped.clone().sub(t));
      t.copy(clamped);
    }
  }

  // ---------- Picking ----------

  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
    this.down = null;
    this.onPick(this.pick(e));
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const id = this.pick(e);
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
  };

  private onPointerLeave = () => {
    if (!this.hoverId) return;
    this.hoverId = null;
    this.renderer.domElement.style.cursor = '';
  };

  private pick(e: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return (this.raycaster.intersectObjects(this.pickables, false)[0]?.object.userData.agentId as string | undefined) ?? null;
  }

  private refreshPickables() {
    this.pickables = [];
    for (const r of this.rooms.values()) r.group.traverse((o) => o.userData.pick && this.pickables.push(o as THREE.Mesh));
  }

  /** Where a seat's character is now, on the floor; it may have wandered off. */
  private feet(seat: Seat, out = new THREE.Vector3()) {
    return seat.character.group.getWorldPosition(out).setY(0);
  }

  private seatOf(id: string): Seat | null {
    for (const r of this.rooms.values()) for (const s of r.seats) if (s.id === id) return s;
    return null;
  }

  private placeSelection() {
    const seat = this.selectedId ? this.seatOf(this.selectedId) : null;
    this.selection.visible = !!seat;
    if (seat) this.selection.position.copy(this.feet(seat)).setY(0.12);
  }

  // ---------- Materials ----------

  private mat = (color: string) => {
    let m = this.colorMats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
      this.colorMats.set(color, m);
      this.shared.add(m);
    }
    return m;
  };

  private applyTheme() {
    const n = this.night;
    this.renderer.setClearColor(n ? '#05070d' : '#bcd9f0');
    this.ambient.color.set(n ? '#6b7aa6' : '#ffffff');
    this.ambient.intensity = n ? 0.55 : 0.8;
    this.hemi.color.set(n ? '#5b6fa8' : '#d6ebff');
    this.hemi.groundColor.set(n ? '#3a2818' : '#8a7a60');
    this.hemi.intensity = n ? 0.9 : 1.2;
    this.sun.color.set(n ? '#9fb4ff' : '#fff1d6');
    this.sun.intensity = n ? 0.9 : 2.4;
    this.glowMat.color.setScalar(n ? 1 : 0.75);
    this.bloom.strength = n ? 0.7 : 0.12;
    this.holoLight.intensity = n ? 40 : 10;
    this.loungeLight.intensity = n ? 60 : 0;
    if (this.backdrop) {
      this.backdrop.map?.dispose();
      this.backdrop.map = backdropTexture(n);
      this.backdrop.needsUpdate = true;
    }
    this.assignLamps();
  }

  private assignLamps() {
    // Busy rooms get lights first; the pool is fixed so lights never trigger a shader recompile.
    const busy = (r: Room) => (r.seats.some((s) => s.status === 'working') ? 0 : r.kind === 'vacant' ? 2 : 1);
    const lit = [...this.rooms.values()].filter((r) => r.lamp).sort((a, b) => busy(a) - busy(b)).slice(0, LAMP_LIGHTS);
    this.lampLights.forEach((l, i) => {
      const r = lit[i];
      l.intensity = r && this.night ? (busy(r) === 0 ? 75 : 45) : 0;
      if (r) l.position.copy(r.lamp!);
    });
  }

  // ---------- Rooms ----------

  private cellOrigin(i: number) {
    const [c, r] = this.grid.cells[i];
    return new THREE.Vector3(c * CW, 0, r * CD);
  }

  private buildRoom(i: number, kind: RoomKind, desks: Desk[], key: string): Room {
    const origin = this.cellOrigin(i);
    const [col, row] = this.grid.cells[i];
    const group = new THREE.Group();
    group.position.copy(origin);
    const b = new VoxelBatch(hash(key) + i);
    const r = rng(i * 977 + 13);
    const seats: Seat[] = [];

    // Plank floor.
    for (let z = -7.6; z < 7.6; z += 1) b.box(-8.6, 0, z, 17.2, 0.06, 0.96, kind === 'vacant' ? C.plankVacant : C.plank, { jitter: 0.1 });

    // Low partitions on the back and left, unless the outer wall is already there.
    if (row !== this.grid.rows[0]) {
      for (let x = -9; x < 9; x += 2) b.box(x, 0, -8.25, 2, 2.2, 0.5, C.brick, { jitter: 0.1 });
      b.box(-9, 2.2, -8.3, 18, 0.25, 0.6, C.trim);
    }
    if (col !== this.grid.cols[0]) {
      for (let z = -8; z < 8; z += 2) if (z < -1 || z >= 3) b.box(-9.25, 0, z, 0.5, 2.2, 2, C.brick, { jitter: 0.1 });
      b.box(-9.3, 2.2, -8, 0.6, 0.25, 7, C.trim);
      b.box(-9.3, 2.2, 3, 0.6, 0.25, 5, C.trim);
    }

    if (kind === 'pool') {
      // Hot desks: four seats anyone can take, with a sign over them.
      const xs = SUB_X[MAX_POOL];
      xs.forEach((x, k) => {
        const d = desks[k];
        const accent = d?.accent ?? '#3a3f4a';
        this.desk(b, x, -1.5, 3.6, 1.6, accent);
        const screens = [
          { x: x - 0.75, y: 1.7, w: 1.35, h: 0.85, kind: 'code' as ScreenKind },
          { x: x + 0.75, y: 1.7, w: 1.35, h: 0.85, kind: (k % 2 ? 'terminal' : 'chart') as ScreenKind },
        ];
        for (const sc of screens) this.monitorFrame(b, sc.x, sc.y, -2.15, sc.w, sc.h);
        b.box(x - 0.8, 1.55, -1.05, 1.6, 0.08, 0.5, '#1f2228');
        this.chair(b, x, 0.7, accent);
        if (d) seats.push(this.seat(group, d, new THREE.Vector3(x, 0, 0.7), screens, -2.02, 'sub', { stand: v(x, 2.1), spots: POOL_SPOTS }));
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: textTexture('HOT DESKS', '#f2f4f8'), transparent: true, toneMapped: false }));
      sign.position.set(0, 3.4, -7.7);
      group.add(sign);
      b.box(-3.2, 2.55, -7.95, 6.4, 1.7, 0.1, '#14171f', { jitter: 0 });
      this.plant(b, 4.5, 5.6, r);
      this.plant(b, -4.5, 5.6, r);
    } else {
      const d = desks[0];
      const accent = d?.accent ?? '#3a3f4a';
      // A team member's desk with three monitors.
      this.desk(b, 0, -4.5, 6.4, 2, accent);
      const screens: Array<{ x: number; y: number; w: number; h: number; kind: ScreenKind }> = [
        { x: -2.05, y: 1.75, w: 1.8, h: 1.1, kind: 'terminal' },
        { x: 0, y: 1.85, w: 2.0, h: 1.25, kind: 'code' },
        { x: 2.05, y: 1.75, w: 1.8, h: 1.1, kind: r() < 0.5 ? 'chart' : 'code' },
      ];
      for (const sc of screens) this.monitorFrame(b, sc.x, sc.y, -5.25, sc.w, sc.h);
      b.box(-1.2, 1.55, -4.15, 2.4, 0.08, 0.6, '#1f2228'); // keyboard
      b.box(2.6, 1.55, -4.0, 0.3, 0.4, 0.3, '#e8e4dc'); // mug
      this.chair(b, MAIN_SEAT.x, MAIN_SEAT.z, accent);
      // Sticky notes behind the desk, like a real planning wall.
      if (row !== this.grid.rows[0]) for (let k = 0; k < 4; k++) b.box(-3 + k * 0.7 + r() * 0.2, 1.2 + r() * 0.6, -7.98, 0.45, 0.45, 0.04, k % 2 ? '#f5d76e' : '#f0b45a', { glow: true, jitter: 0.04 });
      if (d) seats.push(this.seat(group, d, MAIN_SEAT, screens, -5.12, 'main', TEAM_WANDER));
      this.lounge(b, r, kind === 'team');
    }

    // Corner plant and floor lamp.
    this.plant(b, -7.6, -6.8, r);
    if (r() < 0.6) this.plant(b, 7.4, 6.4, r);
    b.box(7.35, 0.06, -7.05, 0.5, 0.15, 0.5, C.woodDark);
    b.box(7.5, 0.2, -6.9, 0.2, 2.7, 0.2, C.woodDark);
    b.box(7.1, 2.9, -7.3, 1.0, 0.85, 1.0, C.lampGlow, { glow: true, jitter: 0 });

    // A bookshelf on the left side.
    if (col !== this.grid.cols[0] || r() < 0.5) {
      b.box(-8.75, 0.06, -6.5, 0.7, 2.6, 3.2, C.woodDark);
      for (let y = 0.4; y < 2.5; y += 0.7)
        for (let z = -6.35; z < -3.5; z += 0.32) if (r() < 0.8) b.box(-8.5, y, z, 0.5, 0.45 + r() * 0.15, 0.26, ACCENTS[Math.floor(r() * ACCENTS.length)], { jitter: 0.2 });
    }

    group.add(b.build({ lit: this.litMat, glow: this.glowMat }));
    this.scene.add(group);
    for (const s of seats) this.setSeatStatus(s, s.status);
    return { kind, key, group, seats, lamp: origin.clone().add(new THREE.Vector3(7.6, 3.4, -6.8)) };
  }

  /** Session desks around the hologram, each turned to face it. */
  private buildPlaza(desks: Desk[], key: string): Room {
    const group = new THREE.Group();
    const seats: Seat[] = [];
    SESSION_SPOTS.forEach((spot, k) => {
      const d = desks[k];
      const pod = new THREE.Group();
      pod.position.copy(spot);
      pod.rotation.y = Math.atan2(spot.x, spot.z);
      group.add(pod);
      const b = new VoxelBatch(hash(key) + k);
      const accent = d?.accent ?? '#3a3f4a';
      this.desk(b, 0, -1.9, 3.8, 1.6, accent);
      const screens = [
        { x: -0.8, y: 1.7, w: 1.45, h: 0.9, kind: 'terminal' as ScreenKind },
        { x: 0.8, y: 1.7, w: 1.45, h: 0.9, kind: 'code' as ScreenKind },
      ];
      for (const sc of screens) this.monitorFrame(b, sc.x, sc.y, -2.55, sc.w, sc.h);
      b.box(-0.8, 1.55, -1.45, 1.6, 0.08, 0.5, '#1f2228');
      this.chair(b, 0, 0.3, accent);
      pod.add(b.build({ lit: this.litMat, glow: this.glowMat }));
      if (d) seats.push(this.seat(pod, d, new THREE.Vector3(0, 0, 0.3), screens, -2.42, 'sub', PLAZA_WANDER));
    });
    this.scene.add(group);
    for (const s of seats) this.setSeatStatus(s, s.status);
    return { kind: 'plaza', key, group, seats, lamp: null };
  }

  private seat(parent: THREE.Group, d: Desk, pos: THREE.Vector3, screens: Array<{ x: number; y: number; w: number; h: number; kind: ScreenKind }>, screenZ: number, size: 'main' | 'sub', wander: Wander): Seat {
    const character = new Character(lookFor(d.id, d.accent, d.zone === 'session' ? 'main' : 'sub'), this.mat, d.id, pos, wander);
    parent.add(character.group);

    const screenMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const textures: THREE.Texture[] = [];
    screens.forEach((sc, k) => {
      const tex = screenTexture(d.accent, sc.kind, hash(d.id) + k);
      textures.push(tex);
      const m = screenMat.clone();
      m.map = tex;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sc.w - 0.14, sc.h - 0.14), m);
      mesh.position.set(sc.x, sc.y + sc.h / 2, screenZ);
      mesh.userData.screen = true;
      parent.add(mesh);
    });

    const light = new THREE.MeshBasicMaterial({ color: STATUS_COLORS[d.status], toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), light);
    lamp.position.set(pos.x - (size === 'main' ? 3.0 : 1.7), 1.68, pos.z - (size === 'main' ? 1.6 : 1.5));
    parent.add(lamp);

    const pick = new THREE.Mesh(new THREE.BoxGeometry(size === 'main' ? 6.4 : 3.6, 3.6, 4.2), this.pickMat);
    pick.position.set(pos.x, 1.8, pos.z - 1.4);
    pick.userData = { agentId: d.id, pick: true };
    parent.add(pick);

    return {
      id: d.id,
      status: d.status,
      character,
      screens: textures,
      screenMat,
      light,
      labelY: size === 'main' ? 4.3 : 3.9,
    };
  }

  private setSeatStatus(seat: Seat, status: DeskStatus) {
    seat.status = status;
    seat.light.color.set(STATUS_COLORS[status]);
    const level = status === 'working' ? 1 : status === 'idle' ? 0.4 : status === 'done' ? 0.25 : 0.12;
    seat.character.group.parent?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.userData.screen) return;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (seat.screens.includes(mat.map!)) mat.color.setScalar(level);
    });
  }

  private disposeRoom(r: Room) {
    this.scene.remove(r.group);
    for (const s of r.seats) {
      s.character.dispose();
      s.screens.forEach((t) => t.dispose());
      s.screenMat.dispose();
    }
    disposeTree(r.group, this.shared);
  }

  private desk(b: VoxelBatch, cx: number, cz: number, w: number, d: number, accent: string) {
    const x = cx - w / 2;
    const z = cz - d / 2;
    b.box(x, 1.35, z, w, 0.2, d, C.wood, { jitter: 0.04 });
    b.box(x, 1.29, z + d - 0.08, w, 0.06, 0.08, accent, { jitter: 0 });
    for (const [lx, lz] of [
      [x + 0.1, z + 0.1],
      [x + w - 0.3, z + 0.1],
      [x + 0.1, z + d - 0.3],
      [x + w - 0.3, z + d - 0.3],
    ])
      b.box(lx, 0.06, lz, 0.2, 1.3, 0.2, C.woodDark);
  }

  private monitorFrame(b: VoxelBatch, cx: number, y: number, z: number, w: number, h: number) {
    b.box(cx - 0.12, 1.55, z + 0.02, 0.24, y - 1.55, 0.18, C.bezel, { jitter: 0 });
    b.box(cx - 0.4, 1.55, z - 0.1, 0.8, 0.06, 0.4, C.bezel, { jitter: 0 });
    b.box(cx - w / 2, y, z, w, h, 0.12, C.bezel, { jitter: 0 });
  }

  private chair(b: VoxelBatch, cx: number, cz: number, accent: string) {
    b.box(cx - 0.6, 0.85, cz - 0.6, 1.2, 0.22, 1.2, C.chair);
    b.box(cx - 0.6, 1.05, cz + 0.45, 1.2, 0.9, 0.2, new THREE.Color(accent).lerp(new THREE.Color(C.chair), 0.65).getStyle());
    b.box(cx - 0.1, 0.25, cz - 0.1, 0.2, 0.6, 0.2, '#1a1a1e');
    b.box(cx - 0.6, 0.08, cz - 0.08, 1.2, 0.15, 0.16, '#1a1a1e');
    b.box(cx - 0.08, 0.08, cz - 0.6, 0.16, 0.15, 1.2, '#1a1a1e');
  }

  private plant(b: VoxelBatch, x: number, z: number, r: () => number) {
    b.box(x - 0.45, 0.06, z - 0.45, 0.9, 0.8, 0.9, C.pot);
    b.box(x - 0.1, 0.86, z - 0.1, 0.2, 0.9, 0.2, C.leafDark);
    const h = 1.6 + r() * 1.4;
    for (let y = 1.2; y < h; y += 0.4) {
      const n = 2 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) b.box(x - 0.7 + r() * 1.0, y, z - 0.7 + r() * 1.0, 0.4, 0.4, 0.4, r() < 0.5 ? C.leaf : C.leafDark, { jitter: 0.12 });
    }
  }

  private lounge(b: VoxelBatch, r: () => number, occupied: boolean) {
    if (r() < 0.55) {
      const fabric = ACCENTS[Math.floor(r() * ACCENTS.length)];
      const sofa = new THREE.Color(fabric).lerp(new THREE.Color('#3a3330'), 0.55).getStyle();
      b.box(-4.5, 0.06, 4.6, 5, 0.9, 1.6, sofa);
      b.box(-4.5, 0.96, 5.7, 5, 0.9, 0.5, sofa);
      b.box(-4.8, 0.06, 4.6, 0.4, 1.4, 1.6, sofa);
      b.box(0.4, 0.06, 4.6, 0.4, 1.4, 1.6, sofa);
      b.box(-3.4, 0.06, 2.4, 2.8, 0.7, 1.4, C.woodDark);
      b.box(-2.6, 0.76, 2.8, 0.3, 0.35, 0.3, '#e8e4dc');
      b.box(-4.8, 0.06, 1.8, 6.0, 0.05, 4.8, '#6a2e2a', { jitter: 0.04 });
    } else {
      // A planning whiteboard.
      b.box(-3.5, 0.06, 5.6, 0.2, 1.2, 0.2, C.woodDark);
      b.box(2.3, 0.06, 5.6, 0.2, 1.2, 0.2, C.woodDark);
      b.box(-3.6, 1.2, 5.55, 6, 3, 0.2, '#e9e6df');
      for (let k = 0; k < 5; k++) b.box(-3.2 + (k % 3) * 1.8, 1.6 + Math.floor(k / 3) * 1.2, 5.52, 1.2, 0.7, 0.05, k % 2 ? '#f5d76e' : '#8fd3a8', { glow: occupied, jitter: 0.05 });
    }
  }

  // ---------- Environment ----------

  private rebuildEnvironment() {
    if (this.env) {
      this.scene.remove(this.env);
      disposeTree(this.env, this.shared);
    }
    const env = new THREE.Group();
    const b = new VoxelBatch(42);
    const { x0, x1, z0, z1 } = this.bounds();
    const zRooms = z1 - LOUNGE;
    const r = rng(99);

    // Ground.
    b.tiles(x0 - 1, -0.6, z0 - 1, x1 - x0 + 1, z1 - z0 + 1, 0.6, C.floor, 2, 0.08);

    // Back wall with windows on the right; left wall carries the sign.
    const H = 14;
    const winStart = x0 + (x1 - x0) * 0.42;
    const windows: Array<[number, number]> = [];
    for (let x = winStart; x + 6 <= x1 - 1; x += 8) windows.push([x, x + 6]);
    const inWindow = (x: number, y: number) => y >= 3 && y < 11 && windows.some(([a, bb]) => x >= a && x < bb);
    for (let x = x0 - 1; x < x1; x += 2) for (let y = 0; y < H; y += 2) if (!inWindow(x + 1, y + 1)) b.box(x, y, z0 - 1, 2, 2, 1, (x + y) % 4 ? C.brick : C.brickDark, { jitter: 0.1 });
    for (const [a, bb] of windows) {
      b.box(a - 0.3, 2.7, z0 - 0.8, bb - a + 0.6, 0.3, 1.1, C.woodDark);
      b.box(a - 0.3, 11, z0 - 0.8, bb - a + 0.6, 0.3, 1.1, C.woodDark);
      b.box(a - 0.3, 3, z0 - 0.8, 0.3, 8, 1.1, C.woodDark);
      b.box(bb, 3, z0 - 0.8, 0.3, 8, 1.1, C.woodDark);
      b.box((a + bb) / 2 - 0.1, 3, z0 - 0.6, 0.2, 8, 0.4, C.woodDark);
      b.box(a, 6.9, z0 - 0.6, bb - a, 0.2, 0.4, C.woodDark);
    }
    for (let z = z0 - 1; z < z1; z += 2) for (let y = 0; y < H; y += 2) b.box(x0 - 1, y, z, 1, 2, 2, (z + y) % 4 ? C.brick : C.brickDark, { jitter: 0.1 });
    b.box(x0 - 1.2, H, z0 - 1.2, x1 - x0 + 1.2, 0.5, 1.4, C.trim);
    b.box(x0 - 1.2, H, z0 - 1.2, 1.4, 0.5, z1 - z0 + 1.2, C.trim);
    // Wall sconces.
    for (let z = z0 + 6; z < z1 - 2; z += 12) b.box(x0, 6, z, 0.4, 0.8, 0.8, C.lampGlow, { glow: true, jitter: 0 });
    for (let x = x0 + 6; x < winStart - 2; x += 12) b.box(x, 6, z0, 0.8, 0.8, 0.4, C.lampGlow, { glow: true, jitter: 0 });

    // Plaza around the hologram.
    b.tiles(-8.6, 0, -7.6, 17.2, 15.2, 0.05, C.plazaFloor, 1.9, 0.05);
    b.tiles(-4, 0.05, -4, 8, 8, 0.75, C.stone, 2, 0.06);
    for (const [px, pz, w, d] of [
      [-4, 3.85, 8, 0.15],
      [-4, -4, 8, 0.15],
      [-4, -4, 0.15, 8],
      [3.85, -4, 0.15, 8],
    ])
      b.box(px, 0.62, pz, w, 0.12, d, C.holo, { glow: true, jitter: 0 });
    for (const [px, pz] of [
      [0, -7],
      [-8, 0.5],
      [8, 0.5],
    ])
      this.plant(b, px, pz, r);

    // Front lounge: a pond on the right, a reading nook on the left.
    const pz = zRooms + 1.5;
    const px = x1 - 16;
    for (let x = px; x < x1 - 2; x += 1) {
      b.box(x, 0, pz, 1, 0.45, 1, C.stone, { jitter: 0.12 });
      b.box(x, 0, pz + 6, 1, 0.45, 1, C.stone, { jitter: 0.12 });
    }
    for (let z = pz + 1; z < pz + 6; z += 1) {
      b.box(px, 0, z, 1, 0.45, 1, C.stone, { jitter: 0.12 });
      b.box(x1 - 3, 0, z, 1, 0.45, 1, C.stone, { jitter: 0.12 });
    }
    for (let k = 0; k < 7; k++) b.box(px + 1.5 + r() * 10, 0.3, pz + 1.5 + r() * 3.6, 0.9, 0.06, 0.9, r() < 0.5 ? '#3f8f3a' : '#5aa84a', { jitter: 0.1 });
    const lx = x0 + 3;
    b.box(lx, 0.05, pz + 2, 6, 0.9, 1.8, '#4a3a5a');
    b.box(lx, 0.95, pz + 3.3, 6, 1.0, 0.5, '#4a3a5a');
    b.box(lx + 1.5, 0.05, pz - 0.2, 3, 0.7, 1.4, C.woodDark);
    b.box(lx + 8, 0.06, pz + 2.8, 0.6, 0.15, 0.6, C.woodDark);
    b.box(lx + 8.2, 0.2, pz + 3, 0.2, 2.4, 0.2, C.woodDark);
    b.box(lx + 7.8, 2.6, pz + 2.6, 1, 0.8, 1, C.lampGlow, { glow: true, jitter: 0 });
    this.loungeLight.position.set(lx + 8.3, 3, pz + 3.1);
    for (let x = x0 + 14; x < px - 2; x += 5) this.plant(b, x, pz + 4.5, r);

    env.add(b.build({ lit: this.litMat, glow: this.glowMat }));

    // Pond water.
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - 3 - (px + 1), 0.2, 5),
      new THREE.MeshStandardMaterial({ color: '#0d2a4a', roughness: 0.12, metalness: 0.4, emissive: '#06213f', emissiveIntensity: 0.6 }),
    );
    water.position.set((px + 1 + x1 - 3) / 2, 0.15, pz + 3.5);
    env.add(water);

    // Painted view and glass for the windows.
    if (windows.length) {
      // Close behind the wall and no taller than it, so it only shows through the glass.
      const left = windows[0][0] - 2;
      const right = x1 - 0.5;
      this.backdrop = new THREE.MeshBasicMaterial({ map: backdropTexture(this.night) });
      const view = new THREE.Mesh(new THREE.PlaneGeometry(right - left, 13), this.backdrop);
      view.position.set((left + right) / 2, 5.5, z0 - 3.5);
      env.add(view);
      const glass = new THREE.MeshStandardMaterial({ color: '#9cc8ff', transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.2, depthWrite: false });
      for (const [a, bb] of windows) {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(bb - a, 8), glass);
        pane.position.set((a + bb) / 2, 7, z0 - 0.5);
        env.add(pane);
      }
    } else this.backdrop = null;

    // The sign.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.25), new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false, color: '#d8deea' }));
    sign.rotation.y = Math.PI / 2;
    sign.position.set(x0 + 0.05, 9.5, z0 + 9);
    env.add(sign);

    // Hologram: glass case, glowing edges, a voxel globe and floating panels.
    const caseGeo = new THREE.BoxGeometry(6.4, 5, 6.4);
    const glassCase = new THREE.Mesh(caseGeo, new THREE.MeshStandardMaterial({ color: C.holo, transparent: true, opacity: 0.07, roughness: 0.1, depthWrite: false }));
    glassCase.position.set(0, 3.3, 0);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(caseGeo), new THREE.LineBasicMaterial({ color: C.holo, toneMapped: false }));
    edges.position.copy(glassCase.position);
    env.add(glassCase, edges);
    this.globe = this.buildGlobe();
    this.globe.position.set(0, 3.3, 0);
    env.add(this.globe);
    this.holoPanels = [];
    for (let k = 0; k < 5; k++) {
      const tex = screenTexture(C.holo, k % 2 ? 'chart' : 'code', 500 + k);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, toneMapped: false, side: THREE.DoubleSide, color: '#9fe6ff' }));
      this.holoPanels.push(p);
      env.add(p);
    }
    this.holoLight.position.set(0, 3.5, 0);

    this.cat = this.buildCat();
    env.add(this.cat.group);

    // Shadow camera hugs the whole office.
    const span = Math.max(x1 - x0, z1 - z0) / 2 + 4;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.sun.position.set(cx + span * 0.9, 60, cz - span * 1.2);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -span * 1.4;
    cam.right = span * 1.4;
    cam.top = span * 1.4;
    cam.bottom = -span * 1.4;
    cam.near = 1;
    cam.far = 200;
    cam.updateProjectionMatrix();

    this.onlineAnchor.set(0, 0.9, 4.4);
    this.env = env;
    this.scene.add(env);
  }

  private buildGlobe() {
    const g = new THREE.Group();
    const s = 0.24;
    const R = 1.7;
    const pts: THREE.Vector3[] = [];
    for (let x = -R; x <= R; x += s) for (let y = -R; y <= R; y += s) for (let z = -R; z <= R; z += s) if (Math.abs(Math.hypot(x, y, z) - R) < s * 0.55) pts.push(new THREE.Vector3(x, y, z));
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(s * 0.96, s * 0.96, s * 0.96), new THREE.MeshBasicMaterial({ toneMapped: false }), pts.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    pts.forEach((p, i) => {
      m.setPosition(p);
      mesh.setMatrixAt(i, m);
      const n = Math.sin(p.x * 2.1 + 1.3) * Math.cos(p.y * 1.7) + Math.sin(p.z * 2.6 + p.y * 0.9) * 0.8;
      const polar = Math.abs(p.y) > R * 0.86;
      col.set(polar ? '#e8f4ff' : n > 0.35 ? '#46b866' : '#2a6fd8').multiplyScalar(0.85);
      mesh.setColorAt(i, col);
    });
    g.add(mesh);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 24, 16), new THREE.MeshBasicMaterial({ color: C.holo, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false }));
    g.add(halo);
    return g;
  }

  private buildCat() {
    const group = new THREE.Group();
    const add = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, c: string) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(c));
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const fur = '#d98a3a';
    add(group, 0.55, 0.5, 1.2, 0, 0.62, 0, fur);
    add(group, 0.5, 0.46, 0.5, 0, 0.95, -0.72, fur);
    add(group, 0.36, 0.2, 0.06, 0, 0.82, -0.98, '#f3e6d3');
    for (const ex of [-0.12, 0.12]) {
      add(group, 0.14, 0.18, 0.1, ex, 1.24, -0.7, fur);
      add(group, 0.07, 0.07, 0.03, ex, 1.0, -0.98, '#1d1d24');
    }
    const legs: THREE.Object3D[] = [];
    for (const [lx, lz] of [
      [-0.17, -0.42],
      [0.17, -0.42],
      [-0.17, 0.42],
      [0.17, 0.42],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 0.4, lz);
      add(pivot, 0.16, 0.4, 0.16, 0, -0.2, 0, fur);
      group.add(pivot);
      legs.push(pivot);
    }
    const tail = new THREE.Group();
    tail.position.set(0, 0.8, 0.6);
    add(tail, 0.12, 0.12, 0.8, 0, 0.2, 0.3, fur).rotation.x = -0.6;
    group.add(tail);
    return { group, legs, tail, s: 0, rest: 0 };
  }

  /** The cat patrols the plaza and stops now and then to sit. */
  private updateCat(dt: number) {
    const cat = this.cat;
    if (!cat) return;
    const side = 9.4;
    const L = side * 4;
    const pos = (s: number) => {
      const u = ((s % L) + L) % L;
      const k = Math.floor(u / side);
      const f = u - k * side;
      const h = side / 2;
      return [
        new THREE.Vector3(-h + f, 0, h),
        new THREE.Vector3(h, 0, h - f),
        new THREE.Vector3(h - f, 0, -h),
        new THREE.Vector3(-h, 0, -h + f),
      ][k];
    };
    let walking = false;
    if (!this.motion) cat.rest = 1;
    else if (cat.rest > 0) cat.rest -= dt;
    else {
      walking = true;
      const before = Math.floor(cat.s / side);
      cat.s += dt * 1.6;
      if (Math.floor(cat.s / side) !== before && Math.floor(cat.s / side) % 3 === 0) cat.rest = 4;
    }
    const p = pos(cat.s);
    const ahead = pos(cat.s + 0.3);
    cat.group.position.copy(p);
    cat.group.lookAt(p.clone().multiplyScalar(2).sub(ahead).setY(0));
    const t = this.clock.elapsedTime;
    cat.legs.forEach((l, i) => (l.rotation.x = walking ? Math.sin(t * 10 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5 : 0));
    cat.tail.rotation.y = Math.sin(t * (walking ? 4 : 1.2)) * 0.4;
  }
}
