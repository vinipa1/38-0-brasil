import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  LayoutGrid,
  Play,
  RefreshCw,
  Shuffle,
  Shirt,
  Trophy,
  Users,
  X,
} from "lucide-react";

import { formations } from "./data/formations";
import {
  historicalTeams,
  getRandomHistoricalTeamWithPlayers,
  getRandomBrazilianLeagueOpponents,
} from "./data/historicalTeams";
import { getClubById } from "./data/clubs";

function canPlayerFitSlot(player, slot) {
  return player.positions.includes(slot.position);
}

function getTeamsWithPlayers() {
  return historicalTeams.filter((team) => team.players.length > 0);
}

function getRandomTeamFromList(teams) {
  if (!teams.length) return null;

  return teams[Math.floor(Math.random() * teams.length)];
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getAverageFromNumbers(numbers, fallback = 76) {
  if (!numbers.length) return fallback;

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function getLineupSectors(lineup) {
  const defenseItems = lineup.filter((item) =>
    ["GOL", "LD", "ZAG", "LE"].includes(item.slotPosition)
  );
  const midfieldItems = lineup.filter((item) => item.slotPosition === "MC");
  const attackItems = lineup.filter((item) =>
    ["PE", "PD", "CA"].includes(item.slotPosition)
  );

  const defenseAverage = getAverageFromNumbers(
    defenseItems.map((item) => item.player.ovr),
    76
  );
  const midfieldAverage = getAverageFromNumbers(
    midfieldItems.map((item) => item.player.ovr),
    defenseAverage
  );
  const attackAverage = getAverageFromNumbers(
    attackItems.map((item) => item.player.ovr),
    midfieldAverage
  );

  return {
    defense: {
      average: defenseAverage,
      count: defenseItems.length,
    },
    midfield: {
      average: midfieldAverage,
      count: midfieldItems.length,
    },
    attack: {
      average: attackAverage,
      count: attackItems.length,
    },
  };
}

function getHistoricalTeamSectors(team) {
  const players = team.players || [];

  if (!players.length) {
    return {
      defense: { average: team.strength || 76, count: 0 },
      midfield: { average: team.strength || 76, count: 0 },
      attack: { average: team.strength || 76, count: 0 },
    };
  }

  const goalkeepers = players.filter((player) => player.positions.includes("GOL"));
  const defenders = players.filter((player) =>
    player.positions.some((position) => ["LD", "ZAG", "LE"].includes(position))
  );
  const midfielders = players.filter((player) => player.positions.includes("MC"));
  const attackers = players.filter((player) =>
    player.positions.some((position) => ["PE", "PD", "CA"].includes(position))
  );

  const defenseAverage = getAverageFromNumbers(
    [...goalkeepers, ...defenders].map((player) => player.ovr),
    team.strength || 76
  );
  const midfieldAverage = getAverageFromNumbers(
    midfielders.map((player) => player.ovr),
    team.strength || defenseAverage
  );
  const attackAverage = getAverageFromNumbers(
    attackers.map((player) => player.ovr),
    team.strength || midfieldAverage
  );

  return {
    defense: {
      average: defenseAverage,
      count: goalkeepers.length + defenders.length,
    },
    midfield: {
      average: midfieldAverage,
      count: midfielders.length,
    },
    attack: {
      average: attackAverage,
      count: attackers.length,
    },
  };
}

function calculateTeamStrengthFromSectors(sectors) {
  return Math.round(
    sectors.defense.average * 0.35 +
      sectors.midfield.average * 0.3 +
      sectors.attack.average * 0.35
  );
}

function getLineupStrength(lineup) {
  if (!lineup.length) return 75;

  const sectors = getLineupSectors(lineup);
  const averageOvr =
    lineup.reduce((sum, item) => sum + item.player.ovr, 0) / lineup.length;

  const structureBonus =
    Math.min(sectors.defense.count, 5) * 0.16 +
    Math.min(sectors.midfield.count, 4) * 0.14 +
    Math.min(sectors.attack.count, 3) * 0.18;

  const sectorStrength = calculateTeamStrengthFromSectors(sectors);

  return Math.round(
    clampNumber(averageOvr * 0.38 + sectorStrength * 0.62 + structureBonus, 60, 99)
  );
}

function normalizeTeamForSimulation(team) {
  const sectors = team.isUserTeam
    ? getLineupSectors(team.lineup)
    : getHistoricalTeamSectors(team);

  const sectorStrength = calculateTeamStrengthFromSectors(sectors);
  const originalStrength = team.strength || sectorStrength;

  return {
    ...team,
    sectors,
    strength: Math.round(originalStrength * 0.25 + sectorStrength * 0.75),
  };
}

function getTeamAttackStrength(team) {
  const sectors = team.sectors || getHistoricalTeamSectors(team);

  return Math.round(
    sectors.attack.average * 0.58 +
      sectors.midfield.average * 0.28 +
      team.strength * 0.14
  );
}

function getTeamDefenseStrength(team) {
  const sectors = team.sectors || getHistoricalTeamSectors(team);

  return Math.round(
    sectors.defense.average * 0.62 +
      sectors.midfield.average * 0.23 +
      team.strength * 0.15
  );
}

function getTeamControlStrength(team) {
  const sectors = team.sectors || getHistoricalTeamSectors(team);

  return Math.round(
    sectors.midfield.average * 0.56 +
      sectors.attack.average * 0.2 +
      sectors.defense.average * 0.14 +
      team.strength * 0.1
  );
}

function getWeightedRandomItem(items, getWeight) {
  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, getWeight(item)), 0);

  if (totalWeight <= 0) return items[0];

  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= Math.max(0, getWeight(item));

    if (random <= 0) return item;
  }

  return items[items.length - 1];
}

function getScoringWeight(lineupItem) {
  const position = lineupItem.slotPosition;
  const ovr = lineupItem.player.ovr;

  const positionMultiplier = {
    CA: 1.55,
    PE: 1.2,
    PD: 1.2,
    MC: 0.72,
    LD: 0.16,
    LE: 0.16,
    ZAG: 0.08,
    GOL: 0,
  };

  return Math.max(0, (ovr - 58) * (positionMultiplier[position] || 0.2));
}

