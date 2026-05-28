# Werkbot-Robots Skills.md

## Project Name

Werkbot-Robots

## App Purpose

Werkbot-Robots is a simple youth soccer lineup planner built for game-day use.

The app helps a coach quickly create balanced lineups based on which players are present at the game. It should balance playing time, skill level, goalie availability, and gender mix across all shifts.

The app should run on Vercel and should not use a database.

Persistent data should be stored in the browser using localStorage. The full team roster, player skill ratings, gender, preferred positions, and goalie willingness should be saved so the coach does not need to enter those details before every game.

Game-day attendance and lineups can be created on the fly.

## Primary Use Case

Before a game, the coach opens the app and does the following:

1. Reviews the saved roster.
2. Checks which players are present.
3. Marks any players with limited minutes.
4. Confirms who is willing to play goalie that day.
5. Generates balanced lineups.
6. Makes manual changes as needed during the game.
7. Uses the app as a sideline lineup guide.

## Technical Requirements

Use the following stack:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Vercel hosting
- localStorage for persistent browser storage
- JSON import and export for backup and portability

Do not use:

- Database
- Login system
- External backend
- Paid API
- Server-side data storage

## Data Storage Requirements

The app should save the roster permanently in localStorage.

The following data should persist between sessions:

- Player names
- Player gender
- Player skill rating
- Player preferred positions
- Player willing-to-play-goalie setting
- Optional player notes
- Default game settings
- Saved lineups, if the user chooses to save them

The app should allow JSON export and import for:

- Roster backup
- Full game lineup backup
- Moving data to another device or browser

## Roster Data Model

Each player should include:

```ts
type Gender = "boy" | "girl";

type Position = "offense" | "midfield" | "defense" | "goalie";

type Player = {
  id: string;
  name: string;
  gender: Gender;
  skillRating: number;
  willingGoalie: boolean;
  preferredPositions: Position[];
  notes?: string;
  active: boolean;
};
```

## Game-Day Player Status Model

Each game should allow the coach to change player availability without editing the permanent roster.

```ts
type GamePlayerStatus = {
  playerId: string;
  present: boolean;
  limitedMinutes: boolean;
  unavailable: boolean;
  goalieToday: boolean;
  outFromShiftIndex?: number;
  note?: string;
};
```

Important behavior:

- `present` means the player is at the game.
- `limitedMinutes` means the app should try to give that player fewer shifts.
- `unavailable` means the player should not be scheduled.
- `goalieToday` means the player is willing to play goalie in this specific game.
- `outFromShiftIndex` means the player became unavailable during the game and should be removed from that shift forward.

## Game Settings Model

```ts
type Formation = {
  offense: number;
  midfield: number;
  defense: number;
  goalie: number;
};

type GameSettings = {
  quarters: number;
  shiftsPerQuarter: number;
  formation: Formation;
  targetMinGirlsOnField: number;
  targetMaxGirlsOnField: number;
  balanceSkill: boolean;
  balancePlayingTime: boolean;
  rotateGoalie: boolean;
};
```

Default settings:

```ts
const defaultGameSettings: GameSettings = {
  quarters: 4,
  shiftsPerQuarter: 2,
  formation: {
    offense: 3,
    midfield: 2,
    defense: 3,
    goalie: 1
  },
  targetMinGirlsOnField: 2,
  targetMaxGirlsOnField: 3,
  balanceSkill: true,
  balancePlayingTime: true,
  rotateGoalie: true
};
```

## Game Structure

The league uses:

- 4 quarters
- 2 shifts per quarter
- 8 total shifts
- 9 players on the field per shift

Field formation:

- 3 offense
- 2 midfield
- 3 defense
- 1 goalie

The app should generate 8 shifts:

1. Quarter 1, Shift 1
2. Quarter 1, Shift 2
3. Quarter 2, Shift 1
4. Quarter 2, Shift 2
5. Quarter 3, Shift 1
6. Quarter 3, Shift 2
7. Quarter 4, Shift 1
8. Quarter 4, Shift 2

