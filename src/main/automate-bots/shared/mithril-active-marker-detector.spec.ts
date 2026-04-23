import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  detectMithrilActiveMarkerBoxesInScreenshot,
  saveBitmapWithMithrilActiveMarkerBoxes,
} from "./mithril-active-marker-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
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

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const boxes = detectMithrilActiveMarkerBoxesInScreenshot(bitmap);
  const basenameNoExt = path.basename(screenshotPath, path.extname(screenshotPath));
  const debugPath = path.join("./test-image-debug", `${basenameNoExt}-mithril-active-marker.png`);
  saveBitmapWithMithrilActiveMarkerBoxes(bitmap, boxes, debugPath);

  for (const [index, box] of boxes.entries()) {
    console.log(
      `#${index + 1} marker at (${box.x}, ${box.y}) ${box.width}x${box.height} center=(${box.centerX}, ${box.centerY}) pixels=${box.pixelCount} fill=${box.fillRatio.toFixed(3)} score=${box.score.toFixed(1)}`,
    );
  }

  if (boxes.length !== 1) {
    console.error(`FAILED: Expected exactly 1 mithril active marker, but detected ${boxes.length}.`);
    return false;
  }

  const [box] = boxes;
  if (Math.abs(box.centerX - 36) > 4 || Math.abs(box.centerY - 34) > 4) {
    console.error(
      `FAILED: Active marker center mismatch. Expected approx (36, 34) ±4px, got (${box.centerX}, ${box.centerY}).`,
    );
    return false;
  }

  console.log(`Debug image: ${debugPath}`);
  return true;
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/mining-mithril-mining-guilde/tini-yellow-circle.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log(`\nMithril Active Marker Detector Test Suite`);
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
