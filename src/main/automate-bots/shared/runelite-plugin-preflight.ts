import fs from "fs";
import path from "path";
import { Window } from "node-window-manager";
import { getRuneLite } from "../../runeLiteWindow";
import { type ScreenCaptureBounds } from "../../windowsScreenCapture";
import {
  fetchRuneLiteLocalApiSnapshot,
  formatRuneLiteLocalApiSnapshot,
} from "../runelite-local-api/runelite-local-api";

export type RuneLiteRequiredPluginId = "mining" | "world-location" | "http-api" | "agility" | "minimap-disabled";

export type RuneLiteRequiredPluginCheck = {
  id: RuneLiteRequiredPluginId;
  name: string;
  available: boolean;
  enabled: boolean;
  evidence: string[];
  fix: string;
};

export type RuneLitePluginPreflightResult = {
  ok: boolean;
  window?: Window;
  captureBounds?: ScreenCaptureBounds;
  profilePath: string | null;
  checks: RuneLiteRequiredPluginCheck[];
  error?: string;
};

type RuneLiteProfileConfig = {
  path: string;
  values: Map<string, string>;
};

const REQUIRED_PLUGIN_NAMES: Record<RuneLiteRequiredPluginId, string> = {
  mining: "Mining",
  "world-location": "World Location",
  "http-api": "Http Api",
  agility: "Agility",
  "minimap-disabled": "Minimap Disabled",
};

const REQUIRED_PLUGIN_FIXES: Record<RuneLiteRequiredPluginId, string> = {
  mining: "Enable the RuneLite Mining plugin and keep its mining status overlay visible.",
  "world-location": "Enable the World Location plugin and turn on Grid Info.",
  "http-api": "Install/enable the Http Server/Http Api plugin and make sure localhost:8080 responds.",
  agility: "Enable the RuneLite Agility plugin, including shortcut/object highlights.",
  "minimap-disabled": "Disable the RuneLite Minimap plugin so the native minimap scale remains unchanged.",
};

const PREFLIGHT_HTTP_API_TIMEOUT_MS = 180;

function getPlayableBounds(window: Window): { x: number; y: number; width: number; height: number } | null {
  const bounds = window.getBounds();
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height) - 50;

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function getRuneLiteHomeDirectory(): string | null {
  const home = process.env.USERPROFILE || process.env.HOME;
  return home ? path.join(home, ".runelite") : null;
}

function parsePropertiesFile(filePath: string): Map<string, string> {
  const values = new Map<string, string>();
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    values.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  return values;
}