function getAssistWeight(lineupItem) {
  const position = lineupItem.slotPosition;
  const ovr = lineupItem.player.ovr;

  const positionMultiplier = {
    MC: 1.45,
    PE: 1.15,
    PD: 1.15,
    CA: 0.58,
    LD: 0.45,
    LE: 0.45,
    ZAG: 0.08,
    GOL: 0,
  };

  return Math.max(0, (ovr - 58) * (positionMultiplier[position] || 0.2));
}

function generatePlayerLeaders(lineup, userStanding) {
  const scorerCandidates = lineup.filter((item) =>
    ["CA", "PE", "PD", "MC"].includes(item.slotPosition)
  );

  const assistCandidates = lineup.filter((item) =>
    ["MC", "PE", "PD", "CA", "LD", "LE"].includes(item.slotPosition)
  );

  const scorerItem =
    getWeightedRandomItem(scorerCandidates, getScoringWeight) || lineup[0];

  const assistPoolWithoutScorer = assistCandidates.filter(
    (item) => item.player.id !== scorerItem?.player.id
  );

  const assistItem =
    getWeightedRandomItem(
      assistPoolWithoutScorer.length ? assistPoolWithoutScorer : assistCandidates,
      getAssistWeight
    ) || scorerItem;

  const scorerBaseShare = {
    CA: 0.3,
    PE: 0.23,
    PD: 0.23,
    MC: 0.16,
  }[scorerItem?.slotPosition] || 0.12;

  const assistBaseShare = {
    MC: 0.25,
    PE: 0.2,
    PD: 0.2,
    CA: 0.12,
    LD: 0.1,
    LE: 0.1,
  }[assistItem?.slotPosition] || 0.08;

  const scorerOvrBonus = ((scorerItem?.player.ovr || 80) - 80) / 220;
  const assistOvrBonus = ((assistItem?.player.ovr || 80) - 80) / 240;

  return {
    topScorer: {
      name: scorerItem?.player.name || "Craque do time",
      goals: Math.max(
        5,
        Math.round(
          userStanding.goalsFor *
            clampNumber(scorerBaseShare + scorerOvrBonus + Math.random() * 0.08, 0.12, 0.42)
        )
      ),
    },
    playmaker: {
      name: assistItem?.player.name || "Maestro do time",
      assists: Math.max(
        4,
        Math.round(
          userStanding.goalsFor *
            clampNumber(assistBaseShare + assistOvrBonus + Math.random() * 0.07, 0.08, 0.34)
        )
      ),
    },
  };
}

function getMatchExpectation(attackingTeam, defendingTeam, homeBonus = 0) {
  const attack = getTeamAttackStrength(attackingTeam);
  const defense = getTeamDefenseStrength(defendingTeam);
  const controlGap =
    getTeamControlStrength(attackingTeam) - getTeamControlStrength(defendingTeam);
  const overallGap = attackingTeam.strength - defendingTeam.strength;

  const diff = attack - defense + controlGap * 0.34 + overallGap * 0.24 + homeBonus;

  let expected = 1.18 + diff / 18;

  if (attackingTeam.strength >= 90) expected += 0.12;
  if (attackingTeam.strength >= 94) expected += 0.12;
  if (defendingTeam.strength <= 78) expected += 0.14;

  return clampNumber(expected, 0.2, 3.65);
}

function generateGoalsFromExpected(expectedGoals) {
  const random = Math.random();
  const base = Math.floor(expectedGoals);
  const decimal = expectedGoals - base;

  let goals = base;

  if (Math.random() < decimal) goals += 1;
  if (random < 0.12) goals -= 1;
  if (random > 0.82) goals += 1;
  if (random > 0.96) goals += 1;

  return clampNumber(goals, 0, 5);
}

function generateMatchScore(homeTeam, awayTeam) {
  const homeExpected = getMatchExpectation(homeTeam, awayTeam, 1.6);
  const awayExpected = getMatchExpectation(awayTeam, homeTeam, 0);

  let homeGoals = generateGoalsFromExpected(homeExpected);
  let awayGoals = generateGoalsFromExpected(awayExpected);

  const strengthGap = homeTeam.strength - awayTeam.strength;
  const expectedGap = homeExpected - awayExpected;

  if (strengthGap >= 7 && homeGoals < awayGoals && Math.random() < 0.58) {
    homeGoals = awayGoals;
  }

  if (strengthGap <= -7 && homeGoals > awayGoals && Math.random() < 0.56) {
    awayGoals = homeGoals;
  }

  if (strengthGap >= 11 && homeGoals === awayGoals && Math.random() < 0.42) {
    homeGoals += 1;
  }

  if (strengthGap <= -11 && homeGoals === awayGoals && Math.random() < 0.38) {
    awayGoals += 1;
  }

  if (expectedGap >= 0.9 && homeGoals < awayGoals && Math.random() < 0.72) {
    homeGoals = awayGoals;
  }

  if (expectedGap <= -0.9 && homeGoals > awayGoals && Math.random() < 0.7) {
    awayGoals = homeGoals;
  }

  return {
    homeGoals,
    awayGoals,
  };
}


