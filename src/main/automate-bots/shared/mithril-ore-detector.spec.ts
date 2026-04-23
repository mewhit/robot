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

const MAX_PLAYER_EDGE_DISTANCE_PX = 500;

const EXPECTED_BY_SCREENSHOT: Record<string, { selectedCenterX: number; selectedCenterY: number; tolerancePx: number }> = {
  "1600x1549-2k-125-8-ores.png": {
    selectedCenterX: 668,
    selectedCenterY: 777,
    tolerancePx: 18,
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

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const boxes = detectMithrilOreBoxesInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);

  if (!playerBox) {
    console.error(`FAILED: Could not detect player marker in ${path.basename(screenshotPath)}.`);
    return false;
  }

  const playerAnchor = { x: playerBox.centerX, y: playerBox.centerY };
  const reachableBoxes = boxes.filter((box) => distanceToBox(playerAnchor, box) <= MAX_PLAYER_EDGE_DISTANCE_PX);
  const selected = selectNearestReachableOre(boxes, playerAnchor);

  for (const [index, box] of reachableBoxes.entries()) {
    const distance = distanceToBox(playerAnchor, box);
    console.log(
      `#${index + 1} reachable ore at (${box.x}, ${box.y}) ${box.width}x${box.height} center=(${box.centerX}, ${box.centerY}) pixels=${box.pixelCount} fill=${box.fillRatio.toFixed(3)} blue-dominance=${box.blueDominance.toFixed(1)} edge=${distance} score=${box.score.toFixed(1)}`,
    );
  }

  if (!selected) {
    console.error(`FAILED: Could not select a reachable mithril ore near the player.`);
    return false;
  }

  const basename = path.basename(screenshotPath);
  const expectedNearest = EXPECTED_BY_SCREENSHOT[basename];
  if (expectedNearest) {
    const dx = selected.centerX - expectedNearest.selectedCenterX;
    const dy = selected.centerY - expectedNearest.selectedCenterY;
    if (axisDistance(dx, dy) > expectedNearest.tolerancePx) {
      console.error(
        `FAILED: Selected ore center mismatch for ${basename}. Expected approx (${expectedNearest.selectedCenterX}, ${expectedNearest.selectedCenterY}) ±${expectedNearest.tolerancePx}px, got (${selected.centerX}, ${selected.centerY}).`,
      );
      return false;
    }
  }

  const expectedOreCount = parseExpectedOreCountFromFilename(screenshotPath);
  if (expectedOreCount !== null && reachableBoxes.length !== expectedOreCount) {
    console.error(
      `FAILED: Expected ${expectedOreCount} reachable ore(s) from filename suffix '-${expectedOreCount}-ores', but detected ${reachableBoxes.length}.`,
    );
    return false;
  }

  const debugOutputDir = "./test-image-debug";
  const basenameNoExt = path.basename(screenshotPath, path.extname(screenshotPath));
  const debugPath = path.join(debugOutputDir, `${basenameNoExt}-mithril-ore-boxes.png`);
  saveBitmapWithMithrilOreBoxes(bitmap, reachableBoxes, debugPath, { x: selected.centerX, y: selected.centerY }, playerBox);

  console.log(`Player center=(${playerAnchor.x}, ${playerAnchor.y})`);
  console.log(`Reachable ore count=${reachableBoxes.length}, selected center=(${selected.centerX}, ${selected.centerY})`);
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
