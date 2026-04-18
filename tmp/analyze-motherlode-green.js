const fs = require('fs');
const { PNG } = require('pngjs');

const file = process.argv[2] || 'test-images/motherlode-mine-box/3-motherlode-mine.png';
const MIN_PIXEL_COUNT = 140;
const MIN_BOX_WIDTH_PX = 24;
const MIN_BOX_HEIGHT_PX = 24;
const MAX_BOX_WIDTH_PX = 76;
const MAX_BOX_HEIGHT_PX = 76;
const MIN_FILL_RATIO = 0.12;
const MAX_FILL_RATIO = 0.92;
const MIN_ASPECT_RATIO = 0.68;
const MAX_ASPECT_RATIO = 1.45;
const MIN_AVG_GREEN = 145;
const MIN_GREEN_DOMINANCE = 88;

const COMPONENT_MERGE_GAP_PX = 5;
const COMPONENT_MIN_OVERLAP_RATIO = 0.8;
const MAX_MERGED_COMPONENT_WIDTH_PX = MAX_BOX_WIDTH_PX + 8;
const MAX_MERGED_COMPONENT_HEIGHT_PX = MAX_BOX_HEIGHT_PX + 8;

function isMotherlodeGreenPixel(r, g, b) {
  return g >= 132 && g - r >= 55 && g - b >= 28 && r <= 190 && b <= 190;
}

function axisGap(minA, maxA, minB, maxB) {
  if (maxA < minB) return minB - maxA - 1;
  if (maxB < minA) return minA - maxB - 1;
  return 0;
}
function axisOverlap(minA, maxA, minB, maxB) {
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB) + 1);
}
function axisOverlapRatio(minA, maxA, minB, maxB) {
  const overlap = axisOverlap(minA, maxA, minB, maxB);
  if (overlap <= 0) return 0;
  const lenA = maxA - minA + 1;
  const lenB = maxB - minB + 1;
  return overlap / Math.min(lenA, lenB);
}
function shouldMergeComponents(a, b) {
  const gapX = axisGap(a.minX, a.maxX, b.minX, b.maxX);
  const gapY = axisGap(a.minY, a.maxY, b.minY, b.maxY);
  if (gapX > COMPONENT_MERGE_GAP_PX || gapY > COMPONENT_MERGE_GAP_PX) return false;
  const overlapXRatio = axisOverlapRatio(a.minX, a.maxX, b.minX, b.maxX);
  const overlapYRatio = axisOverlapRatio(a.minY, a.maxY, b.minY, b.maxY);
  if (overlapXRatio < COMPONENT_MIN_OVERLAP_RATIO && overlapYRatio < COMPONENT_MIN_OVERLAP_RATIO) return false;
  const mergedWidth = Math.max(a.maxX, b.maxX) - Math.min(a.minX, b.minX) + 1;
  const mergedHeight = Math.max(a.maxY, b.maxY) - Math.min(a.minY, b.minY) + 1;
  return mergedWidth <= MAX_MERGED_COMPONENT_WIDTH_PX && mergedHeight <= MAX_MERGED_COMPONENT_HEIGHT_PX;
}
function mergeComponent(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    pixelCount: a.pixelCount + b.pixelCount,
    redSum: a.redSum + b.redSum,
    greenSum: a.greenSum + b.greenSum,
    blueSum: a.blueSum + b.blueSum,
  };
}
function mergeNearbyComponents(components) {
  const merged = components.slice();
  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        if (!shouldMergeComponents(merged[i], merged[j])) continue;
        merged[i] = mergeComponent(merged[i], merged[j]);
        merged.splice(j, 1);
        didMerge = true;
        break;
      }
      if (didMerge) break;
    }
  }
  return merged;
}

function computeInnerFillRatio(mask, imageWidth, minX, minY, maxX, maxY) {
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const insetX = Math.max(2, Math.floor(width * 0.24));
  const insetY = Math.max(2, Math.floor(height * 0.24));
  const innerMinX = minX + insetX;
  const innerMaxX = maxX - insetX;
  const innerMinY = minY + insetY;
  const innerMaxY = maxY - insetY;

  if (innerMinX > innerMaxX || innerMinY > innerMaxY) {
    return 1;
  }

  let innerPixels = 0;
  let innerArea = 0;

  for (let y = innerMinY; y <= innerMaxY; y += 1) {
    for (let x = innerMinX; x <= innerMaxX; x += 1) {
      innerArea += 1;
      if (mask[y * imageWidth + x]) {
        innerPixels += 1;
      }
    }
  }

  if (innerArea === 0) {
    return 1;
  }

  return innerPixels / innerArea;
}

