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

const VALID_MOTHERLODE_CAPACITIES = [81, 108, 162, 189];

type TestStatus = "passed" | "failed" | "skipped";

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
  const basename = path.basename(screenshotPath, path.extname(screenshotPath)).toLowerCase();

  // Preferred filename format:
  // ...-[<sack>+<inventory>-<capacity>]-[<row2>]-[<row3>].png
  // Example: 3840x2128-4k-100-[168+22-189]-[1]-[-1].png
  // Also tolerates legacy closing brace typo on last group: ...-[-1}.png
  const expectedFromNameMatch = basename.match(/\[(-?\d+)\+(-?\d+)-(-?\d+)\]-\[(-?\d+)\]-\[(-?\d+)[\]\}]$/i);
  if (expectedFromNameMatch) {
    const sackCount = Number(expectedFromNameMatch[1]);
    const inventoryCount = Number(expectedFromNameMatch[2]);
    const rawCapacityCount = Number(expectedFromNameMatch[3]);
    const row2Value = Number(expectedFromNameMatch[4]);
    const row3Value = Number(expectedFromNameMatch[5]);
    let capacityCount = rawCapacityCount;

    // Some filename fixtures use a placeholder `0` for capacity when the sack
    // count already implies the Motherlode max-capacity tier.
    if (capacityCount <= 0 && VALID_MOTHERLODE_CAPACITIES.includes(sackCount)) {
      capacityCount = sackCount;
    }

    if (capacityCount > 0) {
      return {
        sackCount,
        inventoryCount,
        capacityCount,
        row2Value,
        row3Value,
      };
    }
  }

  // Legacy fallback names (kept for backward compatibility).

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

async function testDetection(screenshotPath: string): Promise<TestStatus> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    console.warn("Skipping unreadable screenshot.");
    return "skipped";
  }

  const detection = detectMotherlodeBagStatsInScreenshot(bitmap);
  if (!detection) {
    console.error("No motherlode bag stats panel detected.");
    return "failed";
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
    return "passed";
  }

  console.log(
    `Expected by filename: sack=${expected.sackCount} inventory=${expected.inventoryCount} capacity=${expected.capacityCount} row2=${expected.row2Value} row3=${expected.row3Value}`,
  );

  return validateDetection(detection, expected) ? "passed" : "failed";
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/motherlode-bag-full-box/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log(`\nMotherlode Bag Stats Detector Test Suite`);
  console.log(`Testing ${expandedScreenshots.length} screenshot(s)...`);

  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;

  for (const screenshotPath of expandedScreenshots) {
    const status = await testDetection(screenshotPath);
    if (status === "passed") {
      successCount += 1;
    } else if (status === "failed") {
      failureCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  console.log(`\nResults: ${successCount} passed, ${failureCount} failed, ${skippedCount} skipped`);
}

main().catch(console.error);