## Shift Data Model

```ts
type ShiftLineup = {
  id: string;
  quarter: number;
  shiftInQuarter: number;
  shiftIndex: number;
  offense: string[];
  midfield: string[];
  defense: string[];
  goalie: string | null;
  bench: string[];
  locked: boolean;
  warnings: string[];
};
```

## Game Data Model

```ts
type Game = {
  id: string;
  createdAt: string;
  opponent?: string;
  settings: GameSettings;
  playerStatuses: GamePlayerStatus[];
  shifts: ShiftLineup[];
};
```

## Main Screens

### 1. Home Screen

The home screen should have these actions:

- Create Game Lineup
- Manage Roster
- Import Data
- Export Data

Optional:

- Continue Last Game
- View Saved Games

### 2. Roster Screen

The roster screen should allow the coach to:

- Add a player
- Edit a player
- Delete or deactivate a player
- Change skill rating
- Change gender
- Change goalie willingness
- Change preferred positions
- Add notes

The roster should save automatically to localStorage.

Important requirement:

The coach should not need to re-enter skill ratings before every game. Skill ratings are part of the saved roster.

### 3. Game-Day Setup Screen

The game-day setup screen should show the saved roster in a quick checklist.

Each player row should include:

- Player name
- Skill rating
- Gender
- Present checkbox
- Limited minutes checkbox
- Goalie today checkbox
- Unavailable checkbox

Default behavior:

- Active roster players default to present.
- Goalie today should default to the player's saved `willingGoalie` value.
- Limited minutes should default to false.
- Unavailable should default to false.

The coach should be able to quickly uncheck players who are absent.

### 4. Generate Lineups Screen

After attendance is set, the coach taps:

Generate Lineups

The app should create all 8 shifts.

The lineup view should show:

- Quarter and shift
- Offense players
- Midfield players
- Defense players
- Goalie
- Bench
- Total skill score
- Number of girls on field
- Warnings

### 5. Game Mode Screen

This should be the main sideline screen.

It should show:

- Current shift
- Next shift
- Bench players
- Quick actions

Quick actions:

- Swap players
- Move player to bench
- Move player to offense
- Move player to midfield
- Move player to defense
- Move player to goalie
- Mark player out from this shift forward
- Regenerate remaining shifts

The Game Mode screen should be mobile-friendly with large tap targets.

### 6. Player Summary Screen

The summary screen should update after lineup generation and after manual changes.

It should show:

- Player name
- Total shifts played
- Bench shifts
- Offense shifts
- Midfield shifts
- Defense shifts
- Goalie shifts
- Skill rating
- Gender

This helps the coach confirm that playing time is fair.

### 7. Print View

Create a simple print-friendly view that shows all 8 shifts on one page.

It should include:

- Quarter
- Shift
- Offense
- Midfield
- Defense
- Goalie
- Bench

## Playing Time Logic

The app should calculate playing time based only on players who are present and available.

Total field slots:

```ts
totalFieldSlots = quarters * shiftsPerQuarter * 9;
```

Default:

```ts
totalFieldSlots = 4 * 2 * 9 = 72;
```

Target playing time:

```ts
baseShiftCount = Math.floor(totalFieldSlots / availablePlayerCount);
extraShiftCount = totalFieldSlots % availablePlayerCount;
```

Examples:

- 17 players present, most players play 4 shifts, 4 players play 5 shifts.
- 15 players present, most players play 5 shifts, 3 players play 4 shifts.
- 13 players present, most players play 5 or 6 shifts.
- 11 players present, most players play 6 or 7 shifts.
- 9 players present, everyone plays every shift.

Limited minutes players should receive fewer shifts when possible.

## Skill Balancing Logic

Each player has a skill rating from 1 to 10.

The app should calculate the average target skill score for a field lineup.

```ts
targetSkillScore = totalAvailableSkill * 9 / availablePlayerCount;
```

