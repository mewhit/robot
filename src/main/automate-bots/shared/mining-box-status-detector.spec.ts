#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { MiningBoxStatus, detectMiningBoxStatusInScreenshot, saveBitmapWithMiningBoxStatusDebug } from "./mining-box-status-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

const DEBUG_OUTPUT_DIR = "./test-image-debug";

function parseExpectedStatusFromFilename(screenshotPath: string): MiningBoxStatus | null {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath)).toLowerCase();

  if (basename.includes("not-mining")) {
    return "not-mining";
  }

  if (basename.includes("mining")) {
    return "mining";
  }

  return null;
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

function createSolidBitmap(width: number, height: number, color: { r: number; g: number; b: number }): RobotBitmap {
  const buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * width * 4 + x * 4;
      buffer[offset] = color.b;
      buffer[offset + 1] = color.g;
      buffer[offset + 2] = color.r;
      buffer[offset + 3] = 255;
    }
  }

  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image: buffer,
  };
}

function paintRect(bitmap: RobotBitmap, x: number, y: number, width: number, height: number, color: { r: number; g: number; b: number }): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(bitmap.width - 1, x + width - 1);
  const y1 = Math.min(bitmap.height - 1, y + height - 1);

  for (let py = y0; py <= y1; py += 1) {
    for (let px = x0; px <= x1; px += 1) {
      const offset = py * bitmap.byteWidth + px * bitmap.bytesPerPixel;
      bitmap.image[offset] = color.b;
      bitmap.image[offset + 1] = color.g;
      bitmap.image[offset + 2] = color.r;
      bitmap.image[offset + 3] = 255;
    }
  }
}

function paintSegmentDigit(bitmap: RobotBitmap, digit: string, x: number, y: number, scale: number, color: { r: number; g: number; b: number }): void {
  const segmentsByDigit: Record<string, string[]> = {
    "3": ["a", "b", "c", "d", "g"],
    "6": ["a", "c", "d", "e", "f", "g"],
    "8": ["a", "b", "c", "d", "e", "f", "g"],
  };
  const segmentRects: Record<string, [number, number, number, number]> = {
    a: [1, 0, 5, 1],
    b: [5, 1, 1, 4],
    c: [5, 5, 1, 4],
    d: [1, 9, 5, 1],
    e: [0, 5, 1, 4],
    f: [0, 1, 1, 4],
    g: [1, 4, 5, 1],
  };

  for (const segment of segmentsByDigit[digit] ?? []) {
    const [sx, sy, sw, sh] = segmentRects[segment];
    paintRect(bitmap, x + sx * scale, y + sy * scale, sw * scale, sh * scale, color);
  }
}

function createGreenStatDigitsBitmap(): RobotBitmap {
  const bitmap = createSolidBitmap(300, 220, { r: 26, g: 26, b: 26 });
  const green = { r: 40, g: 214, b: 88 };
  paintSegmentDigit(bitmap, "6", 20, 72, 2, green);
  paintSegmentDigit(bitmap, "3", 36, 72, 2, green);
  paintSegmentDigit(bitmap, "8", 52, 72, 2, green);
  return bitmap;
}

function createGreenLongStatDigitsBitmap(): RobotBitmap {
  const bitmap = createSolidBitmap(300, 220, { r: 26, g: 26, b: 26 });
  const green = { r: 40, g: 214, b: 88 };
  const digits = ["6", "3", "8", "6", "3", "8"];
  for (let index = 0; index < digits.length; index += 1) {
    paintSegmentDigit(bitmap, digits[index], 20 + index * 16, 72, 2, green);
  }
  return bitmap;
}

function createGreenOutlineBitmap(): RobotBitmap {
  const bitmap = createSolidBitmap(300, 220, { r: 26, g: 26, b: 26 });
  const green = { r: 40, g: 214, b: 88 };
  paintRect(bitmap, 24, 74, 82, 2, green);
  paintRect(bitmap, 24, 112, 82, 2, green);
  paintRect(bitmap, 24, 74, 2, 40, green);
  paintRect(bitmap, 104, 74, 2, 40, green);
  return bitmap;
}

