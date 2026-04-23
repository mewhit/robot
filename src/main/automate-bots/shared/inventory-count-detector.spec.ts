#!/usr/bin/env node
/**
 * inventory-count-detector.spec.ts
 *
 * Usage:
 *   node -r ts-node/register inventory-count-detector.spec.ts <glob-or-path...>
 *
 * Filename convention: ...-count=<N>.png where N is the expected free inventory slots (0-28).
 */

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { detectInventoryCount, saveBitmapWithInventoryCountDebug } from "./inventory-count-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

const DEBUG_OUTPUT_DIR = "./test-image-debug";

function parseExpectedCountFromFilename(screenshotPath: string): number | null {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const match = basename.match(/count=(\d+)$/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
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
    const expected = parseExpectedCountFromFilename(screenshotPath);

    if (expected === null) {
      console.warn(`SKIP  ${screenshotName} — no count=N in filename`);
      skipped += 1;
      continue;
    }

    const bitmap = await loadScreenshot(screenshotPath);
    if (!bitmap) {
      console.error(`FAIL  ${screenshotName} — could not load image`);
      failed += 1;
      continue;
    }

    const result = detectInventoryCount(bitmap);

    if (result.count === expected) {
      console.log(`PASS  ${screenshotName}  →  count=${result.count}`);
      passed += 1;

      const debugPath = path.join(DEBUG_OUTPUT_DIR, screenshotName.replace(".png", "-inventory-count.png"));
      saveBitmapWithInventoryCountDebug(bitmap, result, debugPath);
    } else {
      console.error(`FAIL  ${screenshotName}  →  expected=${expected}  got=${result.count ?? "null"}  rawText=${result.rawText ?? "null"}`);
      failed += 1;

      const debugPath = path.join(DEBUG_OUTPUT_DIR, screenshotName.replace(".png", "-inventory-count-FAILED.png"));
      saveBitmapWithInventoryCountDebug(bitmap, result, debugPath);
      console.error(`      debug image: ${debugPath}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log("=".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const inputPaths = args.length > 0 ? args : ["test-images/icon/inventory-count/*.png"];
const screenshotPaths = expandScreenshotArgs(inputPaths);

runTests(screenshotPaths);
