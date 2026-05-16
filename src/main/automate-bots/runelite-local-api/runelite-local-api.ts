import { deriveWorldTile, type WorldTile } from "../mapping/world-coordinate";

export type RuneLiteLocalApiResponse = {
  url: string;
  status: number;
  contentType: string;
  json?: unknown;
  textPreview?: string;
};

export type RuneLiteLocalApiProbe = {
  baseUrl: string;
  responses: RuneLiteLocalApiResponse[];
};

export type RuneLiteLocalApiSkill = {
  stat: string;
  level: number;
  boostedLevel: number;
  xp: number;
};

export type RuneLiteLocalApiItem = {
  id: number;
  quantity: number;
  slot?: number;
};

export type RuneLiteLocalApiSnapshot = {
  baseUrl: string;
  skills: RuneLiteLocalApiSkill[];
  inventory: RuneLiteLocalApiItem[];
  equipment: RuneLiteLocalApiItem[];
  playerTile: WorldTile | null;
  probe: RuneLiteLocalApiProbe;
};

const DEFAULT_BASE_URLS = ["http://127.0.0.1:8080", "http://localhost:8080"];
const PROBE_PATHS = [
  "/",
  "/stats",
  "/inv",
  "/equip",
  "/player",
  "/status",
  "/state",
  "/location",
  "/position",
  "/inventory",
  "/equipment",
  "/events",
  "/api/stats",
  "/api/player",
  "/api/status",
  "/api/location",
  "/api/inventory",
  "/api/equipment",
  "/api/events",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "robot-end-to-end-bot",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeUrl(url: string, timeoutMs: number): Promise<RuneLiteLocalApiResponse | null> {
  try {
    const response = await fetchWithTimeout(url, timeoutMs);
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (contentType.toLowerCase().includes("application/json") || /^[\[{]/.test(text.trim())) {
      try {
        return {
          url,
          status: response.status,
          contentType,
          json: JSON.parse(text) as unknown,
        };
      } catch {
        return {
          url,
          status: response.status,
          contentType,
          textPreview: previewText(text),
        };
      }
    }

    return {
      url,
      status: response.status,
      contentType,
      textPreview: previewText(text),
    };
  } catch {
    return null;
  }
}

export async function probeRuneLiteLocalApis(timeoutMs = 350): Promise<RuneLiteLocalApiProbe> {
  for (const baseUrl of DEFAULT_BASE_URLS) {
    const responses: RuneLiteLocalApiResponse[] = [];
    for (const path of PROBE_PATHS) {
      const result = await probeUrl(`${baseUrl}${path}`, timeoutMs);
      if (result) {
        responses.push(result);
      }
    }

    if (responses.length > 0) {
      return { baseUrl, responses };
    }
  }

  throw new Error("No RuneLite local HTTP API responded on localhost:8080.");
}

function summarizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (!isRecord(value)) {
    return typeof value;
  }

  const keys = Object.keys(value).slice(0, 10);
  const details = keys
    .map((key) => {
      const child = value[key];
      if (Array.isArray(child)) {
        return `${key}=array(${child.length})`;
      }
      if (isRecord(child)) {
        return `${key}=object(${Object.keys(child).length})`;
      }
      return `${key}=${String(child).slice(0, 32)}`;
    })
    .join(" ");

  return `object(${Object.keys(value).length}) ${details}`.trim();
}

function parseSkill(value: unknown): RuneLiteLocalApiSkill | null {
  if (!isRecord(value)) {
    return null;
  }

  const stat = typeof value.stat === "string" ? value.stat : undefined;
  const level = Number(value.level);
  const boostedLevel = Number(value.boostedLevel);
  const xp = Number(value.xp);
  if (!stat || ![level, boostedLevel, xp].every(Number.isFinite)) {
    return null;
  }

  return {
    stat,
    level,
    boostedLevel,
    xp,
  };
}

function parseItemSlot(value: Record<string, unknown>, fallbackSlot?: number): number | undefined {
  const slotCandidates = [value.slot, value.index, value.idx, value.inventorySlot];
  for (const candidate of slotCandidates) {
    const slot = Number(candidate);
    if (Number.isInteger(slot) && slot >= 0) {
      return slot;
    }
  }

  return fallbackSlot;
}

function readInventoryPayloadId(value: Record<string, unknown>): number | null {
  return readFiniteNumber(value, ["id", "itemId", "itemID"]);
}

function readInventoryPayloadQuantity(value: Record<string, unknown>): number | null {
  return readFiniteNumber(value, ["quantity", "qty", "amount", "count", "stackSize"]);
}

export function hasRuneLiteLocalApiItemPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const id = readInventoryPayloadId(value);
  if (id === null || !Number.isInteger(id) || id <= 0) {
    return false;
  }

  const quantity = readInventoryPayloadQuantity(value);
  return quantity !== null && Number.isFinite(quantity) && quantity > 0;
}

function parseItem(value: unknown, fallbackSlot?: number): RuneLiteLocalApiItem | null {
  if (!isRecord(value) || !hasRuneLiteLocalApiItemPayload(value)) {
    return null;
  }

  const id = readInventoryPayloadId(value);
  const quantity = readInventoryPayloadQuantity(value);
  if (id === null || quantity === null) {
    return null;
  }

  const slot = parseItemSlot(value, fallbackSlot);
  return {
    id,
    quantity,
    ...(slot !== undefined ? { slot } : {}),
  };
}

function getJsonByPath(probe: RuneLiteLocalApiProbe, path: string): unknown | undefined {
  return probe.responses.find((response) => new URL(response.url).pathname === path)?.json;
}

function parseArray<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parse).filter((entry): entry is T => entry !== null);
}

