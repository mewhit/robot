import crypto from "crypto";
import net from "net";

export type OsrsWikiSyncQuestStatus = "not-started" | "started" | "completed" | "unknown";

export type OsrsWikiSyncQuest = {
  name: string;
  statusCode: number;
  status: OsrsWikiSyncQuestStatus;
};

export type OsrsWikiSyncSnapshot = {
  playerName: string;
  endpoint: string;
  quests: OsrsWikiSyncQuest[];
  levels: Record<string, number>;
};

export type OsrsWikiSyncLocalEquipmentItem = {
  id: number;
};

export type OsrsWikiSyncLocalLoadout = {
  name?: string;
  equipment: Record<string, OsrsWikiSyncLocalEquipmentItem | null>;
  skills: Record<string, number>;
  buffs: Record<string, boolean>;
};

export type OsrsWikiSyncLocalSnapshot = {
  endpoint: string;
  port: number;
  loadouts: OsrsWikiSyncLocalLoadout[];
};

const WIKISYNC_BASE_URL = "https://sync.runescape.wiki/runelite/player";
const LOCAL_WS_PORT_MIN = 37767;
const LOCAL_WS_PORT_MAX = 37776;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function questStatusFromCode(statusCode: number): OsrsWikiSyncQuestStatus {
  if (statusCode === 2) {
    return "completed";
  }
  if (statusCode === 1) {
    return "started";
  }
  if (statusCode === 0) {
    return "not-started";
  }
  return "unknown";
}

function parseNumericRecord(value: unknown, fieldName: string): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`WikiSync field '${fieldName}' is not an object.`);
  }

  const parsed: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
      continue;
    }
    parsed[key] = numericValue;
  }

  return parsed;
}

export function parseOsrsWikiSyncResponse(
  playerName: string,
  endpoint: string,
  payload: unknown,
): OsrsWikiSyncSnapshot {
  if (!isRecord(payload)) {
    throw new Error("WikiSync response is not an object.");
  }

  if (typeof payload.code === "string" && payload.code === "NO_USER_DATA") {
    throw new Error(`WikiSync has no uploaded data for '${playerName}'. Log in with the WikiSync plugin enabled.`);
  }

  const quests = Object.entries(parseNumericRecord(payload.quests, "quests"))
    .map(([name, statusCode]) => ({
      name,
      statusCode,
      status: questStatusFromCode(statusCode),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    playerName,
    endpoint,
    quests,
    levels: parseNumericRecord(payload.levels, "levels"),
  };
}

function parseLocalEquipmentItem(value: unknown): OsrsWikiSyncLocalEquipmentItem | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }

  const id = Number(value.id);
  return Number.isInteger(id) ? { id } : null;
}

function parseLocalEquipment(value: unknown): Record<string, OsrsWikiSyncLocalEquipmentItem | null> {
  if (!isRecord(value)) {
    return {};
  }

  const parsed: Record<string, OsrsWikiSyncLocalEquipmentItem | null> = {};
  for (const [slot, item] of Object.entries(value)) {
    parsed[slot] = parseLocalEquipmentItem(item);
  }
  return parsed;
}

function parseLocalBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) {
    return {};
  }

  const parsed: Record<string, boolean> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "boolean") {
      parsed[key] = rawValue;
    }
  }
  return parsed;
}

function parseLocalLoadout(value: unknown): OsrsWikiSyncLocalLoadout | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    name: typeof value.name === "string" ? value.name : undefined,
    equipment: parseLocalEquipment(value.equipment),
    skills: parseNumericRecord(value.skills, "skills"),
    buffs: parseLocalBooleanRecord(value.buffs),
  };
}

