import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";
import {
  BankDepositOrbDetection,
  detectBankDepositIconWithOrb,
  saveBitmapWithBankDepositOrbDetection,
} from "./bank-deposit-orb-detector";

type ExpectedDetection = {
  shouldDetect: boolean;
  centerX?: number;
  centerY?: number;
  tolerancePx?: number;
  minInliers?: number;
  minAppearanceScore?: number;
};

const DEFAULT_REFERENCE_ICON = "test-images/icon/bank-deposit/bank-deposit-icon.png";

const EXPECTED_BY_SCREENSHOT: Record<string, ExpectedDetection> = {
  "1600x1549-2k-125-bankin-deposit-test-image.png": {
    shouldDetect: true,
    centerX: 326,
    centerY: 838,
    tolerancePx: 2,
    minInliers: 10,
    minAppearanceScore: 0.98,
  },
  "1298x1549-2k-125-bankin-deposit-test-image2.png": {
    shouldDetect: true,
    centerX: 326,
    centerY: 838,
    tolerancePx: 2,
    minInliers: 10,
    minAppearanceScore: 0.98,
  },
};

async function loadPngBitmap(filePath: string): Promise<RobotBitmap | null> {
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

        for (let i = 0; i < png.data.length; i += 4) {
          image[i] = png.data[i + 2];
          image[i + 1] = png.data[i + 1];
          image[i + 2] = png.data[i];
          image[i + 3] = 255;
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
        console.error(`Failed to load ${filePath}: ${error}`);
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

    if (matches.length === 0) {
      expanded.push(arg);
      continue;
    }

    expanded.push(...matches);
  }

  return expanded;
}

function validateDetection(
  screenshotPath: string,
  detection: BankDepositOrbDetection,
): boolean {
  const basename = path.basename(screenshotPath);
  const expected = EXPECTED_BY_SCREENSHOT[basename];

  if (!expected) {
    return true;
  }

  if (!expected.shouldDetect) {
    console.error(`Expected no detection for ${basename}, but ORB found one.`);
    return false;
  }

  if ((expected.minInliers ?? 0) > detection.inlierCount) {
    console.error(
      `Too few inliers for ${basename}: expected >=${expected.minInliers}, actual ${detection.inlierCount}`,
    );
    return false;
  }

  if ((expected.minAppearanceScore ?? 0) > detection.appearanceScore) {
    console.error(
      `Appearance score too low for ${basename}: expected >=${expected.minAppearanceScore}, actual ${detection.appearanceScore.toFixed(3)}`,
    );
    return false;
  }

  if (
    expected.centerX !== undefined &&
    expected.centerY !== undefined &&
    expected.tolerancePx !== undefined
  ) {
    const dx = Math.abs(expected.centerX - detection.centerX);
    const dy = Math.abs(expected.centerY - detection.centerY);

    console.log(
      `Expected center=(${expected.centerX}, ${expected.centerY}) +/-${expected.tolerancePx}px, actual=(${detection.centerX}, ${detection.centerY})`,
    );

    if (dx > expected.tolerancePx || dy > expected.tolerancePx) {
      console.error(`Center mismatch for ${basename}: dx=${dx}, dy=${dy}`);
      return false;
    }
  }

  return true;
}

async function testDetection(referenceBitmap: RobotBitmap, screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const screenshotBitmap = await loadPngBitmap(screenshotPath);
  if (!screenshotBitmap) {
    return false;
  }

  const result = detectBankDepositIconWithOrb(referenceBitmap, screenshotBitmap);
  const debugOutputPath = path.join(
    "test-image-debug",
    `${path.basename(screenshotPath, path.extname(screenshotPath))}-bank-deposit-orb.png`,
  );

  saveBitmapWithBankDepositOrbDetection(screenshotBitmap, result, debugOutputPath);
  console.log(`Reference keypoints: ${result.referenceKeypointCount}`);
  console.log(`Scene keypoints: ${result.sceneKeypointCount}`);
  console.log(`Raw matches: ${result.rawMatchCount}`);
  console.log(`Debug image: ${debugOutputPath}`);

  if (!result.detection) {
    console.log("No bank-deposit ORB match detected.");
    return false;
  }

  const detection = result.detection;
  console.log(
    `Detected icon at center=(${detection.centerX}, ${detection.centerY}) box=${detection.width}x${detection.height} score=${detection.score.toFixed(1)} inliers=${detection.inlierCount} appearance=${detection.appearanceScore.toFixed(3)} rotation=${detection.rotationDeg.toFixed(1)} scale=${detection.scale.toFixed(2)}`,
  );

  return validateDetection(screenshotPath, detection);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const referenceIconPath =
    args[0] && !args[0].includes("*") && args[0].toLowerCase().endsWith(".png") && fs.existsSync(args[0])
      ? args[0]
      : DEFAULT_REFERENCE_ICON;
  const screenshotArgs =
    referenceIconPath === DEFAULT_REFERENCE_ICON ? args : args.slice(1);
  const expandedScreenshots =
    screenshotArgs.length > 0
      ? expandScreenshotArgs(screenshotArgs)
      : expandScreenshotArgs(["test-images/icon/bank-deposit/*test-image*.png"]);

  console.log("\nBank Deposit ORB Detector Test Suite");
  console.log(`Reference icon: ${referenceIconPath}`);
  console.log(`Testing ${expandedScreenshots.length} screenshot(s)...`);

  const referenceBitmap = await loadPngBitmap(referenceIconPath);
  if (!referenceBitmap) {
    process.exitCode = 1;
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const screenshotPath of expandedScreenshots) {
    const success = await testDetection(referenceBitmap, screenshotPath);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
