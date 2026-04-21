import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { detectCyanBoxesInScreenshot } from "./cyan-box-detector";
import {
  detectMotherlodeMineBoxesInScreenshot,
  MotherlodeMineBox,
  saveBitmapWithMotherlodeMineBoxes,
} from "./motherlode-mine-box-detector";
import { selectNearestGreenMotherlodeNode } from "./motherlode-target-selection";
import { detectBestPlayerBoxInScreenshot } from "./player-box-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type ExpectedActiveNode = {
  activeCenterX: number;
  activeCenterY: number;
  activeTolerancePx: number;
  fragmentedNode?: {
    maxFillRatio: number;
    maxPixelCount: number;
  };
  tinyCyan?: {
    centerX: number;
    centerY: number;
    tolerancePx: number;
    minDistanceFromActivePx: number;
  };
};

type TinyCyanCandidate = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
};

type CaptureBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const ACTIVE_NODE_MATCH_RADIUS_PX = 34;

const EXPECTED_BY_SCREENSHOT: Record<string, ExpectedActiveNode> = {
  "1615x1549-2k-125.png": {
    activeCenterX: 783,
    activeCenterY: 813,
    activeTolerancePx: 20,
  },
  "1615x1549-2k-125-2.png": {
    activeCenterX: 789,
    activeCenterY: 718,
    activeTolerancePx: 20,
  },
  "1615x1549-2k-125-3.png": {
    activeCenterX: 740,
    activeCenterY: 768,
    activeTolerancePx: 20,
  },
  "1615x1549-2k-125-4.png": {
    activeCenterX: 841,
    activeCenterY: 759,
    activeTolerancePx: 20,
  },
};

function parseExpectedActiveNodeFromFilename(screenshotPath: string): ExpectedActiveNode | null {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const match = basename.match(/-\[(\d+)\]-\[(\d+)\]-\[[-+]?\d+\]$/i);
  if (!match) {
    return null;
  }

  const activeCenterX = Number(match[1]);
  const activeCenterY = Number(match[2]);
  if (!Number.isFinite(activeCenterX) || !Number.isFinite(activeCenterY)) {
    return null;
  }

  return {
    activeCenterX,
    activeCenterY,
    activeTolerancePx: 20,
  };
}

function resolveExpectedActiveNode(screenshotPath: string): ExpectedActiveNode | null {
  const byMap = EXPECTED_BY_SCREENSHOT[path.basename(screenshotPath)];
  if (byMap) {
    return byMap;
  }

  return parseExpectedActiveNodeFromFilename(screenshotPath);
}

function loadScreenshot(filePath: string): Promise<RobotBitmap | null> {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const png = new PNG();

    fs.createReadStream(filePath)
      .pipe(png)
      .on("parsed", function (this: PNG) {
        const buffer = Buffer.alloc(png.width * png.height * 4);

        for (let index = 0; index < png.data.length; index += 4) {
          const r = png.data[index];
          const g = png.data[index + 1];
          const b = png.data[index + 2];

          buffer[index] = b;
          buffer[index + 1] = g;
          buffer[index + 2] = r;
          buffer[index + 3] = 255;
        }

        resolve({
          width: png.width,
          height: png.height,
          byteWidth: png.width * 4,
          bytesPerPixel: 4,
          image: buffer,
        });
      })
      .on("error", (error) => {
        console.error(`Failed to load image: ${error}`);
        resolve(null);
      });
  });
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function expandScreenshotArgs(args: string[]): string[] {
  const expanded: string[] = [];

  for (const arg of args) {
    if (!arg.includes("*")) {
      expanded.push(arg);
      continue;
    }

    const normalized = arg.replace(/\\/g, "/");
    const slashIndex = normalized.lastIndexOf("/");
    const dir = slashIndex >= 0 ? normalized.slice(0, slashIndex) : ".";
    const filePattern = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
    const patternRegex = patternToRegex(filePattern);

    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      expanded.push(arg);
      continue;
    }

    const matches = fs
      .readdirSync(dir)
      .filter((entry) => patternRegex.test(entry))
      .map((entry) => path.join(dir, entry));

    if (matches.length === 0) {
      expanded.push(arg);
      continue;
    }

    expanded.push(...matches);
  }

  return expanded;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function isSameBox(a: MotherlodeMineBox | null, b: MotherlodeMineBox | null): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function findClosestBoxToExpectedCenter(
  boxes: MotherlodeMineBox[],
  expectedCenterX: number,
  expectedCenterY: number,
): { box: MotherlodeMineBox | null; axisDistance: number } {
  let best: MotherlodeMineBox | null = null;
  let bestAxisDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const dx = box.centerX - expectedCenterX;
    const dy = box.centerY - expectedCenterY;
    const distance = axisDistance(dx, dy);

    if (distance < bestAxisDistance) {
      bestAxisDistance = distance;
      best = box;
    }
  }

  return { box: best, axisDistance: bestAxisDistance };
}

