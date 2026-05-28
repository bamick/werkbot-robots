"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import ShiftLineupCard from "@/components/ShiftLineupCard";
import type {
  GamePlayerStatus,
  GameSettings,
  Player,
  Position,
  SavedLineup,
  ShiftLineup,
} from "@/lib/types";
import {
  createInitialGameStatus,
  defaultGameSettings,
  defaultRoster,
  normalizeGameSettings,
  syncGameStatus,
} from "@/lib/defaults";
import {
  createExportPayload,
  loadGameStatus,
  loadRoster,
  loadSavedLineups,
  loadSettings,
  parseImportPayload,
  saveGameStatus,
  saveRoster,
  saveSavedLineups,
  saveSettings,
} from "@/lib/storage";
import { generateLineups } from "@/lib/lineup";

const POSITION_OPTIONS = ["LD", "CD", "RD", "LM", "RM", "LF", "CF", "RF", "goalie"] as const;

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type QuarterAssignment = Record<string, string>;

const POSITION_GROUPS: Record<"defense" | "midfield" | "offense", readonly Position[]> = {
  defense: ["LD", "CD", "RD"],
  midfield: ["LM", "RM"],
  offense: ["LF", "CF", "RF"],
};

function getShiftLabels(settings: GameSettings): string[] {
  const labels: string[] = [];
  for (let quarter = 1; quarter <= settings.quarters; quarter += 1) {
    for (let shift = 1; shift <= settings.shiftsPerQuarter; shift += 1) {
      labels.push(`Q${quarter}-${shift}`);
    }
  }
  return labels;
}

function normalizeImportPayload(payload: unknown): payload is {
  roster: Player[];
  gameStatus: GamePlayerStatus[];
  settings: GameSettings;
  savedLineups: SavedLineup[];
} {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "roster" in payload &&
    "gameStatus" in payload &&
    "settings" in payload
  );
}

function getPreferredQuarterLabel(player: Player, group: keyof typeof POSITION_GROUPS): string {
  const preferred = player.preferredPositions.find((position) =>
    POSITION_GROUPS[group].includes(position as any),
  );
  if (preferred) {
    return preferred;
  }

  if (group === "defense") return "D";
  if (group === "midfield") return "M";
  if (group === "offense") return "O";
  return "";
}

function getShiftAssignmentLabel(
  player: Player,
  shift: ShiftLineup,
): string {
  if (shift.goalie === player.id) {
    return "G";
  }
  if (shift.defense.includes(player.id)) {
    return getPreferredQuarterLabel(player, "defense");
  }
  if (shift.midfield.includes(player.id)) {
    return getPreferredQuarterLabel(player, "midfield");
  }
  if (shift.offense.includes(player.id)) {
    return getPreferredQuarterLabel(player, "offense");
  }
  if (shift.bench.includes(player.id)) {
    return "B";
  }
  return "";
}

type AssignmentGroup = "goalie" | "defense" | "midfield" | "offense" | "bench";

function getAssignmentGroup(value: string): AssignmentGroup | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "B") {
    return "bench";
  }
  if (normalized === "G") {
    return "goalie";
  }
  if (["D", "LD", "CD", "RD"].includes(normalized)) {
    return "defense";
  }
  if (["M", "LM", "RM"].includes(normalized)) {
    return "midfield";
  }
  if (["O", "LF", "CF", "RF"].includes(normalized)) {
    return "offense";
  }
  return null;
}

type PlayerAssignmentHistory = {
  positionCounts: Record<AssignmentGroup, number>;
  lastPosition: AssignmentGroup | null;
  consecutiveSamePositionCount: number;
};

function initializeAssignmentHistory(roster: Player[]) {
  return new Map<string, PlayerAssignmentHistory>(
    roster.map((player) => [
      player.id,
      {
        positionCounts: {
          goalie: 0,
          defense: 0,
          midfield: 0,
          offense: 0,
          bench: 0,
        },
        lastPosition: null,
        consecutiveSamePositionCount: 0,
      },
    ]),
  );
}

