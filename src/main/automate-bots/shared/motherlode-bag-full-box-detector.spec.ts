import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  MotherlodeBagFullState,
  detectMotherlodeBagFullBoxInScreenshot,
  saveBitmapWithMotherlodeBagFullBox,
} from "./motherlode-bag-full-box-detector";

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

function expectedStateFromScreenshotPath(screenshotPath: string): MotherlodeBagFullState | null {
  const file = path.basename(screenshotPath).toLowerCase();

  if (file.includes("full-bag")) {
    return "green";
  }

  if (file.includes("near-full")) {
    return "yellow";
  }

  if (file.includes("deposite-full") || file.includes("deposit-full")) {
    return "red";
  }

  if (file.includes("mining-time")) {
    return "native";
  }

  if (file.includes("[-3777]-[140]")) {
    return "red";
  }

  return null;
}

function shiftBitmapDown(bitmap: RobotBitmap, shiftY: number): RobotBitmap {
  const clampedShift = Math.max(0, Math.min(bitmap.height - 1, Math.floor(shiftY)));
  if (clampedShift <= 0) {
    return {
      ...bitmap,
      image: Buffer.from(bitmap.image),
    };
  }

  const shifted = Buffer.alloc(bitmap.image.length);

  for (let y = 0; y < bitmap.height; y += 1) {
    const sourceY = y - clampedShift;
    const effectiveSourceY = sourceY >= 0 ? sourceY : 0;
    const sourceOffset = effectiveSourceY * bitmap.byteWidth;
    const targetOffset = y * bitmap.byteWidth;
    bitmap.image.copy(shifted, targetOffset, sourceOffset, sourceOffset + bitmap.byteWidth);
  }

  return {
    width: bitmap.width,
    height: bitmap.height,
    byteWidth: bitmap.byteWidth,
    bytesPerPixel: bitmap.bytesPerPixel,
    image: shifted,
  };
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const expectedState = expectedStateFromScreenshotPath(screenshotPath);
  const detection = detectMotherlodeBagFullBoxInScreenshot(bitmap);

  console.log(`Detected state: ${detection.state}`);
  if (expectedState) {
    console.log(`Expected state: ${expectedState}`);
  }

  console.log(
    `Panel roi=(${detection.x}, ${detection.y}) ${detection.width}x${detection.height} total=${detection.totalPixelCount} confidence=${detection.confidence.toFixed(3)}`,
  );
  console.log(
    `Pixels native=${detection.nativePixelCount} green=${detection.greenPixelCount} yellow=${detection.yellowPixelCount} red=${detection.redPixelCount}`,
  );

  const debugOutputDir = "./test-image-debug";
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const debugPath = path.join(debugOutputDir, `${basename}-motherlode-bag-full-box.png`);
  saveBitmapWithMotherlodeBagFullBox(bitmap, detection, debugPath);
  console.log(`Debug image: ${debugPath}`);

  if (!expectedState) {
    return true;
  }

  const shiftCandidates = [
    Math.max(40, Math.round(bitmap.height * 0.05)),
    Math.max(80, Math.round(bitmap.height * 0.1)),
  ]
    .filter((shift, index, values) => shift < bitmap.height / 3 && values.indexOf(shift) === index)
    .sort((a, b) => a - b);

  let shiftsMatch = true;
  for (const shiftY of shiftCandidates) {
    const shiftedBitmap = shiftBitmapDown(bitmap, shiftY);
    const shiftedDetection = detectMotherlodeBagFullBoxInScreenshot(shiftedBitmap);
    console.log(
      `Shift +${shiftY}px: state=${shiftedDetection.state} roi=(${shiftedDetection.x}, ${shiftedDetection.y}) ${shiftedDetection.width}x${shiftedDetection.height} confidence=${shiftedDetection.confidence.toFixed(3)}`,
    );

    if (shiftedDetection.state !== expectedState) {
      shiftsMatch = false;
      const shiftedDebugPath = path.join(debugOutputDir, `${basename}-shift-${shiftY}-motherlode-bag-full-box.png`);
      saveBitmapWithMotherlodeBagFullBox(shiftedBitmap, shiftedDetection, shiftedDebugPath);
      console.error(
        `Shifted state mismatch for ${screenshotPath} at +${shiftY}px: expected=${expectedState} actual=${shiftedDetection.state}`,
      );
      console.error(`Shifted debug image: ${shiftedDebugPath}`);
    }
  }

  const isMatch = detection.state === expectedState && shiftsMatch;
  if (detection.state !== expectedState) {
    console.error(`State mismatch for ${screenshotPath}: expected=${expectedState} actual=${detection.state}`);
  }

  return isMatch;
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/motherlode-bag-full-box/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log(`\nMotherlode Bag Full Box Detector Test Suite`);
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
}

main().catch(console.error);
