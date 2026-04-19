import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { detectOverlayBoxInScreenshot, saveBitmapWithBox, saveSoftMaskDebug } from "./coordinate-box-detector";
import { debugSaveAllStagesForRaw } from "./ocr-engine";

export type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type ExpectedCoordinates = {
  x: number;
  y: number;
  z: number;
};

function cropBitmap(
  bitmap: RobotBitmap,
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
): RobotBitmap {
  const x0 = Math.max(0, cropX);
  const y0 = Math.max(0, cropY);
  const x1 = Math.min(bitmap.width, cropX + cropWidth);
  const y1 = Math.min(bitmap.height, cropY + cropHeight);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const bpp = bitmap.bytesPerPixel;
  const cropped = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y += 1) {
    const srcOffset = (y0 + y) * bitmap.byteWidth + x0 * bpp;
    const dstOffset = y * w * bpp;
    bitmap.image.copy(cropped, dstOffset, srcOffset, srcOffset + w * bpp);
  }
  return { width: w, height: h, byteWidth: w * bpp, bytesPerPixel: bpp, image: cropped };
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
        console.error(`Failed to load image: ${error}`);
        resolve(null);
      });
  });
}

function parseExpectedCoordinatesFromFilename(screenshotPath: string): ExpectedCoordinates | null {
  const fileName = path.basename(screenshotPath, path.extname(screenshotPath));
  const match = fileName.match(/(?:^|-)r-(\d+)-(\d+)-(\d)(?:-|$)/i);
  if (!match) {
    return null;
  }

  const x = Number(match[1]);
  const y = Number(match[2]);
  const z = Number(match[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return { x, y, z };
}

function parseDetectedCoordinates(matchedLine: string): ExpectedCoordinates | null {
  const match = matchedLine.match(/^\s*(\d+),(\d+),(\d)\s*$/);
  if (!match) {
    return null;
  }

  const x = Number(match[1]);
  const y = Number(match[2]);
  const z = Number(match[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return { x, y, z };
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

function parseWindowsScalePercentFromFilename(screenshotPath: string): number {
  const fileName = path.basename(screenshotPath, path.extname(screenshotPath));
  // Naming convention: [gameRes]-[monitorTier]-[scalePercent]-...
  // e.g. 1298x779-2k-125-r-3618-9473-0
  const match = fileName.match(/^\d+x\d+-\w+-(\d+)-/);
  if (!match) {
    return 100;
  }
  const scale = Number(match[1]);
  return Number.isFinite(scale) && scale > 0 ? scale : 100;
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    console.error("Failed to load screenshot");
    return false;
  }

  console.log(`Loaded image: ${bitmap.width}x${bitmap.height}`);

  const debugOutputDir = "./test-image-debug";
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const windowsScalePercent = parseWindowsScalePercentFromFilename(screenshotPath);
  console.log(`Windows scale: ${windowsScalePercent}%`);

  try {
    const result = detectOverlayBoxInScreenshot(bitmap, windowsScalePercent);
    const expectedCoordinates = parseExpectedCoordinatesFromFilename(screenshotPath);

    if (!result) {
      console.log("NO DETECTION - overlay not found in image");
      return false;
    }

    console.log("DETECTION SUCCESS");
    console.log(`Tile coordinates: ${result.matchedLine}`);
    console.log(`Overlay box: (${result.x}, ${result.y}) ${result.width}x${result.height}`);

    const debugPath = path.join(debugOutputDir, `${basename}-detected.png`);
    saveBitmapWithBox(bitmap, result, debugPath);
    console.log(`Debug image: ${debugPath}`);

    const croppedBitmap = cropBitmap(bitmap, result.x, result.y, result.width, result.height);
    const debugRawPath = path.join(debugOutputDir, `${basename}-raw.png`);
    debugSaveAllStagesForRaw(croppedBitmap, debugRawPath);
    const softMaskPath = path.join(debugOutputDir, `${basename}-05-softmask.png`);
    saveSoftMaskDebug(bitmap, result, softMaskPath);
    console.log(`OCR crop debug: ${path.join(debugOutputDir, `${basename}-02-grayscale.png`)}`);
    console.log(`OCR crop debug: ${path.join(debugOutputDir, `${basename}-04-upscaled.png`)}`);
    console.log(`Soft mask debug: ${softMaskPath}`);

    if (expectedCoordinates) {
      const detectedCoordinates = parseDetectedCoordinates(result.matchedLine);
      if (!detectedCoordinates) {
        console.error(`Could not parse detected coordinates from matched line: ${result.matchedLine}`);
        return false;
      }

      console.log(`Expected coordinates: ${expectedCoordinates.x},${expectedCoordinates.y},${expectedCoordinates.z}`);
      const isMatch =
        detectedCoordinates.x === expectedCoordinates.x &&
        detectedCoordinates.y === expectedCoordinates.y &&
        detectedCoordinates.z === expectedCoordinates.z;

      if (!isMatch) {
        console.error(
          `Coordinate mismatch: expected ${expectedCoordinates.x},${expectedCoordinates.y},${expectedCoordinates.z}, got ${detectedCoordinates.x},${detectedCoordinates.y},${detectedCoordinates.z}`,
        );
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error(`Detection failed with error: ${error}`);
    return false;
  } finally {
    console.log("-".repeat(60));
  }
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/coordinate-box/*r-*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  if (expandedScreenshots.length === 0) {
    console.error("No screenshot files found.");
    process.exitCode = 1;
    return;
  }

  console.log("\nCoordinate Detector Test Suite");
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
