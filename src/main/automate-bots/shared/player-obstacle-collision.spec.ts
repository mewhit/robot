import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  detectBestMotherlodeObstacleRedBoxInScreenshot,
  saveBitmapWithMotherlodeObstacleRedBoxes,
} from "./motherlode-obstacle-red-detector";
import { detectBestPlayerBoxInScreenshot, saveBitmapWithPlayerBoxes } from "./player-box-detector";
import { isPlayerCollidingWithObstacle } from "./player-obstacle-collision";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

const COLLISION_PADDING_PX = 4;

const EXPECTED_COLLISION_BY_SCREENSHOT: Record<string, boolean> = {
  "1600x1549-2k-125-colide-test.png": true,
  "1600x1549-2k-125-no-colide-test.png": false,
  "1600x1549-2k-125-no-colide-test2.png": false,
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

function resolveExpectedCollision(basename: string): boolean | null {
  if (basename in EXPECTED_COLLISION_BY_SCREENSHOT) {
    return EXPECTED_COLLISION_BY_SCREENSHOT[basename];
  }

  const normalized = basename.toLowerCase();
  if (normalized.includes("no-colide") || normalized.includes("no-collide")) {
    return false;
  }

  if (normalized.includes("colide") || normalized.includes("collide")) {
    return true;
  }

  return null;
}

async function testCollision(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const basename = path.basename(screenshotPath);
  const expectedCollision = resolveExpectedCollision(basename);
  if (expectedCollision === null) {
    console.error(`No expected collision outcome configured for ${basename}.`);
    return false;
  }

  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const obstacleBox = detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);

  const basenameNoExt = path.basename(screenshotPath, path.extname(screenshotPath));
  const playerDebugPath = path.join("test-image-debug", `${basenameNoExt}-player-box.png`);
  const obstacleDebugPath = path.join("test-image-debug", `${basenameNoExt}-obstacle-red-box.png`);

  await saveBitmapWithPlayerBoxes(bitmap, playerBox ? [playerBox] : [], playerDebugPath);
  saveBitmapWithMotherlodeObstacleRedBoxes(bitmap, obstacleBox ? [obstacleBox] : [], obstacleDebugPath);

  console.log(`Player debug image: ${playerDebugPath}`);
  console.log(`Obstacle debug image: ${obstacleDebugPath}`);

  const detectedCollision = isPlayerCollidingWithObstacle(playerBox, obstacleBox, COLLISION_PADDING_PX);

  if (!playerBox || !obstacleBox) {
    if (!playerBox) {
      console.warn(`No player box detected in ${basename}.`);
    }

    if (!obstacleBox) {
      console.warn(`No obstacle red box detected in ${basename}.`);
    }

    console.log(`Collision with padding ${COLLISION_PADDING_PX}px: ${detectedCollision ? "YES" : "NO"}`);
    console.log(`Expected collision: ${expectedCollision ? "YES" : "NO"}`);

    if (detectedCollision !== expectedCollision) {
      console.error(`Collision mismatch for ${basename}.`);
      return false;
    }

    console.log("Collision expectation matched.");
    return true;
  }

  console.log(
    `Player box: (${playerBox.x},${playerBox.y}) ${playerBox.width}x${playerBox.height} center=(${playerBox.centerX},${playerBox.centerY})`,
  );
  console.log(
    `Obstacle box: (${obstacleBox.x},${obstacleBox.y}) ${obstacleBox.width}x${obstacleBox.height} center=(${obstacleBox.centerX},${obstacleBox.centerY})`,
  );
  console.log(`Collision with padding ${COLLISION_PADDING_PX}px: ${detectedCollision ? "YES" : "NO"}`);
  console.log(`Expected collision: ${expectedCollision ? "YES" : "NO"}`);

  if (detectedCollision !== expectedCollision) {
    console.error(`Collision mismatch for ${basename}.`);
    return false;
  }

  console.log("Collision expectation matched.");
  return true;
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/colide/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  if (expandedScreenshots.length === 0) {
    console.error("No screenshots to test.");
    process.exit(1);
  }

  console.log("\nPlayer/Obstacle Collision Test Suite");
  console.log(`Testing ${expandedScreenshots.length} screenshot(s)...`);

  let successCount = 0;
  let failureCount = 0;

  for (const screenshotPath of expandedScreenshots) {
    const success = await testCollision(screenshotPath);
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