function parseItemArray(value: unknown): RuneLiteLocalApiItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, slot) => parseItem(entry, slot))
    .filter((entry): entry is RuneLiteLocalApiItem => entry !== null);
}

function readFiniteNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function parseWorldTileLike(value: unknown, depth = 0): WorldTile | null {
  if (!isRecord(value) || depth > 3) {
    return null;
  }

  const x = readFiniteNumber(value, ["worldX", "x"]);
  const y = readFiniteNumber(value, ["worldY", "y"]);
  const z = readFiniteNumber(value, ["plane", "z", "level"]);
  if (
    x !== null &&
    y !== null &&
    z !== null &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(z) &&
    x >= 1_000 &&
    y >= 1_000 &&
    z >= 0 &&
    z <= 3
  ) {
    return deriveWorldTile(x, y, z);
  }

  const nestedKeys = [
    "location",
    "position",
    "worldPoint",
    "worldLocation",
    "tile",
    "player",
    "localPlayer",
  ];
  for (const key of nestedKeys) {
    const nested = parseWorldTileLike(value[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function parsePlayerTile(probe: RuneLiteLocalApiProbe): WorldTile | null {
  const locationPaths = [
    "/location",
    "/position",
    "/player",
    "/status",
    "/state",
    "/api/location",
    "/api/player",
    "/api/status",
  ];

  for (const path of locationPaths) {
    const tile = parseWorldTileLike(getJsonByPath(probe, path));
    if (tile) {
      return tile;
    }
  }

  return null;
}

export async function fetchRuneLiteLocalApiSnapshot(timeoutMs = 350): Promise<RuneLiteLocalApiSnapshot> {
  const probe = await probeRuneLiteLocalApis(timeoutMs);
  return {
    baseUrl: probe.baseUrl,
    skills: parseArray(getJsonByPath(probe, "/stats"), parseSkill),
    inventory: parseItemArray(getJsonByPath(probe, "/inv") ?? getJsonByPath(probe, "/inventory") ?? getJsonByPath(probe, "/api/inventory")),
    equipment: parseItemArray(getJsonByPath(probe, "/equip") ?? getJsonByPath(probe, "/equipment") ?? getJsonByPath(probe, "/api/equipment")),
    playerTile: parsePlayerTile(probe),
    probe,
  };
}

export function formatRuneLiteLocalApiSnapshot(
  snapshot: RuneLiteLocalApiSnapshot,
  options: { includeSkills?: boolean } = {},
): string {
  const tileSummary = snapshot.playerTile
    ? ` tile=${snapshot.playerTile.x},${snapshot.playerTile.y},${snapshot.playerTile.z}`
    : "";
  const skillSummary = options.includeSkills ? formatRuneLiteLocalApiSkillSummary(snapshot) : "";

  return `base=${snapshot.baseUrl}${tileSummary}${skillSummary ? ` ${skillSummary}` : ""} inventory=${
    snapshot.inventory.length
  } equipment=${snapshot.equipment.length}`;
}

export function getRuneLiteLocalApiSkillLevel(
  snapshot: RuneLiteLocalApiSnapshot,
  skillName: string,
): number | null {
  const normalizedSkillName = skillName.trim().toLowerCase();
  const skill = snapshot.skills.find((entry) => entry.stat.trim().toLowerCase() === normalizedSkillName);
  if (!skill || !Number.isFinite(skill.level)) {
    return null;
  }

  return Math.max(1, Math.min(99, Math.round(skill.level)));
}

export function formatRuneLiteLocalApiSkillSummary(snapshot: RuneLiteLocalApiSnapshot): string {
  const wanted = ["Attack", "Strength", "Defence", "Hitpoints", "Magic", "Ranged", "Prayer", "Mining", "Agility", "Runecraft"];
  const skillsByName = new Map(snapshot.skills.map((skill) => [skill.stat, skill]));
  const skillSummary = wanted
    .map((name) => {
      const skill = skillsByName.get(name);
      return skill ? `${name}=${skill.level}` : null;
    })
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return `skills=${snapshot.skills.length}${skillSummary ? ` ${skillSummary}` : ""}`;
}

export function formatRuneLiteLocalApiProbe(probe: RuneLiteLocalApiProbe): string {
  const endpoints = probe.responses
    .slice(0, 8)
    .map((response) => {
      const path = new URL(response.url).pathname;
      if (response.json !== undefined) {
        return `${path}:${summarizeJson(response.json)}`;
      }
      return `${path}:${response.textPreview || response.contentType || "ok"}`;
    })
    .join("; ");

  return `base=${probe.baseUrl} endpoints=${probe.responses.length}${endpoints ? ` ${endpoints}` : ""}`;
}