export function parseOsrsWikiSyncLocalResponse(payload: unknown, endpoint: string, port: number): OsrsWikiSyncLocalSnapshot {
  if (!isRecord(payload)) {
    throw new Error("WikiSync local response is not an object.");
  }

  const rawPayload = payload.payload;
  if (!isRecord(rawPayload) || !Array.isArray(rawPayload.loadouts)) {
    throw new Error("WikiSync local response is missing payload.loadouts.");
  }

  return {
    endpoint,
    port,
    loadouts: rawPayload.loadouts.map(parseLocalLoadout).filter((loadout): loadout is OsrsWikiSyncLocalLoadout =>
      Boolean(loadout),
    ),
  };
}

function buildWebSocketHandshake(port: number, key: string): Buffer {
  return Buffer.from(
    [
      "GET / HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "Origin: http://localhost",
      "",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

function validateWebSocketAccept(key: string, headers: string): void {
  const statusLine = headers.split(/\r?\n/, 1)[0] ?? "";
  if (!statusLine.includes("101")) {
    throw new Error(`WikiSync local WebSocket handshake failed: ${statusLine}.`);
  }

  const expected = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  const acceptHeader = headers
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith("sec-websocket-accept:"));
  const actual = acceptHeader?.slice(acceptHeader.indexOf(":") + 1).trim();
  if (actual !== expected) {
    throw new Error("WikiSync local WebSocket handshake returned an invalid accept key.");
  }
}

function buildClientTextFrame(message: string): Buffer {
  const payload = Buffer.from(message, "utf8");
  const mask = crypto.randomBytes(4);
  const headerLength = payload.length < 126 ? 2 : payload.length <= 0xffff ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + payload.length);
  frame[0] = 0x81;

  if (payload.length < 126) {
    frame[1] = 0x80 | payload.length;
    mask.copy(frame, 2);
    for (let index = 0; index < payload.length; index += 1) {
      frame[6 + index] = payload[index] ^ mask[index % 4];
    }
    return frame;
  }

  if (payload.length <= 0xffff) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payload.length, 2);
    mask.copy(frame, 4);
    for (let index = 0; index < payload.length; index += 1) {
      frame[8 + index] = payload[index] ^ mask[index % 4];
    }
    return frame;
  }

  frame[1] = 0x80 | 127;
  frame.writeBigUInt64BE(BigInt(payload.length), 2);
  mask.copy(frame, 10);
  for (let index = 0; index < payload.length; index += 1) {
    frame[14 + index] = payload[index] ^ mask[index % 4];
  }
  return frame;
}

function tryReadServerTextFrame(
  buffer: Buffer<ArrayBufferLike>,
): { message?: string; remaining: Buffer<ArrayBufferLike> } | null {
  if (buffer.length < 2) {
    return null;
  }

  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLength = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("WikiSync local WebSocket frame is too large.");
    }
    payloadLength = Number(bigLength);
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + payloadLength) {
    return null;
  }

  const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  const remaining = buffer.subarray(offset + payloadLength);
  if (opcode === 0x1) {
    return { message: payload.toString("utf8"), remaining };
  }
  return { remaining };
}

function fetchOsrsWikiSyncLocalPort(port: number, timeoutMs: number): Promise<OsrsWikiSyncLocalSnapshot> {
  const endpoint = `ws://127.0.0.1:${port}/`;
  const sequenceId = 1;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const key = crypto.randomBytes(16).toString("base64");
    let settled = false;
    let handshakeComplete = false;
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    const timeout = setTimeout(() => {
      finish(new Error(`WikiSync local WebSocket timed out at ${endpoint}.`));
    }, timeoutMs);

    function finish(result: Error | OsrsWikiSyncLocalSnapshot): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    }

    socket.on("connect", () => {
      socket.write(buildWebSocketHandshake(port, key));
    });

    socket.on("data", (chunk) => {
      try {
        const data = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        buffer = Buffer.concat([buffer, data]);
        if (!handshakeComplete) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) {
            return;
          }

          const headers = buffer.subarray(0, headerEnd).toString("utf8");
          validateWebSocketAccept(key, headers);
          handshakeComplete = true;
          buffer = buffer.subarray(headerEnd + 4);
          socket.write(buildClientTextFrame(JSON.stringify({ _wsType: "GetPlayer", sequenceId })));
        }

        while (buffer.length > 0) {
          const frame = tryReadServerTextFrame(buffer);
          if (!frame) {
            break;
          }
          buffer = frame.remaining;
          if (!frame.message) {
            continue;
          }

          const parsed = JSON.parse(frame.message) as unknown;
          if (
            isRecord(parsed) &&
            parsed._wsType === "GetPlayer" &&
            Number(parsed.sequenceId) === sequenceId
          ) {
            finish(parseOsrsWikiSyncLocalResponse(parsed, endpoint, port));
            return;
          }
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.on("error", (error) => {
      finish(error);
    });
  });
}

