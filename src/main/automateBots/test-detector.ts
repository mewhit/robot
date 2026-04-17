/**
 * Test script to validate coordinate detector against screenshot files
 * Usage: ts-node src/main/automateBots/test-detector.ts <screenshot-path>
 */

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { detectOverlayBoxInScreenshot, saveBitmapWithBox } from "./coordinate-detector";

export type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

/**
 * Load PNG image and convert to RobotBitmap format (async)
 * @param filePath - Path to PNG file
 * @returns Promise<RobotBitmap | null>
 */
async function loadScreenshot(filePath: string): Promise<RobotBitmap | null> {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return null;
  }

  return new Promise((resolve) => {
    const png = new PNG();
    fs.createReadStream(filePath)
      .pipe(png)
      .on("parsed", function (this: PNG) {
        // Convert RGBA → BGR format (robotjs format)
        const buffer = Buffer.alloc(png.width * png.height * 4);
        for (let i = 0; i < png.data.length; i += 4) {
          const r = png.data[i];
          const g = png.data[i + 1];
          const b = png.data[i + 2];

          // Write as BGR (robotjs format)
          buffer[i] = b;
          buffer[i + 1] = g;
          buffer[i + 2] = r;
          buffer[i + 3] = 255;
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
        console.error(`❌ Failed to load image: ${error}`);
        resolve(null);
      });
  });
}

/**
 * Run detection test on a screenshot
 */
async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\n📸 Testing: ${screenshotPath}`);
  console.log("─".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    console.error(`❌ Failed to load screenshot`);
    return false;
  }

  console.log(`✓ Loaded image: ${bitmap.width}×${bitmap.height}`);

  try {
    const result = detectOverlayBoxInScreenshot(bitmap);

    if (result) {
      console.log(`\n✅ DETECTION SUCCESS!`);
      console.log(`   Tile Coordinates: ${result.matchedLine}`);
      console.log(`   Overlay Box: (${result.x}, ${result.y}) ${result.width}×${result.height}`);

      // Save debug image with box drawn
      const debugOutputDir = "./ocr-debug";
      const basename = path.basename(screenshotPath, path.extname(screenshotPath));
      const debugPath = path.join(debugOutputDir, `${basename}-detected.png`);

      saveBitmapWithBox(bitmap, result, debugPath);
      console.log(`   Debug image: ${debugPath}`);
      return true;
    } else {
      console.log(`\n❌ NO DETECTION - Overlay not found in image`);
      return false;
    }
  } catch (error) {
    console.error(`\n❌ Detection failed with error: ${error}`);
    return false;
  } finally {
    console.log("─".repeat(60));
  }
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

/**
 * Main test runner
 */
async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));

  if (args.length === 0) {
    console.log(`
Usage: npx ts-node src/main/automateBots/test-detector.ts <screenshot-path> [screenshot-path2] ...

Examples:
  npx ts-node src/main/automateBots/test-detector.ts ./test-images/screenshot1.png
  npx ts-node src/main/automateBots/test-detector.ts test-images/tile-*.png

The script will:
  1. Load each PNG screenshot
  2. Run detectOverlayBoxInScreenshot()
  3. Print coordinates if found
  4. Save debug image with overlay box drawn
    `);
    return;
  }

  console.log(`\n🧪 Coordinate Detector Test Suite`);
  console.log(`Testing ${args.length} screenshot(s)...\n`);

  let successCount = 0;
  let failureCount = 0;

  for (const arg of args) {
    const success = await testDetection(arg);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  console.log(`\n📊 Results: ${successCount} passed, ${failureCount} failed`);
}

main().catch(console.error);