function createEmptyStanding(team) {
  return {
    id: team.id,
    label: team.label,
    club: team.club,
    clubId: team.clubId,
    era: team.era,
    type: team.type,
    strength: team.strength,
    sectors: team.sectors,
    isUserTeam: team.isUserTeam || false,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

function applyMatchToStandings(standings, homeTeam, awayTeam, homeGoals, awayGoals) {
  const home = standings[homeTeam.id];
  const away = standings[awayTeam.id];

  home.played += 1;
  away.played += 1;

  home.goalsFor += homeGoals;
  home.goalsAgainst += awayGoals;
  away.goalsFor += awayGoals;
  away.goalsAgainst += homeGoals;

  if (homeGoals > awayGoals) {
    home.wins += 1;
    home.points += 3;
    away.losses += 1;
  } else if (awayGoals > homeGoals) {
    away.wins += 1;
    away.points += 3;
    home.losses += 1;
  } else {
    home.draws += 1;
    away.draws += 1;
    home.points += 1;
    away.points += 1;
  }

  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;
}

function simulateBrazilianLeague(lineup, formation) {
  const userStrength = getLineupStrength(lineup);

  const userTeam = normalizeTeamForSimulation({
    id: "user-xi",
    clubId: "user-xi",
    club: "Seu XI",
    label: "Seu XI Histórico",
    era: formation.name,
    type: "Draft",
    strength: userStrength,
    isUserTeam: true,
    lineup,
  });

  const opponents = getRandomBrazilianLeagueOpponents(19).map((team) =>
    normalizeTeamForSimulation(team)
  );
  const leagueTeams = [userTeam, ...opponents];

  const standingsMap = Object.fromEntries(
    leagueTeams.map((team) => [team.id, createEmptyStanding(team)])
  );

  const userMatches = [];

  for (let i = 0; i < leagueTeams.length; i += 1) {
    for (let j = i + 1; j < leagueTeams.length; j += 1) {
      const homeTeam = leagueTeams[i];
      const awayTeam = leagueTeams[j];

      const { homeGoals, awayGoals } = generateMatchScore(homeTeam, awayTeam);

      applyMatchToStandings(standingsMap, homeTeam, awayTeam, homeGoals, awayGoals);

      if (homeTeam.isUserTeam || awayTeam.isUserTeam) {
        userMatches.push({
          round: userMatches.length + 1,
          home: homeTeam.label,
          away: awayTeam.label,
          homeGoals,
          awayGoals,
          opponent: homeTeam.isUserTeam ? awayTeam.label : homeTeam.label,
          userGoals: homeTeam.isUserTeam ? homeGoals : awayGoals,
          opponentGoals: homeTeam.isUserTeam ? awayGoals : homeGoals,
          result:
            (homeTeam.isUserTeam ? homeGoals : awayGoals) >
            (homeTeam.isUserTeam ? awayGoals : homeGoals)
              ? "V"
              : (homeTeam.isUserTeam ? homeGoals : awayGoals) ===
                (homeTeam.isUserTeam ? awayGoals : homeGoals)
              ? "E"
              : "D",
        });
      }

      const reverseHomeTeam = awayTeam;
      const reverseAwayTeam = homeTeam;

      const {
        homeGoals: reverseHomeGoals,
        awayGoals: reverseAwayGoals,
      } = generateMatchScore(reverseHomeTeam, reverseAwayTeam);

      applyMatchToStandings(
        standingsMap,
        reverseHomeTeam,
        reverseAwayTeam,
        reverseHomeGoals,
        reverseAwayGoals
      );

      if (reverseHomeTeam.isUserTeam || reverseAwayTeam.isUserTeam) {
        userMatches.push({
          round: userMatches.length + 1,
          home: reverseHomeTeam.label,
          away: reverseAwayTeam.label,
          homeGoals: reverseHomeGoals,
          awayGoals: reverseAwayGoals,
          opponent: reverseHomeTeam.isUserTeam
            ? reverseAwayTeam.label
            : reverseHomeTeam.label,
          userGoals: reverseHomeTeam.isUserTeam ? reverseHomeGoals : reverseAwayGoals,
          opponentGoals: reverseHomeTeam.isUserTeam
            ? reverseAwayGoals
            : reverseHomeGoals,
          result:
            (reverseHomeTeam.isUserTeam ? reverseHomeGoals : reverseAwayGoals) >
            (reverseHomeTeam.isUserTeam ? reverseAwayGoals : reverseHomeGoals)
              ? "V"
              : (reverseHomeTeam.isUserTeam ? reverseHomeGoals : reverseAwayGoals) ===
                (reverseHomeTeam.isUserTeam ? reverseAwayGoals : reverseHomeGoals)
              ? "E"
              : "D",
        });
      }
    }
  }

  const table = Object.values(standingsMap).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });

  const userStanding = table.find((team) => team.isUserTeam);
  const userPosition = table.findIndex((team) => team.isUserTeam) + 1;

  const leaders = generatePlayerLeaders(lineup, userStanding);

  return {
    table,
    userStanding,
    userPosition,
    userMatches,
    userStrength,
    userSectors: userTeam.sectors,
    ...leaders,
  };
}


function DraftSectorPanel({ lineup }) {
  const sectors = getLineupSectors(lineup);
  const strength = getLineupStrength(lineup);

  const sectorItems = [
    {
      label: "DEF",
      value: sectors.defense.count ? Math.round(sectors.defense.average) : "—",
      count: sectors.defense.count,
    },
    {
      label: "MEI",
      value: sectors.midfield.count ? Math.round(sectors.midfield.average) : "—",
      count: sectors.midfield.count,
    },
    {
      label: "ATA",
      value: sectors.attack.count ? Math.round(sectors.attack.average) : "—",
      count: sectors.attack.count,
    },
    {
      label: "GERAL",
      value: lineup.length ? strength : "—",
      count: lineup.length,
    },
  ];

  return (
    <div className="mx-auto mb-5 grid max-w-xl grid-cols-4 gap-2">
      {sectorItems.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-white/10 bg-black/25 px-2 py-3 text-center backdrop-blur"
        >
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">
            {item.label}
          </p>
          <p className="mt-1 text-xl font-black text-white sm:text-2xl">
            {item.value}
          </p>
          <p className="mt-0.5 text-[9px] font-bold text-slate-500 sm:text-[10px]">
            {item.count} jogador{item.count === 1 ? "" : "es"}
          </p>
        </div>
      ))}
    </div>
  );
}