Each generated shift should try to keep the total field skill score near the target.

The app does not need perfect balance. It should avoid highly uneven shifts.

## Gender Balance Logic

The app should try to keep 2 to 3 girls on the field per shift.

This should be a preference, not a hard blocker.

Ideal:

- 2 girls
- 3 girls

Acceptable:

- 1 girl when needed

Avoid:

- 0 girls unless impossible
- Too many girls on one shift if it causes later shifts to have none

## Goalie Logic

Goalie should only be assigned from players who are willing to play goalie.

Use this priority:

1. Players marked `goalieToday`
2. Players with saved `willingGoalie`
3. Manual coach override only

The app should rotate goalie shifts as evenly as possible.

Avoid:

- Same player playing goalie too many times
- Assigning goalie to someone not marked as willing
- Leaving goalie empty

If no goalie is available, show a warning.

## Lineup Generation Strategy

Use a weighted scoring system.

The app should create possible lineups and pick the lineup with the lowest penalty score.

Penalty examples:

- Player is over target shifts: +100
- Player is under target shifts late in the game: +50
- No goalie available: +500
- Goalie is not marked willing: +200
- Girl count is 0: +200
- Girl count is 1: +40
- Girl count is more than 3: +20
- Skill score is far from target: add difference from target
- Player is placed in a non-preferred position: +25
- Same goalie repeats too often: +50
- Player sits 3 shifts in a row: +30
- Player plays too many shifts in a row: +15

Lower score is better.

## Recommended Generation Order

When creating each shift, assign positions in this order:

1. Goalie
2. Defense
3. Midfield
4. Offense
5. Bench

Reason:

- Goalie has the tightest restriction.
- Defense needs stability.
- Midfield needs balance.
- Offense usually has more volunteers.

## Manual Editing Requirements

The coach should be able to make changes after lineups are generated.

Required actions:

- Swap two players
- Move a player from field to bench
- Move a player from bench to field
- Change a player position
- Change goalie
- Lock a shift
- Unlock a future shift
- Mark player out from a shift forward
- Regenerate remaining unlocked shifts

Important behavior:

- Completed shifts should stay locked.
- Current shift can be edited.
- Future shifts can be regenerated.
- Regeneration should not change locked shifts.

## Injury or Player-Out Workflow

When the coach marks a player out:

1. Ask which shift the player is out from.
2. Remove that player from the current and future unlocked shifts.
3. Keep past locked shifts unchanged.
4. Let the coach choose:
   - Replace in current shift only
   - Regenerate all remaining unlocked shifts

## Warnings

The app should show warnings, but should not block the coach unless the lineup is impossible.

Example warnings:

- This shift has only 1 girl on the field.
- This shift has no girls on the field.
- Goalie is not marked as willing.
- No goalie is available for this shift.
- This player is scheduled for more shifts than most players.
- This player is scheduled for fewer shifts than most players.
- This shift has a much lower skill score than the others.
- This shift has a much higher skill score than the others.
- Fewer than 9 players are available.

## localStorage Keys

Use clear localStorage keys.

```ts
const STORAGE_KEYS = {
  roster: "werkbot-robots-roster",
  settings: "werkbot-robots-settings",
  currentGame: "werkbot-robots-current-game",
  savedGames: "werkbot-robots-saved-games"
};
```

## Suggested Folder Structure

```txt
/src
  /app
    page.tsx
    roster/page.tsx
    game/new/page.tsx
    game/[id]/page.tsx
    game/[id]/print/page.tsx
  /components
    PlayerForm.tsx
    RosterTable.tsx
    GameDayPlayerChecklist.tsx
    LineupCard.tsx
    ShiftEditor.tsx
    PlayerSummaryTable.tsx
    WarningList.tsx
  /lib
    storage.ts
    lineup-generator.ts
    lineup-summary.ts
    validation.ts
    import-export.ts
  /types
    player.ts
    game.ts
    lineup.ts
```

## Component Requirements