function buildAssignmentHistoryFromQuarterAssignments(
  roster: Player[],
  quarterAssignments: Record<string, QuarterAssignment>,
  shiftLabels: string[],
  endShiftIndex: number,
) {
  const history = initializeAssignmentHistory(roster);

  roster.forEach((player) => {
    const assignments = quarterAssignments[player.id] || {};
    for (let index = 0; index <= endShiftIndex; index += 1) {
      const label = shiftLabels[index];
      const group = getAssignmentGroup(assignments[label] ?? "");
      if (!group) {
        continue;
      }
      const playerHistory = history.get(player.id);
      if (!playerHistory) {
        continue;
      }
      if (group === "bench") {
        playerHistory.positionCounts.bench += 1;
        playerHistory.lastPosition = "bench";
        playerHistory.consecutiveSamePositionCount = 0;
        continue;
      }
      const samePosition = playerHistory.lastPosition === group;
      playerHistory.consecutiveSamePositionCount = samePosition
        ? playerHistory.consecutiveSamePositionCount + 1
        : 1;
      playerHistory.lastPosition = group;
      playerHistory.positionCounts[group] += 1;
    }
  });

  return history;
}

function buildLineupsFromQuarterAssignments(
  roster: Player[],
  quarterAssignments: Record<string, QuarterAssignment>,
  settings: GameSettings,
): ShiftLineup[] {
  const labels = getShiftLabels(settings);

  return labels.map((label, index) => {
    const shift = {
      id: `shift-${label}`,
      quarter: Math.floor(index / settings.shiftsPerQuarter) + 1,
      shiftInQuarter: (index % settings.shiftsPerQuarter) + 1,
      shiftIndex: index,
      offense: [] as string[],
      midfield: [] as string[],
      defense: [] as string[],
      goalie: null as string | null,
      bench: [] as string[],
      locked: false,
      warnings: [],
    };

    roster.forEach((player) => {
      const assignment = quarterAssignments[player.id]?.[label] ?? "";
      const group = getAssignmentGroup(assignment);
      if (group === "goalie") {
        shift.goalie = player.id;
      } else if (group === "defense") {
        shift.defense.push(player.id);
      } else if (group === "midfield") {
        shift.midfield.push(player.id);
      } else if (group === "offense") {
        shift.offense.push(player.id);
      } else if (group === "bench") {
        shift.bench.push(player.id);
      }
    });

    return shift;
  });
}

function regenerateLaterQuarterAssignments(
  roster: Player[],
  gameStatus: GamePlayerStatus[],
  settings: GameSettings,
  quarterAssignments: Record<string, QuarterAssignment>,
  startShiftIndex: number,
) {
  const shiftLabels = getShiftLabels(settings);
  if (startShiftIndex + 1 >= shiftLabels.length) {
    return quarterAssignments;
  }

  const history = buildAssignmentHistoryFromQuarterAssignments(
    roster,
    quarterAssignments,
    shiftLabels,
    startShiftIndex,
  );

  const generated = generateLineups(
    roster,
    gameStatus,
    settings,
    history,
    startShiftIndex + 1,
  );

  const nextAssignments = { ...quarterAssignments };
  roster.forEach((player) => {
    generated.forEach((shift) => {
      const shiftLabel = shiftLabels[shift.shiftIndex];
      nextAssignments[player.id] = {
        ...nextAssignments[player.id],
        [shiftLabel]: getShiftAssignmentLabel(player, shift),
      };
    });
  });

  return nextAssignments;
}

function createEmptyQuarterAssignments(
  roster: Player[],
  settings: GameSettings,
): Record<string, QuarterAssignment> {
  const labels = getShiftLabels(settings);
  return roster.reduce<Record<string, QuarterAssignment>>((acc, player) => {
    acc[player.id] = labels.reduce<Record<string, string>>((row, label) => {
      row[label] = "";
      return row;
    }, {});
    return acc;
  }, {});
}

