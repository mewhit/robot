import path from "path";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_MOTHERLODE_BAG_STATS_SCREENSHOTS,
  expandScreenshotArgs,
  expectedStatsFromScreenshotPath,
  testDetection,
} from "./motherlode-bag-stats-detector.spec";

const screenshotPaths = expandScreenshotArgs(DEFAULT_MOTHERLODE_BAG_STATS_SCREENSHOTS).sort((a, b) =>
  a.localeCompare(b),
);

describe.sequential("test:screenshot:motherlode-bag-stats", () => {
  test("fixtures should exist", () => {
    expect(screenshotPaths.length).toBeGreaterThan(0);
  });

  for (const screenshotPath of screenshotPaths) {
    const screenshotName = path.basename(screenshotPath);

    test(screenshotName, async () => {
      const expected = expectedStatsFromScreenshotPath(screenshotPath);
      expect(
        expected,
        `Missing expected values in filename: ${screenshotName}. Use ...-[<sack>+<inventory>-<capacity>]-[<row2>]-[<row3>].png`,
      ).not.toBeNull();

      if (!expected) {
        return;
      }

      const status = await testDetection(screenshotPath);
      expect(status).toBe("passed");
    });
  }
});