function findNodeNearActiveScreen(
  boxes: MotherlodeMineBox[],
  activeScreen: { x: number; y: number },
  captureBounds: CaptureBounds,
): MotherlodeMineBox | null {
  const activeX = activeScreen.x - captureBounds.x;
  const activeY = activeScreen.y - captureBounds.y;

  let best: MotherlodeMineBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nearestX = clamp(activeX, box.x, box.x + box.width - 1);
    const nearestY = clamp(activeY, box.y, box.y + box.height - 1);
    const dx = activeX - nearestX;
    const dy = activeY - nearestY;
    const distance = axisDistance(dx, dy);

    if (distance > ACTIVE_NODE_MATCH_RADIUS_PX) {
      continue;
    }

    const centerDx = box.centerX - activeX;
    const centerDy = box.centerY - activeY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (distance < bestDistance || (Math.abs(distance - bestDistance) < 0.001 && centerDistance < bestCenterDistance)) {
      bestDistance = distance;
      bestCenterDistance = centerDistance;
      best = box;
    }
  }

  return best;
}

function collectTinyCyanCandidates(bitmap: RobotBitmap): TinyCyanCandidate[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const isCyanLike = r <= 120 && g >= 170 && b >= 180 && b - r >= 70;
      if (!isCyanLike) {
        continue;
      }

      mask[y * width + x] = 1;
    }
  }

  const remaining = mask.slice();
  const candidates: TinyCyanCandidate[] = [];

  for (let startIndex = 0; startIndex < remaining.length; startIndex += 1) {
    if (!remaining[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    remaining[startIndex] = 0;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) {
        break;
      }

      const x = index % width;
      const y = Math.floor(index / width);

      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            continue;
          }

          const nextIndex = nextY * width + nextX;
          if (!remaining[nextIndex]) {
            continue;
          }

          remaining[nextIndex] = 0;
          stack.push(nextIndex);
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    if (pixelCount < 40 || pixelCount > 220) {
      continue;
    }

    if (componentWidth < 12 || componentWidth > 24 || componentHeight < 12 || componentHeight > 24) {
      continue;
    }

    candidates.push({
      x: minX,
      y: minY,
      width: componentWidth,
      height: componentHeight,
      centerX: Math.round((minX + maxX) / 2),
      centerY: Math.round((minY + maxY) / 2),
      pixelCount,
    });
  }

  return candidates.sort((a, b) => b.pixelCount - a.pixelCount);
}

function findTinyCyanNearExpected(
  candidates: TinyCyanCandidate[],
  expected: ExpectedActiveNode,
): TinyCyanCandidate | null {
  if (!expected.tinyCyan) {
    return null;
  }

  let best: TinyCyanCandidate | null = null;
  let bestAxisDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const dx = candidate.centerX - expected.tinyCyan.centerX;
    const dy = candidate.centerY - expected.tinyCyan.centerY;
    const distance = axisDistance(dx, dy);

    if (distance < bestAxisDistance) {
      bestAxisDistance = distance;
      best = candidate;
    }
  }

  if (!best) {
    return null;
  }

  return bestAxisDistance <= expected.tinyCyan.tolerancePx ? best : null;
}

