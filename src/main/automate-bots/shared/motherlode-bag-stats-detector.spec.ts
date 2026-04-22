import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  MotherlodeBagStats,
  detectMotherlodeBagStatsInScreenshot,
  saveBitmapWithMotherlodeBagStats,
} from "./motherlode-bag-stats-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type ExpectedStats = {
  sackCount: number;
  inventoryCount: number;
  capacityCount: number;
  row2Value: number;
  row3Value: number;
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

function expectedStatsFromScreenshotPath(screenshotPath: string): ExpectedStats | null {
  const basename = path.basename(screenshotPath).toLowerCase();

  if (basename.includes("[168+22-189]-[1]-[-1}")) {
    return {
      sackCount: 168,
      inventoryCount: 22,
      capacityCount: 189,
      row2Value: 1,
      row3Value: -1,
    };
  }

  if (basename.includes("1298x1549-2k-125-3")) {
    return {
      sackCount: 80,
      inventoryCount: 0,
      capacityCount: 108,
      row2Value: 2,
      row3Value: 28,
    };
  }

  if (basename.includes("full-bag")) {
    return {
      sackCount: 56,
      inventoryCount: 28,
      capacityCount: 108,
      row2Value: 2,
      row3Value: 8,
    };
  }

  return null;
}

function validateDetection(detection: MotherlodeBagStats, expected: ExpectedStats): boolean {
  if (detection.sackRow.sackCount !== expected.sackCount) {
    console.error(`Expected sack=${expected.sackCount}, got ${detection.sackRow.sackCount}`);
    return false;
  }

  if (detection.sackRow.inventoryCount !== expected.inventoryCount) {
    console.error(`Expected inventory=${expected.inventoryCount}, got ${detection.sackRow.inventoryCount}`);
    return false;
  }

  if (detection.sackRow.capacityCount !== expected.capacityCount) {
    console.error(`Expected capacity=${expected.capacityCount}, got ${detection.sackRow.capacityCount}`);
    return false;
  }

  if (detection.row2.value !== expected.row2Value) {
    console.error(`Expected row2=${expected.row2Value}, got ${detection.row2.value}`);
    return false;
  }

  if (detection.row3.value !== expected.row3Value) {
    console.error(`Expected row3=${expected.row3Value}, got ${detection.row3.value}`);
    return false;
  }

  return true;
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const detection = detectMotherlodeBagStatsInScreenshot(bitmap);
  if (!detection) {
    console.error("No motherlode bag stats panel detected.");
    return false;
  }

  console.log(`Panel roi=(${detection.x}, ${detection.y}) ${detection.width}x${detection.height}`);
  console.log(
    `Sack row: raw='${detection.sackRow.rawText ?? ""}' sack=${detection.sackRow.sackCount} inventory=${detection.sackRow.inventoryCount} capacity=${detection.sackRow.capacityCount}`,
  );
  console.log(`Row 2: raw='${detection.row2.rawText ?? ""}' value=${detection.row2.value}`);
  console.log(`Row 3: raw='${detection.row3.rawText ?? ""}' value=${detection.row3.value}`);

  const debugOutputDir = "./test-image-debug";
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const debugPath = path.join(debugOutputDir, `${basename}-motherlode-bag-stats.png`);
  saveBitmapWithMotherlodeBagStats(bitmap, detection, debugPath);
  console.log(`Debug image: ${debugPath}`);

  const expected = expectedStatsFromScreenshotPath(screenshotPath);
  if (!expected) {
    return true;
  }

  return validateDetection(detection, expected);
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/motherlode-bag-full-box/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log(`\nMotherlode Bag Stats Detector Test Suite`);
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