function TeamKitIcon({ clubId, size = "md", label = null }) {
  const club = getClubById(clubId);

  if (!club) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-xs font-black text-white">
        ?
      </div>
    );
  }

  const sizeClasses = {
    xs: "h-8 w-8 text-[8px] rounded-lg",
    sm: "h-9 w-9 text-[9px] rounded-xl",
    md: "h-10 w-10 text-[10px] rounded-xl sm:h-12 sm:w-12 sm:text-xs sm:rounded-2xl",
    lg: "h-10 w-10 text-[9px] rounded-xl sm:h-14 sm:w-14 sm:text-xs sm:rounded-2xl md:h-16 md:w-16 md:text-sm",
  };

  const kit = club.kit;
  const colors = kit.colors;

  let background = kit.baseColor;

  if (kit.type === "horizontal-stripes") {
    background = `repeating-linear-gradient(180deg, ${colors[0]} 0 8px, ${colors[1]} 8px 16px)`;
  }

  if (kit.type === "vertical-stripes") {
    background = `repeating-linear-gradient(90deg, ${colors[0]} 0 10px, ${colors[1]} 10px 20px, ${
      colors[2] || colors[0]
    } 20px 30px)`;
  }

  if (kit.type === "diagonal-sash") {
    background = `linear-gradient(135deg, ${kit.baseColor} 0 42%, ${kit.accentColor} 42% 58%, ${kit.baseColor} 58% 100%)`;
  }

  if (kit.type === "diagonal-stripes") {
    background = `repeating-linear-gradient(135deg, ${colors[0]} 0 12px, ${colors[1]} 12px 24px)`;
  }

  if (kit.type === "split") {
    background = `linear-gradient(90deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
  }

  if (kit.type === "chest-stripes") {
    background = `linear-gradient(180deg, ${kit.baseColor} 0 38%, ${colors[1]} 38% 48%, ${colors[2]} 48% 58%, ${kit.baseColor} 58% 100%)`;
  }

  return (
    <div
      className={`${sizeClasses[size]} relative flex shrink-0 items-center justify-center overflow-hidden border border-white/25 font-black shadow-lg`}
      style={{
        background,
        color: kit.textColor,
      }}
      title={club.name}
    >
      <div className="absolute left-1/2 top-0 h-3 w-5 -translate-x-1/2 rounded-b-full bg-black/20" />
      <span className="relative drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
        {label || club.shortName}
      </span>
    </div>
  );
}


function KitBallIcon({ clubId }) {
  const club = getClubById(clubId);

  if (!club) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-[8px] font-black text-white sm:h-12 sm:w-12 sm:text-[10px]">
        ?
      </div>
    );
  }

  const kit = club.kit;
  const colors = kit.colors;

  let background = kit.baseColor;

  if (kit.type === "horizontal-stripes") {
    background = `repeating-linear-gradient(180deg, ${colors[0]} 0 5px, ${colors[1]} 5px 10px)`;
  }

  if (kit.type === "vertical-stripes") {
    background = `repeating-linear-gradient(90deg, ${colors[0]} 0 6px, ${colors[1]} 6px 12px, ${
      colors[2] || colors[0]
    } 12px 18px)`;
  }

  if (kit.type === "diagonal-sash") {
    background = `linear-gradient(135deg, ${kit.baseColor} 0 40%, ${kit.accentColor} 40% 60%, ${kit.baseColor} 60% 100%)`;
  }

  if (kit.type === "diagonal-stripes") {
    background = `repeating-linear-gradient(135deg, ${colors[0]} 0 8px, ${colors[1]} 8px 16px)`;
  }

  if (kit.type === "split") {
    background = `linear-gradient(90deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
  }

  if (kit.type === "chest-stripes") {
    background = `linear-gradient(180deg, ${kit.baseColor} 0 38%, ${colors[1]} 38% 48%, ${colors[2]} 48% 58%, ${kit.baseColor} 58% 100%)`;
  }

  return (
    <div
      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-white/25 shadow-lg sm:h-12 sm:w-12"
      style={{ background }}
      title={club.name}
    >
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.45),transparent_34%)]" />
      <span
        className="relative text-[7px] font-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:text-[9px]"
        style={{ color: kit.textColor }}
      >
        {club.shortName}
      </span>
    </div>
  );
}

function FormationMiniPreview({ formation }) {
  return (
    <div className="relative mt-5 h-56 overflow-hidden rounded-3xl border border-white/10 bg-emerald-950/60">
      <div className="absolute inset-3 rounded-2xl border border-emerald-300/25" />
      <div className="absolute left-1/2 top-3 h-10 w-20 -translate-x-1/2 rounded-b-full border border-emerald-300/25 border-t-0" />
      <div className="absolute bottom-3 left-1/2 h-10 w-20 -translate-x-1/2 rounded-t-full border border-emerald-300/25 border-b-0" />
      <div className="absolute left-3 right-3 top-1/2 border-t border-emerald-300/20" />

      {formation.slots.map((slot, index) => (
        <div
          key={`${formation.id}-${slot.id}-${index}`}
          className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-emerald-200/40 bg-emerald-400 text-[10px] font-black text-emerald-950 shadow-lg"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
          }}
          title={slot.position}
        >
          {slot.position}
        </div>
      ))}
    </div>
  );
}