function runSyntheticRegressionTests(): { passed: number; failed: number } {
  const cases: Array<{ name: string; bitmap: RobotBitmap; expected: MiningBoxStatus }> = [
    {
      name: "synthetic-green-stat-digits",
      bitmap: createGreenStatDigitsBitmap(),
      expected: "unknown",
    },
    {
      name: "synthetic-green-long-stat-digits",
      bitmap: createGreenLongStatDigitsBitmap(),
      expected: "unknown",
    },
    {
      name: "synthetic-green-outline",
      bitmap: createGreenOutlineBitmap(),
      expected: "unknown",
    },
  ];
  let passed = 0;
  let failed = 0;

  for (const testCase of cases) {
    const detection = detectMiningBoxStatusInScreenshot(testCase.bitmap);
    const debugSuffix = detection.status === testCase.expected ? "" : "-FAILED";
    const debugPath = path.join(DEBUG_OUTPUT_DIR, `${testCase.name}-mining-status${debugSuffix}.png`);
    saveBitmapWithMiningBoxStatusDebug(testCase.bitmap, detection, debugPath);

    if (detection.status === testCase.expected) {
      console.log(
        `PASS  ${testCase.name}  ->  status=${detection.status} confidence=${detection.confidence.toFixed(2)} red=${detection.redPixelCount} green=${detection.greenPixelCount} text=${detection.textComponentCount}c/${detection.textColumnCount}col/${detection.textWidth}x${detection.textHeight}`,
      );
      passed += 1;
      continue;
    }

    console.error(
      `FAIL  ${testCase.name}  ->  expected=${testCase.expected} got=${detection.status} confidence=${detection.confidence.toFixed(2)} red=${detection.redPixelCount} green=${detection.greenPixelCount} text=${detection.textComponentCount}c/${detection.textColumnCount}col/${detection.textWidth}x${detection.textHeight}`,
    );
    console.error(`      debug image: ${debugPath}`);
    failed += 1;
  }

  return {
    passed,
    failed,
  };
}

async function runTests(screenshotPaths: string[]): Promise<void> {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const screenshotPath of screenshotPaths) {
    const screenshotName = path.basename(screenshotPath);
    const expected = parseExpectedStatusFromFilename(screenshotPath);

    if (!expected) {
      console.warn(`SKIP  ${screenshotName} — no mining/not-mining marker in filename`);
      skipped += 1;
      continue;
    }

    const bitmap = await loadScreenshot(screenshotPath);
    if (!bitmap) {
      console.error(`FAIL  ${screenshotName} — could not load image`);
      failed += 1;
      continue;
    }

    const detection = detectMiningBoxStatusInScreenshot(bitmap);
    const debugSuffix = detection.status === expected ? "" : "-FAILED";
    const debugPath = path.join(DEBUG_OUTPUT_DIR, screenshotName.replace(".png", `-mining-status${debugSuffix}.png`));
    saveBitmapWithMiningBoxStatusDebug(bitmap, detection, debugPath);

    if (detection.status === expected) {
      console.log(
        `PASS  ${screenshotName}  ->  status=${detection.status} confidence=${detection.confidence.toFixed(2)} red=${detection.redPixelCount} green=${detection.greenPixelCount} text=${detection.textComponentCount}c/${detection.textColumnCount}col/${detection.textWidth}x${detection.textHeight}`,
      );
      passed += 1;
      continue;
    }

    console.error(
      `FAIL  ${screenshotName}  ->  expected=${expected} got=${detection.status} confidence=${detection.confidence.toFixed(2)} red=${detection.redPixelCount} green=${detection.greenPixelCount} text=${detection.textComponentCount}c/${detection.textColumnCount}col/${detection.textWidth}x${detection.textHeight}`,
    );
    console.error(`      debug image: ${debugPath}`);
    failed += 1;
  }

  const syntheticResults = runSyntheticRegressionTests();
  passed += syntheticResults.passed;
  failed += syntheticResults.failed;

  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log("=".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const inputPaths = args.length > 0 ? args : ["test-images/mining-box-stats/*.png"];
const screenshotPaths = expandScreenshotArgs(inputPaths);

runTests(screenshotPaths);