function ensureQuarterAssignments(
  current: Record<string, QuarterAssignment>,
  roster: Player[],
  settings: GameSettings,
): Record<string, QuarterAssignment> {
  const labels = getShiftLabels(settings);
  const next = { ...current };

  roster.forEach((player) => {
    const row = next[player.id] ?? {};
    next[player.id] = labels.reduce<Record<string, string>>((newRow, label) => {
      newRow[label] = label in row ? row[label] : "";
      return newRow;
    }, {});
  });

  Object.keys(next).forEach((playerId) => {
    if (!roster.some((player) => player.id === playerId)) {
      delete next[playerId];
    }
  });

  return next;
}

function assignPositionLabels(
  playerIds: string[],
  rosterMap: Map<string, Player>,
  labels: string[],
  randomizePlayerIds: Set<string> = new Set<string>(),
): Record<string, string> {
  const assignments: Record<string, string> = {};
  const usedLabels = new Set<string>();

  const players = playerIds
    .map((playerId) => rosterMap.get(playerId))
    .filter((player): player is Player => Boolean(player));

  const preferredPlayers = players.filter((player) => !randomizePlayerIds.has(player.id));
  const randomizedPlayers = players.filter((player) => randomizePlayerIds.has(player.id));

  for (const player of preferredPlayers) {
    const preferred = player.preferredPositions.find(
      (position) => labels.includes(position) && !usedLabels.has(position),
    );
    if (preferred) {
      assignments[player.id] = preferred;
      usedLabels.add(preferred);
    }
  }

  for (const player of randomizedPlayers) {
    const availableLabels = labels.filter((label) => !usedLabels.has(label));
    const fallback = availableLabels.length > 0
      ? availableLabels[Math.floor(Math.random() * availableLabels.length)]
      : labels[Math.floor(Math.random() * labels.length)];
    assignments[player.id] = fallback;
    usedLabels.add(fallback);
  }

  for (const player of players) {
    if (assignments[player.id]) {
      continue;
    }
    const preferred = player.preferredPositions.find(
      (position) => labels.includes(position) && !usedLabels.has(position),
    );
    if (preferred) {
      assignments[player.id] = preferred;
      usedLabels.add(preferred);
      continue;
    }
    const fallback = labels.find((label) => !usedLabels.has(label)) ?? labels[0];
    assignments[player.id] = fallback;
    usedLabels.add(fallback);
  }

  return assignments;
}

function getPlayerMap(roster: Player[]) {
  return new Map(roster.map((player) => [player.id, player]));
}

function buildQuarterAssignmentsFromLineups(
  roster: Player[],
  lineups: ShiftLineup[],
  settings: GameSettings,
): Record<string, QuarterAssignment> {
  const assignments = createEmptyQuarterAssignments(roster, settings);
  const rosterMap = getPlayerMap(roster);

  lineups.forEach((shift) => {
    const shiftLabel = `Q${shift.quarter}-${shift.shiftInQuarter}`;
    const previousShift = lineups.find((item) => item.shiftIndex === shift.shiftIndex - 1);
    const goalieReturners = new Set<string>();
    if (previousShift?.goalie) {
      goalieReturners.add(previousShift.goalie);
    }
    const defenseLabels = assignPositionLabels(shift.defense, rosterMap, ["LD", "CD", "RD"]);
    const midfieldLabels = assignPositionLabels(shift.midfield, rosterMap, ["LM", "RM"]);
    const offenseLabels = assignPositionLabels(
      shift.offense,
      rosterMap,
      ["LF", "CF", "RF"],
      goalieReturners,
    );

    roster.forEach((player) => {
      if (shift.goalie === player.id) {
        assignments[player.id][shiftLabel] = "G";
      } else if (shift.defense.includes(player.id)) {
        assignments[player.id][shiftLabel] = defenseLabels[player.id] ?? getPreferredQuarterLabel(player, "defense");
      } else if (shift.midfield.includes(player.id)) {
        assignments[player.id][shiftLabel] = midfieldLabels[player.id] ?? getPreferredQuarterLabel(player, "midfield");
      } else if (shift.offense.includes(player.id)) {
        assignments[player.id][shiftLabel] = offenseLabels[player.id] ?? getPreferredQuarterLabel(player, "offense");
      } else if (shift.bench.includes(player.id)) {
        assignments[player.id][shiftLabel] = "B";
      } else {
        assignments[player.id][shiftLabel] = "";
      }
    });
  });

  return assignments;
}

