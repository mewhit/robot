#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  CATALYTIC_GUARDIAN_RUNES,
  ELEMENTAL_GUARDIAN_RUNES,
  GuardianOfTheRiftActiveRuneDetection,
  GuardianOfTheRiftRuneTemplate,
  GuardianOfTheRiftRune,
  detectGuardianOfTheRiftActiveRunes,
  loadGuardianOfTheRiftRuneTemplatesFromDirectory,
  saveBitmapWithGuardianOfTheRiftActiveRunesDebug,
} from "./guardian-of-the-rift-active-rune-detector";
import type { RobotBitmap } from "./ocr-engine";

type ExpectedActiveRunes = {
  elemental: GuardianOfTheRiftRune | null;
  catalytic: GuardianOfTheRiftRune | null;
};

const DEFAULT_ICON_DIR = "test-images/icon/guardin-of-the-rift";
const DEFAULT_SCREENSHOT_GLOB = "test-images/runescrafting/guardian-of-the-rift/active-guardian/*.png";
const DEBUG_OUTPUT_DIR = "test-image-debug";

const FILENAME_RUNE_ALIASES: Record<string, GuardianOfTheRiftRune> = {
  earch: "earth",
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

function normalizeRuneName(value: string): GuardianOfTheRiftRune | null {
  const normalized = value.toLowerCase();
  const alias = FILENAME_RUNE_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  if ((ELEMENTAL_GUARDIAN_RUNES as readonly string[]).includes(normalized)) {
    return normalized as GuardianOfTheRiftRune;
  }

  if ((CATALYTIC_GUARDIAN_RUNES as readonly string[]).includes(normalized)) {
    return normalized as GuardianOfTheRiftRune;
  }

  return null;
}

function parseExpectedActiveRunesFromFilename(screenshotPath: string): ExpectedActiveRunes | null {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  if (basename.endsWith("-no-active")) {
    return { elemental: null, catalytic: null };
  }

  const parts = basename.split("-");
  if (parts.length < 2) {
    return null;
  }

  const catalytic = normalizeRuneName(parts[parts.length - 1]);
  const elemental = normalizeRuneName(parts[parts.length - 2]);
  if (!elemental || !catalytic) {
    return null;
  }

  return { elemental, catalytic };
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

function getDebugPath(screenshotPath: string, failed: boolean): string {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const suffix = failed ? "-guardian-active-runes-failed.png" : "-guardian-active-runes.png";
  return path.join(DEBUG_OUTPUT_DIR, `${basename}${suffix}`);
}

function validateDetection(
  screenshotPath: string,
  expected: ExpectedActiveRunes,
  detection: GuardianOfTheRiftActiveRuneDetection,
): boolean {
  const basename = path.basename(screenshotPath);
  const elementalRune = detection.elemental?.rune ?? null;
  const catalyticRune = detection.catalytic?.rune ?? null;

  if (expected.elemental === null && expected.catalytic === null) {
    if (elementalRune !== null || catalyticRune !== null) {
      console.error(`FAIL  ${basename}  expected=no-active  got=${elementalRune ?? "null"}-${catalyticRune ?? "null"}`);
      return false;
    }

    console.log(`PASS  ${basename}  active=no-active`);
    return true;
  }

  if (elementalRune !== expected.elemental || catalyticRune !== expected.catalytic) {
    console.error(
      `FAIL  ${basename}  expected=${expected.elemental}-${expected.catalytic}  got=${elementalRune ?? "null"}-${catalyticRune ?? "null"}`,
    );
    return false;
  }

  console.log(
    `PASS  ${basename}  active=${elementalRune}-${catalyticRune}  scores=${detection.elemental!.score.toFixed(3)},${detection.catalytic!.score.toFixed(3)}`,
  );
  return true;
}

async function testDetection(screenshotPath: string, templates: GuardianOfTheRiftRuneTemplate[]): Promise<boolean> {
  const expected = parseExpectedActiveRunesFromFilename(screenshotPath);
  if (!expected) {
    console.warn(`SKIP  ${path.basename(screenshotPath)}  no expected runes in filename`);
    return true;
  }

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const detection = detectGuardianOfTheRiftActiveRunes(bitmap, templates);
  const passed = validateDetection(screenshotPath, expected, detection);
  const debugPath = getDebugPath(screenshotPath, !passed);
  saveBitmapWithGuardianOfTheRiftActiveRunesDebug(bitmap, detection, debugPath);

  if (!passed) {
    console.error(`      debug image: ${debugPath}`);
    for (const match of detection.matches.slice(0, 8)) {
      console.error(
        `      ${match.slot}:${match.rune} score=${match.score.toFixed(3)} error=${match.averageColorError.toFixed(1)} center=(${match.centerX},${match.centerY})`,
      );
    }
  }

  return passed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const screenshotPaths = expandScreenshotArgs(args.length > 0 ? args : [DEFAULT_SCREENSHOT_GLOB]);

  console.log("\nGuardian of the Rift Active Rune Detector Test Suite");
  console.log(`Icon templates: ${DEFAULT_ICON_DIR}`);
  console.log(`Testing ${screenshotPaths.length} screenshot(s)...`);

  const templates = await loadGuardianOfTheRiftRuneTemplatesFromDirectory(DEFAULT_ICON_DIR);
  let passed = 0;
  let failed = 0;

  for (const screenshotPath of screenshotPaths) {
    const success = await testDetection(screenshotPath, templates);
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
