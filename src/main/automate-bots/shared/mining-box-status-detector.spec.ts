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
        `PASS  ${screenshotName}  ->  status=${detection.status} confidence=${detection.confidence.toFixed(2)} red=${detection.redPixelCount} green=${detection.greenPixelCount}`,
      );
      passed += 1;
      continue;
    }

    console.error(
      `FAIL  ${screenshotName}  ->  expected=${expected} got=${detection.status} confidence=${detection.confidence.toFixed(2)} red=${detection.redPixelCount} green=${detection.greenPixelCount}`,
    );
    console.error(`      debug image: ${debugPath}`);
    failed += 1;
  }

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