fs.createReadStream(file)
  .pipe(new PNG())
  .on('parsed', function () {
    const width = this.width;
    const height = this.height;
    const mask = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = this.data[idx];
        const g = this.data[idx + 1];
        const b = this.data[idx + 2];
        if (isMotherlodeGreenPixel(r, g, b)) {
          mask[y * width + x] = 1;
        }
      }
    }

    const remaining = mask.slice();
    const components = [];

    for (let start = 0; start < remaining.length; start++) {
      if (!remaining[start]) continue;
      const stack = [start];
      remaining[start] = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      let pixelCount = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      while (stack.length) {
        const index = stack.pop();
        const x = index % width;
        const y = Math.floor(index / width);
        const pidx = (y * width + x) * 4;
        const r = this.data[pidx];
        const g = this.data[pidx + 1];
        const b = this.data[pidx + 2];
        pixelCount += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        redSum += r;
        greenSum += g;
        blueSum += b;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nidx = ny * width + nx;
            if (!remaining[nidx]) continue;
            remaining[nidx] = 0;
            stack.push(nidx);
          }
        }
      }

      components.push({ minX, minY, maxX, maxY, pixelCount, redSum, greenSum, blueSum });
    }

    const merged = mergeNearbyComponents(components.filter((c) => c.pixelCount >= 8));
    const evaluated = merged
      .map((c) => {
        const w = c.maxX - c.minX + 1;
        const h = c.maxY - c.minY + 1;
        const fill = c.pixelCount / (w * h);
        const aspect = w / h;
        const avgR = c.redSum / c.pixelCount;
        const avgG = c.greenSum / c.pixelCount;
        const avgB = c.blueSum / c.pixelCount;
        const dom = avgG - (avgR + avgB) / 2;
        const innerFill = computeInnerFillRatio(mask, width, c.minX, c.minY, c.maxX, c.maxY);
        const reasons = [];
        if (c.pixelCount < MIN_PIXEL_COUNT) reasons.push('pixelCount');
        if (w < MIN_BOX_WIDTH_PX) reasons.push('minWidth');
        if (h < MIN_BOX_HEIGHT_PX) reasons.push('minHeight');
        if (w > MAX_BOX_WIDTH_PX) reasons.push('maxWidth');
        if (h > MAX_BOX_HEIGHT_PX) reasons.push('maxHeight');
        if (fill < MIN_FILL_RATIO) reasons.push('minFill');
        if (fill > MAX_FILL_RATIO) reasons.push('maxFill');
        if (aspect < MIN_ASPECT_RATIO) reasons.push('minAspect');
        if (aspect > MAX_ASPECT_RATIO) reasons.push('maxAspect');
        if (avgG < MIN_AVG_GREEN) reasons.push('avgGreen');
        if (dom < MIN_GREEN_DOMINANCE) reasons.push('dominance');
        return {
          x: c.minX,
          y: c.minY,
          w,
          h,
          pixels: c.pixelCount,
          fill: Number(fill.toFixed(3)),
          innerFill: Number(innerFill.toFixed(3)),
          aspect: Number(aspect.toFixed(3)),
          avgG: Number(avgG.toFixed(1)),
          dom: Number(dom.toFixed(1)),
          pass: reasons.length === 0,
          reasons,
        };
      })
      .sort((a, b) => b.pixels - a.pixels);

    const pass = evaluated.filter((v) => v.pass);
    const fail = evaluated.filter((v) => !v.pass && v.pixels >= 40);

    console.log('File:', file);
    console.log('PASS count:', pass.length);
    pass.slice(0, 25).forEach((v) => console.log('PASS', JSON.stringify(v)));
    console.log('FAIL>=40 count:', fail.length);
    fail.slice(0, 80).forEach((v) => console.log('FAIL', JSON.stringify(v)));
  })
  .on('error', (err) => {
    console.error(err);
    process.exit(1);
  });