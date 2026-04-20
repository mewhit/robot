import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  detectBestMotherlodeDepositBoxInScreenshot,
  saveBitmapWithMotherlodeDepositBoxes,
} from "./motherlode-deposit-box-detector";
import { detectBestPlayerBoxInScreenshot, saveBitmapWithPlayerBoxes } from "./player-box-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

const DEPOSIT_PLAYER_NEAR_RADIUS_PX = 48;

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getPlayerDistanceToDepositBox(
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: { x: number; y: number; width: number; height: number } | null,
): number | null {
  if (!playerAnchorInCapture || !depositBox) return null;
  const nearestX = clamp(playerAnchorInCapture.x, depositBox.x, depositBox.x + depositBox.width - 1);
  const nearestY = clamp(playerAnchorInCapture.y, depositBox.y, depositBox.y + depositBox.height - 1);
  const dx = playerAnchorInCapture.x - nearestX;
  const dy = playerAnchorInCapture.y - nearestY;
  return Math.sqrt(dx * dx + dy * dy);
}

function isPlayerNearDepositBox(
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: { x: number; y: number; width: number; height: number } | null,
  radiusPx: number,
): boolean {
  const distance = getPlayerDistanceToDepositBox(playerAnchorInCapture, depositBox);
  return distance !== null && distance <= radiusPx;
}

function resolveExpectedNearDeposit(basename: string): boolean | null {
  const normalized = basename.toLowerCase();
  if (normalized.includes("-yes")) {
    return true;
  }

  if (normalized.includes("-no")) {
    return false;
  }

  return null;
}

async function testNearDepositTransition(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const basename = path.basename(screenshotPath);
  const expectedNear = resolveExpectedNearDeposit(basename);
  if (expectedNear === null) {
    console.error(`No expected near-deposit outcome configured for ${basename}.`);
    return false;
  }

  const depositBox = detectBestMotherlodeDepositBoxInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
  const distancePx = getPlayerDistanceToDepositBox(playerAnchorInCapture, depositBox);
  const nearDeposit = isPlayerNearDepositBox(playerAnchorInCapture, depositBox, DEPOSIT_PLAYER_NEAR_RADIUS_PX);

  const basenameNoExt = path.basename(screenshotPath, path.extname(screenshotPath));
  const depositDebugPath = path.join("test-image-debug", `${basenameNoExt}-near-deposit-deposit.png`);
  const playerDebugPath = path.join("test-image-debug", `${basenameNoExt}-near-deposit-player.png`);

  saveBitmapWithMotherlodeDepositBoxes(bitmap, depositBox ? [depositBox] : [], depositDebugPath);
  await saveBitmapWithPlayerBoxes(bitmap, playerBox ? [playerBox] : [], playerDebugPath);

  console.log(`Deposit debug image: ${depositDebugPath}`);
  console.log(`Player debug image: ${playerDebugPath}`);

  if (!depositBox) {
    console.error(`No deposit box detected in ${basename}.`);
    return false;
  }

  if (!playerBox) {
    console.error(`No player box detected in ${basename}.`);
    return false;
  }

  console.log(
    `Deposit box: (${depositBox.x},${depositBox.y}) ${depositBox.width}x${depositBox.height} center=(${depositBox.centerX},${depositBox.centerY})`,
  );
  console.log(`Player box: (${playerBox.x},${playerBox.y}) ${playerBox.width}x${playerBox.height} center=(${playerBox.centerX},${playerBox.centerY})`);
  console.log(`Distance to deposit: ${distancePx?.toFixed(2) ?? "n/a"}px`);
  console.log(`Near deposit (${DEPOSIT_PLAYER_NEAR_RADIUS_PX}px): ${nearDeposit ? "YES" : "NO"}`);
  console.log(`Expected near deposit: ${expectedNear ? "YES" : "NO"}`);

  if (nearDeposit !== expectedNear) {
    console.error(`Near-deposit mismatch for ${basename}.`);
    return false;
  }

  console.log("Near-deposit expectation matched.");
  return true;
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/motherlode-near-deposit-transition/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  if (expandedScreenshots.length === 0) {
    console.error("No screenshots to test.");
    process.exit(1);
  }

  console.log("\nMotherlode Near-Deposit Transition Test Suite");
  console.log(`Testing ${expandedScreenshots.length} screenshot(s)...`);

  let successCount = 0;
  let failureCount = 0;

  for (const screenshotPath of expandedScreenshots) {
    const success = await testNearDepositTransition(screenshotPath);
    if (success) {
      successCount += 1;
    } else {
      failureCount += 1;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${successCount} passed, ${failureCount} failed`);
  console.log("=".repeat(60));

  process.exit(failureCount === 0 ? 0 : 1);
}

void main();
