#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  detectGuardianOfTheRiftMindRuneIcon,
  loadGuardianOfTheRiftMindRuneIconTemplate,
  saveBitmapWithGuardianOfTheRiftMindRuneIconDebug,
} from "./guardian-of-the-rift-mind-rune-icon-detector";
import type { RobotBitmap } from "./ocr-engine";

const DEFAULT_TEMPLATE_PATH = "test-images/icon/guardin-of-the-rift/mind-rune-indicator.png";
const DEFAULT_SCREENSHOT_GLOBS = [
  "test-images/icon/guardin-of-the-rift/mind-rune-indicator.png",
  "test-images/runescrafting/guardian-of-the-rift/active-guardian/*.png",
];
const DEBUG_OUTPUT_DIR = "test-image-debug";

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

function expectsMindRuneIcon(screenshotPath: string): boolean {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath)).toLowerCase();
  return basename === "mind-rune-indicator" || basename.endsWith("-mind");
}

function getDebugPath(screenshotPath: string, failed: boolean): string {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const suffix = failed ? "-mind-rune-icon-failed.png" : "-mind-rune-icon.png";
  return path.join(DEBUG_OUTPUT_DIR, `${basename}${suffix}`);
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const expected = expectsMindRuneIcon(screenshotPath);
  const template = await loadGuardianOfTheRiftMindRuneIconTemplate(DEFAULT_TEMPLATE_PATH);
  const detection = detectGuardianOfTheRiftMindRuneIcon(bitmap, template);
  const actual = detection.hasMindRuneIcon;
  const passed = actual === expected;
  const debugPath = getDebugPath(screenshotPath, !passed);
  saveBitmapWithGuardianOfTheRiftMindRuneIconDebug(bitmap, detection, debugPath);

  if (passed) {
    console.log(
      `PASS  ${path.basename(screenshotPath)}  expected=${expected} detected=${actual} score=${detection.match?.score.toFixed(3) ?? detection.matches[0]?.score.toFixed(3) ?? "null"}`,
    );
    return true;
  }

  console.error(
    `FAIL  ${path.basename(screenshotPath)}  expected=${expected} detected=${actual} bestScore=${detection.matches[0]?.score.toFixed(3) ?? "null"}`,
  );
  console.error(`      debug image: ${debugPath}`);
  return false;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const screenshotPaths = expandScreenshotArgs(args.length > 0 ? args : DEFAULT_SCREENSHOT_GLOBS);

  console.log("\nGuardian of the Rift Mind Rune Icon Detector Test Suite");
  console.log(`Template: ${DEFAULT_TEMPLATE_PATH}`);
  console.log(`Testing ${screenshotPaths.length} screenshot(s)...`);

  let passed = 0;
  let failed = 0;

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
