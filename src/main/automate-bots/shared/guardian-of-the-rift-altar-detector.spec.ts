#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  detectGuardianOfTheRiftAltarMarkersInScreenshot,
  formatGuardianOfTheRiftAltarCandidates,
  saveBitmapWithGuardianOfTheRiftAltarDebug,
} from "./guardian-of-the-rift-altar-detector";
import type { RobotBitmap } from "./ocr-engine";

const DEFAULT_SCREENSHOT_GLOB = "test-images/runescrafting/guardian-of-the-rift/altar/*.png";
const DEBUG_OUTPUT_DIR = "test-image-debug";

type AltarExpectation = {
  shouldDetect: boolean;
};

type SyntheticAltarComponent = {
  name: string;
  width: number;
  height: number;
  shouldDetect: boolean;
};

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function isImageFilename(value: string): boolean {
  return /\.(png|jpg|jpeg)$/i.test(value);
}

function expandScreenshotArgs(args: string[]): string[] {
  const expanded: string[] = [];

  for (const arg of args) {
    if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
      const matches = fs
        .readdirSync(arg)
        .filter((entry) => isImageFilename(entry))
        .map((entry) => path.join(arg, entry));

      expanded.push(...(matches.length > 0 ? matches : [arg]));
      continue;
    }

    if (!arg.includes("*")) {
      expanded.push(arg);
      continue;
    }

    const normalized = arg.replace(/\\/g, "/");
    const slashIndex = normalized.lastIndexOf("/");
    const directory = slashIndex >= 0 ? normalized.slice(0, slashIndex) : ".";
    const filePattern = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
    const regex = patternToRegex(filePattern);

    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      expanded.push(arg);
      continue;
    }

    const matches = fs
      .readdirSync(directory)
      .filter((entry) => regex.test(entry))
      .map((entry) => path.join(directory, entry));

    expanded.push(...(matches.length > 0 ? matches : [arg]));
  }

  return expanded;
}

function getExpectedDetectionFromFilename(screenshotPath: string): AltarExpectation {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath)).toLowerCase();
  const shouldNotDetect = /(^|[-_])(no[-_]?altar|none|missing)([-_]|$)/i.test(basename);
  return { shouldDetect: !shouldNotDetect };
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
        const image = Buffer.alloc(png.width * png.height * 4);

        for (let index = 0; index < png.data.length; index += 4) {
          image[index] = png.data[index + 2];
          image[index + 1] = png.data[index + 1];
          image[index + 2] = png.data[index];
          image[index + 3] = png.data[index + 3];
        }

        resolve({
          width: png.width,
          height: png.height,
          byteWidth: png.width * 4,
          bytesPerPixel: 4,
          image,
        });
      })
      .on("error", (error) => {
        console.error(`Failed to load image: ${error}`);
        resolve(null);
      });
  });
}

function createSyntheticBitmap(width: number, height: number): RobotBitmap {
  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image: Buffer.alloc(width * height * 4),
  };
}

function paintYellowRectangle(bitmap: RobotBitmap, x: number, y: number, width: number, height: number): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const offset = py * bitmap.byteWidth + px * bitmap.bytesPerPixel;
      bitmap.image[offset] = 0;
      bitmap.image[offset + 1] = 220;
      bitmap.image[offset + 2] = 255;
      bitmap.image[offset + 3] = 255;
    }
  }
}

function getDebugPath(screenshotPath: string, failed: boolean): string {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const suffix = failed ? "-guardian-altar-failed.png" : "-guardian-altar.png";
  return path.join(DEBUG_OUTPUT_DIR, `${basename}${suffix}`);
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  const expected = getExpectedDetectionFromFilename(screenshotPath);
  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const detections = detectGuardianOfTheRiftAltarMarkersInScreenshot(bitmap);
  const passed = expected.shouldDetect ? detections.length > 0 : detections.length === 0;
  const debugPath = getDebugPath(screenshotPath, !passed);
  saveBitmapWithGuardianOfTheRiftAltarDebug(bitmap, detections, debugPath);

  if (passed) {
    console.log(
      `PASS  ${path.basename(screenshotPath)}  expected=${expected.shouldDetect ? "altar" : "no-altar"}  candidates=${formatGuardianOfTheRiftAltarCandidates(detections)}`,
    );
    return true;
  }

  console.error(
    `FAIL  ${path.basename(screenshotPath)}  expected=${expected.shouldDetect ? "altar" : "no-altar"}  candidates=${formatGuardianOfTheRiftAltarCandidates(detections)}`,
  );
  console.error(`      debug image: ${debugPath}`);
  return false;
}

function testSyntheticShapeFilters(): { passed: number; failed: number } {
  const cases: SyntheticAltarComponent[] = [
    { name: "valid altar-sized square", width: 135, height: 132, shouldDetect: true },
    { name: "earth altar angled marker", width: 126, height: 102, shouldDetect: true },
    { name: "thin edge sliver", width: 14, height: 54, shouldDetect: false },
    { name: "tall yellow strip", width: 44, height: 134, shouldDetect: false },
    { name: "oversized yellow blob", width: 199, height: 197, shouldDetect: false },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of cases) {
    const bitmap = createSyntheticBitmap(1298, 1549);
    paintYellowRectangle(bitmap, 420, 520, testCase.width, testCase.height);
    const detections = detectGuardianOfTheRiftAltarMarkersInScreenshot(bitmap);
    const success = testCase.shouldDetect ? detections.length === 1 : detections.length === 0;
    if (success) {
      console.log(
        `PASS  synthetic ${testCase.name}  expected=${testCase.shouldDetect ? "altar" : "no-altar"}  candidates=${formatGuardianOfTheRiftAltarCandidates(detections)}`,
      );
      passed += 1;
      continue;
    }

    console.error(
      `FAIL  synthetic ${testCase.name}  expected=${testCase.shouldDetect ? "altar" : "no-altar"}  candidates=${formatGuardianOfTheRiftAltarCandidates(detections)}`,
    );
    failed += 1;
  }

  console.log(`Synthetic shape filters: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const screenshotPaths = expandScreenshotArgs(args.length > 0 ? args : [DEFAULT_SCREENSHOT_GLOB]);

  console.log("\nGuardian of the Rift Altar Detector Test Suite");
  console.log(`Testing ${screenshotPaths.length} screenshot(s)...`);

  const syntheticResults = testSyntheticShapeFilters();
  let passed = syntheticResults.passed;
  let failed = syntheticResults.failed;

  for (const screenshotPath of screenshotPaths) {
    const success = await testDetection(screenshotPath);
    if (success) {
      passed += 1;
    } else {
      failed += 1;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
