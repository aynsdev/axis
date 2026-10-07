import * as THREE from 'three';
import type { DeskStatus } from './palette';
import { hash, rng } from './random';

const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#8d5a3b', '#5c3a24', '#f5d7c0'];
const HAIR = ['#2b1d14', '#5a3a22', '#a8742f', '#e2c27a', '#1b1b1f', '#7a2e1d', '#d8d8d8'];
const PANTS = ['#2d3445', '#3b3026', '#23262d', '#40444f', '#2a3a2f'];

export interface Look {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  hat: 'none' | 'cap' | 'beanie' | 'headphones';
  hatColor: string;
}

export function lookFor(id: string, accent: string, kind: 'main' | 'sub'): Look {
  const r = rng(hash(id));
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const hats: Look['hat'][] = kind === 'main' ? ['cap', 'none', 'beanie'] : ['headphones', 'none', 'cap', 'none'];
  return { skin: pick(SKIN), hair: pick(HAIR), shirt: accent, pants: pick(PANTS), hat: pick(hats), hatColor: kind === 'main' ? accent : pick(HAIR) };
}

/** Where a character may stroll when it has nothing to do, in its parent's coordinates. */
export interface Wander {
  /** Beside the chair: where it stands up and sits down. */
  stand: THREE.Vector3;
  /** Spots in open floor, reachable in a straight line from `stand` and from each other. */
  spots: THREE.Vector3[];
}

type Pose = { arm: number; lean: number; headYaw: number; headPitch: number; type: number };
const POSES: Record<DeskStatus, Pose> = {
  working: { arm: 1.18, lean: 0.06, headYaw: 0, headPitch: 0.08, type: 1 },
  idle: { arm: 0.22, lean: -0.22, headYaw: 0, headPitch: -0.12, type: 0 },
  done: { arm: 0.4, lean: -0.3, headYaw: 0, headPitch: -0.2, type: 0 },
  off: { arm: 0.75, lean: -0.32, headYaw: 0, headPitch: 0.35, type: 0 },
};

const SEAT_HIP = 1.2;
const STAND_HIP = 2.02;
const WALK_SPEED = 1.5;
const SIT_SPEED = 2.2;

/**
 * A blocky person whose home is a chair facing -z; origin on the floor under the seat.
 * Working, it sits and types. With nothing to do it gets up after a moment, strolls
 * between open spots in its room, and heads back to its chair when work arrives.
 */
export class Character {
  readonly group = new THREE.Group();
  /** Everything above the floor; raised when standing. */
  private body = new THREE.Group();
  private upper = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private hips: THREE.Group[] = [];
  private knees: THREE.Group[] = [];
  private pose: Pose = { ...POSES.idle };
  private phase: number;
  private rand: () => number;

  private seat: THREE.Vector3;
  private wander: Wander | null;
  /** 1 seated, 0 standing. */
  private sit = 1;
  private path: THREE.Vector3[] = [];
  private pause = 0;
  private stride = 0;
  private idleFor = 0;
  private walking = false;

