const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const MIN_PIXEL_COUNT = 220;
const MIN_BOX_WIDTH_PX = 24;
const MIN_BOX_HEIGHT_PX = 24;
const MAX_BOX_WIDTH_PX = 76;
const MAX_BOX_HEIGHT_PX = 76;
const MIN_FILL_RATIO = 0.3;
const MAX_FILL_RATIO = 0.92;
const MIN_ASPECT_RATIO = 0.68;
const MAX_ASPECT_RATIO = 1.45;
const MIN_AVG_GREEN = 145;
const MIN_GREEN_DOMINANCE = 105;
const GREEN_RING_MIN_PIXEL_COUNT = 140;
const GREEN_RING_MIN_SIDE_PX = 30;
const GREEN_RING_MAX_SIDE_PX = 40;
const GREEN_RING_MIN_FILL_RATIO = 0.12;
const GREEN_RING_MAX_FILL_RATIO = 0.38;
const GREEN_RING_MIN_ASPECT_RATIO = 0.85;
const GREEN_RING_MAX_ASPECT_RATIO = 1.2;
const GREEN_RING_MIN_AVG_GREEN = 150;
const GREEN_RING_MIN_GREEN_DOMINANCE = 88;
const ACTIVE_NODE_MATCH_RADIUS_PX = 34;

function isGreen(r, g, b) {
  return g >= 132 && g - r >= 55 && g - b >= 28 && r <= 190 && b <= 190;
}

function isYellow(r, g, b) {
  return r >= 155 && g >= 105 && b <= 105 && r + g >= 285 && r - b >= 85 && g - b >= 35;
}

function axisDistance(dx, dy) {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function collectComponents(png, pixelFn) {
  const w = png.width;
  const h = png.height;
  const mask = new Uint8Array(w * h);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (pixelFn(r, g, b)) {
        mask[y * w + x] = 1;
      }
    }
  }

  const components = [];
  const remaining = mask.slice();

  for (let start = 0; start < remaining.length; start += 1) {
    if (!remaining[start]) {
      continue;
    }

    const stack = [start];
    remaining[start] = 0;

    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;

    while (stack.length > 0) {
      const idx = stack.pop();
      const x = idx % w;
      const y = Math.floor(idx / w);
      const i = (y * w + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];

      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      redSum += r;
      greenSum += g;
      blueSum += b;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!remaining[ni]) continue;
          remaining[ni] = 0;
          stack.push(ni);
        }
      }
    }

    components.push({ minX, minY, maxX, maxY, pixelCount, redSum, greenSum, blueSum });
  }

  return components;
}

function toBox(candidate, color) {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const fillRatio = candidate.pixelCount / (width * height);
  const aspectRatio = width / height;

  const avgRed = candidate.redSum / candidate.pixelCount;
  const avgGreen = candidate.greenSum / candidate.pixelCount;
  const avgBlue = candidate.blueSum / candidate.pixelCount;
  const greenDominance = avgGreen - (avgRed + avgBlue) / 2;

  if (color === 'green') {
    const denseGreenGeometryOk =
      candidate.pixelCount >= MIN_PIXEL_COUNT &&
      width >= MIN_BOX_WIDTH_PX &&
      height >= MIN_BOX_HEIGHT_PX &&
      width <= MAX_BOX_WIDTH_PX &&
      height <= MAX_BOX_HEIGHT_PX &&
      fillRatio >= MIN_FILL_RATIO &&
      fillRatio <= MAX_FILL_RATIO &&
      aspectRatio >= MIN_ASPECT_RATIO &&
      aspectRatio <= MAX_ASPECT_RATIO;

    const ringGreenGeometryOk =
      candidate.pixelCount >= GREEN_RING_MIN_PIXEL_COUNT &&
      width >= GREEN_RING_MIN_SIDE_PX &&
      height >= GREEN_RING_MIN_SIDE_PX &&
      width <= GREEN_RING_MAX_SIDE_PX &&
      height <= GREEN_RING_MAX_SIDE_PX &&
      fillRatio >= GREEN_RING_MIN_FILL_RATIO &&
      fillRatio <= GREEN_RING_MAX_FILL_RATIO &&
      aspectRatio >= GREEN_RING_MIN_ASPECT_RATIO &&
      aspectRatio <= GREEN_RING_MAX_ASPECT_RATIO;

    const denseGreenSignalOk = avgGreen >= MIN_AVG_GREEN && greenDominance >= MIN_GREEN_DOMINANCE;
    const ringGreenSignalOk = avgGreen >= GREEN_RING_MIN_AVG_GREEN && greenDominance >= GREEN_RING_MIN_GREEN_DOMINANCE;

    if (!(denseGreenGeometryOk && denseGreenSignalOk) && !(ringGreenGeometryOk && ringGreenSignalOk)) {
      return null;
    }
  } else {
    const redDominance = avgRed - (avgGreen + avgBlue) / 2;

    const denseYellowOk =
      candidate.pixelCount >= MIN_PIXEL_COUNT &&
      width >= MIN_BOX_WIDTH_PX &&
      height >= MIN_BOX_HEIGHT_PX &&
      width <= MAX_BOX_WIDTH_PX &&
      height <= MAX_BOX_HEIGHT_PX &&
      fillRatio >= MIN_FILL_RATIO &&
      fillRatio <= MAX_FILL_RATIO &&
      aspectRatio >= MIN_ASPECT_RATIO &&
      aspectRatio <= MAX_ASPECT_RATIO &&
      avgRed >= 165 &&
      redDominance >= 60;

    const ringYellowOk =
      candidate.pixelCount >= 130 &&
      width >= 22 &&
      height >= 22 &&
      width <= 44 &&
      height <= 44 &&
      fillRatio >= 0.1 &&
      fillRatio <= 0.62 &&
      aspectRatio >= 0.7 &&
      aspectRatio <= 1.45 &&
      avgRed >= 160 &&
      redDominance >= 60;

    if (!denseYellowOk && !ringYellowOk) {
      return null;
    }
  }

  return {
    x: candidate.minX,
    y: candidate.minY,
    width,
    height,
    centerX: Math.round(candidate.minX + width / 2),
    centerY: Math.round(candidate.minY + height / 2),
    color,
  };
}

