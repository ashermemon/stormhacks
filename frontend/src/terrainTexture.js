// Softens the hard edges between the terrain texture's big colour zones (shore sand,
// grass, mountain rock, snow) so the ground fades from one to the next instead of
// switching abruptly. Detail inside a zone (light/dark grass patches, rock patches)
// stays crisp. Runs once on load, on a downscaled copy for the blurs.

const WORK_SIZE = 512; // blurs run at this resolution, then get upsampled
// Blend radii in WORK_SIZE pixels (the 2048 texture covers the 300-unit map, so
// 1 px here is about 0.6 units). The sand rim is thin, so its blend stays narrow.
const SHORE_GRASS_RADIUS = 2;
const GRASS_MOUNTAIN_RADIUS = 7;
// Snow fades outward into the rock (snow pixels themselves are left white, so even
// small snow patches keep their colour).
const ROCK_SNOW_RADIUS = 4;

const SHORE = 0;
const GRASS = 1;
const ROCK = 2;
const SNOW = 3;

const isSnow = (r, g, b) => Math.min(r, g, b) > 190;
// Stricter test for "leave this pixel alone": the texture's anti-aliased snow edge
// pixels are greyish and should be faded too, or they'd leave a faint grey rim.
const isPureSnow = (r, g, b) => Math.min(r, g, b) > 228;

function zoneOf(r, g, b) {
  if (g - Math.max(r, b) > 30) return GRASS; // the two greens
  if (isSnow(r, g, b)) return SNOW; // near-white
  if (r - b > 30) return SHORE; // sand rim and stream/pond bed
  return ROCK; // the two greys
}

export function softenTerrainTexture(texture) {
  const image = texture.image;
  const width = image.width;
  const height = image.height;

  const full = makeCanvas(width, height);
  full.ctx.drawImage(image, 0, 0);
  const out = full.ctx.getImageData(0, 0, width, height);
  const px = out.data;

  // Downscaled planes: colour and one-hot zone masks.
  const n = WORK_SIZE;
  const small = makeCanvas(n, n);
  small.ctx.drawImage(image, 0, 0, n, n);
  const sp = small.ctx.getImageData(0, 0, n, n).data;
  const rgb = [0, 1, 2].map(() => new Float32Array(n * n));
  const zones = [0, 1, 2, 3].map(() => new Float32Array(n * n));
  const snowColor = [0, 0, 0];
  let snowCount = 0;
  for (let i = 0; i < n * n; i++) {
    const r = sp[i * 4];
    const g = sp[i * 4 + 1];
    const b = sp[i * 4 + 2];
    rgb[0][i] = r;
    rgb[1][i] = g;
    rgb[2][i] = b;
    const zone = zoneOf(r, g, b);
    zones[zone][i] = 1;
    if (zone === SNOW) {
      snowColor[0] += r;
      snowColor[1] += g;
      snowColor[2] += b;
      snowCount++;
    }
  }
  for (let c = 0; c < 3; c++) snowColor[c] /= Math.max(snowCount, 1);

  // Narrow blend for shore<->grass, medium for rock<->snow, wide for grass<->mountain.
  const blurAll = (planes, radius) => planes.map((p) => blur(p, n, radius));
  const narrowRgb = blurAll(rgb, SHORE_GRASS_RADIUS);
  const narrowZones = blurAll(zones, SHORE_GRASS_RADIUS);
  const wideRgb = blurAll(rgb, GRASS_MOUNTAIN_RADIUS);
  const wideZones = blurAll(zones, GRASS_MOUNTAIN_RADIUS);
  const snowNearby = blur(zones[SNOW], n, ROCK_SNOW_RADIUS);

  // Blend weight peaks (1) where two zones meet 50/50 and is 0 inside a zone.
  const shoreGrass = new Float32Array(n * n);
  const grassMountain = new Float32Array(n * n);
  const rockSnow = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    shoreGrass[i] = smooth(4 * narrowZones[SHORE][i] * narrowZones[GRASS][i]);
    const mountain = wideZones[ROCK][i] + wideZones[SNOW][i];
    grassMountain[i] = smooth(4 * wideZones[GRASS][i] * mountain);
    // 1 right at a snow edge (half the neighbourhood is snow), fading to 0 outward.
    rockSnow[i] = smooth(2 * snowNearby[i]);
  }

  // Composite at full resolution, bilinearly sampling the small planes.
  const scaleX = n / width;
  const scaleY = n / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(Math.max((y + 0.5) * scaleY - 0.5, 0), n - 1);
    const y0 = Math.min(Math.floor(sy), n - 2);
    const ty = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(Math.max((x + 0.5) * scaleX - 0.5, 0), n - 1);
      const x0 = Math.min(Math.floor(sx), n - 2);
      const tx = sx - x0;
      const i00 = y0 * n + x0;
      const i10 = i00 + 1;
      const i01 = i00 + n;
      const i11 = i01 + 1;
      const sample = (p) =>
        (p[i00] * (1 - tx) + p[i10] * tx) * (1 - ty) +
        (p[i01] * (1 - tx) + p[i11] * tx) * ty;

      const wm = sample(grassMountain);
      const wn = sample(rockSnow);
      const ws = sample(shoreGrass);
      if (wm < 0.002 && wn < 0.002 && ws < 0.002) continue;
      const o = (y * width + x) * 4;
      const snow = isPureSnow(px[o], px[o + 1], px[o + 2]);
      for (let c = 0; c < 3; c++) {
        let v = px[o + c];
        if (wm >= 0.002) v += (sample(wideRgb[c]) - v) * wm;
        if (wn >= 0.002 && !snow) v += (snowColor[c] - v) * wn;
        if (ws >= 0.002) v += (sample(narrowRgb[c]) - v) * ws;
        px[o + c] = v;
      }
    }
  }

  full.ctx.putImageData(out, 0, 0);
  texture.image = full.canvas;
  texture.needsUpdate = true;
  return texture;
}

// Separable box blur, three passes (close to a gaussian), clamped at the edges.
function blur(src, n, radius) {
  let a = Float32Array.from(src);
  let b = new Float32Array(n * n);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, n, radius, 1, n); // horizontal
    boxPass(b, a, n, radius, n, 1); // vertical
  }
  return a;
}

function boxPass(src, dst, n, r, step, lineStep) {
  const span = 2 * r + 1;
  for (let line = 0; line < n; line++) {
    const base = line * lineStep;
    const at = (k) => src[base + Math.min(Math.max(k, 0), n - 1) * step];
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += at(k);
    for (let k = 0; k < n; k++) {
      dst[base + k * step] = sum / span;
      sum += at(k + r + 1) - at(k - r);
    }
  }
}

function smooth(t) {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) };
}