function TacticalPitch({
  formation,
  lineup,
  pendingSelection,
  onHighlightedSlotClick,
}) {
  const highlightedSlotIndexes =
    pendingSelection?.compatibleSlots.map((slot) => slot.index) || [];

  return (
    <div className="relative min-h-[410px] overflow-hidden rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.22),_rgba(6,20,13,0.95))] p-3 sm:min-h-[520px] sm:rounded-[2rem] sm:p-4">
      <div className="absolute inset-3 rounded-[1.25rem] border-2 border-emerald-200/20 sm:inset-4 sm:rounded-[1.5rem]" />
      <div className="absolute left-1/2 top-3 h-14 w-28 -translate-x-1/2 rounded-b-full border-2 border-emerald-200/20 border-t-0 sm:top-4 sm:h-20 sm:w-40" />
      <div className="absolute bottom-3 left-1/2 h-14 w-28 -translate-x-1/2 rounded-t-full border-2 border-emerald-200/20 border-b-0 sm:bottom-4 sm:h-20 sm:w-40" />
      <div className="absolute left-3 right-3 top-1/2 border-t-2 border-emerald-200/15 sm:left-4 sm:right-4" />
      <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-200/15 sm:h-28 sm:w-28" />

      {formation.slots.map((slot, index) => {
        const lineupItem = lineup.find((item) => item.slotIndex === index);
        const player = lineupItem?.player;
        const team = lineupItem?.team;
        const isHighlighted = highlightedSlotIndexes.includes(index);

        return (
          <button
            key={`${formation.id}-${slot.id}-${index}`}
            type="button"
            onClick={() => {
              if (!isHighlighted) return;
              onHighlightedSlotClick({ ...slot, index });
            }}
            disabled={!isHighlighted}
            className={`absolute flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center transition sm:w-24 sm:gap-2 md:w-28 ${
              isHighlighted
                ? "z-20 cursor-pointer scale-110"
                : "cursor-default disabled:opacity-100"
            }`}
            style={{
              left: `${slot.x}%`,
              top: `${slot.y}%`,
            }}
          >
            {player ? (
              <div className="relative">
                <KitBallIcon clubId={team.clubId} />
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-emerald-100 bg-emerald-400 text-[8px] font-black text-emerald-950 shadow-lg sm:h-7 sm:w-7 sm:text-[9px]">
                  {player.ovr}
                </span>
              </div>
            ) : (
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-[9px] font-black shadow-xl transition sm:h-12 sm:w-12 sm:text-[11px] md:h-14 md:w-14 md:text-xs ${
                  isHighlighted
                    ? "border-yellow-200 bg-yellow-300 text-yellow-950 shadow-[0_0_32px_rgba(253,224,71,0.65)]"
                    : "border-white/20 bg-black/40 text-slate-300"
                }`}
              >
                {slot.position}
              </div>
            )}

            <div
              className={`w-fit max-w-[82px] rounded-md border px-1 py-[2px] backdrop-blur transition sm:max-w-[108px] sm:rounded-lg sm:px-1.5 sm:py-0.5 ${
                isHighlighted
                  ? "border-yellow-200 bg-yellow-300/20"
                  : player
                  ? "border-emerald-300/30 bg-emerald-400/15"
                  : "border-white/10 bg-black/30"
              }`}
            >
              <p className="truncate whitespace-nowrap text-[8px] font-black leading-none sm:text-[10px] md:text-[11px]">
                {player ? player.name : isHighlighted ? "Aqui" : "Vazio"}
              </p>
              <p className="hidden">
                {player ? team.label : slot.position}
              </p>
            </div>
          </button>
        );
      })}

      {pendingSelection && (
        <div className="absolute bottom-4 left-1/2 z-30 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-yellow-200/30 bg-black/75 p-3 text-center backdrop-blur sm:bottom-6 sm:w-[calc(100%-3rem)] sm:p-4">
          <p className="text-sm font-bold text-yellow-100">
            Escolha no campinho onde escalar {pendingSelection.player.name}.
          </p>
          <p className="mt-1 text-xs text-slate-300">
            As posições compatíveis estão destacadas em amarelo.
          </p>
        </div>
      )}
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState("home");
  const [selectedFormation, setSelectedFormation] = useState(null);
  const [lineup, setLineup] = useState([]);
  const [currentTeam, setCurrentTeam] = useState(null);
  const [rollingTeam, setRollingTeam] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const [pendingSelection, setPendingSelection] = useState(null);
  const [leagueResult, setLeagueResult] = useState(null);
  const [copiedResult, setCopiedResult] = useState(false);

  const openSlots = useMemo(() => {
    if (!selectedFormation) return [];

    return selectedFormation.slots
      .map((slot, index) => ({
        ...slot,
        index,
        player: lineup.find((item) => item.slotIndex === index)?.player || null,
      }))
      .filter((slot) => !slot.player);
  }, [selectedFormation, lineup]);

  const availablePlayers = useMemo(() => {
    if (!currentTeam) return [];

    const pickedPlayerIds = lineup.map((item) => item.player.id);

    return currentTeam.players
      .filter((player) => !pickedPlayerIds.includes(player.id))
      .map((player) => {
        const compatibleSlots = openSlots.filter((slot) =>
          canPlayerFitSlot(player, slot)
        );

        return {
          ...player,
          compatibleSlots,
          isAvailable: compatibleSlots.length > 0,
        };
      });
  }, [currentTeam, lineup, openSlots]);

  function startDraft() {
    setScreen("formations");
  }

  function goHome() {
    setScreen("home");
    setSelectedFormation(null);
    setLineup([]);
    setCurrentTeam(null);
    setRollingTeam(null);
    setIsRolling(false);
    setPendingSelection(null);
    setLeagueResult(null);
    setCopiedResult(false);
  }

  function chooseFormation(formation) {
    setSelectedFormation(formation);
  }

  function continueToDraft() {
    if (!selectedFormation) return;
    setLineup([]);
    setCurrentTeam(null);
    setRollingTeam(null);
    setIsRolling(false);
    setPendingSelection(null);
    setLeagueResult(null);
    setCopiedResult(false);
    setScreen("draft");
  }

  function drawTeam() {
    if (isRolling) return;

    const teamsWithPlayers = getTeamsWithPlayers();

    if (!teamsWithPlayers.length) {
      setCurrentTeam(null);
      setRollingTeam(null);
      return;
    }

    const finalTeam = getRandomHistoricalTeamWithPlayers();

    setCurrentTeam(null);
    setRollingTeam(null);
    setIsRolling(false);
    setPendingSelection(null);
    setLeagueResult(null);
    setIsRolling(true);

    const rouletteSteps = [60, 70, 80, 95, 110, 130, 155, 185, 220, 260, 310, 380];
    let stepIndex = 0;

    function rollStep() {
      const isLastStep = stepIndex >= rouletteSteps.length;

      if (isLastStep) {
        setRollingTeam(finalTeam);

        window.setTimeout(() => {
          setCurrentTeam(finalTeam);
          setRollingTeam(null);
          setIsRolling(false);
        }, 360);

        return;
      }

      setRollingTeam(getRandomTeamFromList(teamsWithPlayers));
      window.setTimeout(rollStep, rouletteSteps[stepIndex]);
      stepIndex += 1;
    }

    rollStep();
  }

  function addPlayerToSlot(player, slot, team) {
    setLineup((currentLineup) => [
      ...currentLineup,
      {
        slotIndex: slot.index,
        slotPosition: slot.position,
        player,
        team,
      },
    ]);

    setCurrentTeam(null);
    setPendingSelection(null);
  }

  function pickPlayer(player) {
    if (!player.isAvailable || player.compatibleSlots.length === 0) return;

    if (player.compatibleSlots.length === 1) {
      addPlayerToSlot(player, player.compatibleSlots[0], currentTeam);
      return;
    }

    setPendingSelection({
      player,
      team: currentTeam,
      compatibleSlots: player.compatibleSlots,
    });
  }

  function choosePendingSlot(slot) {
    if (!pendingSelection) return;

    addPlayerToSlot(pendingSelection.player, slot, pendingSelection.team);
  }

  function cancelPendingSelection() {
    setPendingSelection(null);
  }

  function restartDraft() {
    setLineup([]);
    setCurrentTeam(null);
    setRollingTeam(null);
    setIsRolling(false);
    setPendingSelection(null);
    setLeagueResult(null);
    setCopiedResult(false);
  }

  function runSimulation() {
    if (!selectedFormation || lineup.length !== selectedFormation.slots.length) return;

    const result = simulateBrazilianLeague(lineup, selectedFormation);
    setLeagueResult(result);
    setCopiedResult(false);
    setScreen("result");
  }

  function buildResultText() {
    if (!leagueResult || !selectedFormation) return "";

    const standing = leagueResult.userStanding;
    const medal =
      leagueResult.userPosition === 1
        ? "🏆 CAMPEÃO"
        : leagueResult.userPosition <= 4
        ? "🔥 G-4"
        : leagueResult.userPosition <= 6
        ? "⭐ Top 6"
        : "⚽ Campanha encerrada";

    const lineupText = selectedFormation.slots
      .map((slot, index) => {
        const lineupItem = lineup.find((item) => item.slotIndex === index);

        if (!lineupItem) return `${slot.position}: Vazio`;

        return `${slot.position}: ${lineupItem.player.name} (${lineupItem.player.ovr})`;
      })
      .join("\n");

    return `38–0 Brasil

${medal}
Formação: ${selectedFormation.name}
Posição final: ${leagueResult.userPosition}º lugar
Setores: DEF ${Math.round(leagueResult.userSectors.defense.average)} / MEI ${Math.round(leagueResult.userSectors.midfield.average)} / ATA ${Math.round(leagueResult.userSectors.attack.average)}

Campanha:
${standing.wins}V ${standing.draws}E ${standing.losses}D — ${standing.points} pts
Gols: ${standing.goalsFor} pró / ${standing.goalsAgainst} contra
Saldo: ${standing.goalDifference}

Destaques:
Artilheiro: ${leagueResult.topScorer.name} — ${leagueResult.topScorer.goals} gols
Garçom: ${leagueResult.playmaker.name} — ${leagueResult.playmaker.assists} assistências

Escalação:
${lineupText}`;
  }

  async function copyResultText() {
    const text = buildResultText();

    try {
      await navigator.clipboard.writeText(text);
      setCopiedResult(true);

      window.setTimeout(() => {
        setCopiedResult(false);
      }, 1800);
    } catch {
      setCopiedResult(false);
    }
  }

  if (screen === "result" && leagueResult) {
    const { userStanding, userPosition, table, userMatches, userStrength } = leagueResult;
    const lastFive = userMatches.slice(-5);

    return (
      <main className="min-h-screen bg-[#06140d] text-white">
        <section className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => setScreen("draft")}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/10"
            >
              <ArrowLeft size={18} />
              Voltar ao draft
            </button>

            <button
              onClick={goHome}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/10"
            >
              <RefreshCw size={16} />
              Jogar de novo
            </button>
          </div>

          <div className="mb-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
              <Trophy size={18} />
              Etapa 3 de 3
            </div>

            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Brasileirão simulado
            </h1>

            <p className="mt-4 max-w-3xl text-lg text-slate-300">
              Seu XI entrou contra 19 elencos históricos sorteados sem repetir clubes.
            </p>
          </div>

          <div className="mb-6 overflow-hidden rounded-[2rem] border border-emerald-300/20 bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.18),_rgba(255,255,255,0.04))] p-5 shadow-[0_0_50px_rgba(16,185,129,0.08)] md:p-7">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-200">
                  Resultado final
                </p>

                <h2 className="mt-3 text-5xl font-black tracking-tight text-white md:text-7xl">
                  {userPosition}º
                </h2>

                <p className="mt-2 text-lg font-bold text-slate-300">
                  {userPosition === 1
                    ? "Campeão do Brasileirão histórico"
                    : userPosition <= 4
                    ? "Campanha de G-4"
                    : userPosition <= 6
                    ? "Campanha forte"
                    : "Campanha encerrada"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[560px]">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Pontos
                  </p>
                  <p className="mt-2 text-3xl font-black text-emerald-300">
                    {userStanding.points}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Campanha
                  </p>
                  <p className="mt-2 text-xl font-black text-white">
                    {userStanding.wins}V {userStanding.draws}E {userStanding.losses}D
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Saldo
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {userStanding.goalDifference}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Força
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {userStrength}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Defesa
                </p>
                <p className="mt-1 text-2xl font-black text-white">
                  {Math.round(leagueResult.userSectors.defense.average)}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Meio
                </p>
                <p className="mt-1 text-2xl font-black text-white">
                  {Math.round(leagueResult.userSectors.midfield.average)}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Ataque
                </p>
                <p className="mt-1 text-2xl font-black text-white">
                  {Math.round(leagueResult.userSectors.attack.average)}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
                  Artilheiro
                </p>
                <p className="mt-2 text-xl font-black">
                  {leagueResult.topScorer.name}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {leagueResult.topScorer.goals} gols
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
                  Garçom
                </p>
                <p className="mt-2 text-xl font-black">
                  {leagueResult.playmaker.name}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {leagueResult.playmaker.assists} assistências
                </p>
              </div>
            </div>

            <button
              onClick={copyResultText}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-300 md:w-auto"
            >
              <Copy size={18} />
              {copiedResult ? "Resumo copiado!" : "Copiar resumo"}
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_0.75fr]">
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04]">
              <div className="border-b border-white/10 p-5">
                <h2 className="text-2xl font-black">Tabela final</h2>
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-black/20 text-xs uppercase tracking-[0.18em] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3 text-center">Pts</th>
                      <th className="px-4 py-3 text-center">J</th>
                      <th className="px-4 py-3 text-center">V</th>
                      <th className="px-4 py-3 text-center">E</th>
                      <th className="px-4 py-3 text-center">D</th>
                      <th className="px-4 py-3 text-center">SG</th>
                      <th className="px-4 py-3 text-center">GP</th>
                      <th className="px-4 py-3 text-center">GC</th>
                    </tr>
                  </thead>

                  <tbody>
                    {table.map((team, index) => (
                      <tr
                        key={team.id}
                        className={`border-t border-white/5 ${
                          team.isUserTeam ? "bg-emerald-400/15" : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-black">{index + 1}</td>
                        <td className="px-4 py-3 font-black">{team.label}</td>
                        <td className="px-4 py-3 text-center font-black">{team.points}</td>
                        <td className="px-4 py-3 text-center">{team.played}</td>
                        <td className="px-4 py-3 text-center">{team.wins}</td>
                        <td className="px-4 py-3 text-center">{team.draws}</td>
                        <td className="px-4 py-3 text-center">{team.losses}</td>
                        <td className="px-4 py-3 text-center">{team.goalDifference}</td>
                        <td className="px-4 py-3 text-center">{team.goalsFor}</td>
                        <td className="px-4 py-3 text-center">{team.goalsAgainst}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-white/10 md:hidden">
                {table.map((team, index) => (
                  <div
                    key={team.id}
                    className={`p-4 ${team.isUserTeam ? "bg-emerald-400/15" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-black">
                          {index + 1}. {team.label}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {team.wins}V {team.draws}E {team.losses}D • SG {team.goalDifference}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-2xl font-black text-emerald-300">
                          {team.points}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                          pts
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                      <div className="rounded-xl bg-black/20 px-2 py-2">
                        <p className="font-black">{team.played}</p>
                        <p className="text-slate-500">J</p>
                      </div>
                      <div className="rounded-xl bg-black/20 px-2 py-2">
                        <p className="font-black">{team.goalsFor}</p>
                        <p className="text-slate-500">GP</p>
                      </div>
                      <div className="rounded-xl bg-black/20 px-2 py-2">
                        <p className="font-black">{team.goalsAgainst}</p>
                        <p className="text-slate-500">GC</p>
                      </div>
                      <div className="rounded-xl bg-black/20 px-2 py-2">
                        <p className="font-black">{team.goalDifference}</p>
                        <p className="text-slate-500">SG</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-2xl font-black">Reta final</h2>

              <div className="mt-4 space-y-3">
                {lastFive.map((match) => (
                  <div
                    key={match.round}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                        Rodada {match.round}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          match.result === "V"
                            ? "bg-emerald-400 text-emerald-950"
                            : match.result === "E"
                            ? "bg-yellow-300 text-yellow-950"
                            : "bg-red-400 text-red-950"
                        }`}
                      >
                        {match.result}
                      </span>
                    </div>

                    <p className="text-sm font-bold">
                      {match.home} {match.homeGoals} x {match.awayGoals} {match.away}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                Esta campanha é única para o XI que você montou. Para tentar outra
                simulação, volte ao início e monte um novo time.
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "draft") {
    const isComplete = lineup.length === selectedFormation.slots.length;
    const hasAnyPlayerDatabase = historicalTeams.some((team) => team.players.length > 0);

    return (
      <main className="min-h-screen bg-[#06140d] text-white">
        <section className="mx-auto max-w-7xl px-6 py-8">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => setScreen("formations")}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/10"
            >
              <ArrowLeft size={18} />
              Voltar
            </button>

            <button
              onClick={restartDraft}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/10"
            >
              <RefreshCw size={16} />
              Reiniciar draft
            </button>
          </div>

          <div className="mb-5 text-center">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">
              {selectedFormation.name} • {lineup.length}/11
            </p>

            <h1 className="mt-2 text-4xl font-black tracking-tight md:text-6xl">
              Monte seu XI
            </h1>

            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
              Role um elenco, escolha um jogador e complete o time.
            </p>
          </div>

          <DraftSectorPanel lineup={lineup} />

          <div className="mx-auto max-w-4xl space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
              {isComplete ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center sm:min-h-[420px]">
                  <Trophy className="mb-5 text-emerald-300" size={54} />
                  <h2 className="text-3xl font-black">XI completo!</h2>
                  <p className="mt-3 max-w-md text-slate-300">
                    Agora é hora de colocar esse time no Brasileirão histórico.
                  </p>

                  <button
                    onClick={runSimulation}
                    className="mt-8 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-7 py-4 font-bold text-emerald-950 transition hover:bg-emerald-300"
                  >
                    <Play size={20} fill="currentColor" />
                    Simular Brasileirão
                  </button>
                </div>
              ) : !hasAnyPlayerDatabase ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center sm:min-h-[420px]">
                  <Shirt className="mb-5 text-emerald-300" size={54} />
                  <h2 className="text-3xl font-black">Base criada</h2>
                  <p className="mt-3 max-w-md text-slate-300">
                    Os elencos históricos já estão cadastrados, mas ainda estão sem
                    jogadores. O próximo passo é preencher os primeiros times com 18
                    jogadores.
                  </p>
                </div>
              ) : isRolling ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center sm:min-h-[420px]">
                  <div className="mb-5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
                    Roletando...
                  </div>

                  <div className="w-full max-w-sm overflow-hidden rounded-[2rem] border border-white/10 bg-black/25 p-5 shadow-[0_0_45px_rgba(16,185,129,0.12)]">
                    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-white/5">
                      {rollingTeam ? (
                        <TeamKitIcon clubId={rollingTeam.clubId} size="lg" />
                      ) : (
                        <Shuffle className="text-emerald-300" size={34} />
                      )}
                    </div>

                    <div className="relative min-h-20 overflow-hidden">
                      <div className="absolute inset-x-0 top-1/2 h-px bg-emerald-300/30" />
                      <h2 className="animate-pulse break-words px-2 text-2xl font-black leading-tight sm:text-3xl">
                        {rollingTeam?.label || "Sorteando..."}
                      </h2>
                      <p className="mt-1 truncate text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                        {rollingTeam?.type || "elenco histórico"}
                      </p>
                    </div>
                  </div>

                  <p className="mt-5 text-sm text-slate-400">
                    Segura... vai cair um elenco.
                  </p>
                </div>
              ) : !currentTeam ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center sm:min-h-[420px]">
                  <Shuffle className="mb-4 text-emerald-300" size={46} />
                  <h2 className="text-3xl font-black">Próximo elenco</h2>
                  <p className="mt-2 max-w-sm text-sm text-slate-400">
                    Sem re-roll. Caiu, escolheu.
                  </p>

                  <button
                    onClick={drawTeam}
                    disabled={isRolling}
                    className="mt-7 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-3xl bg-emerald-400 px-8 py-5 text-xl font-black uppercase tracking-[0.14em] text-emerald-950 shadow-[0_0_35px_rgba(52,211,153,0.22)] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Shuffle size={24} />
                    Rolar
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex items-center gap-3 rounded-3xl border border-white/10 bg-black/20 p-4">
                    <TeamKitIcon clubId={currentTeam.clubId} size="lg" />

                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
                        Caiu
                      </p>
                      <h2 className="break-words text-xl font-black leading-tight sm:text-2xl">
                        {currentTeam.label}
                      </h2>
                      <p className="mt-1 truncate text-xs text-slate-400">
                        {currentTeam.era}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`mb-3 rounded-2xl border p-3 text-sm ${
                      pendingSelection
                        ? "border-yellow-300/30 bg-yellow-300/10 text-yellow-100"
                        : "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    }`}
                  >
                    {pendingSelection ? (
                      <div className="flex items-center justify-between gap-3">
                        <span>
                          Agora clique no campinho para escalar{" "}
                          <strong>{pendingSelection.player.name}</strong>.
                        </span>

                        <button
                          onClick={cancelPendingSelection}
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-slate-200 hover:bg-white/10"
                        >
                          <X size={14} />
                          cancelar
                        </button>
                      </div>
                    ) : (
                      "Escolha 1 jogador para liberar o próximo sorteio."
                    )}
                  </div>

                  <div className="space-y-2">
                    {availablePlayers.map((player) => {
                      const isPendingPlayer = pendingSelection?.player.id === player.id;

                      return (
                        <button
                          key={player.id}
                          onClick={() => pickPlayer(player)}
                          disabled={!player.isAvailable}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                            isPendingPlayer
                              ? "border-yellow-200 bg-yellow-300/15"
                              : player.isAvailable
                              ? "border-white/10 bg-black/20 hover:border-emerald-300/40 hover:bg-emerald-400/10"
                              : "cursor-not-allowed border-white/5 bg-black/10 opacity-40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <h3 className="text-base font-black">{player.name}</h3>
                              <p className="mt-0.5 text-xs text-slate-400">
                                {player.nationality ? `${player.nationality} • ` : ""}
                                {player.positions.join("/")}
                              </p>
                            </div>

                            <div className="text-right">
                              <span className="rounded-full bg-emerald-400 px-3 py-1 text-xs font-black text-emerald-950">
                                OVR {player.ovr}
                              </span>
                              <p className="mt-2 text-xs text-slate-500">
                                {player.isAvailable
                                  ? player.compatibleSlots.length > 1
                                    ? `Clique e escolha no campo`
                                    : `Encaixa em ${player.compatibleSlots[0].position}`
                                  : "Sem posição livre"}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div>
              <TacticalPitch
                formation={selectedFormation}
                lineup={lineup}
                pendingSelection={pendingSelection}
                onHighlightedSlotClick={choosePendingSlot}
              />
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "formations") {
    return (
      <main className="min-h-screen bg-[#06140d] text-white">
        <section className="mx-auto max-w-6xl px-6 py-10">
          <button
            onClick={goHome}
            className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/10"
          >
            <ArrowLeft size={18} />
            Voltar
          </button>

          <div className="mb-10">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
              <LayoutGrid size={18} />
              Etapa 1 de 3
            </div>

            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Escolha sua formação
            </h1>

            <p className="mt-4 max-w-2xl text-lg text-slate-300">
              A formação define quais posições você precisa preencher no draft.
              Depois disso, vamos começar a sortear os elencos históricos.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {formations.map((formation) => {
              const isSelected = selectedFormation?.id === formation.id;

              return (
                <button
                  key={formation.id}
                  onClick={() => chooseFormation(formation)}
                  className={`rounded-3xl border p-6 text-left transition ${
                    isSelected
                      ? "border-emerald-300 bg-emerald-400/15 shadow-[0_0_40px_rgba(52,211,153,0.12)]"
                      : "border-white/10 bg-white/[0.04] hover:border-emerald-300/40 hover:bg-white/[0.07]"
                  }`}
                >
                  <div className="mb-5 flex items-center justify-between">
                    <span className="text-3xl font-black">{formation.name}</span>

                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        isSelected
                          ? "bg-emerald-400 text-emerald-950"
                          : "bg-white/10 text-slate-300"
                      }`}
                    >
                      {isSelected ? <Check size={20} /> : <Shirt size={20} />}
                    </span>
                  </div>

                  <p className="min-h-[48px] text-sm leading-relaxed text-slate-300">
                    {formation.description}
                  </p>

                  <FormationMiniPreview formation={formation} />
                </button>
              );
            })}
          </div>

          {selectedFormation && (
            <div className="mt-8 rounded-3xl border border-emerald-300/20 bg-emerald-400/10 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">
                    Formação selecionada
                  </p>
                  <h2 className="mt-1 text-3xl font-black">
                    {selectedFormation.name}
                  </h2>
                  <p className="mt-2 text-slate-300">
                    Próxima etapa: começar o draft com elencos históricos.
                  </p>
                </div>

                <button
                  onClick={continueToDraft}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-7 py-4 font-bold text-emerald-950 transition hover:bg-emerald-300"
                >
                  <Play size={20} fill="currentColor" />
                  Continuar
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#06140d] text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-6 flex items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
          <Trophy size={18} />
          Versão de testes. Sujeito a bugs, elencos com jogadores errados e overalls não condizentes. Tudo sujeito a mudança.
          
        </div>

        <h1 className="max-w-3xl text-5xl font-black tracking-tight md:text-7xl">
          38–0 Brasil
        </h1>

        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-300 md:text-xl">
          Monte um XI com lendas de várias eras do futebol brasileiro e tente
          fazer a campanha perfeita no Brasileirão.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <button
            onClick={startDraft}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-7 py-4 font-bold text-emerald-950 transition hover:bg-emerald-300"
          >
            <Play size={20} fill="currentColor" />
            Começar Draft
          </button>

          <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-7 py-4 font-bold text-white transition hover:bg-white/10">
            <Shuffle size={20} />
            Ver exemplo
          </button>
        </div>

        <div className="mt-14 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-left">
            <Shirt className="mb-4 text-emerald-300" size={28} />
            <h2 className="text-lg font-bold">Escolha a formação</h2>
            <p className="mt-2 text-sm text-slate-400">
              4-3-3, 4-4-2, 4-2-3-1, 3-5-2 e outras opções.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-left">
            <Shuffle className="mb-4 text-emerald-300" size={28} />
            <h2 className="text-lg font-bold">Sorteie elencos históricos</h2>
            <p className="mt-2 text-sm text-slate-400">
              Mais de 100 elencos históricos, cult e marcantes do futebol brasileiro.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-left">
            <Trophy className="mb-4 text-emerald-300" size={28} />
            <h2 className="text-lg font-bold">Simule o Brasileirão</h2>
            <p className="mt-2 text-sm text-slate-400">
              Seu XI contra 19 times históricos sorteados sem repetir clubes.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
