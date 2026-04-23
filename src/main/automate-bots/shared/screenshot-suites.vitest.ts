import { spawn } from "child_process";
import path from "path";
import { describe, expect, test } from "vitest";

type ScreenshotSuite = {
  script: string;
  args: string[];
  timeoutMs?: number;
};

type SuiteResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  command: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 12_000;
const WORKSPACE_ROOT = process.cwd();
const TS_NODE_BIN = path.resolve(WORKSPACE_ROOT, "node_modules", "ts-node", "dist", "bin.js");

const SCREENSHOT_SUITES: Record<string, ScreenshotSuite> = {
  "test:screenshot:coordinate": {
    script: "src/main/automate-bots/shared/coordinate-box-detector.spec.ts",
    args: ["test-images/coordinate-box/*r-*.png"],
  },
  "test:screenshot:agility": {
    script: "src/main/automate-bots/shared/agility-box-detector.spec.ts",
    args: ["test-images/agility-box/*.png"],
  },
  "test:screenshot:tile-location": {
    script: "src/main/automate-bots/shared/tile-location-detection.spec.ts",
    args: ["test-images/tile-location-box/*.png"],
  },
  "test:screenshot:cyan": {
    script: "src/main/automate-bots/shared/cyan-box-detector.spec.ts",
    args: ["test-images/npc-box/*.png"],
  },
  "test:screenshot:attack": {
    script: "src/main/automate-bots/shared/attack-box-detector.spec.ts",
    args: ["test-images/attack-box/*.png"],
  },
  "test:screenshot:motherlode-mine-box": {
    script: "src/main/automate-bots/shared/motherlode-mine-box-detector.spec.ts",
    args: ["test-images/motherlode-mine-box/*.png"],
  },
  "test:screenshot:motherlode-deposit": {
    script: "src/main/automate-bots/shared/motherlode-deposit-box-detector.spec.ts",
    args: ["test-images/motherlode-mine-upstair-deposit/*.png"],
  },
  "test:screenshot:motherlode-banking-green": {
    script: "src/main/automate-bots/shared/motherlode-banking-green-detector.spec.ts",
    args: ["test-images/motherlode-banking-green/*.png"],
  },
  "test:screenshot:motherlode-banking-yellow": {
    script: "src/main/automate-bots/shared/motherlode-banking-yellow-detector.spec.ts",
    args: ["test-images/motherlode-banking-yellow/*.png"],
  },
  "test:screenshot:motherlode-bag-full": {
    script: "src/main/automate-bots/shared/motherlode-bag-full-box-detector.spec.ts",
    args: ["test-images/motherlode-bag-full-box/*.png"],
  },
  "test:screenshot:motherlode-bag-stats": {
    script: "src/main/automate-bots/shared/motherlode-bag-stats-detector.spec.ts",
    args: ["test-images/motherlode-bag-full-box/*.png"],
  },
  "test:screenshot:motherlode-obstacle-red": {
    script: "src/main/automate-bots/shared/motherlode-obstacle-red-detector.spec.ts",
    args: ["test-images/motherload-obstacle/*.png"],
  },
  "test:screenshot:motherlode-collision": {
    script: "src/main/automate-bots/shared/player-obstacle-collision.spec.ts",
    args: ["test-images/colide/*.png"],
  },
  "test:screenshot:motherlode-near-deposit": {
    script: "src/main/automate-bots/shared/motherlode-near-deposit-transition.spec.ts",
    args: ["test-images/motherlode-near-deposit-transition/*.png"],
  },
  "test:screenshot:motherlode-targeting": {
    script: "src/main/automate-bots/shared/motherlode-target-selection.spec.ts",
    args: ["image-test/motherlode-nearest-anchor.png"],
  },
  "test:screenshot:motherlode-active-node": {
    script: "src/main/automate-bots/shared/motherlode-active-node.spec.ts",
    args: ["test-images/motherlode-active-node/*.png"],
    timeoutMs: 180_000,
  },
  "test:screenshot:player": {
    script: "src/main/automate-bots/shared/player-box-detector.spec.ts",
    args: ["test-images/player/*.png"],
  },
  "test:screenshot:bank-deposit-orb": {
    script: "src/main/automate-bots/shared/bank-deposit-orb-detector.spec.ts",
    args: [],
  },
};

function quoteArgIfNeeded(value: string): string {
  return value.includes(" ") ? `\"${value}\"` : value;
}

function buildOutputSnippet(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }

  return output.slice(-MAX_OUTPUT_CHARS);
}

function runSuite(suite: ScreenshotSuite): Promise<SuiteResult> {
  const scriptPath = path.resolve(WORKSPACE_ROOT, suite.script);
  const commandArgs = [TS_NODE_BIN, scriptPath, ...suite.args];
  const command = [process.execPath, ...commandArgs].map(quoteArgIfNeeded).join(" ");

  return new Promise((resolve, reject) => {
    const outputChunks: string[] = [];
    const child = spawn(process.execPath, commandArgs, {
      cwd: WORKSPACE_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      outputChunks.push(chunk.toString());
    });

    child.stderr.on("data", (chunk) => {
      outputChunks.push(chunk.toString());
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
        output: outputChunks.join(""),
        command,
      });
    });
  });
}

describe.sequential("Screenshot Suites", () => {
  for (const [suiteName, suite] of Object.entries(SCREENSHOT_SUITES)) {
    test(
      suiteName,
      async () => {
        const result = await runSuite(suite);

        if (result.exitCode !== 0) {
          const outputSnippet = buildOutputSnippet(result.output);
          const signalText = result.signal ? `, signal=${result.signal}` : "";
          throw new Error(
            `Suite failed with exitCode=${result.exitCode}${signalText}\nCommand: ${result.command}\n\n${outputSnippet}`,
          );
        }

        expect(result.exitCode).toBe(0);
      },
      suite.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  }
});
