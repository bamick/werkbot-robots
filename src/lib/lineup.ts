import type {
  GamePlayerStatus,
  GameSettings,
  Player,
  ShiftLineup,
} from "./types";

const POSITION_TYPES = ["goalie", "defense", "midfield", "offense"] as const;

function getPositionGroup(position: string): "goalie" | "defense" | "midfield" | "offense" {
  switch (position) {
    case "goalie":
      return "goalie";
    case "defense":
    case "LD":
    case "CD":
    case "RD":
      return "defense";
    case "midfield":
    case "LM":
    case "RM":
      return "midfield";
    case "offense":
    case "LF":
    case "CF":
    case "RF":
      return "offense";
    default:
      return "offense";
  }
}

function playerPrefersPosition(player: ActivePlayer, position: string) {
  const positionGroup = getPositionGroup(position);
  return player.preferredPositions.some(
    (pref) => getPositionGroup(pref) === positionGroup,
  );
}

type PositionGroup = "goalie" | "defense" | "midfield" | "offense" | "bench";

type PlayerPositionHistory = {
  positionCounts: Record<PositionGroup, number>;
  lastPosition: PositionGroup | null;
  consecutiveSamePositionCount: number;
};

type ActivePlayer = Player & GamePlayerStatus & {
  currentShiftIndex: number;
};

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getPlayerMap(roster: Player[]) {
  return new Map(roster.map((player) => [player.id, player]));
}

function buildActivePlayers(
  roster: Player[],
  gameStatus: GamePlayerStatus[],
  shiftIndex: number,
): ActivePlayer[] {
  const rosterMap = getPlayerMap(roster);
  return gameStatus
    .map((status) => {
      const player = rosterMap.get(status.playerId);
      if (!player) {
        return null;
      }
      return {
        ...player,
        ...status,
        currentShiftIndex: shiftIndex,
      };
    })
    .filter(
      (item): item is ActivePlayer =>
        item !== null &&
        item.active &&
        item.present &&
        !item.unavailable &&
        (item.outFromShiftIndex === undefined || item.currentShiftIndex < item.outFromShiftIndex),
    );
}

function chooseGoalie(
  candidates: ActivePlayer[],
  settings: GameSettings,
  playCount: Map<string, number>,
  positionHistory: Map<string, PlayerPositionHistory>,
): string | null {
  const eligible = candidates.filter((player) => player.goalieToday && player.willingGoalie);
  const fallback = candidates.filter((player) => player.willingGoalie);
  const pool = eligible.length > 0 ? eligible : fallback.length > 0 ? fallback : candidates;
  if (pool.length === 0) {
    return null;
  }

  const goaliesUnderLimit = pool.filter((player) => {
    const history = positionHistory.get(player.id);
    return (history?.positionCounts.goalie ?? 0) < 2;
  });
  const candidatePool = goaliesUnderLimit.length > 0 ? goaliesUnderLimit : pool;

  const getGoaliePenalty = (player: ActivePlayer) => {
    const history = positionHistory.get(player.id);
    let penalty = 0;

    if (history?.lastPosition === "goalie") {
      penalty += history.consecutiveSamePositionCount >= 2 ? 120 : 48;
    }
    if ((history?.positionCounts.goalie ?? 0) >= 2) {
      penalty += 96;
    }

    return penalty;
  };

  return candidatePool
    .slice()
    .sort((a, b) => {
      const aCount = playCount.get(a.id) ?? 0;
      const bCount = playCount.get(b.id) ?? 0;
      const countDiff = aCount - bCount;
      if (countDiff !== 0) {
        return countDiff;
      }
      const penaltyDiff = getGoaliePenalty(a) - getGoaliePenalty(b);
      if (penaltyDiff !== 0) {
        return penaltyDiff;
      }
      if (settings.balanceSkill) {
        return b.skillRating - a.skillRating;
      }
      return a.name.localeCompare(b.name);
    })[0].id;
}