function readLatestRuneLiteProfileConfig(): RuneLiteProfileConfig | null {
  const runeLiteHome = getRuneLiteHomeDirectory();
  if (!runeLiteHome) {
    return null;
  }

  const profilesDirectory = path.join(runeLiteHome, "profiles2");
  if (!fs.existsSync(profilesDirectory)) {
    return null;
  }

  const profileFiles = fs
    .readdirSync(profilesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".properties") && !entry.name.startsWith("$rsprofile"))
    .map((entry) => {
      const filePath = path.join(profilesDirectory, entry.name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const latestProfile = profileFiles[0];
  if (!latestProfile) {
    return null;
  }

  try {
    return {
      path: latestProfile.filePath,
      values: parsePropertiesFile(latestProfile.filePath),
    };
  } catch {
    return null;
  }
}

function readBooleanConfig(config: RuneLiteProfileConfig | null, key: string): boolean | null {
  const value = config?.values.get(key)?.toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function hasConfigPrefix(config: RuneLiteProfileConfig | null, prefix: string): boolean {
  if (!config) {
    return false;
  }

  for (const key of config.values.keys()) {
    if (key.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function readExternalPluginSlugs(config: RuneLiteProfileConfig | null): Set<string> {
  const raw = config?.values.get("runelite.externalPlugins") ?? "";
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function hasInstalledPluginJar(pluginSlug: string): boolean {
  const runeLiteHome = getRuneLiteHomeDirectory();
  if (!runeLiteHome) {
    return false;
  }

  const pluginsDirectory = path.join(runeLiteHome, "plugins");
  if (!fs.existsSync(pluginsDirectory)) {
    return false;
  }

  try {
    return fs
      .readdirSync(pluginsDirectory, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.startsWith(`${pluginSlug}_`) && entry.name.endsWith(".jar"));
  } catch {
    return false;
  }
}

function createCheck(
  id: RuneLiteRequiredPluginId,
  available: boolean,
  enabled: boolean,
  evidence: string[],
): RuneLiteRequiredPluginCheck {
  return {
    id,
    name: REQUIRED_PLUGIN_NAMES[id],
    available,
    enabled,
    evidence,
    fix: REQUIRED_PLUGIN_FIXES[id],
  };
}

function formatOptionalBoolean(value: boolean | null): string {
  return value === null ? "unset" : String(value);
}

function formatProfilePath(config: RuneLiteProfileConfig | null): string {
  return config ? path.basename(config.path) : "unavailable";
}

function buildPreflightError(checks: RuneLiteRequiredPluginCheck[]): string {
  const missing = checks.filter((check) => !check.available || !check.enabled);
  if (missing.length === 0) {
    return "";
  }

  const missingText = missing
    .map((check) => {
      const state = check.id === "minimap-disabled"
        ? "enabled but must be disabled"
        : !check.available
          ? "not available"
          : "disabled or not visible";
      return `${check.name} (${state})`;
    })
    .join(", ");
  const fixes = missing.map((check) => check.fix).join(" ");
  return `Arceuus Blood Rune V2 startup check failed. Required RuneLite plugin issue(s): ${missingText}. ${fixes}`;
}

export function formatRuneLitePluginPreflightChecks(result: RuneLitePluginPreflightResult): string {
  return result.checks
    .map((check) => {
      const evidence = check.evidence.length > 0 ? ` evidence=[${check.evidence.join("; ")}]` : "";
      return `${check.name}:available=${check.available} enabled=${check.enabled}${evidence}`;
    })
    .join(" | ");
}

export async function runArceuusBloodRuneV2PluginPreflight(): Promise<RuneLitePluginPreflightResult> {
  const window = getRuneLite();
  const profileConfig = readLatestRuneLiteProfileConfig();
  const profileEvidence = `profile=${formatProfilePath(profileConfig)}`;
  const minimapPluginEnabled = readBooleanConfig(profileConfig, "runelite.minimapplugin");

  if (!window) {
    const checks: RuneLiteRequiredPluginCheck[] = [
      createCheck("mining", false, false, [profileEvidence, "RuneLite window not found"]),
      createCheck("world-location", false, false, [profileEvidence, "RuneLite window not found"]),
      createCheck("http-api", false, false, [profileEvidence, "RuneLite window not found"]),
      createCheck("agility", false, false, [profileEvidence, "RuneLite window not found"]),
      createCheck("minimap-disabled", true, minimapPluginEnabled !== true, [
        profileEvidence,
        `runelite.minimapplugin=${formatOptionalBoolean(minimapPluginEnabled)}`,
      ]),
    ];
    return {
      ok: false,
      profilePath: profileConfig?.path ?? null,
      checks,
      error: buildPreflightError(checks),
    };
  }

  if (!window.isVisible()) {
    window.show();
  }
  window.bringToTop();

  const bounds = getPlayableBounds(window);
  if (!bounds) {
    const checks: RuneLiteRequiredPluginCheck[] = [
      createCheck("mining", false, false, [profileEvidence, "invalid RuneLite bounds"]),
      createCheck("world-location", false, false, [profileEvidence, "invalid RuneLite bounds"]),
      createCheck("http-api", false, false, [profileEvidence, "invalid RuneLite bounds"]),
      createCheck("agility", false, false, [profileEvidence, "invalid RuneLite bounds"]),
      createCheck("minimap-disabled", true, minimapPluginEnabled !== true, [
        profileEvidence,
        `runelite.minimapplugin=${formatOptionalBoolean(minimapPluginEnabled)}`,
      ]),
    ];
    return {
      ok: false,
      window,
      profilePath: profileConfig?.path ?? null,
      checks,
      error: buildPreflightError(checks),
    };
  }

  const externalPlugins = readExternalPluginSlugs(profileConfig);
  const miningPluginEnabled = readBooleanConfig(profileConfig, "runelite.miningplugin");
  const agilityPluginEnabled = readBooleanConfig(profileConfig, "runelite.agilityplugin");
  const worldLocationPluginEnabled = readBooleanConfig(profileConfig, "runelite.worldlocationplugin");
  const worldLocationGridInfo = readBooleanConfig(profileConfig, "worldlocation.gridInfo");

  const worldLocationJarInstalled = hasInstalledPluginJar("world-location");
  const httpServerJarInstalled = hasInstalledPluginJar("http-server");

  let httpApiProbeEvidence = "snapshot=not-run";
  let httpApiResponded = false;
  try {
    const snapshot = await fetchRuneLiteLocalApiSnapshot(PREFLIGHT_HTTP_API_TIMEOUT_MS);
    httpApiResponded = true;
    httpApiProbeEvidence = `snapshot=${formatRuneLiteLocalApiSnapshot(snapshot, { includeSkills: true })}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    httpApiProbeEvidence = `snapshot=failed ${message}`;
  }

  const worldLocationAvailable =
    worldLocationPluginEnabled !== null ||
    externalPlugins.has("world-location") ||
    worldLocationJarInstalled ||
    hasConfigPrefix(profileConfig, "worldlocation.");
  const httpApiAvailable =
    httpApiResponded || externalPlugins.has("http-server") || httpServerJarInstalled;
  const miningEnabled = miningPluginEnabled !== false;
  const worldLocationEnabled = worldLocationAvailable && worldLocationPluginEnabled !== false && worldLocationGridInfo !== false;
  const agilityEnabled = agilityPluginEnabled !== false;

  const checks = [
    createCheck("mining", true, miningEnabled, [
      profileEvidence,
      `runelite.miningplugin=${formatOptionalBoolean(miningPluginEnabled)}`,
      "screenScan=skipped",
    ]),
    createCheck("world-location", worldLocationAvailable, worldLocationEnabled, [
      profileEvidence,
      `external=${externalPlugins.has("world-location")}`,
      `jar=${worldLocationJarInstalled}`,
      `runelite.worldlocationplugin=${formatOptionalBoolean(worldLocationPluginEnabled)}`,
      `gridInfo=${formatOptionalBoolean(worldLocationGridInfo)}`,
      "screenScan=skipped",
    ]),
    createCheck("http-api", httpApiAvailable, httpApiResponded, [
      profileEvidence,
      `external=${externalPlugins.has("http-server")}`,
      `jar=${httpServerJarInstalled}`,
      httpApiProbeEvidence,
    ]),
    createCheck("agility", true, agilityEnabled, [
      profileEvidence,
      `runelite.agilityplugin=${formatOptionalBoolean(agilityPluginEnabled)}`,
      "screenScan=skipped",
    ]),
    createCheck("minimap-disabled", true, minimapPluginEnabled !== true, [
      profileEvidence,
      `runelite.minimapplugin=${formatOptionalBoolean(minimapPluginEnabled)}`,
    ]),
  ];
  const error = buildPreflightError(checks);

  return {
    ok: error.length === 0,
    window,
    captureBounds: bounds,
    profilePath: profileConfig?.path ?? null,
    checks,
    ...(error ? { error } : {}),
  };
}
