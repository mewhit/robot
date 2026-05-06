import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  detectGuardianOfTheRiftRewardPoints,
  detectGuardianOfTheRiftTimeSincePortal,
  type GuardianOfTheRiftTimeSincePortalColor,
} from "./guardian-of-the-rift-panel-detector";
import type { RobotBitmap } from "./ocr-engine";

const PANEL_SCREENSHOT_DIR = "test-images/runescrafting/guardian-of-the-rift/pannel";

function loadPngBitmap(filePath: string): Promise<RobotBitmap> {
  return new Promise((resolve, reject) => {
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
      .on("error", reject);
  });
}

function createBitmap(width: number, height: number, color: { r: number; g: number; b: number }): RobotBitmap {
  const image = Buffer.alloc(width * height * 4);

  for (let index = 0; index < image.length; index += 4) {
    image[index] = color.b;
    image[index + 1] = color.g;
    image[index + 2] = color.r;
    image[index + 3] = 255;
  }

  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image,
  };
}

function setPixel(bitmap: RobotBitmap, x: number, y: number, color: { r: number; g: number; b: number }): void {
  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
  bitmap.image[offset] = color.b;
  bitmap.image[offset + 1] = color.g;
  bitmap.image[offset + 2] = color.r;
  bitmap.image[offset + 3] = 255;
}

function drawTimeValuePixels(bitmap: RobotBitmap, color: { r: number; g: number; b: number }): void {
  for (let y = 407; y <= 420; y += 1) {
    for (let x = 184; x <= 200; x += 1) {
      if ((x + y) % 3 !== 0) {
        setPixel(bitmap, x, y, color);
      }
    }
  }
}

function expectedColorFromScreenshotPath(screenshotPath: string): GuardianOfTheRiftTimeSincePortalColor | null {
  const basename = path.basename(screenshotPath);
  const match = basename.match(/-(green|yellow|white|red)-/i);
  return match ? (match[1].toLowerCase() as GuardianOfTheRiftTimeSincePortalColor) : null;
}

function expectedSecondsFromScreenshotPath(screenshotPath: string): number | null {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const match = basename.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function listPanelScreenshots(): string[] {
  if (!fs.existsSync(PANEL_SCREENSHOT_DIR)) {
    return [];
  }

  return fs
    .readdirSync(PANEL_SCREENSHOT_DIR)
    .filter((entry) => /\.(png|jpg|jpeg)$/i.test(entry))
    .map((entry) => path.join(PANEL_SCREENSHOT_DIR, entry))
    .sort((a, b) => a.localeCompare(b));
}

describe("Guardian of the Rift panel detector", () => {
  test("detects the time-since-portal color in current panel screenshots", async () => {
    const screenshotPaths = listPanelScreenshots();
    const unreadableScreenshots: string[] = [];
    let tested = 0;

    expect(screenshotPaths.length).toBeGreaterThan(0);

    for (const screenshotPath of screenshotPaths) {
      const expectedColor = expectedColorFromScreenshotPath(screenshotPath);
      const expectedSeconds = expectedSecondsFromScreenshotPath(screenshotPath);
      expect(expectedColor, `Missing expected color in filename: ${path.basename(screenshotPath)}`).not.toBeNull();
      expect(expectedSeconds, `Missing expected seconds in filename: ${path.basename(screenshotPath)}`).not.toBeNull();

      if (!expectedColor || expectedSeconds === null) {
        continue;
      }

      let bitmap: RobotBitmap;
      try {
        bitmap = await loadPngBitmap(screenshotPath);
      } catch {
        unreadableScreenshots.push(path.basename(screenshotPath));
        continue;
      }

      const detection = detectGuardianOfTheRiftTimeSincePortal(bitmap);
      const rewardPoints = detectGuardianOfTheRiftRewardPoints(bitmap);

      expect(detection.color, path.basename(screenshotPath)).toBe(expectedColor);
      expect(detection.secondsElapsed, path.basename(screenshotPath)).toBe(expectedSeconds);
      expect(detection.rawText, path.basename(screenshotPath)).toBe(String(expectedSeconds));
      expect(detection.pixelCount, path.basename(screenshotPath)).toBeGreaterThan(20);
      expect(detection.confidence, path.basename(screenshotPath)).toBeGreaterThan(0.8);
      expect(rewardPoints.elementalPoints, path.basename(screenshotPath)).toBe(22);
      expect(rewardPoints.catalyticPoints, path.basename(screenshotPath)).toBe(15);
      expect(rewardPoints.rawText, path.basename(screenshotPath)).toBe("22/15");
      expect(rewardPoints.focus, path.basename(screenshotPath)).toBe("catalytic");
      tested += 1;
    }

    expect(tested).toBeGreaterThan(0);
    expect(tested, `Unreadable screenshots: ${unreadableScreenshots.join(", ")}`).toBeGreaterThanOrEqual(
      screenshotPaths.length - 1,
    );
  });

  test("classifies a white time-since-portal value when a screenshot is not available yet", () => {
    const bitmap = createBitmap(260, 520, { r: 28, g: 26, b: 24 });
    drawTimeValuePixels(bitmap, { r: 235, g: 235, b: 230 });

    const detection = detectGuardianOfTheRiftTimeSincePortal(bitmap);

    expect(detection.color).toBe("white");
    expect(detection.pixelCount).toBeGreaterThan(20);
  });

  test("classifies a red time-since-portal value when a screenshot is not available yet", () => {
    const bitmap = createBitmap(260, 520, { r: 28, g: 26, b: 24 });
    drawTimeValuePixels(bitmap, { r: 245, g: 35, b: 30 });

    const detection = detectGuardianOfTheRiftTimeSincePortal(bitmap);

    expect(detection.color).toBe("red");
    expect(detection.pixelCount).toBeGreaterThan(20);
  });
});