function buildPlayerScore(
  player: ActivePlayer,
  position: string,
  avgSkill: number,
  settings: GameSettings,
  girlsNeeded: number,
  girlsOnField: number,
  playerCount: number,
  positionHistory?: PlayerPositionHistory,
): number {
  let score = 0;
  score += playerCount * 20;
  if (player.limitedMinutes) {
    score += 24;
  }
  if (!playerPrefersPosition(player, position)) {
    score += 18;
  }
  if (settings.balanceSkill) {
    score += Math.abs(player.skillRating - avgSkill) * 3;
  }
  if (girlsNeeded > 0 && player.gender === "boy") {
    score += 40;
  }
  if (girlsOnField >= settings.targetMaxGirlsOnField && player.gender === "girl") {
    score += 32;
  }

  if (positionHistory) {
    const positionGroup = position as PositionGroup;
    if (positionHistory.lastPosition === positionGroup) {
      score += positionHistory.consecutiveSamePositionCount >= 2 ? 120 : 48;
    }
    if (positionHistory.positionCounts[positionGroup] >= 2) {
      score += 96;
    }
    if (positionGroup === "offense" && positionHistory.lastPosition === "goalie") {
      score -= 200;
    }
  }
  return score;
}

function selectPlayersForPosition(
  pool: ActivePlayer[],
  count: number,
  position: string,
  avgSkill: number,
  settings: GameSettings,
  girlsNeeded: number,
  girlsOnField: number,
  playCount: Map<string, number>,
  positionHistory: Map<string, PlayerPositionHistory>,
): string[] {
  const positionGroup = position as PositionGroup;
  const strictCandidates = pool.filter((player) => {
    const history = positionHistory.get(player.id);
    return (
      (history?.positionCounts[positionGroup] ?? 0) < 2 &&
      (history?.lastPosition !== positionGroup || (history?.consecutiveSamePositionCount ?? 0) < 2)
    );
  });
  const countStrictCandidates = pool.filter((player) => {
    const history = positionHistory.get(player.id);
    return (history?.positionCounts[positionGroup] ?? 0) < 2;
  });
  const consecutiveStrictCandidates = pool.filter((player) => {
    const history = positionHistory.get(player.id);
    return (history?.lastPosition !== positionGroup || (history?.consecutiveSamePositionCount ?? 0) < 2);
  });
  const goalieTransitionCandidates =
    positionGroup === "offense"
      ? pool.filter((player) => positionHistory.get(player.id)?.lastPosition === "goalie")
      : [];
  const baseCandidates =
    strictCandidates.length >= count
      ? strictCandidates
      : countStrictCandidates.length >= count
      ? countStrictCandidates
      : consecutiveStrictCandidates.length >= count
      ? consecutiveStrictCandidates
      : pool;
  const candidates =
    goalieTransitionCandidates.length > 0
      ? Array.from(
          new Set([...goalieTransitionCandidates, ...baseCandidates]),
        )
      : baseCandidates;

  const sorted = candidates
    .slice()
    .sort((a, b) => {
      const scoreA = buildPlayerScore(
        a,
        position,
        avgSkill,
        settings,
        girlsNeeded,
        girlsOnField,
        playCount.get(a.id) ?? 0,
        positionHistory.get(a.id),
      );
      const scoreB = buildPlayerScore(
        b,
        position,
        avgSkill,
        settings,
        girlsNeeded,
        girlsOnField,
        playCount.get(b.id) ?? 0,
        positionHistory.get(b.id),
      );
      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }
      return a.skillRating === b.skillRating
        ? a.name.localeCompare(b.name)
        : b.skillRating - a.skillRating;
    })
    .slice(0, count);
  return sorted.map((player) => player.id);
}