export async function fetchOsrsWikiSyncLocalSnapshot(timeoutMs = 750): Promise<OsrsWikiSyncLocalSnapshot> {
  let lastError: Error | undefined;

  for (let port = LOCAL_WS_PORT_MIN; port <= LOCAL_WS_PORT_MAX; port += 1) {
    try {
      return await fetchOsrsWikiSyncLocalPort(port, timeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`WikiSync local WebSocket is unavailable. Last error: ${lastError?.message ?? "unknown"}`);
}

export async function fetchOsrsWikiSyncSnapshot(
  playerName: string,
  gameMode = "STANDARD",
): Promise<OsrsWikiSyncSnapshot> {
  const normalized = playerName.trim();
  if (!normalized) {
    throw new Error("OSRS WikiSync player name is empty.");
  }

  const endpoint = `${WIKISYNC_BASE_URL}/${encodeURIComponent(normalized)}/${encodeURIComponent(gameMode)}`;
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "robot-end-to-end-bot",
    },
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`WikiSync request returned non-JSON data: ${response.status} ${response.statusText}.`);
  }

  if (!response.ok) {
    if (isRecord(payload) && typeof payload.code === "string") {
      if (payload.code === "NO_USER_DATA") {
        throw new Error(`WikiSync has no uploaded data for '${normalized}'. Log in with the WikiSync plugin enabled.`);
      }
      throw new Error(`WikiSync request failed: ${payload.code}.`);
    }
    throw new Error(`WikiSync request failed: ${response.status} ${response.statusText}.`);
  }

  return parseOsrsWikiSyncResponse(normalized, endpoint, payload);
}

export function formatOsrsWikiSyncLocalSummary(snapshot: OsrsWikiSyncLocalSnapshot): string {
  const loadout = snapshot.loadouts[0];
  if (!loadout) {
    return `endpoint=${snapshot.endpoint} loadouts=0`;
  }

  const skills = loadout.skills;
  const equipmentCount = Object.values(loadout.equipment).filter(Boolean).length;
  return `endpoint=${snapshot.endpoint} player=${loadout.name ?? "unknown"} skills atk=${skills.atk ?? "?"} str=${
    skills.str ?? "?"
  } def=${skills.def ?? "?"} hp=${skills.hp ?? "?"} magic=${skills.magic ?? "?"} ranged=${
    skills.ranged ?? "?"
  } prayer=${skills.prayer ?? "?"} mining=${skills.mining ?? "?"} equipment=${equipmentCount}`;
}

export function formatOsrsWikiSyncSummary(snapshot: OsrsWikiSyncSnapshot): string {
  const completed = snapshot.quests.filter((quest) => quest.status === "completed").length;
  const started = snapshot.quests.filter((quest) => quest.status === "started").length;
  const notStarted = snapshot.quests.filter((quest) => quest.status === "not-started").length;
  const runecraft = snapshot.levels.Runecraft ?? snapshot.levels.runecraft;
  const combat = snapshot.levels.Combat ?? snapshot.levels.combat;

  const levelSummary = [
    runecraft !== undefined ? `Runecraft=${runecraft}` : null,
    combat !== undefined ? `Combat=${combat}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return `quests completed=${completed} started=${started} notStarted=${notStarted}${
    levelSummary ? ` ${levelSummary}` : ""
  }`;
}