function detectBoxes(png) {
  const green = collectComponents(png, isGreen)
    .filter((c) => c.pixelCount >= 8)
    .map((c) => toBox(c, 'green'))
    .filter(Boolean);

  const yellow = collectComponents(png, isYellow)
    .filter((c) => c.pixelCount >= 8)
    .map((c) => toBox(c, 'yellow'))
    .filter(Boolean);

  return [...green, ...yellow];
}

function findActiveCenter(png) {
  const w = png.width;
  const h = png.height;
  const mask = new Uint8Array(w * h);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (Math.abs(r - 64) <= 6 && Math.abs(g - 220) <= 6 && Math.abs(b - 255) <= 6) {
        mask[y * w + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(w * h);
  let best = null;

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || visited[i]) continue;
    const stack = [i];
    visited[i] = 1;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let count = 0;

    while (stack.length > 0) {
      const p = stack.pop();
      const x = p % w;
      const y = Math.floor(p / w);
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || visited[ni]) continue;
          visited[ni] = 1;
          stack.push(ni);
        }
      }
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (width < 10 || height < 10 || width > 30 || height > 30) {
      continue;
    }
    if (!best || count > best.count) {
      best = { minX, minY, maxX, maxY, count };
    }
  }

  if (!best) return null;
  return {
    x: Math.round((best.minX + best.maxX) / 2),
    y: Math.round((best.minY + best.maxY) / 2),
  };
}

function nearestBox(boxes, pt) {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCenter = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nx = Math.max(box.x, Math.min(pt.x, box.x + box.width - 1));
    const ny = Math.max(box.y, Math.min(pt.y, box.y + box.height - 1));
    const d = axisDistance(pt.x - nx, pt.y - ny);
    const cd = axisDistance(box.centerX - pt.x, box.centerY - pt.y);
    if (d < bestDist || (Math.abs(d - bestDist) < 0.001 && cd < bestCenter)) {
      best = box;
      bestDist = d;
      bestCenter = cd;
    }
  }

  if (!best) return null;
  return { box: best, d: bestDist };
}

function loadPng(filePath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(new PNG())
      .on('parsed', function parsed() {
        resolve(this);
      })
      .on('error', reject);
  });
}

(async () => {
  const files = fs.readdirSync('./ocr-debug')
    .filter((f) => /-motherlode-mine\.png$/i.test(f))
    .map((f) => ({ f, n: Number(f.split('-')[0]) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n);

  for (const { f, n } of files) {
    const png = await loadPng(path.join('./ocr-debug', f));
    const boxes = detectBoxes(png);
    const green = boxes.filter((b) => b.color === 'green').length;
    const yellow = boxes.filter((b) => b.color === 'yellow').length;
    const active = findActiveCenter(png);
    if (!active) {
      console.log(`#${n}: boxes=${boxes.length} green=${green} yellow=${yellow} active=none`);
      continue;
    }
    const nearest = nearestBox(boxes, active);
    if (!nearest) {
      console.log(`#${n}: boxes=0 active=(${active.x},${active.y})`);
      continue;
    }

    const within = nearest.d <= ACTIVE_NODE_MATCH_RADIUS_PX;
    console.log(`#${n}: active=(${active.x},${active.y}) boxes=${boxes.length} green=${green} yellow=${yellow} nearest=${nearest.box.color}@(${nearest.box.centerX},${nearest.box.centerY}) d=${nearest.d} within=${within}`);
  }
})();
