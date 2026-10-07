import * as THREE from 'three';
import { rng } from './voxels';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function texture(c: HTMLCanvasElement, pixelated = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (pixelated) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
  return t;
}

export type ScreenKind = 'code' | 'terminal' | 'chart';

/** A tall strip of fake screen content; scrolling its offset reads as live output. */
export function screenTexture(accent: string, kind: ScreenKind, seed: number) {
  const [c, g] = canvas(64, 192);
  const r = rng(seed);
  g.fillStyle = '#0b0f17';
  g.fillRect(0, 0, 64, 192);
  const a = new THREE.Color(accent);
  const tones = [a.getStyle(), '#e6edf3', '#7d8590', new THREE.Color(accent).offsetHSL(0.15, 0, 0.1).getStyle(), '#3fb950'];
  if (kind === 'chart') {
    for (let y = 0; y < 192; y += 48) {
      g.fillStyle = '#161b26';
      g.fillRect(4, y + 4, 56, 40);
      for (let x = 0; x < 8; x++) {
        const h = 6 + r() * 30;
        g.fillStyle = x % 3 === 0 ? tones[3] : tones[0];
        g.fillRect(8 + x * 6, y + 40 - h, 4, h);
      }
    }
  } else {
    for (let y = 3; y < 190; y += 5) {
      let x = 3 + (kind === 'code' ? Math.floor(r() * 4) * 4 : 0);
      if (kind === 'terminal' && r() < 0.5) {
        g.fillStyle = tones[4];
        g.fillRect(3, y, 3, 3);
        x = 8;
      }
      while (x < 58 && r() < 0.85) {
        const w = 3 + Math.floor(r() * 12);
        g.fillStyle = tones[Math.floor(r() * (kind === 'terminal' ? 3 : 4))];
        g.fillRect(x, y, Math.min(w, 61 - x), 3);
        x += w + 2;
      }
    }
  }
  const t = texture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 0.5);
  return t;
}

/** The big wall sign from the reference: name over a tagline. */
export function signTexture() {
  const [c, g] = canvas(1024, 384);
  g.fillStyle = '#10131a';
  g.fillRect(0, 0, 1024, 384);
  g.strokeStyle = '#2a3142';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 1014, 374);
  g.fillStyle = '#f2f4f8';
  g.font = '800 168px "Inter Variable", Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('AXIS', 512, 150);
  g.fillStyle = '#9fb1d1';
  g.font = '600 44px "Inter Variable", Inter, system-ui, sans-serif';
  g.fillText('BUILD  ·  RUN  ·  MONITOR  ·  TOGETHER', 512, 290);
  return texture(c, false);
}

/** A painted view for the windows: lake, hills and a village, by night or by day. */
export function backdropTexture(night: boolean) {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(night ? 7 : 11);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
  if (night) {
    sky.addColorStop(0, '#060a1a');
    sky.addColorStop(1, '#1b2550');
  } else {
    sky.addColorStop(0, '#5fa8e8');
    sky.addColorStop(1, '#cfe7f7');
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  if (night) {
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
      g.fillRect(Math.floor(r() * W), Math.floor(r() * H * 0.5), 1 + (r() < 0.1 ? 1 : 0), 1);
    }
    // A blocky moon.
    g.fillStyle = '#cfe0ff';
    g.fillRect(400, 28, 40, 40);
    g.fillStyle = '#a9c0ee';
    g.fillRect(408, 36, 10, 8);
    g.fillRect(424, 52, 8, 8);
  } else {
    g.fillStyle = '#fff3c4';
    g.fillRect(404, 30, 34, 34);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      const x = r() * W;
      const y = 20 + r() * 60;
      g.fillRect(x, y, 40 + r() * 40, 10);
      g.fillRect(x + 10, y - 6, 24, 8);
    }
  }

  // Stepped hills.
  const horizon = H * 0.62;
  for (const [base, color] of [
    [horizon - 52, night ? '#0d1424' : '#6f9a5a'],
    [horizon - 26, night ? '#111a2c' : '#5d8a4a'],
  ] as const) {
    g.fillStyle = color;
    let y = base;
    for (let x = 0; x < W; x += 8) {
      y = Math.max(base - 30, Math.min(horizon, y + (r() - 0.5) * 16));
      g.fillRect(x, Math.floor(y / 4) * 4, 8, H);
    }
  }

  // Village with lit windows at night.
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(r() * (W - 30));
    const w = 14 + Math.floor(r() * 16);
    const h = 12 + Math.floor(r() * 18);
    g.fillStyle = night ? '#1a1f2c' : '#d8c3a0';
    g.fillRect(x, horizon - h, w, h);
    g.fillStyle = night ? '#141824' : '#9a4f3a';
    g.fillRect(x - 2, horizon - h - 5, w + 4, 6);
    for (let k = 0; k < 3; k++) {
      if (r() < 0.6) {
        g.fillStyle = night ? '#ffc56b' : '#4a5a6a';
        g.fillRect(x + 3 + Math.floor(r() * (w - 6)), horizon - h + 4 + Math.floor(r() * (h - 8)), 3, 3);
      }
    }
  }

  // Lake with streaky reflections.
  g.fillStyle = night ? '#0a1226' : '#7fb3d9';
  g.fillRect(0, horizon, W, H - horizon);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = night ? `rgba(255,197,107,${0.15 + r() * 0.35})` : 'rgba(255,255,255,0.35)';
    g.fillRect(Math.floor(r() * W), horizon + 3 + Math.floor(r() * (H - horizon - 6)), 4 + Math.floor(r() * 10), 1);
  }
  // A jetty.
  g.fillStyle = night ? '#2a2018' : '#7a5a3a';
  g.fillRect(150, horizon + 18, 120, 4);
  for (let x = 154; x < 270; x += 18) g.fillRect(x, horizon + 22, 3, 10);

  return texture(c);
}

export function textTexture(text: string, color: string) {
  const [c, g] = canvas(256, 64);
  g.fillStyle = color;
  g.font = '700 40px "Inter Variable", Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  return texture(c, false);
}
