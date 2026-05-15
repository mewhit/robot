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

function parseItem(value: unknown, fallbackSlot?: number): RuneLiteLocalApiItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = Number(value.id);
  const quantity = Number(value.quantity);
  if (!Number.isInteger(id) || !Number.isFinite(quantity)) {
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

export async function fetchRuneLiteLocalApiSnapshot(timeoutMs = 350): Promise<RuneLiteLocalApiSnapshot> {
  const probe = await probeRuneLiteLocalApis(timeoutMs);
  return {
    baseUrl: probe.baseUrl,
    skills: parseArray(getJsonByPath(probe, "/stats"), parseSkill),
    inventory: parseItemArray(getJsonByPath(probe, "/inv") ?? getJsonByPath(probe, "/inventory") ?? getJsonByPath(probe, "/api/inventory")),
    equipment: parseItemArray(getJsonByPath(probe, "/equip") ?? getJsonByPath(probe, "/equipment") ?? getJsonByPath(probe, "/api/equipment")),
    probe,
  };
}

export function formatRuneLiteLocalApiSnapshot(snapshot: RuneLiteLocalApiSnapshot): string {
  const wanted = ["Attack", "Strength", "Defence", "Hitpoints", "Magic", "Ranged", "Prayer", "Mining", "Runecraft"];
  const skillsByName = new Map(snapshot.skills.map((skill) => [skill.stat, skill]));
  const skillSummary = wanted
    .map((name) => {
      const skill = skillsByName.get(name);
      return skill ? `${name}=${skill.level}` : null;
    })
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return `base=${snapshot.baseUrl} skills=${snapshot.skills.length}${skillSummary ? ` ${skillSummary}` : ""} inventory=${
    snapshot.inventory.length
  } equipment=${snapshot.equipment.length}`;
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
