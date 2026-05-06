import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  detectGuardianOfTheRiftPowerBar,
  detectGuardianOfTheRiftRewardPoints,
  detectGuardianOfTheRiftTimeSincePortal,
  type GuardianOfTheRiftTimeSincePortalColor,
} from "./guardian-of-the-rift-panel-detector";
import { detectGuardianOfTheRiftTimer } from "./guardian-of-the-rift-timer-detector";
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

function drawPowerBarPixels(bitmap: RobotBitmap, color: { r: number; g: number; b: number }): void {
  for (let y = 72; y <= 88; y += 1) {
    for (let x = 18; x <= 215; x += 1) {
      setPixel(bitmap, x, y, color);
    }
  }
}

const SYNTHETIC_DIGIT_ROWS: Record<string, string[]> = {
  "1": ["00011", "01111", "11111", "11111", "00111", "00111", "00111"],
  "5": ["11111", "11111", "11111", "11111", "11011", "11111", "11111"],
};

function drawTimeDigits(
  bitmap: RobotBitmap,
  rawText: string,
  startX: number,
  startY: number,
  color: { r: number; g: number; b: number },
): void {
  const scale = 2;
  let cursorX = startX;

  for (const digit of rawText) {
    const rows = SYNTHETIC_DIGIT_ROWS[digit];
    if (!rows) {
      throw new Error(`Missing synthetic digit rows for ${digit}`);
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < rows[rowIndex].length; columnIndex += 1) {
        if (rows[rowIndex][columnIndex] !== "1") {
          continue;
        }

        for (let yScale = 0; yScale < scale; yScale += 1) {
          for (let xScale = 0; xScale < scale; xScale += 1) {
            setPixel(bitmap, cursorX + columnIndex * scale + xScale, startY + rowIndex * scale + yScale, color);
          }
        }
      }
    }

    cursorX += rows[0].length * scale + 3;
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
  test("detects Guardian Power yellow and blue bar states", async () => {
    const yellowBitmap = await loadPngBitmap(
      "test-images/runescrafting/guardian-of-the-rift/pannel/1298x1549-2k-125-yellow-145.png",
    );
    const blueBitmap = await loadPngBitmap(
      "test-images/runescrafting/guardian-of-the-rift/active-guardian/1328x1549-2k-125-air-body.png",
    );

    expect(detectGuardianOfTheRiftPowerBar(yellowBitmap, "helper").fillColor).toBe("yellow");
    expect(detectGuardianOfTheRiftPowerBar(blueBitmap, "helper").fillColor).toBe("blue");
  });

  test("classifies an empty Guardian Power bar and a missing panel", () => {
    const emptyBitmap = createBitmap(260, 120, { r: 25, g: 25, b: 25 });
    drawPowerBarPixels(emptyBitmap, { r: 150, g: 150, b: 145 });

    const missingBitmap = createBitmap(260, 120, { r: 25, g: 25, b: 25 });

    expect(detectGuardianOfTheRiftPowerBar(emptyBitmap, "helper").fillColor).toBe("empty");
    expect(detectGuardianOfTheRiftPowerBar(missingBitmap, "helper").fillColor).toBe("missing");
  });

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

      const detection = detectGuardianOfTheRiftTimeSincePortal(bitmap, "helper");
      const rewardPoints = detectGuardianOfTheRiftRewardPoints(bitmap, "helper");

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

    const detection = detectGuardianOfTheRiftTimeSincePortal(bitmap, "helper");

    expect(detection.color).toBe("white");
    expect(detection.pixelCount).toBeGreaterThan(20);
  });

  test("detects reward points when the panel is moved away from the fixed ROI", async () => {
    const screenshotPath = "test-images/runescrafting/guardian-of-the-rift/outlined/1598x1549-2k-125-1.png";
    if (!fs.existsSync(screenshotPath)) {
      return;
    }

    const bitmap = await loadPngBitmap(screenshotPath);
    const rewardPoints = detectGuardianOfTheRiftRewardPoints(bitmap, "helper");

    expect(rewardPoints.elementalPoints).toBe(0);
    expect(rewardPoints.catalyticPoints).toBe(0);
    expect(rewardPoints.rawText).toBe("0/0");
    expect(rewardPoints.focus).toBe("balanced");
  });

  test("classifies a red time-since-portal value when a screenshot is not available yet", () => {
    const bitmap = createBitmap(260, 520, { r: 28, g: 26, b: 24 });
    drawTimeValuePixels(bitmap, { r: 245, g: 35, b: 30 });

    const detection = detectGuardianOfTheRiftTimeSincePortal(bitmap, "helper");

    expect(detection.color).toBe("red");
    expect(detection.pixelCount).toBeGreaterThan(20);
  });

  test("classifies optimizer portal time color from parsed timer digits", () => {
    const bitmap = createBitmap(260, 520, { r: 28, g: 26, b: 24 });

    for (let y = 392; y <= 395; y += 1) {
      for (let x = 116; x <= 225; x += 1) {
        setPixel(bitmap, x, y, { r: 235, g: 235, b: 230 });
      }
    }

    drawTimeDigits(bitmap, "115", 150, 404, { r: 245, g: 35, b: 30 });

    const detection = detectGuardianOfTheRiftTimeSincePortal(bitmap, "optimizer");

    expect(detection.secondsElapsed).toBe(75);
    expect(detection.rawText).toBe("115");
    expect(detection.color).toBe("red");
    expect(detection.counts.red).toBeGreaterThan(detection.counts.white);
  });

  test("detects the optimizer overlay portal time and ignores unavailable reward points", async () => {
    const bitmap = await loadPngBitmap(
      "test-images/runescrafting/guardian-of-the-rift/1639x1549-2k-125-new-panel-time-and-reward-point.png",
    );

    const timeSincePortal = detectGuardianOfTheRiftTimeSincePortal(bitmap, "optimizer");
    const rewardPoints = detectGuardianOfTheRiftRewardPoints(bitmap, "optimizer");
    const timer = detectGuardianOfTheRiftTimer(bitmap, "optimizer");

    expect(timeSincePortal.secondsElapsed).toBe(50);
    expect(timeSincePortal.rawText).toBe("050");
    expect(timeSincePortal.color).toBe("white");
    expect(rewardPoints.elementalPoints).toBeNull();
    expect(rewardPoints.catalyticPoints).toBeNull();
    expect(rewardPoints.focus).toBeNull();
    expect(timer.secondsRemaining).toBe(70);
  });

  test("detects the optimizer game-starting timer and portal time on the smaller-outline screenshot", async () => {
    const bitmap = await loadPngBitmap(
      "test-images/runescrafting/guardian-of-the-rift/1639x1549-2k-125-new-outlined.png",
    );

    const timeSincePortal = detectGuardianOfTheRiftTimeSincePortal(bitmap, "optimizer");
    const rewardPoints = detectGuardianOfTheRiftRewardPoints(bitmap, "optimizer");
    const timer = detectGuardianOfTheRiftTimer(bitmap, "optimizer");

    expect(detectGuardianOfTheRiftPowerBar(bitmap, "optimizer").fillColor).toBe("empty");
    expect(timeSincePortal.secondsElapsed).toBe(67);
    expect(timeSincePortal.rawText).toBe("107");
    expect(rewardPoints.elementalPoints).toBeNull();
    expect(rewardPoints.catalyticPoints).toBeNull();
    expect(timer.secondsRemaining).toBe(48);
    expect(timer.rawText).toBe("48");
  });
});
