import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  MotherlodeObstacleRedBox,
  detectMotherlodeObstacleRedBoxesInScreenshot,
  saveBitmapWithMotherlodeObstacleRedBoxes,
} from "./motherlode-obstacle-red-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type ExpectedDetection = {
  shouldDetect: boolean;
  centerX?: number;
  centerY?: number;
  tolerancePx?: number;
  minPixelCount?: number;
  minWidth?: number;
  minHeight?: number;
};

const EXPECTED_BY_SCREENSHOT: Record<string, ExpectedDetection> = {
  "1600x1549-2k-125-bot-should-click-red.png": {
    shouldDetect: false,
  },
  "1600x1549-2k-125-colide-test.png": {
    shouldDetect: true,
    centerX: 452,
    centerY: 658,
    tolerancePx: 24,
    minPixelCount: 1800,
    minWidth: 45,
    minHeight: 40,
  },
  "1600x1549-2k-125-colision-2.png": {
    shouldDetect: true,
    centerX: 410,
    centerY: 513,
    tolerancePx: 24,
    minPixelCount: 1500,
    minWidth: 42,
    minHeight: 36,
  },
  "1600x1549-2k-125-colision.png": {
    shouldDetect: true,
    centerX: 453,
    centerY: 614,
    tolerancePx: 24,
    minPixelCount: 1700,
    minWidth: 42,
    minHeight: 40,
  },
  "1600x1549-2k-125-no-colisio.png": {
    shouldDetect: false,
  },
  "1298x1549-2k-125-red-rock.png": {
    shouldDetect: true,
    centerX: 777,
    centerY: 811,
    tolerancePx: 24,
    minPixelCount: 600,
    minWidth: 28,
    minHeight: 28,
  },
  "1749x1549-2k-125.png": {
    shouldDetect: true,
    centerX: 480,
    centerY: 549,
    tolerancePx: 24,
    minPixelCount: 260,
    minWidth: 20,
    minHeight: 22,
  },
  "3856x2128-4k-100-colision.png": {
    shouldDetect: true,
    centerX: 1792,
    centerY: 1144,
    tolerancePx: 30,
    minPixelCount: 4000,
    minWidth: 70,
    minHeight: 80,
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

function validateBestBox(screenshotPath: string, best: MotherlodeObstacleRedBox): boolean {
  const basename = path.basename(screenshotPath);
  const expected = EXPECTED_BY_SCREENSHOT[basename];

  if (!expected) {
    return true;
  }

  if (!expected.shouldDetect) {
    console.error(`Expected no red obstacle detection for ${basename}, but got one.`);
    return false;
  }

  if (
    expected.centerX === undefined ||
    expected.centerY === undefined ||
    expected.tolerancePx === undefined ||
    expected.minPixelCount === undefined ||
    expected.minWidth === undefined ||
    expected.minHeight === undefined
  ) {
    console.error(`Invalid expected detection config for ${basename}.`);
    return false;
  }

  const dx = Math.abs(best.centerX - expected.centerX);
  const dy = Math.abs(best.centerY - expected.centerY);
  const withinTolerance = dx <= expected.tolerancePx && dy <= expected.tolerancePx;
  const sizeOk = best.width >= expected.minWidth && best.height >= expected.minHeight;
  const pixelsOk = best.pixelCount >= expected.minPixelCount;

  console.log(
    `Expected center=(${expected.centerX}, ${expected.centerY}) +/-${expected.tolerancePx}px, actual=(${best.centerX}, ${best.centerY})`,
  );

  if (!withinTolerance) {
    console.error(`Center mismatch for ${basename}: dx=${dx}, dy=${dy}`);
    return false;
  }

  if (!sizeOk) {
    console.error(
      `Size too small for ${basename}: expected min ${expected.minWidth}x${expected.minHeight}, actual ${best.width}x${best.height}`,
    );
    return false;
  }

  if (!pixelsOk) {
    console.error(
      `Pixel count too low for ${basename}: expected >=${expected.minPixelCount}, actual ${best.pixelCount}`,
    );
    return false;
  }

  return true;
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const basename = path.basename(screenshotPath);
  const expected = EXPECTED_BY_SCREENSHOT[basename];
  const debugOutputDir = "./test-image-debug";
  const basenameNoExt = path.basename(screenshotPath, path.extname(screenshotPath));
  const debugPath = path.join(debugOutputDir, `${basenameNoExt}-motherlode-obstacle-red-boxes.png`);

  const boxes = detectMotherlodeObstacleRedBoxesInScreenshot(bitmap);
  if (boxes.length === 0) {
    saveBitmapWithMotherlodeObstacleRedBoxes(bitmap, [], debugPath);
    console.log(`Debug image: ${debugPath}`);

    if (expected && !expected.shouldDetect) {
      console.log("No motherlode obstacle red boxes detected (expected).\n");
      return true;
    }

    console.log("No motherlode obstacle red boxes detected.");
    return false;
  }

  const best = boxes[0];
  console.log(
    `Best red-box at (${best.x}, ${best.y}) ${best.width}x${best.height} center=(${best.centerX}, ${best.centerY}) pixels=${best.pixelCount} fill=${best.fillRatio.toFixed(3)} red-dominance=${best.redDominance.toFixed(1)} score=${best.score.toFixed(1)}`,
  );

  saveBitmapWithMotherlodeObstacleRedBoxes(bitmap, [best], debugPath);
  console.log(`Debug image: ${debugPath}`);

  return validateBestBox(screenshotPath, best);
}

function createBitmap(width: number, height: number, color: { r: number; g: number; b: number }): RobotBitmap {
  const image = Buffer.alloc(width * height * 4);

  for (let index = 0; index < image.length; index += 4) {
    image[index] = color.b;
    image[index + 1] = color.g;
    image[index + 2] = color.r;
    image[index + 3] = 255;
  }

  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image,
  };
}

function fillRect(
  bitmap: RobotBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): void {
  const minX = Math.max(0, x);
  const minY = Math.max(0, y);
  const maxX = Math.min(bitmap.width - 1, x + width - 1);
  const maxY = Math.min(bitmap.height - 1, y + height - 1);

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const offset = py * bitmap.byteWidth + px * bitmap.bytesPerPixel;
      bitmap.image[offset] = color.b;
      bitmap.image[offset + 1] = color.g;
      bitmap.image[offset + 2] = color.r;
      bitmap.image[offset + 3] = 255;
    }
  }
}