### PlayerForm

Used to add or edit roster players.

Fields:

- Name
- Gender
- Skill rating
- Willing goalie
- Preferred positions
- Notes

### RosterTable

Shows saved players.

Actions:

- Edit
- Deactivate
- Delete

### GameDayPlayerChecklist

Shows all active players and allows game-day status changes.

### LineupCard

Shows one shift lineup.

Includes:

- Quarter
- Shift
- Positions
- Bench
- Warnings

### ShiftEditor

Allows manual changes to a shift.

### PlayerSummaryTable

Shows playing time by player.

### WarningList

Shows lineup warnings.

## Scheduling Utility Functions

Create these functions in `/lib/lineup-generator.ts`.

```ts
function generateLineups(
  players: Player[],
  statuses: GamePlayerStatus[],
  settings: GameSettings,
  lockedShifts?: ShiftLineup[]
): ShiftLineup[] {
  // Generate shifts based on available players, settings, and locked shifts.
}
```

```ts
function calculateTargetShiftCounts(
  availablePlayers: Player[],
  settings: GameSettings
): Record<string, number> {
  // Calculate how many shifts each player should play.
}
```

```ts
function scoreLineup(
  lineup: ShiftLineup,
  context: LineupScoringContext
): number {
  // Return a penalty score for the lineup.
}
```

```ts
function regenerateFromShift(
  game: Game,
  fromShiftIndex: number
): Game {
  // Keep previous locked shifts and regenerate future unlocked shifts.
}
```

```ts
function summarizePlayingTime(
  game: Game,
  players: Player[]
): PlayerSummary[] {
  // Return total shifts and position counts for each player.
}
```

## Validation Rules

Before generating lineups:

- At least 9 players should be present and available.
- If fewer than 9 players are available, show a warning and generate the best possible lineup.
- At least 1 goalie should be available.
- If no goalie is available, show a warning.
- Skill ratings must be between 1 and 10.
- Player names cannot be empty.

## UI Requirements

The design should be simple, clean, and fast to use on a phone.

Prioritize:

- Large buttons
- Simple tables
- Clear cards
- Minimal clicks
- Fast game-day setup
- Easy editing during a game
- Print-friendly output

Use Tailwind CSS for layout and styling.

Recommended UI sections:

- Cards for each shift
- Tables for roster and summary
- Checkbox rows for game-day attendance
- Warning badges
- Lock icons for locked shifts
- Clear primary action button for Generate Lineups

## MVP Requirements

The first working version should include:

- Add and edit roster players
- Save roster to localStorage
- Edit player skill ratings any time
- Game-day attendance checklist
- Generate 8 shifts
- Balance playing time
- Balance skill
- Assign goalie from willing players
- Try to keep 2 to 3 girls on the field
- Show bench for each shift
- Show player summary
- Allow basic manual swaps
- Allow marking player out from a shift forward
- Regenerate remaining unlocked shifts
- Export and import roster JSON
- Print-friendly lineup view

## Future Enhancements

Optional features for later:

- Saved game history
- Position-specific skill ratings
- Fatigue tracking
- Drag and drop editing
- Assistant coach sharing
- PDF export
- CSV export
- Season playing-time history
- Rotate extra playing time across games
- Player development notes
- Dark mode

## Build Priorities

Build in this order:

1. Roster storage and editing
2. Game-day attendance setup
3. Basic lineup generation
4. Playing time summary
5. Skill and gender balancing
6. Goalie rotation
7. Manual shift editing
8. Regenerate remaining shifts
9. Import and export
10. Print view

## Definition of Done

The MVP is complete when a coach can:

1. Add the full roster once.
2. Set and change each player’s skill rating.
3. Save the roster locally.
4. Open the app before a game.
5. Select who is present.
6. Generate 8 balanced shifts.
7. See who plays, who sits, and who plays goalie.
8. Make changes when needed.
9. Regenerate future shifts after a player comes out.
10. Print or export the lineup.
