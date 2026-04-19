import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  MotherlodeDepositBox,
  detectMotherlodeDepositBoxesInScreenshot,
  saveBitmapWithMotherlodeDepositBoxes,
} from "./motherlode-deposit-box-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type ExpectedDetection = {
  centerX: number;
  centerY: number;
  tolerancePx: number;
  minPixelCount: number;
  minWidth: number;
  minHeight: number;
};

const EXPECTED_BY_SCREENSHOT: Record<string, ExpectedDetection> = {
  "1749x1549-2k-125.png": {
    centerX: 761,
    centerY: 713,
    tolerancePx: 26,
    minPixelCount: 1300,
    minWidth: 40,
    minHeight: 35,
  },
  "1749x1549-2k-125-2.png": {
    centerX: 601,
    centerY: 526,
    tolerancePx: 26,
    minPixelCount: 1200,
    minWidth: 35,
    minHeight: 30,
  },
  "1749x1549-2k-125-3.png": {
    centerX: 595,
    centerY: 664,
    tolerancePx: 26,
    minPixelCount: 1300,
    minWidth: 40,
    minHeight: 35,
  },
  "1749x1549-2k-125-4.png": {
    centerX: 771,
    centerY: 755,
    tolerancePx: 30,
    minPixelCount: 1800,
    minWidth: 80,
    minHeight: 35,
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

function validateBestBox(screenshotPath: string, best: MotherlodeDepositBox): boolean {
  const basename = path.basename(screenshotPath);
  const expected = EXPECTED_BY_SCREENSHOT[basename];

  if (!expected) {
    return true;
  }

  const dx = Math.abs(best.centerX - expected.centerX);
  const dy = Math.abs(best.centerY - expected.centerY);
  const withinTolerance = dx <= expected.tolerancePx && dy <= expected.tolerancePx;
  const sizeOk = best.width >= expected.minWidth && best.height >= expected.minHeight;
  const pixelsOk = best.pixelCount >= expected.minPixelCount;

  console.log(
    `Expected center=(${expected.centerX}, ${expected.centerY}) ±${expected.tolerancePx}px, actual=(${best.centerX}, ${best.centerY})`,
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

  const boxes = detectMotherlodeDepositBoxesInScreenshot(bitmap);
  if (boxes.length === 0) {
    console.log("No motherlode deposit (cyan) boxes detected.");
    return false;
  }

  const best = boxes[0];
  console.log(
    `Best deposit-box at (${best.x}, ${best.y}) ${best.width}x${best.height} center=(${best.centerX}, ${best.centerY}) pixels=${best.pixelCount} fill=${best.fillRatio.toFixed(3)} score=${best.score.toFixed(1)}`,
  );

  const debugOutputDir = "./test-image-debug";
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const debugPath = path.join(debugOutputDir, `${basename}-motherlode-deposit-boxes.png`);
  saveBitmapWithMotherlodeDepositBoxes(bitmap, boxes, debugPath);
  console.log(`Debug image: ${debugPath}`);

  return validateBestBox(screenshotPath, best);
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/motherlode-mine-upstair-deposit/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log(`\nMotherlode Deposit Box Detector Test Suite`);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