async function testScreenshot(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const basename = path.basename(screenshotPath);
  const expected = resolveExpectedActiveNode(screenshotPath);
  if (!expected) {
    console.error(`No expected active-node config for ${basename}`);
    return false;
  }

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const boxes = detectMotherlodeMineBoxesInScreenshot(bitmap);
  const greenBoxes = boxes.filter((box) => box.color === "green");
  const yellowBoxes = boxes.filter((box) => box.color === "yellow");
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const cyanBoxes = detectCyanBoxesInScreenshot(bitmap);

  if (!playerBox) {
    console.error(`FAILED: Could not detect magenta player marker in ${basename}.`);
    return false;
  }

  if (boxes.length === 0) {
    console.error(`FAILED: Could not detect any motherlode mine node boxes in ${basename}.`);
    return false;
  }

  const playerAnchor = { x: playerBox.centerX, y: playerBox.centerY };
  const selectedByAlgo =
    greenBoxes.length > 0
      ? selectNearestGreenMotherlodeNode(greenBoxes, { width: bitmap.width, height: bitmap.height }, playerAnchor)
      : null;

  const nearestToExpected = findClosestBoxToExpectedCenter(boxes, expected.activeCenterX, expected.activeCenterY);
  const selected = selectedByAlgo ?? nearestToExpected.box;
  if (!selected) {
    console.error(`FAILED: Could not resolve expected active node candidate in ${basename}.`);
    return false;
  }

  const dxActive = selected.centerX - expected.activeCenterX;
  const dyActive = selected.centerY - expected.activeCenterY;
  const activeAxisDistance = axisDistance(dxActive, dyActive);
  console.log(
    `Expected active node center=(${expected.activeCenterX}, ${expected.activeCenterY}) ±${expected.activeTolerancePx}px, detected center=(${selected.centerX}, ${selected.centerY}) color=${selected.color}`,
  );

  if (selectedByAlgo) {
    console.log("Selection source: green-node algorithm.");
  } else {
    console.log("Selection source: fallback nearest-to-expected (no green boxes available).");
  }

  if (activeAxisDistance > expected.activeTolerancePx) {
    console.error(`FAILED: Active node center mismatch for ${basename} (dx=${dxActive}, dy=${dyActive}).`);
    return false;
  }

  if (expected.fragmentedNode) {
    if (
      selected.fillRatio > expected.fragmentedNode.maxFillRatio ||
      selected.pixelCount > expected.fragmentedNode.maxPixelCount
    ) {
      console.error(
        `FAILED: Expected fragmented active node in ${basename}, but got fill=${selected.fillRatio.toFixed(3)} pixels=${selected.pixelCount}.`,
      );
      return false;
    }

    console.log(
      `Fragmented-node check passed: fill=${selected.fillRatio.toFixed(3)}<=${expected.fragmentedNode.maxFillRatio}, pixels=${selected.pixelCount}<=${expected.fragmentedNode.maxPixelCount}.`,
    );
  }

  const captureBounds: CaptureBounds = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const matchedFromActiveCenter = findNodeNearActiveScreen(
    boxes,
    { x: selected.centerX, y: selected.centerY },
    captureBounds,
  );

  if (!isSameBox(matchedFromActiveCenter, selected)) {
    console.error(`FAILED: Mining-phase active matcher did not resolve selected node in ${basename}.`);
    return false;
  }

  const tinyCyanCandidates = collectTinyCyanCandidates(bitmap);
  if (expected.tinyCyan) {
    const tinyCyan = findTinyCyanNearExpected(tinyCyanCandidates, expected);
    if (!tinyCyan) {
      console.error(`FAILED: Could not locate expected tiny cyan marker in ${basename}.`);
      return false;
    }

    const dxTiny = tinyCyan.centerX - expected.tinyCyan.centerX;
    const dyTiny = tinyCyan.centerY - expected.tinyCyan.centerY;
    console.log(
      `Tiny cyan marker center=(${tinyCyan.centerX}, ${tinyCyan.centerY}), expected=(${expected.tinyCyan.centerX}, ${expected.tinyCyan.centerY}) ±${expected.tinyCyan.tolerancePx}px`,
    );

    const matchedFromTinyCyan = findNodeNearActiveScreen(
      boxes,
      { x: tinyCyan.centerX, y: tinyCyan.centerY },
      captureBounds,
    );

    const tinyToActiveDx = selected.centerX - tinyCyan.centerX;
    const tinyToActiveDy = selected.centerY - tinyCyan.centerY;
    const tinyToActiveDistance = Math.sqrt(tinyToActiveDx * tinyToActiveDx + tinyToActiveDy * tinyToActiveDy);

    if (tinyToActiveDistance < expected.tinyCyan.minDistanceFromActivePx) {
      console.error(
        `FAILED: Tiny cyan marker is unexpectedly close to active node in ${basename} (distance=${tinyToActiveDistance.toFixed(1)}).`,
      );
      return false;
    }

    if (matchedFromTinyCyan && isSameBox(matchedFromTinyCyan, selected)) {
      console.error(`FAILED: Tiny cyan marker incorrectly resolves to active mining node in ${basename}.`);
      return false;
    }

    console.log(
      `Tiny cyan marker is not the active mining node (distance=${tinyToActiveDistance.toFixed(1)}px, matched=${matchedFromTinyCyan ? "other/none" : "none"}).`,
    );

    if (Math.abs(dxTiny) > expected.tinyCyan.tolerancePx || Math.abs(dyTiny) > expected.tinyCyan.tolerancePx) {
      console.error(`FAILED: Tiny cyan marker center mismatch for ${basename} (dx=${dxTiny}, dy=${dyTiny}).`);
      return false;
    }
  } else {
    console.log(`No tiny cyan marker expectation for ${basename}; skipping tiny-cyan validation.`);
  }

  const debugOutputDir = "./test-image-debug";
  const basenameNoExt = path.basename(screenshotPath, path.extname(screenshotPath));
  const debugPath = path.join(debugOutputDir, `${basenameNoExt}-motherlode-active-node.png`);

  saveBitmapWithMotherlodeMineBoxes(bitmap, boxes, debugPath, { x: selected.centerX, y: selected.centerY }, playerBox, {
    r: 255,
    g: 0,
    b: 255,
  });

  console.log(
    `Detected mine boxes: total=${boxes.length}, green=${greenBoxes.length}, yellow=${yellowBoxes.length}, cyan=${cyanBoxes.length}`,
  );
  console.log(`Debug image: ${debugPath}`);

  return true;
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/motherlode-active-node/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log("\nMotherlode Active Node Mining Regression");
  console.log(`Testing ${expandedScreenshots.length} screenshot(s)...`);

  let successCount = 0;
  let failureCount = 0;

  for (const screenshotPath of expandedScreenshots) {
    const ok = await testScreenshot(screenshotPath);
    if (ok) {
      successCount += 1;
    } else {
      failureCount += 1;
    }
  }

  console.log(`\nResults: ${successCount} passed, ${failureCount} failed`);
  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