function initializePositionHistory(roster: Player[]) {
  return new Map<string, PlayerPositionHistory>(
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

function buildPlayCountFromHistory(positionHistory: Map<string, PlayerPositionHistory>) {
  const playCount = new Map<string, number>();
  positionHistory.forEach((history, playerId) => {
    const count =
      history.positionCounts.goalie +
      history.positionCounts.defense +
      history.positionCounts.midfield +
      history.positionCounts.offense;
    playCount.set(playerId, count);
  });
  return playCount;
}

export function generateLineups(
  roster: Player[],
  gameStatus: GamePlayerStatus[],
  settings: GameSettings,
  startingPositionHistory?: Map<string, PlayerPositionHistory>,
  startShiftIndex = 0,
): ShiftLineup[] {
  const shifts: ShiftLineup[] = [];
  const totalShifts = settings.quarters * settings.shiftsPerQuarter;
  const rosterMap = getPlayerMap(roster);
  const positionHistory =
    startingPositionHistory && startingPositionHistory.size > 0
      ? new Map(startingPositionHistory)
      : initializePositionHistory(roster);
  const playCount =
    startingPositionHistory && startingPositionHistory.size > 0
      ? buildPlayCountFromHistory(positionHistory)
      : new Map<string, number>();

  for (let index = startShiftIndex; index < totalShifts; index += 1) {
    const activePlayers = buildActivePlayers(roster, gameStatus, index);
    const avgSkill =
      activePlayers.reduce((sum, player) => sum + player.skillRating, 0) /
      Math.max(activePlayers.length, 1);

    const goalieCandidate = chooseGoalie(activePlayers, settings, playCount, positionHistory);
    const selected: Set<string> = new Set();
    const warnings: string[] = [];

    if (!goalieCandidate) {
      warnings.push("No available goalie candidate for this shift.");
    } else {
      selected.add(goalieCandidate);
      playCount.set(goalieCandidate, (playCount.get(goalieCandidate) ?? 0) + 1);
    }

    const goalieGender = goalieCandidate
      ? rosterMap.get(goalieCandidate)?.gender === "girl"
        ? "girl"
        : "boy"
      : "boy";
    let girlsOnField = goalieGender === "girl" ? 1 : 0;

    const availablePlayers = activePlayers.filter(
      (player) => player.id !== goalieCandidate,
    );

    const positionOrder: Array<keyof GameSettings["formation"]> = [
      "defense",
      "midfield",
      "offense",
    ];

    const positionAssignments: Partial<Record<keyof GameSettings["formation"], string[]>> = {
      goalie: goalieCandidate ? [goalieCandidate] : [],
    };

    for (const position of positionOrder) {
      const count = settings.formation[position];
      const remaining = availablePlayers.filter((player) => !selected.has(player.id));
      if (remaining.length === 0 && count > 0) {
        warnings.push(`Not enough players to fill ${position}.`);
        positionAssignments[position] = [];
        continue;
      }

      const girlsNeeded = Math.max(
        0,
        settings.targetMinGirlsOnField - girlsOnField - Math.max(0, count - remaining.length),
      );

      const chosen = selectPlayersForPosition(
        remaining,
        Math.min(count, remaining.length),
        position,
        avgSkill,
        settings,
        girlsNeeded,
        girlsOnField,
        playCount,
        positionHistory,
      );

      positionAssignments[position] = chosen;
      chosen.forEach((playerId) => {
        selected.add(playerId);
        const player = rosterMap.get(playerId);
        if (player?.gender === "girl") {
          girlsOnField += 1;
        }
        playCount.set(playerId, (playCount.get(playerId) ?? 0) + 1);
      });
    }

    const assignedCount =
      (positionAssignments.offense?.length ?? 0) +
      (positionAssignments.midfield?.length ?? 0) +
      (positionAssignments.defense?.length ?? 0) +
      (positionAssignments.goalie?.length ?? 0);
    const bench = availablePlayers
      .filter((player) => !selected.has(player.id))
      .map((player) => player.id);

    const assignmentMap = new Map<string, PositionGroup>();
    if (goalieCandidate) {
      assignmentMap.set(goalieCandidate, "goalie");
    }
    (positionAssignments.defense ?? []).forEach((playerId) => assignmentMap.set(playerId, "defense"));
    (positionAssignments.midfield ?? []).forEach((playerId) => assignmentMap.set(playerId, "midfield"));
    (positionAssignments.offense ?? []).forEach((playerId) => assignmentMap.set(playerId, "offense"));
    bench.forEach((playerId) => assignmentMap.set(playerId, "bench"));

    assignmentMap.forEach((positionGroup, playerId) => {
      const history = positionHistory.get(playerId);
      if (!history) return;

      if (positionGroup === "bench") {
        history.positionCounts.bench += 1;
        history.lastPosition = "bench";
        history.consecutiveSamePositionCount = 0;
        return;
      }

      const isSamePosition = history.lastPosition === positionGroup;
      history.consecutiveSamePositionCount = isSamePosition
        ? history.consecutiveSamePositionCount + 1
        : 1;
      history.lastPosition = positionGroup;
      history.positionCounts[positionGroup] += 1;
    });

    if (assignedCount < settings.formation.offense + settings.formation.midfield + settings.formation.defense + settings.formation.goalie) {
      warnings.push("Shift has fewer players than the target formation.");
    }

    shifts.push({
      id: createId("shift"),
      quarter: Math.floor(index / settings.shiftsPerQuarter) + 1,
      shiftInQuarter: (index % settings.shiftsPerQuarter) + 1,
      shiftIndex: index,
      offense: positionAssignments.offense ?? [],
      midfield: positionAssignments.midfield ?? [],
      defense: positionAssignments.defense ?? [],
      goalie: positionAssignments.goalie?.[0] ?? null,
      bench,
      locked: false,
      warnings,
    });
  }

  return shifts;
}
