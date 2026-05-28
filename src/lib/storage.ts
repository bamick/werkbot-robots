import type {
  AppExportPayload,
  GamePlayerStatus,
  GameSettings,
  Player,
  SavedLineup,
} from "./types";
import { createInitialGameStatus, defaultGameSettings, normalizeGameSettings } from "./defaults";

const ROSTER_KEY = "werkbot-roster";
const ROSTER_VERSION_KEY = "werkbot-roster-version";
const CURRENT_ROSTER_VERSION = 1;
const GAME_STATUS_KEY = "werkbot-game-status";
const SETTINGS_KEY = "werkbot-game-settings";
const SAVED_LINEUPS_KEY = "werkbot-saved-lineups";

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, value);
}

function removeStorage(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(key);
}

const legacySampleRosterNames = [
  "Ava",
  "Noah",
  "Mia",
  "Ethan",
  "Isabella",
  "Liam",
  "Emma",
  "Oliver",
  "Sophia",
  "Lucas",
];

function isLegacySampleRoster(roster: Player[]): boolean {
  if (roster.length !== legacySampleRosterNames.length) {
    return false;
  }

  return roster.every((player, index) => player.name === legacySampleRosterNames[index]);
}

export function loadRoster(): Player[] {
  const storedVersion = safeParse<number | null>(readStorage(ROSTER_VERSION_KEY), null);
  const storedRoster = safeParse<Player[]>(readStorage(ROSTER_KEY), []);

  if (storedVersion === null && isLegacySampleRoster(storedRoster)) {
    removeStorage(ROSTER_KEY);
    removeStorage(ROSTER_VERSION_KEY);
    return [];
  }

  return storedRoster;
}

export function saveRoster(roster: Player[]): void {
  writeStorage(ROSTER_KEY, JSON.stringify(roster));
  writeStorage(ROSTER_VERSION_KEY, JSON.stringify(CURRENT_ROSTER_VERSION));
}

export function loadGameStatus(roster: Player[]): GamePlayerStatus[] {
  const saved = safeParse<GamePlayerStatus[]>(readStorage(GAME_STATUS_KEY), []);
  if (saved.length === 0) {
    return createInitialGameStatus(roster);
  }
  const rosterIds = new Set(roster.map((player) => player.id));
  return saved.filter((status) => rosterIds.has(status.playerId));
}

export function saveGameStatus(gameStatus: GamePlayerStatus[]): void {
  writeStorage(GAME_STATUS_KEY, JSON.stringify(gameStatus));
}

export function loadSettings(): GameSettings {
  return normalizeGameSettings(
    safeParse<Partial<GameSettings>>(readStorage(SETTINGS_KEY), defaultGameSettings),
  );
}

export function saveSettings(settings: GameSettings): void {
  writeStorage(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSavedLineups(): SavedLineup[] {
  return safeParse<SavedLineup[]>(readStorage(SAVED_LINEUPS_KEY), []);
}

export function saveSavedLineups(lineups: SavedLineup[]): void {
  writeStorage(SAVED_LINEUPS_KEY, JSON.stringify(lineups));
}

export function createExportPayload(
  roster: Player[],
  gameStatus: GamePlayerStatus[],
  settings: GameSettings,
  savedLineups: SavedLineup[],
): AppExportPayload {
  return {
    roster,
    gameStatus,
    settings,
    savedLineups,
  };
}

export function parseImportPayload(value: string): AppExportPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as any).roster) &&
      Array.isArray((parsed as any).gameStatus) &&
      typeof (parsed as any).settings === "object" &&
      (parsed as any).settings !== null
    ) {
      return parsed as AppExportPayload;
    }
  } catch {
    return null;
  }
  return null;
}