function createSyntheticTallObstacleBitmap(): RobotBitmap {
  const bitmap = createBitmap(1200, 1200, { r: 89, g: 69, b: 27 });

  // Orange ladder-like block that should remain rejected by the stricter tall profile.
  fillRect(bitmap, 470, 860, 74, 128, { r: 204, g: 100, b: 1 });

  // Tall pure-red blocker that mirrors the stalled deposit screenshots.
  fillRect(bitmap, 605, 763, 50, 96, { r: 232, g: 6, b: 7 });
  fillRect(bitmap, 620, 775, 18, 24, { r: 89, g: 69, b: 27 });

  return bitmap;
}

async function testSyntheticTallObstacleDetection(): Promise<boolean> {
  console.log(`\nTesting: synthetic-tall-pure-red`);
  console.log("-".repeat(60));

  const bitmap = createSyntheticTallObstacleBitmap();
  const debugPath = path.join("test-image-debug", "synthetic-tall-pure-red-motherlode-obstacle-red-boxes.png");
  const boxes = detectMotherlodeObstacleRedBoxesInScreenshot(bitmap);

  if (boxes.length === 0) {
    saveBitmapWithMotherlodeObstacleRedBoxes(bitmap, [], debugPath);
    console.log(`Debug image: ${debugPath}`);
    console.log("No motherlode obstacle red boxes detected.");
    return false;
  }

  const best = boxes[0];
  saveBitmapWithMotherlodeObstacleRedBoxes(bitmap, [best], debugPath);
  console.log(
    `Best red-box at (${best.x}, ${best.y}) ${best.width}x${best.height} center=(${best.centerX}, ${best.centerY}) pixels=${best.pixelCount} fill=${best.fillRatio.toFixed(3)} profile=${best.profile} score=${best.score.toFixed(1)}`,
  );
  console.log(`Debug image: ${debugPath}`);

  const centerOk = Math.abs(best.centerX - 630) <= 4 && Math.abs(best.centerY - 811) <= 4;
  const geometryOk = best.width >= 48 && best.height >= 92;
  const pixelsOk = best.pixelCount >= 4300;
  const profileOk = best.profile === "tall-pure-red";

  if (!centerOk) {
    console.error(`Synthetic tall obstacle center mismatch: actual=(${best.centerX}, ${best.centerY})`);
    return false;
  }

  if (!geometryOk) {
    console.error(`Synthetic tall obstacle geometry mismatch: actual=${best.width}x${best.height}`);
    return false;
  }

  if (!pixelsOk) {
    console.error(`Synthetic tall obstacle pixel count too low: actual=${best.pixelCount}`);
    return false;
  }

  if (!profileOk) {
    console.error(`Synthetic tall obstacle used wrong profile: actual=${best.profile}`);
    return false;
  }

  return true;
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/motherload-obstacle/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log(`\nMotherlode Obstacle Red Box Detector Test Suite`);
  console.log(`Testing ${expandedScreenshots.length + 1} screenshot(s)...`);

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

  const syntheticSuccess = await testSyntheticTallObstacleDetection();
  if (syntheticSuccess) {
    successCount += 1;
  } else {
    failureCount += 1;
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