  constructor(look: Look, mat: (c: string) => THREE.Material, agentId: string, seat: THREE.Vector3, wander: Wander | null) {
    this.phase = (hash(agentId) % 1000) / 160;
    this.rand = rng(hash(agentId) ^ 0x5bd1e995);
    this.seat = seat.clone();
    this.wander = wander;
    this.group.position.copy(seat);
    this.group.add(this.body);

    const part = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: string) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      // Characters wander off their desks, so they are clickable themselves.
      m.userData = { agentId, pick: true };
      parent.add(m);
      return m;
    };

    // Legs hang from the hip; seated, the hip swings the thigh forward and the knee drops the shin.
    for (const sx of [-0.23, 0.23]) {
      const hip = new THREE.Group();
      hip.position.set(sx, 0, 0);
      this.body.add(hip);
      part(hip, 0.42, 1.0, 0.42, 0, -0.5, 0, look.pants);
      const knee = new THREE.Group();
      knee.position.set(0, -1.0, 0);
      hip.add(knee);
      part(knee, 0.42, 0.92, 0.42, 0, -0.46, 0, look.pants);
      part(knee, 0.46, 0.18, 0.6, 0, -0.92, -0.08, '#1c1a19');
      this.hips.push(hip);
      this.knees.push(knee);
    }

    this.upper.position.set(0, 0, 0.05);
    this.body.add(this.upper);
    part(this.upper, 0.92, 1.15, 0.5, 0, 0.6, 0, look.shirt);
    // Collar trim keeps the shirt from reading as a flat block.
    part(this.upper, 0.94, 0.12, 0.52, 0, 1.12, 0, new THREE.Color(look.shirt).offsetHSL(0, 0, -0.12).getStyle());

    for (const [g, sx] of [
      [this.armL, -0.67],
      [this.armR, 0.67],
    ] as const) {
      g.position.set(sx, 1.08, 0);
      this.upper.add(g);
      part(g, 0.4, 0.62, 0.4, 0, -0.28, 0, look.shirt);
      part(g, 0.38, 0.5, 0.38, 0, -0.82, 0, look.skin);
    }

    this.head.position.set(0, 1.2, 0);
    this.upper.add(this.head);
    part(this.head, 0.86, 0.86, 0.86, 0, 0.43, 0, look.skin);
    // Hair over the top and back; the face looks at the monitors.
    part(this.head, 0.9, 0.24, 0.9, 0, 0.8, 0, look.hair);
    part(this.head, 0.9, 0.62, 0.22, 0, 0.5, 0.36, look.hair);
    for (const ex of [-0.2, 0.2]) part(this.head, 0.14, 0.12, 0.04, ex, 0.5, -0.44, '#1d1d24');

    if (look.hat === 'cap') {
      part(this.head, 0.94, 0.26, 0.94, 0, 0.92, 0, look.hatColor);
      part(this.head, 0.8, 0.08, 0.4, 0, 0.82, -0.6, look.hatColor);
    } else if (look.hat === 'beanie') {
      part(this.head, 0.96, 0.36, 0.96, 0, 0.96, 0.02, look.hatColor);
    } else if (look.hat === 'headphones') {
      part(this.head, 1.02, 0.12, 0.16, 0, 0.93, 0, '#2a2a30');
      for (const hx of [-0.5, 0.5]) part(this.head, 0.16, 0.4, 0.4, hx, 0.48, 0, '#2a2a30');
    }
  }

  /** 0 seated to 1 standing, so a name plate can rise with its owner. */
  get rise() {
    return 1 - this.sit;
  }

  update(t: number, dt: number, status: DeskStatus, motion: boolean) {
    const busy = status === 'working';
    if (!motion || !this.wander) this.settle();
    else this.move(dt, busy);

    const target = POSES[status];
    const k = motion ? 1 - Math.exp(-dt * 5) : 1;
    for (const key of Object.keys(target) as (keyof Pose)[]) this.pose[key] += (target[key] - this.pose[key]) * k;
    const p = this.pose;
    const s = this.sit;
    const tt = motion ? t + this.phase : 0;

    // Legs: seated bends hip and knee 90°; walking swings them.
    const swing = this.walking ? Math.sin(this.stride) * 0.55 : 0;
    this.hips.forEach((h, i) => (h.rotation.x = s * (Math.PI / 2) + (1 - s) * (i ? -swing : swing)));
    // Knees only ever bend backward.
    this.knees.forEach((kn, i) => (kn.rotation.x = -s * (Math.PI / 2) - (1 - s) * Math.max(0, i ? swing : -swing) * 0.6));
    this.body.position.y = THREE.MathUtils.lerp(STAND_HIP, SEAT_HIP, s) + (this.walking ? Math.abs(Math.sin(this.stride)) * 0.06 : 0);

    // Arms: the seated pose blends into a relaxed swing on foot.
    const typing = p.type * Math.sin(tt * 13) * 0.09;
    const seatedArm = p.arm;
    this.armL.rotation.x = s * (seatedArm + typing) + (1 - s) * -swing * 0.8;
    this.armR.rotation.x = s * (seatedArm - typing) + (1 - s) * swing * 0.8;
    this.armL.rotation.z = -0.04;
    this.armR.rotation.z = 0.04;
    this.upper.rotation.x = s * (-p.lean + p.type * Math.sin(tt * 1.7) * 0.015);

    // Glances between screens while working; looks around while strolling.
    const looking = this.walking ? 0 : (1 - s) * Math.sin(tt * 0.7) * 0.6;
    this.head.rotation.y = s * (p.headYaw + p.type * Math.sin(tt * 0.55) * 0.42) + looking;
    this.head.rotation.x = s * (p.headPitch + (1 - p.type) * Math.sin(tt * 1.1) * 0.03);
  }

  /** Snaps to the chair, for reduced motion or when there is nowhere to walk. */
  private settle() {
    this.path = [];
    this.walking = false;
    this.sit = 1;
    this.group.position.copy(this.seat);
    this.group.rotation.y = 0;
  }

  private move(dt: number, busy: boolean) {
    const w = this.wander!;
    const pos = this.group.position;
    const atSeat = pos.distanceToSquared(this.seat) < 1e-4;

    if (busy) {
      this.idleFor = 0;
      if (atSeat) {
        this.walking = false;
        this.path = [];
        this.face(0, dt);
        this.sit = Math.min(1, this.sit + dt * SIT_SPEED);
        return;
      }
      // Head home: back to the stand spot, then into the chair.
      const last = this.path.at(-1);
      if (!last || !last.equals(this.seat)) this.path = pos.distanceToSquared(w.stand) < 1e-4 ? [this.seat] : [w.stand.clone(), this.seat];
      this.pause = 0;
    } else {
      this.idleFor += dt;
      // Linger a few seconds after finishing, so short gaps between tool calls don't send everyone pacing.
      if (atSeat && this.idleFor < 4 + (this.phase % 3)) {
        this.walking = false;
        this.sit = Math.min(1, this.sit + dt * SIT_SPEED);
        return;
      }
      if (atSeat && this.sit > 0) {
        this.walking = false;
        this.sit = Math.max(0, this.sit - dt * SIT_SPEED);
        return;
      }
      if (!this.path.length) {
        if (this.pause > 0) {
          this.pause -= dt;
          this.walking = false;
          return;
        }
        const from = atSeat ? [w.stand.clone()] : [];
        const spot = w.spots[Math.floor(this.rand() * w.spots.length)];
        this.path = [...from, spot.clone()];
      }
    }

    // Walk toward the next point on the path.
    const next = this.path[0];
    const to = next.clone().sub(pos).setY(0);
    const dist = to.length();
    const stepLen = WALK_SPEED * dt;
    // Stand fully before leaving the chair; sit only once there.
    if (this.sit > 0 && !next.equals(this.seat)) {
      this.sit = Math.max(0, this.sit - dt * SIT_SPEED);
      this.walking = false;
      return;
    }
    if (dist <= stepLen) {
      pos.copy(next);
      this.path.shift();
      if (!this.path.length && !busy) this.pause = 2 + this.rand() * 4;
      this.walking = this.path.length > 0;
      return;
    }
    this.walking = true;
    this.stride += dt * 9;
    pos.addScaledVector(to.divideScalar(dist), stepLen);
    // Back into the chair facing the desk; otherwise face where it's going.
    if (next.equals(this.seat) && dist < 0.8) this.face(0, dt);
    else this.face(Math.atan2(-to.x, -to.z), dt);
  }

  private face(yaw: number, dt: number) {
    const r = this.group.rotation;
    const d = Math.atan2(Math.sin(yaw - r.y), Math.cos(yaw - r.y));
    r.y += d * Math.min(1, dt * 8);
  }

  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