export default function Home() {
  const [roster, setRoster] = useState<Player[]>([]);

  const [gameStatus, setGameStatus] = useState<GamePlayerStatus[]>([]);
  const [settings, setSettings] = useState<GameSettings>(defaultGameSettings);
  const [savedLineups, setSavedLineups] = useState<SavedLineup[]>([]);
  const [lineups, setLineups] = useState<ShiftLineup[]>([]);
  const [quarterAssignments, setQuarterAssignments] = useState<Record<string, QuarterAssignment>>({});
  const [loaded, setLoaded] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const storedRoster = loadRoster();
    const baseRoster = storedRoster.length > 0 ? storedRoster : defaultRoster;
    const storedSettings = loadSettings();
    const storedSavedLineups = loadSavedLineups();
    const storedGameStatus = loadGameStatus(baseRoster);

    setRoster(baseRoster);
    setSettings(storedSettings);
    setSavedLineups(storedSavedLineups);
    setGameStatus(syncGameStatus(storedGameStatus, baseRoster));
    setLoaded(true);
  }, []);

  useEffect(() => {
    setQuarterAssignments((current) => ensureQuarterAssignments(current, roster, settings));
  }, [roster, settings]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    saveRoster(roster);
    setGameStatus((current) => syncGameStatus(current, roster));
  }, [roster, loaded]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    saveGameStatus(gameStatus);
  }, [gameStatus, loaded]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    saveSettings(settings);
  }, [settings, loaded]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    saveSavedLineups(savedLineups);
  }, [savedLineups, loaded]);

  const playerNameById = useMemo(
    () => new Map(roster.map((player) => [player.id, player.name])),
    [roster],
  );

  const shiftLabels = getShiftLabels(settings);

  const goalScorers = useMemo(
    () =>
      gameStatus
        .filter((status) => status.goals > 0)
        .map((status) => ({
          playerId: status.playerId,
          goals: status.goals,
          name: playerNameById.get(status.playerId) ?? "Unknown",
        })),
    [gameStatus, playerNameById],
  );

  const handleAddPlayer = () => {
    setRoster((current) => [
      ...current,
      {
        id: `player-${randomId()}`,
        name: "",
        gender: "boy",
        skillRating: 5,
        willingGoalie: false,
        preferredPositions: ["LF"],
        notes: "",
        active: true,
      },
    ]);
  };

  const handleRemovePlayer = (playerId: string) => {
    setRoster((current) => current.filter((player) => player.id !== playerId));
    setGameStatus((current) => current.filter((status) => status.playerId !== playerId));
  };

  const updatePlayer = (playerId: string, payload: Partial<Player>) => {
    setRoster((current) =>
      current.map((player) =>
        player.id === playerId ? { ...player, ...payload } : player,
      ),
    );
  };

  const updateGameStatus = (
    playerId: string,
    payload: Partial<GamePlayerStatus>,
  ) => {
    setGameStatus((current) =>
      current.map((status) =>
        status.playerId === playerId ? { ...status, ...payload } : status,
      ),
    );
  };

  const updateQuarterAssignment = (
    playerId: string,
    quarterKey: string,
    value: string,
  ) => {
    const nextQuarterAssignments = {
      ...quarterAssignments,
      [playerId]: {
        ...quarterAssignments[playerId],
        [quarterKey]: value,
      },
    };

    const shiftIndex = shiftLabels.indexOf(quarterKey);
    if (shiftIndex === -1) {
      setQuarterAssignments(nextQuarterAssignments);
      return;
    }

    const regenerated = regenerateLaterQuarterAssignments(
      roster,
      gameStatus,
      settings,
      nextQuarterAssignments,
      shiftIndex,
    );

    setQuarterAssignments(regenerated);
    setLineups(buildLineupsFromQuarterAssignments(roster, regenerated, settings));
  };

  const handleTogglePreferredPosition = (
    playerId: string,
    position: Position,
  ) => {
    setRoster((current) =>
      current.map((player) => {
        if (player.id !== playerId) {
          return player;
        }
        const hasPosition = player.preferredPositions.includes(position);
        const updatedPositions = hasPosition
          ? player.preferredPositions.filter((item) => item !== position)
          : [...player.preferredPositions, position];
        return {
          ...player,
          preferredPositions:
            updatedPositions.length > 0 ? updatedPositions : ["LF"],
        };
      }),
    );
  };

  const handleGenerateLineups = () => {
    const generated = generateLineups(roster, gameStatus, settings);
    setLineups(generated);
    setQuarterAssignments(buildQuarterAssignmentsFromLineups(roster, generated, settings));
  };

  const handleSaveLineup = () => {
    if (lineups.length === 0) {
      return;
    }
    const name = `Lineup ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
    const newEntry: SavedLineup = {
      id: `saved-${randomId()}`,
      name,
      shifts: lineups,
      createdAt: new Date().toISOString(),
    };
    setSavedLineups((current) => [newEntry, ...current]);
  };

  const handleLoadSavedLineup = (entry: SavedLineup) => {
    setLineups(entry.shifts);
    setQuarterAssignments(buildQuarterAssignmentsFromLineups(roster, entry.shifts, settings));
  };

  const handleDeleteSavedLineup = (entryId: string) => {
    setSavedLineups((current) => current.filter((item) => item.id !== entryId));
  };

  const handleExport = () => {
    const payload = createExportPayload(roster, gameStatus, settings, savedLineups);
    const fileName = `werkbot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const raw = await file.text();
    const payload = parseImportPayload(raw);
    if (!payload || !normalizeImportPayload(payload)) {
      setImportError("Could not import JSON. Make sure the backup file is valid.");
      event.target.value = "";
      return;
    }
    setRoster(payload.roster);
    setSettings(normalizeGameSettings(payload.settings));
    setSavedLineups(payload.savedLineups ?? []);
    setGameStatus(syncGameStatus(payload.gameStatus, payload.roster));
    setLineups([]);
    setQuarterAssignments(createEmptyQuarterAssignments(payload.roster, normalizeGameSettings(payload.settings)));
    setImportError(null);
    event.target.value = "";
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleReset = () => {
    setRoster(defaultRoster);
    setSettings(defaultGameSettings);
    setSavedLineups([]);
    setGameStatus(createInitialGameStatus(defaultRoster));
    setLineups([]);
    setQuarterAssignments(createEmptyQuarterAssignments(defaultRoster, defaultGameSettings));
  };

  const activePlayers = roster.filter((player) => player.active);
  type TabKey = "roster" | "status" | "settings" | "lineup" | "scoreboard";
  const [activeTab, setActiveTab] = useState<TabKey>("roster");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "roster", label: "Roster" },
    { key: "status", label: "Game day status" },
    { key: "settings", label: "Game settings" },
    { key: "lineup", label: "Lineup" },
    { key: "scoreboard", label: "Scoreboard" },
  ];

  const tabButtonClass = (tab: TabKey) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition ${
      tab === activeTab
        ? "bg-slate-900 text-white shadow"
        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    }`;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">
                Werkbot Robots vs {settings.opponent || "Opponent Name"}
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                {settings.gameDate
                  ? new Date(settings.gameDate).toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "numeric",
                    })
                  : "Date mm/dd/yyyy"}
              </h1>
            </div>
            <div className="flex flex-col gap-4 sm:items-end">
              <div className="grid w-full grid-cols-2 gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-center sm:w-auto">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Werkbot Robots</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{settings.homeScore}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{settings.opponent || "Opponent"}</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{settings.awayScore}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-flow-col sm:auto-cols-max sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleGenerateLineups}
                  className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  Generate lineups
                </button>
                <button
                  type="button"
                  onClick={handleSaveLineup}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
                >
                  Save lineup
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={tabButtonClass(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-6">
            {activeTab === "roster" ? (
              <>
                <section className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
                  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">Roster</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Add and edit players. Your roster saves in browser storage.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddPlayer}
                      className="inline-flex items-center justify-center rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500"
                    >
                      Add player
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-3xl border border-slate-200">
                    <div className="grid grid-cols-[1.8fr_0.8fr_0.9fr_0.8fr_0.8fr_0.8fr] gap-0 border-b border-slate-200 bg-slate-100 px-4 py-3 text-xs uppercase tracking-[0.18em] text-slate-500">
                      <span>Name</span>
                      <span>Gender</span>
                      <span>Skill</span>
                      <span>Goalie</span>
                      <span>Positions</span>
                      <span>Actions</span>
                    </div>
                    <div className="divide-y divide-slate-200">
                      {roster.map((player) => (
                        <div key={player.id} className="grid grid-cols-[1.8fr_0.8fr_0.9fr_0.8fr_0.8fr_0.8fr] gap-0 px-4 py-4 text-sm text-slate-700">
                          <div className="space-y-2">
                            <input
                              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                              value={player.name}
                              onChange={(event) => updatePlayer(player.id, { name: event.target.value })}
                              placeholder="Player name"
                            />
                            <input
                              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                              value={player.notes ?? ""}
                              onChange={(event) => updatePlayer(player.id, { notes: event.target.value })}
                              placeholder="Notes"
                            />
                          </div>
                          <select
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                            value={player.gender}
                            onChange={(event) => updatePlayer(player.id, { gender: event.target.value as Player["gender"] })}
                          >
                            <option value="boy">Boy</option>
                            <option value="girl">Girl</option>
                          </select>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                            value={player.skillRating}
                            onChange={(event) => {
                              const skill = clampNumber(Number(event.target.value), 1, 10);
                              updatePlayer(player.id, { skillRating: skill });
                            }}
                          />
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={player.willingGoalie}
                              onChange={(event) => updatePlayer(player.id, { willingGoalie: event.target.checked })}
                              className="h-4 w-4 rounded border-slate-300 text-sky-600"
                            />
                            <span className="text-sm text-slate-700">Yes</span>
                          </label>
                          <div className="flex flex-wrap gap-1">
                            {POSITION_OPTIONS.map((option) => (
                              <button
                                key={option}
                                type="button"
                                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${player.preferredPositions.includes(option) ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"}`}
                                onClick={() => handleTogglePreferredPosition(player.id, option)}
                              >
                                {option.slice(0, 3)}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                              <input
                                type="checkbox"
                                checked={player.active}
                                onChange={(event) => updatePlayer(player.id, { active: event.target.checked })}
                                className="h-4 w-4 rounded border-slate-300 text-sky-600"
                              />
                              Active
                            </label>
                            <button
                              type="button"
                              onClick={() => handleRemovePlayer(player.id)}
                              className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
                  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">Import / export</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Export the roster and lineup data to JSON, or import a backup from another browser.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleExport}
                        className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                      >
                        Export JSON
                      </button>
                      <button
                        type="button"
                        onClick={openFilePicker}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
                      >
                        Import JSON
                      </button>
                      <button
                        type="button"
                        onClick={handleReset}
                        className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                      >
                        Reset defaults
                      </button>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={handleImport}
                  />
                  {importError ? (
                    <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">
                      {importError}
                    </div>
                  ) : null}

                  {savedLineups.length > 0 ? (
                    <div className="mt-6 space-y-3">
                      <p className="text-sm font-semibold text-slate-900">Saved lineups</p>
                      <div className="space-y-3">
                        {savedLineups.map((entry) => (
                          <div key={entry.id} className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-semibold text-slate-900">{entry.name}</p>
                              <p className="text-sm text-slate-600">{new Date(entry.createdAt).toLocaleString()}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleLoadSavedLineup(entry)}
                                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                              >
                                Load
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSavedLineup(entry.id)}
                                className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}

            {activeTab === "status" ? (
              <section className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Game-day status</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Mark present players, limited minutes, and goalie readiness for the current game.
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-3xl border border-slate-200">
                  <div className="grid grid-cols-[2.0fr_0.8fr_0.8fr_0.8fr_0.8fr_0.9fr] gap-0 border-b border-slate-200 bg-slate-100 px-4 py-3 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <span>Player</span>
                    <span>Present</span>
                    <span>Limited</span>
                    <span>Unavailable</span>
                    <span>Goalie</span>
                    <span>Goals</span>
                  </div>
                  <div className="divide-y divide-slate-200">
                    {activePlayers.map((player) => {
                      const status = gameStatus.find((item) => item.playerId === player.id);
                      return (
                        <div key={player.id} className="grid grid-cols-[2.0fr_0.8fr_0.8fr_0.8fr_0.8fr_0.9fr] gap-0 px-4 py-4 text-sm text-slate-700">
                          <div>
                            <p className="font-semibold text-slate-900">{player.name || "Unnamed player"}</p>
                            <p className="text-xs text-slate-500">{player.notes}</p>
                          </div>
                          <label className="inline-flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={status?.present ?? false}
                              onChange={(event) => updateGameStatus(player.id, { present: event.target.checked })}
                              className="h-4 w-4 rounded border-slate-300 text-sky-600"
                            />
                          </label>
                          <label className="inline-flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={status?.limitedMinutes ?? false}
                              onChange={(event) => updateGameStatus(player.id, { limitedMinutes: event.target.checked })}
                              className="h-4 w-4 rounded border-slate-300 text-sky-600"
                            />
                          </label>
                          <label className="inline-flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={status?.unavailable ?? false}
                              onChange={(event) => updateGameStatus(player.id, { unavailable: event.target.checked })}
                              className="h-4 w-4 rounded border-slate-300 text-sky-600"
                            />
                          </label>
                          <label className="inline-flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={status?.goalieToday ?? false}
                              onChange={(event) => updateGameStatus(player.id, { goalieToday: event.target.checked })}
                              className="h-4 w-4 rounded border-slate-300 text-sky-600"
                            />
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={status?.goals ?? 0}
                            onChange={(event) =>
                              updateGameStatus(player.id, {
                                goals: clampNumber(Number(event.target.value), 0, 20),
                              })
                            }
                            className="mx-auto h-10 w-20 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "settings" ? (
              <section className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Game settings</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Configure formation, quarters, and balance rules for shift generation.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <p className="mb-3 text-sm font-semibold text-slate-900">Structure</p>
                    <label className="mb-3 block text-sm text-slate-700">
                      Quarters
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={settings.quarters}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            quarters: clampNumber(Number(event.target.value), 1, 6),
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                      />
                    </label>
                    <label className="block text-sm text-slate-700">
                      Shifts per quarter
                      <input
                        type="number"
                        min={1}
                        max={4}
                        value={settings.shiftsPerQuarter}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            shiftsPerQuarter: clampNumber(Number(event.target.value), 1, 4),
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                      />
                    </label>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <p className="mb-3 text-sm font-semibold text-slate-900">Girls on field</p>
                    <label className="mb-3 block text-sm text-slate-700">
                      Min girls
                      <input
                        type="number"
                        min={0}
                        max={9}
                        value={settings.targetMinGirlsOnField}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            targetMinGirlsOnField: clampNumber(Number(event.target.value), 0, 9),
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                      />
                    </label>
                    <label className="block text-sm text-slate-700">
                      Max girls
                      <input
                        type="number"
                        min={0}
                        max={9}
                        value={settings.targetMaxGirlsOnField}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            targetMaxGirlsOnField: clampNumber(Number(event.target.value), 0, 9),
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="inline-flex items-center gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={settings.balanceSkill}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          balanceSkill: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-sky-600"
                    />
                    Balance skill
                  </label>
                  <label className="inline-flex items-center gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={settings.balancePlayingTime}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          balancePlayingTime: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-sky-600"
                    />
                    Balance playing time
                  </label>
                  <label className="inline-flex items-center gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={settings.rotateGoalie}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          rotateGoalie: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-sky-600"
                    />
                    Rotate goalie
                  </label>
                </div>
              </section>
            ) : null}

            {activeTab === "scoreboard" ? (
              <section className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Scoreboard</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Track the opponent, game date, score, and goal scorers here.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm text-slate-700">
                    Opponent
                    <input
                      type="text"
                      value={settings.opponent}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          opponent: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                      placeholder="Opponent name"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Game date
                    <input
                      type="date"
                      value={settings.gameDate}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          gameDate: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                    />
                  </label>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl bg-white p-5 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Werkbot Robots</p>
                    <p className="mt-3 text-5xl font-semibold text-slate-900">{settings.homeScore}</p>
                  </div>
                  <div className="rounded-3xl bg-white p-5 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{settings.opponent || "Opponent"}</p>
                    <p className="mt-3 text-5xl font-semibold text-slate-900">{settings.awayScore}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm text-slate-700">
                    Our goals
                    <input
                      type="number"
                      min={0}
                      value={settings.homeScore}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          homeScore: clampNumber(Number(event.target.value), 0, 20),
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Their goals
                    <input
                      type="number"
                      min={0}
                      value={settings.awayScore}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          awayScore: clampNumber(Number(event.target.value), 0, 20),
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                    />
                  </label>
                </div>

                {goalScorers.length > 0 ? (
                  <div className="mt-5 rounded-3xl bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">Goal scorers</p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-700">
                      {goalScorers.map((scorer) => (
                        <li key={scorer.playerId}>
                          {scorer.name} — {scorer.goals} goal{scorer.goals === 1 ? "" : "s"}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-5 rounded-3xl bg-slate-50 p-4 text-sm text-slate-600">
                    No goal scorers logged yet.
                  </div>
                )}
              </section>
            ) : null}

            {activeTab === "lineup" ? (
              <section className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-slate-950">Game sheet</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Track player positions by shift in a spreadsheet-style lineup view.
                  </p>
                </div>

                <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
                  <table className="min-w-full text-sm text-slate-700">
                    <thead className="bg-slate-100 text-xs uppercase tracking-[0.18em] text-slate-500">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Name</th>
                        {shiftLabels.map((label) => (
                          <th key={label} className="px-4 py-3 text-left font-semibold">
                            {label}
                          </th>
                        ))}
                        <th className="px-4 py-3 text-left font-semibold">Goals</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {activePlayers.map((player) => {
                        const status = gameStatus.find((item) => item.playerId === player.id);
                        const assignment = quarterAssignments[player.id] ?? {}
                        return (
                          <tr key={player.id} className="hover:bg-slate-50">
                            <td className="whitespace-nowrap px-4 py-3">
                              <div className="font-semibold text-slate-900">{player.name || "Unnamed"}</div>
                              <div className="mt-1 text-xs text-slate-500">{player.notes}</div>
                            </td>
                            {shiftLabels.map((label) => {
                              const value = assignment[label] ?? "";
                              const isOnField = value !== "" && value !== "B";
                              const isBench = value === "B";
                              return (
                                <td key={label} className="px-4 py-3">
                                  <input
                                    type="text"
                                    value={value}
                                    onChange={(event) => updateQuarterAssignment(player.id, label, event.target.value)}
                                    placeholder="Position"
                                    className={`w-full rounded-2xl border px-3 py-2 text-sm outline-none transition ${
                                      isOnField
                                        ? "border-emerald-300 bg-emerald-100 text-emerald-900 focus:border-emerald-500 focus:ring-emerald-100"
                                        : isBench
                                        ? "border-slate-200 bg-slate-100 text-slate-600 focus:border-slate-300 focus:ring-slate-100"
                                        : "border-slate-200 bg-slate-50 text-slate-900 focus:border-sky-500 focus:ring-sky-100"
                                    }`}
                                  />
                                </td>
                              );
                            })}
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min={0}
                                value={status?.goals ?? 0}
                                onChange={(event) =>
                                  updateGameStatus(player.id, {
                                    goals: clampNumber(Number(event.target.value), 0, 20),
                                  })
                                }
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleGenerateLineups}
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => setLineups([])}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
                  >
                    Clear shifts
                  </button>
                </div>

                {lineups.length === 0 ? (
                  <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
                    Generate a lineup to preview shifts here.
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    {lineups.map((shift) => (
                      <ShiftLineupCard
                        key={shift.id}
                        shift={shift}
                        playerNameById={playerNameById}
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
