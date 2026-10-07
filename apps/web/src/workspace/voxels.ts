import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './random';

export { hash, rng } from './random';

const tmp = new THREE.Color();

/**
 * Collects boxes and merges them into one lit and one glowing mesh, so a room is
 * two draw calls however many blocks it has. Colors get a little per-block jitter
 * for the hand-placed voxel look.
 */
export class VoxelBatch {
  private lit: THREE.BufferGeometry[] = [];
  private glow: THREE.BufferGeometry[] = [];
  private rand: () => number;

  constructor(seed = 1) {
    this.rand = rng(seed);
  }

  /** Adds a box by its min corner and size. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, opts: { glow?: boolean; jitter?: number } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x + w / 2, y + h / 2, z + d / 2);
    tmp.set(color);
    const j = opts.jitter ?? 0.06;
    if (j) tmp.offsetHSL(0, 0, (this.rand() - 0.5) * j);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    (opts.glow ? this.glow : this.lit).push(g);
    return this;
  }

  /** Fills a w×d area with 1×1 tiles of thickness h, each jittered. */
  tiles(x: number, y: number, z: number, w: number, d: number, h: number, color: THREE.ColorRepresentation, size = 1, jitter = 0.08) {
    for (let i = 0; i < w; i += size) for (let k = 0; k < d; k += size) this.box(x + i, y, z + k, Math.min(size, w - i), h, Math.min(size, d - k), color, { jitter });
    return this;
  }

  build(materials: { lit: THREE.Material; glow: THREE.Material }, shadows = true): THREE.Group {
    const group = new THREE.Group();
    if (this.lit.length) {
      const mesh = new THREE.Mesh(mergeGeometries(this.lit), materials.lit);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (this.glow.length) group.add(new THREE.Mesh(mergeGeometries(this.glow), materials.glow));
    for (const g of [...this.lit, ...this.glow]) g.dispose();
    this.lit = [];
    this.glow = [];
    return group;
  }
}

export function disposeTree(root: THREE.Object3D, keep: Set<THREE.Material | THREE.Texture> = new Set()) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (keep.has(mat)) continue;
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map && !keep.has(map)) map.dispose();
      mat.dispose();
    }
  });
}
