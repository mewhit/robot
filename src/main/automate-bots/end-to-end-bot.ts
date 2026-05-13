import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { pushAutomateBotLog } from "../automateBotLogs";
import { END_TO_END_BOT_ID } from "./definitions";
import { readOsrsCacheMapRegionView } from "./cache/cache-map-view";

const BOT_NAME = "End To End";
const STEP_START_ID = `${END_TO_END_BOT_ID}:start`;
const STEP_CACHE_MAP_ID = `${END_TO_END_BOT_ID}:cache-map`;
const STEP_DONE_ID = `${END_TO_END_BOT_ID}:done`;

let runToken = 0;

function log(message: string): void {
  pushAutomateBotLog("info", `Automate Bot (${BOT_NAME}): ${message}`);
}

function warn(message: string): void {
  pushAutomateBotLog("warn", `Automate Bot (${BOT_NAME}): ${message}`);
}

export function onEndToEndBotStart(): void {
  const token = ++runToken;

  void (async () => {
    try {
      setAutomateBotCurrentStep(STEP_START_ID);
      log("Started.");

      setAutomateBotCurrentStep(STEP_CACHE_MAP_ID);
      const region = readOsrsCacheMapRegionView({ regionX: 50, regionY: 50 });
      const blockedTiles = region.tiles.filter((tile) => tile.z === 0 && tile.blocked).length;
      log(
        `Cache map loaded: cache=${region.cacheDirectoryPath} region=${region.regionX},${region.regionY} icons=${region.icons.length} objects=${region.objects.length} locations=${region.locationCount} blockedPlane0=${blockedTiles}.`,
      );

      const labeledIcons = region.icons
        .filter((icon) => icon.label)
        .slice(0, 8)
        .map((icon) => `${icon.label}@${icon.worldX},${icon.worldY},${icon.z}`)
        .join("; ");
      log(`Map icon labels: ${labeledIcons || "none"}.`);

      setAutomateBotCurrentStep(STEP_DONE_ID);
      log("Finished end-to-end smoke flow.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`Failed: ${message}`);
    } finally {
      if (token === runToken) {
        setAutomateBotCurrentStep(null);
        stopAutomateBot("bot");
      }
    }
  })();
}
