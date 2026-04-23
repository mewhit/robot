import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  detectMithrilOreBoxesInScreenshot,
  MithrilOreBox,
  saveBitmapWithMithrilOreBoxes,
} from "./mithril-ore-detector";
import { detectBestPlayerBoxInScreenshot } from "./player-box-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type AnchorPoint = {
  x: number;
  y: number;
};

type ScreenshotExpectation = {
  minimumOreCount?: number;
  selectedCenterX?: number;
  selectedCenterY?: number;
  tolerancePx?: number;
  playerAnchor?: AnchorPoint;
};

type DebugPlayerBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MAX_PLAYER_EDGE_DISTANCE_PX = 500;

const EXPECTED_BY_SCREENSHOT: Record<string, ScreenshotExpectation> = {
  "1600x1549-2k-125-8-ores.png": {
    minimumOreCount: 8,
    selectedCenterX: 668,
    selectedCenterY: 777,
    tolerancePx: 18,
  },
  "3840x2128-4k-100-8-ores.png": {
    minimumOreCount: 8,
    selectedCenterX: 1974,
    selectedCenterY: 1019,
    tolerancePx: 24,
  },
};

async function loadScreenshot(filePath: string): Promise<RobotBitmap | null> {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return null;
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

function parseExpectedOreCountFromFilename(screenshotPath: string): number | null {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const match = basename.match(/-(\d+)-ores$/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function distanceToBox(anchor: AnchorPoint, box: MithrilOreBox): number {
  const nearestX = clamp(anchor.x, box.x, box.x + box.width - 1);
  const nearestY = clamp(anchor.y, box.y, box.y + box.height - 1);
  return axisDistance(anchor.x - nearestX, anchor.y - nearestY);
}

function selectNearestReachableOre(boxes: MithrilOreBox[], anchor: AnchorPoint): MithrilOreBox | null {
  let best: MithrilOreBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistanceSq = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const edgeDistance = distanceToBox(anchor, box);
    if (edgeDistance > MAX_PLAYER_EDGE_DISTANCE_PX) {
      continue;
    }

    const centerDx = anchor.x - box.centerX;
    const centerDy = anchor.y - box.centerY;
    const centerDistanceSq = centerDx * centerDx + centerDy * centerDy;

    if (edgeDistance < bestEdgeDistance) {
      bestEdgeDistance = edgeDistance;
      bestCenterDistanceSq = centerDistanceSq;
      best = box;
      continue;
    }

    if (Math.abs(edgeDistance - bestEdgeDistance) < 0.5 && centerDistanceSq < bestCenterDistanceSq) {
      bestCenterDistanceSq = centerDistanceSq;
      best = box;
    }
  }

  return best;
}

function getDebugPath(screenshotPath: string, failed: boolean): string {
  const debugOutputDir = "./test-image-debug";
  const basenameNoExt = path.basename(screenshotPath, path.extname(screenshotPath));
  const suffix = failed ? "-mithril-ore-boxes-failed.png" : "-mithril-ore-boxes.png";
  return path.join(debugOutputDir, `${basenameNoExt}${suffix}`);
}

function saveDetectionDebugImage(
  bitmap: RobotBitmap,
  screenshotPath: string,
  boxes: MithrilOreBox[],
  selected: MithrilOreBox | null,
  playerBox: DebugPlayerBox | null,
  failed: boolean,
): string {
  const debugPath = getDebugPath(screenshotPath, failed);
  saveBitmapWithMithrilOreBoxes(
    bitmap,
    boxes,
    debugPath,
    selected ? { x: selected.centerX, y: selected.centerY } : null,
    playerBox,
  );
  return debugPath;
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const boxes = detectMithrilOreBoxesInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const basename = path.basename(screenshotPath);
  const expectedNearest = EXPECTED_BY_SCREENSHOT[basename];
  const minimumOreCount = expectedNearest?.minimumOreCount ?? parseExpectedOreCountFromFilename(screenshotPath);
  const requiresSelectedOreExpectation =
    expectedNearest?.selectedCenterX !== undefined &&
    expectedNearest?.selectedCenterY !== undefined &&
    expectedNearest?.tolerancePx !== undefined;
  const playerAnchor =
    expectedNearest?.playerAnchor ?? (playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null);
  const failWithDebug = (message: string, selected: MithrilOreBox | null = null): boolean => {
    console.error(`FAILED: ${message}`);
    if (playerAnchor) {
      console.log(`Player center=(${playerAnchor.x}, ${playerAnchor.y})`);
    }

    const debugPath = saveDetectionDebugImage(bitmap, screenshotPath, boxes, selected, playerBox, true);
    console.log(`Failure debug image: ${debugPath}`);
    return false;
  };

  if (minimumOreCount !== null && boxes.length < minimumOreCount) {
    return failWithDebug(
      `Expected at least ${minimumOreCount} detected ore(s) from ${expectedNearest?.minimumOreCount !== undefined ? `fixture expectation for ${basename}` : `filename suffix '-${minimumOreCount}-ores'`}, but detected ${boxes.length}.`,
    );
  }

  if (requiresSelectedOreExpectation && !playerAnchor) {
    return failWithDebug(`Could not detect player marker in ${basename}.`);
  }

  const reachableBoxes = playerAnchor
    ? boxes.filter((box) => distanceToBox(playerAnchor, box) <= MAX_PLAYER_EDGE_DISTANCE_PX)
    : [];
  const selected = playerAnchor ? selectNearestReachableOre(boxes, playerAnchor) : null;

  for (const [index, box] of reachableBoxes.entries()) {
    const distance = playerAnchor ? distanceToBox(playerAnchor, box) : -1;
    console.log(
      `#${index + 1} reachable ore at (${box.x}, ${box.y}) ${box.width}x${box.height} center=(${box.centerX}, ${box.centerY}) pixels=${box.pixelCount} fill=${box.fillRatio.toFixed(3)} blue-dominance=${box.blueDominance.toFixed(1)} edge=${distance} score=${box.score.toFixed(1)}`,
    );
  }

  if (requiresSelectedOreExpectation && !selected) {
    return failWithDebug(`Could not select a reachable mithril ore near the player.`);
  }

  if (
    selected &&
    expectedNearest?.selectedCenterX !== undefined &&
    expectedNearest?.selectedCenterY !== undefined &&
    expectedNearest?.tolerancePx !== undefined
  ) {
    const dx = selected.centerX - expectedNearest.selectedCenterX;
    const dy = selected.centerY - expectedNearest.selectedCenterY;
    if (axisDistance(dx, dy) > expectedNearest.tolerancePx) {
      return failWithDebug(
        `Selected ore center mismatch for ${basename}. Expected approx (${expectedNearest.selectedCenterX}, ${expectedNearest.selectedCenterY}) +/-${expectedNearest.tolerancePx}px, got (${selected.centerX}, ${selected.centerY}).`,
        selected,
      );
    }
  }

  const debugPath = saveDetectionDebugImage(bitmap, screenshotPath, boxes, selected, playerBox, false);

  if (playerAnchor) {
    console.log(`Player center=(${playerAnchor.x}, ${playerAnchor.y})`);
  }
  console.log(`Detected ore count=${boxes.length}`);
  if (playerAnchor) {
    console.log(`Reachable ore count=${reachableBoxes.length}`);
  }
  if (selected) {
    console.log(`Selected center=(${selected.centerX}, ${selected.centerY})`);
  }
  console.log(`Debug image: ${debugPath}`);
  return true;
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/mining-mithril-mining-guilde/*-ores.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log(`\nMithril Ore Detector Test Suite`);
  console.log(`Testing ${expandedScreenshots.length} screenshot(s)...`);

  let successCount = 0;
  let failureCount = 0;

  for (const screenshotPath of expandedScreenshots) {
    const success = await testDetection(screenshotPath);
    if (success) {
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

main().catch(console.error);
