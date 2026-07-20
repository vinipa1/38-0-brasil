import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import {
  ArrowLeft,
  Check,
  Copy,
  LayoutGrid,
  Moon,
  Play,
  RefreshCw,
  Shuffle,
  Share2,
  Shirt,
  Sun,
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
import { loadOnlineRoom } from "./services/loadOnlineRoom";
import {
  clearActiveRoomCode,
  forgetRememberedRoom,
  getRememberedRoomCode,
  mapRoomStatusToScreen,
  rememberActiveRoomCode,
} from "./services/onlineRoomLocal";




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

function getDraftRerollLimit(gameMode) {
  return gameMode === "expert" ? 1 : 3;
}

function getAlternativeTeamVersions(team) {
  if (!team) return [];

  return getTeamsWithPlayers().filter(
    (candidate) => candidate.clubId === team.clubId && candidate.id !== team.id
  );
}



function normalizePlayerIdentity(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPlayerIdentityKey(player) {
  return player?.playerKey || normalizePlayerIdentity(player?.name || player?.id || "");
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSiteShareUrl() {
  if (typeof window === "undefined") return "38-0 Brasil";

  return window.location.origin;
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





function getMatchExpectation(attackingTeam, defendingTeam, homeBonus = 0) {
  const attack = getTeamAttackStrength(attackingTeam);
  const defense = getTeamDefenseStrength(defendingTeam);
  const controlGap =
    getTeamControlStrength(attackingTeam) - getTeamControlStrength(defendingTeam);
  const overallGap = attackingTeam.strength - defendingTeam.strength;

  const diff = attack - defense + controlGap * 0.3 + overallGap * 0.32 + homeBonus;

  let expected = 1.15 + diff / 17.5;

  // Light home advantage (user requested "leve leve")
  if (homeBonus > 0) {
    expected += 0.08;
  }

  // Strong teams perform better, but not overwhelmingly
  if (attackingTeam.strength >= 88) expected += 0.08;
  if (attackingTeam.strength >= 93) expected += 0.08;

  return clampNumber(expected, 0.25, 3.4);
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
  const homeExpected = getMatchExpectation(homeTeam, awayTeam, 1.35); // leve vantagem mandante
  const awayExpected = getMatchExpectation(awayTeam, homeTeam, 0);

  let homeGoals = generateGoalsFromExpected(homeExpected);
  let awayGoals = generateGoalsFromExpected(awayExpected);

  const strengthGap = homeTeam.strength - awayTeam.strength;
  const expectedGap = homeExpected - awayExpected;

  // Reduced anti-upset logic for more emotion (upsets can happen, but strong teams still favored)
  if (strengthGap >= 8 && homeGoals < awayGoals && Math.random() < 0.35) {
    homeGoals = awayGoals;
  }

  if (strengthGap <= -8 && homeGoals > awayGoals && Math.random() < 0.32) {
    awayGoals = homeGoals;
  }

  if (strengthGap >= 12 && homeGoals === awayGoals && Math.random() < 0.28) {
    homeGoals += 1;
  }

  if (strengthGap <= -12 && homeGoals === awayGoals && Math.random() < 0.25) {
    awayGoals += 1;
  }

  if (expectedGap >= 1.0 && homeGoals < awayGoals && Math.random() < 0.45) {
    homeGoals = awayGoals;
  }

  if (expectedGap <= -1.0 && homeGoals > awayGoals && Math.random() < 0.42) {
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
    isOnlineHumanTeam: team.isOnlineHumanTeam || false,
    ownerParticipantId: team.ownerParticipantId || null,
    playerName: team.playerName || null,
    formationName: team.formationName || null,
    lineup: team.lineup || [],
    players: team.players || [],
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


function createRoundRobinSchedule(teams) {
  const fixedTeams = [...teams];

  if (fixedTeams.length % 2 !== 0) {
    fixedTeams.push(null);
  }

  const teamCount = fixedTeams.length;
  const roundsPerTurn = teamCount - 1;
  const half = teamCount / 2;
  const rotation = [...fixedTeams];
  const firstTurn = [];

  for (let round = 0; round < roundsPerTurn; round += 1) {
    const matches = [];

    for (let index = 0; index < half; index += 1) {
      const teamA = rotation[index];
      const teamB = rotation[teamCount - 1 - index];

      if (!teamA || !teamB) continue;

      const invertHome = round % 2 === 1;
      const homeTeam = invertHome ? teamB : teamA;
      const awayTeam = invertHome ? teamA : teamB;

      matches.push({
        homeTeam,
        awayTeam,
      });
    }

    firstTurn.push(matches);

    const fixed = rotation[0];
    const rest = rotation.slice(1);
    rest.unshift(rest.pop());
    rotation.splice(0, rotation.length, fixed, ...rest);
  }

  const secondTurn = firstTurn.map((roundMatches) =>
    roundMatches.map((match) => ({
      homeTeam: match.awayTeam,
      awayTeam: match.homeTeam,
    }))
  );

  return [...firstTurn, ...secondTurn];
}

function createStandingsFromTeams(teams) {
  return Object.fromEntries(
    teams.map((team) => [team.id, createEmptyStanding(team)])
  );
}

function getSortedTableFromStandingsMap(standingsMap) {
  return Object.values(standingsMap).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });
}

function buildPartialTable(leagueResult, revealedRounds) {
  if (!leagueResult?.rounds?.length) return leagueResult?.table || [];

  const standingsMap = createStandingsFromTeams(leagueResult.leagueTeams || []);
  const roundsToApply = leagueResult.rounds.slice(0, revealedRounds);

  roundsToApply.forEach((round) => {
    round.matches.forEach((match) => {
      applyMatchToStandings(
        standingsMap,
        match.homeTeam,
        match.awayTeam,
        match.homeGoals,
        match.awayGoals
      );
    });
  });

  return getSortedTableFromStandingsMap(standingsMap);
}

function getPartialUserStanding(leagueResult, revealedRounds) {
  const partialTable = buildPartialTable(leagueResult, revealedRounds);
  const userStanding = partialTable.find((team) => team.isUserTeam);
  const userPosition = partialTable.findIndex((team) => team.isUserTeam) + 1;

  return {
    table: partialTable,
    standing: userStanding,
    position: userPosition || "—",
  };
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
  const schedule = createRoundRobinSchedule(leagueTeams);
  const standingsMap = createStandingsFromTeams(leagueTeams);

  const rounds = [];
  const userMatches = [];

  schedule.forEach((roundMatches, roundIndex) => {
    const roundNumber = roundIndex + 1;
    const simulatedMatches = roundMatches.map(({ homeTeam, awayTeam }) => {
      const { homeGoals, awayGoals } = generateMatchScore(homeTeam, awayTeam);

      applyMatchToStandings(standingsMap, homeTeam, awayTeam, homeGoals, awayGoals);

      const match = {
        round: roundNumber,
        homeTeam,
        awayTeam,
        home: homeTeam.label,
        away: awayTeam.label,
        homeGoals,
        awayGoals,
        homePlayers: homeTeam.isUserTeam ? [] : homeTeam.players || [],
        awayPlayers: awayTeam.isUserTeam ? [] : awayTeam.players || [],
        hasHumanTeam: Boolean(homeTeam.isUserTeam || awayTeam.isUserTeam),
      };

      match.events = generateOnlineMatchEvents(match);

      if (homeTeam.isUserTeam || awayTeam.isUserTeam) {
        const userGoals = homeTeam.isUserTeam ? homeGoals : awayGoals;
        const opponentGoals = homeTeam.isUserTeam ? awayGoals : homeGoals;

        userMatches.push({
          ...match,
          opponent: homeTeam.isUserTeam ? awayTeam.label : homeTeam.label,
          userGoals,
          opponentGoals,
          result:
            userGoals > opponentGoals
              ? "V"
              : userGoals === opponentGoals
              ? "E"
              : "D",
        });
      }

      return match;
    });

    rounds.push({
      round: roundNumber,
      matches: simulatedMatches,
    });
  });

  const table = getSortedTableFromStandingsMap(standingsMap);
  const enrichedUserMatches = enrichUserMatchesWithEvents(userMatches, lineup, leagueTeams);
  const userStanding = table.find((team) => team.isUserTeam);
  const userPosition = table.findIndex((team) => team.isUserTeam) + 1;

  const leaders = getPartialCampaignLeaders(enrichedUserMatches);

  return {
    leagueTeams,
    rounds,
    table,
    userStanding,
    userPosition,
    userMatches: enrichedUserMatches,
    userStrength,
    userSectors: userTeam.sectors,
    ...leaders,
  };
}


function DraftSectorPanel({ lineup, revealValues = true }) {
  const sectors = getLineupSectors(lineup);
  const strength = getLineupStrength(lineup);

  const sectorItems = [
    {
      label: "DEF",
      value: revealValues && sectors.defense.count ? Math.round(sectors.defense.average) : "?",
      count: sectors.defense.count,
    },
    {
      label: "MEI",
      value: revealValues && sectors.midfield.count ? Math.round(sectors.midfield.average) : "?",
      count: sectors.midfield.count,
    },
    {
      label: "ATA",
      value: revealValues && sectors.attack.count ? Math.round(sectors.attack.average) : "?",
      count: sectors.attack.count,
    },
    {
      label: "GERAL",
      value: revealValues && lineup.length ? strength : "?",
      count: lineup.length,
    },
  ];

  return (
    <div className="mx-auto mb-5 grid max-w-xl grid-cols-4 gap-2">
      {sectorItems.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-slate-900/10 bg-white/80 px-2 py-3 text-center backdrop-blur"
        >
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]">
            {item.label}
          </p>
          <p className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">
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
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-xs font-black text-slate-950">
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
      <div className="absolute left-1/2 top-0 h-3 w-5 -translate-x-1/2 rounded-b-full bg-white/75" />
      <span className="relative drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
        {label || club.shortName}
      </span>
    </div>
  );
}


function KitBallIcon({ clubId, overall = null }) {
  const club = getClubById(clubId);

  if (!club) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[8px] font-black text-slate-950 sm:h-12 sm:w-12 sm:text-[10px]">
        {overall ?? "?"}
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
      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-[3px] border-slate-950 shadow-lg sm:h-12 sm:w-12"
      style={{ background }}
      title={club.name}
    >
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.42),transparent_36%)]" />
      {overall ? (
        <span
          className="overall-badge-number relative flex h-6 min-w-6 items-center justify-center rounded-full bg-white/92 px-1.5 text-[10px] font-black leading-none text-slate-950 shadow-[0_3px_10px_rgba(15,23,42,0.22)] ring-1 ring-black/10 sm:h-7 sm:min-w-7 sm:text-xs"
        >
          {overall}
        </span>
      ) : (
        <span
          className="relative text-[7px] font-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] sm:text-[9px]"
          style={{ color: kit.textColor }}
        >
          {club.shortName}
        </span>
      )}
    </div>
  );
}

function FormationMiniPreview({ formation }) {
  return (
    <div className="relative mt-5 h-56 overflow-hidden rounded-3xl border border-slate-900/10 bg-emerald-950/60">
      <div className="absolute inset-3 rounded-2xl border border-emerald-300/25" />
      <div className="absolute left-1/2 top-3 h-10 w-20 -translate-x-1/2 rounded-b-full border border-emerald-300/25 border-t-0" />
      <div className="absolute bottom-3 left-1/2 h-10 w-20 -translate-x-1/2 rounded-t-full border border-emerald-300/25 border-b-0" />
      <div className="absolute left-3 right-3 top-1/2 border-t border-emerald-600/20" />

      {formation.slots.map((slot, index) => (
        <div
          key={`${formation.id}-${slot.id}-${index}`}
          className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-emerald-200/40 bg-emerald-300 text-[10px] font-black text-emerald-950 shadow-lg"
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
  revealOveralls = true,
}) {
  const highlightedSlotIndexes =
    pendingSelection?.compatibleSlots.map((slot) => slot.index) || [];

  return (
    <div
      className={`relative min-h-[430px] overflow-hidden rounded-[1.5rem] border border-slate-900/10 p-3 transition sm:min-h-[560px] sm:rounded-[2rem] sm:p-4 ${
        pendingSelection ? "ring-4 ring-yellow-300/70 shadow-[0_0_34px_rgba(253,224,71,0.42)]" : ""
      }`}
      style={{
        background:
          "repeating-linear-gradient(180deg, #2f8556 0 54px, #2b7a4d 54px 108px)",
      }}
    >
      <div className="absolute inset-3 rounded-[1.25rem] border-2 border-white/45 sm:inset-4 sm:rounded-[1.5rem]" />

      <div className="absolute left-1/2 top-3 h-[10%] w-[26%] -translate-x-1/2 border-2 border-white/45 border-t-0 sm:top-4" />
      <div className="absolute left-1/2 top-3 h-[4.5%] w-[11%] -translate-x-1/2 border-2 border-white/45 border-t-0 sm:top-4" />
      <div className="absolute left-1/2 top-[12.5%] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/55" />
      <div
        className="absolute left-1/2 top-[9.3%] h-[8%] w-[18%] -translate-x-1/2 rounded-full border-2 border-white/45"
        style={{ clipPath: "inset(50% 0 0 0)" }}
      />

      <div className="absolute left-1/2 bottom-3 h-[10%] w-[26%] -translate-x-1/2 border-2 border-white/45 border-b-0 sm:bottom-4" />
      <div className="absolute left-1/2 bottom-3 h-[4.5%] w-[11%] -translate-x-1/2 border-2 border-white/45 border-b-0 sm:bottom-4" />
      <div className="absolute left-1/2 bottom-[12.5%] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/55" />
      <div
        className="absolute left-1/2 bottom-[9.3%] h-[8%] w-[18%] -translate-x-1/2 rounded-full border-2 border-white/45"
        style={{ clipPath: "inset(0 0 50% 0)" }}
      />

      <div className="absolute left-3 right-3 top-1/2 border-t-2 border-white/45 sm:left-4 sm:right-4" />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/45 sm:h-36 sm:w-36" />
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/55" />

      <div className="absolute left-3 top-3 h-4 w-4 rounded-tl-[999px] border-l-2 border-t-2 border-white/45 sm:left-4 sm:top-4" />
      <div className="absolute right-3 top-3 h-4 w-4 rounded-tr-[999px] border-r-2 border-t-2 border-white/45 sm:right-4 sm:top-4" />
      <div className="absolute bottom-3 left-3 h-4 w-4 rounded-bl-[999px] border-b-2 border-l-2 border-white/45 sm:bottom-4 sm:left-4" />
      <div className="absolute bottom-3 right-3 h-4 w-4 rounded-br-[999px] border-b-2 border-r-2 border-white/45 sm:bottom-4 sm:right-4" />

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
                <KitBallIcon clubId={team.clubId} overall={revealOveralls ? player.ovr : "?"} />
              </div>
            ) : (
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-[9px] font-black shadow-lg transition sm:h-12 sm:w-12 sm:text-[11px] md:h-14 md:w-14 md:text-xs ${
                  isHighlighted
                    ? "animate-pulse border-yellow-300 bg-yellow-200 text-yellow-950 shadow-[0_0_22px_rgba(253,224,71,0.55)]"
                    : "border-slate-900 bg-white text-slate-950"
                }`}
              >
                {slot.position}
              </div>
            )}

            <div
              className={`w-fit max-w-[92px] rounded-md px-1.5 py-[3px] transition sm:max-w-[116px] sm:px-2 sm:py-1 ${
                isHighlighted
                  ? "bg-yellow-200 text-yellow-950 shadow-[0_4px_10px_rgba(15,23,42,0.18)]"
                  : player
                  ? "bg-white text-slate-950 shadow-[0_4px_10px_rgba(15,23,42,0.18)]"
                  : "bg-white text-slate-950 shadow-[0_4px_10px_rgba(15,23,42,0.12)]"
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
          <p className="text-sm font-bold text-amber-900">
            Escolha no campinho onde escalar {pendingSelection.player.name}.
          </p>
          <p className="mt-1 text-xs text-slate-700">
            As posições compatíveis estão destacadas em amarelo.
          </p>
        </div>
      )}
    </div>
  );
}

function getSeasonRatingBadgeClasses(rating) {
  if (rating === null || rating === undefined || rating === "" || !Number.isFinite(Number(rating))) {
    return "bg-slate-400 text-white";
  }

  const value = Number(rating);
  if (value < 6) return "bg-red-600 text-white";
  if (value < 6.5) return "bg-orange-500 text-white";
  if (value < 7) return "bg-yellow-400 text-slate-950";
  if (value < 8) return "bg-emerald-500 text-white";
  if (value < 9) return "bg-cyan-500 text-white";
  return "bg-blue-600 text-white";
}

function formatSeasonRating(rating) {
  if (rating === null || rating === undefined || rating === "") return "—";
  return Number.isFinite(Number(rating)) ? Number(rating).toFixed(1) : "—";
}

function getOnlineTeamPitchStats({ leagueResult, team, liveRound, liveMinute = 0 }) {
  if (!team?.lineup?.length) return {};

  const storedTeamStats = leagueResult?.playerStats?.[team.id];
  const storedPlayers = storedTeamStats?.players || [];
  const scorerLeaders = leagueResult?.leaderboards?.scorers || [];
  const assistantLeaders = leagueResult?.leaderboards?.assistants || [];
  const liveMatch = (liveRound?.matches || []).find(
    (match) => match.homeTeam?.id === team.id || match.awayTeam?.id === team.id
  );
  const liveEvents = (liveMatch?.events || []).filter(
    (event) => event.type === "goal" && Number(event.minute || 0) <= Number(liveMinute || 0)
  );

  return Object.fromEntries(
    team.lineup.map((lineupItem) => {
      const player = lineupItem.player || {};
      const stored = storedPlayers.find(
        (item) => item.playerId === player.id || item.name === player.name
      );
      const fallbackGoals = scorerLeaders.find(
        (item) => item.name === player.name && item.team === team.label
      )?.total || 0;
      const fallbackAssists = assistantLeaders.find(
        (item) => item.name === player.name && item.team === team.label
      )?.total || 0;
      const liveGoals = liveEvents.filter(
        (event) => event.teamId === team.id &&
          (event.playerId === player.id || (!event.playerId && event.playerName === player.name))
      ).length;
      const liveAssists = liveEvents.filter(
        (event) => event.teamId === team.id &&
          (event.assistId === player.id || (!event.assistId && event.assistName === player.name))
      ).length;

      return [
        player.id,
        {
          goals: Number(stored?.goals ?? fallbackGoals) + liveGoals,
          assists: Number(stored?.assists ?? fallbackAssists) + liveAssists,
          averageRating: stored?.averageRating ?? null,
          lastRating: stored?.lastRating ?? null,
          matches: Number(stored?.matches || 0),
        },
      ];
    })
  );
}

function OnlineSeasonPitch({ formation, lineup, playerStats }) {
  return (
    <div
      className="relative min-h-[430px] overflow-hidden rounded-[1.5rem] border border-slate-900/10 p-3 sm:min-h-[560px] sm:rounded-[2rem] sm:p-4"
      style={{
        background:
          "repeating-linear-gradient(180deg, #2f8556 0 54px, #2b7a4d 54px 108px)",
      }}
    >
      <div className="absolute inset-3 rounded-[1.25rem] border-2 border-white/45 sm:inset-4 sm:rounded-[1.5rem]" />

      <div className="absolute left-1/2 top-3 h-[10%] w-[26%] -translate-x-1/2 border-2 border-white/45 border-t-0 sm:top-4" />
      <div className="absolute left-1/2 top-3 h-[4.5%] w-[11%] -translate-x-1/2 border-2 border-white/45 border-t-0 sm:top-4" />
      <div className="absolute left-1/2 top-[12.5%] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/55" />
      <div
        className="absolute left-1/2 top-[9.3%] h-[8%] w-[18%] -translate-x-1/2 rounded-full border-2 border-white/45"
        style={{ clipPath: "inset(50% 0 0 0)" }}
      />

      <div className="absolute bottom-3 left-1/2 h-[10%] w-[26%] -translate-x-1/2 border-2 border-white/45 border-b-0 sm:bottom-4" />
      <div className="absolute bottom-3 left-1/2 h-[4.5%] w-[11%] -translate-x-1/2 border-2 border-white/45 border-b-0 sm:bottom-4" />
      <div className="absolute bottom-[12.5%] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/55" />
      <div
        className="absolute bottom-[9.3%] left-1/2 h-[8%] w-[18%] -translate-x-1/2 rounded-full border-2 border-white/45"
        style={{ clipPath: "inset(0 0 50% 0)" }}
      />

      <div className="absolute left-3 right-3 top-1/2 border-t-2 border-white/45 sm:left-4 sm:right-4" />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/45 sm:h-36 sm:w-36" />
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/55" />

      <div className="absolute left-3 top-3 h-4 w-4 rounded-tl-[999px] border-l-2 border-t-2 border-white/45 sm:left-4 sm:top-4" />
      <div className="absolute right-3 top-3 h-4 w-4 rounded-tr-[999px] border-r-2 border-t-2 border-white/45 sm:right-4 sm:top-4" />
      <div className="absolute bottom-3 left-3 h-4 w-4 rounded-bl-[999px] border-b-2 border-l-2 border-white/45 sm:bottom-4 sm:left-4" />
      <div className="absolute bottom-3 right-3 h-4 w-4 rounded-br-[999px] border-b-2 border-r-2 border-white/45 sm:bottom-4 sm:right-4" />

      {formation.slots.map((slot, index) => {
        const lineupItem = lineup.find((item) => item.slotIndex === index);
        if (!lineupItem?.player) return null;

        const player = lineupItem.player;
        const stats = playerStats[player.id] || {};
        const displayedY = Math.min(Number(slot.y || 50), 84);

        return (
          <div
            key={`${formation.id}-${slot.id}-${player.id}`}
            className="absolute z-10 flex w-[78px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 text-center sm:w-28 sm:gap-1"
            style={{ left: `${slot.x}%`, top: `${displayedY}%` }}
            title={`${player.name} · ${stats.goals || 0} gols · ${stats.assists || 0} assistências · média ${formatSeasonRating(stats.averageRating)}`}
          >
            <KitBallIcon
              clubId={lineupItem.team?.clubId}
              overall={player.ovr}
            />

            <div className="flex max-w-full items-center justify-center gap-1">
              <span className="max-w-[57px] truncate rounded-md bg-white px-1 py-[3px] text-[7px] font-black leading-none text-slate-950 shadow-[0_4px_10px_rgba(15,23,42,0.18)] sm:max-w-[86px] sm:px-1.5 sm:text-[10px]">
                {player.name}
              </span>
              <span
                className={`min-w-[23px] rounded px-1 py-[3px] text-[7px] font-black leading-none shadow-[0_4px_10px_rgba(15,23,42,0.18)] sm:min-w-[30px] sm:text-[10px] ${getSeasonRatingBadgeClasses(stats.averageRating)}`}
              >
                {formatSeasonRating(stats.averageRating)}
              </span>
            </div>

            <div className="rounded-md bg-slate-950/88 px-1.5 py-[3px] text-[7px] font-black leading-none text-white shadow-[0_4px_10px_rgba(15,23,42,0.22)] sm:px-2 sm:text-[10px]">
              {stats.goals || 0} ⚽&nbsp;&nbsp;{stats.assists || 0} 🅰️
            </div>
          </div>
        );
      })}
    </div>
  );
}


function ThemeStyles() {
  return (
    <style>{`
      .theme-dark {
        background: #07120c;
        color: #f8fafc;
      }

      .theme-dark [class*="bg-[#f7f0df]"] {
        background: #07120c !important;
      }

      .theme-dark [class*="bg-white/"],
      .theme-dark [class*="bg-white"] {
        background-color: rgba(15, 23, 42, 0.72) !important;
      }

      .theme-dark [class*="border-slate-900/10"],
      .theme-dark [class*="border-slate-900/5"] {
        border-color: rgba(255, 255, 255, 0.12) !important;
      }

      .theme-dark [class*="text-slate-950"],
      .theme-dark [class*="text-slate-900"],
      .theme-dark [class*="text-slate-800"] {
        color: #f8fafc !important;
      }

      .theme-dark [class*="text-slate-700"],
      .theme-dark [class*="text-slate-600"] {
        color: #cbd5e1 !important;
      }

      .theme-dark [class*="text-slate-500"] {
        color: #94a3b8 !important;
      }

      .theme-dark [class*="shadow-[0_16px_45px"] {
        box-shadow: 0 18px 55px rgba(0, 0, 0, 0.32) !important;
      }

      .theme-dark [class*="bg-amber-100"],
      .theme-dark [class*="bg-yellow-100"] {
        background-color: rgba(146, 64, 14, 0.22) !important;
      }

      .theme-dark [class*="text-amber-900"] {
        color: #fde68a !important;
      }

      .theme-dark [class*="bg-emerald-300"] {
        background-color: #34d399 !important;
      }

      .theme-dark [class*="text-emerald-950"] {
        color: #052e16 !important;
      }

      .theme-dark .theme-toggle {
        background: rgba(15, 23, 42, 0.82) !important;
        border-color: rgba(255, 255, 255, 0.16) !important;
        color: #f8fafc !important;
      }

      .theme-light .theme-toggle {
        background: rgba(255, 255, 255, 0.82) !important;
        border-color: rgba(15, 23, 42, 0.1) !important;
        color: #0f172a !important;
      }

      .theme-light .overall-badge-number {
        color: #0f172a !important;
        text-shadow: none !important;
      }

      .theme-dark .overall-badge-number {
        color: #ffffff !important;
        text-shadow: 0 1px 2px rgba(0,0,0,0.95), 0 0 1px rgba(0,0,0,0.95) !important;
      }

      .theme-dark .force-dark-text,
      .theme-dark .force-dark-text * {
        color: #0f172a !important;
      }

      .theme-dark .force-dark-text svg {
        color: #0f172a !important;
        stroke: #0f172a !important;
      }

      .theme-dark .force-white-text,
      .theme-dark .force-white-text * {
        color: #f8fafc !important;
      }

      .theme-dark .force-white-text svg {
        color: #f8fafc !important;
        stroke: #f8fafc !important;
      }

      .theme-dark .force-emerald-dark-text,
      .theme-dark .force-emerald-dark-text * {
        color: #064e3b !important;
      }

      .theme-dark .event-minute-badge {
        color: #ffffff !important;
      }

      .theme-dark .force-dark-text [class*="text-blue-"],
      .theme-dark .force-dark-text [class*="text-emerald-"],
      .theme-dark .force-dark-text [class*="text-red-"],
      .theme-dark .force-dark-text [class*="text-yellow-"] {
        color: inherit !important;
      }

      .theme-dark .force-dark-text .event-minute-badge,
      .theme-dark .force-dark-text .leader-total-badge {
        color: #ffffff !important;
      }

      .theme-dark .champion-modal-surface {
        background: #f7f0df !important;
        color: #0f172a !important;
      }

      .theme-dark .champion-modal-surface [class*="bg-white/"],
      .theme-dark .champion-modal-surface [class*="bg-white"] {
        background-color: rgba(255, 255, 255, 0.9) !important;
      }

      .theme-dark .champion-modal-surface [class*="bg-slate-50"] {
        background-color: #f8fafc !important;
      }


      .theme-dark .online-soft-card,
      .theme-dark .online-soft-card *,
      .theme-dark .online-speed-control,
      .theme-dark .online-speed-control *,
      .theme-dark .online-score-pill,
      .theme-dark .online-score-pill * {
        color: #0f172a !important;
      }

      .theme-dark .online-speed-control {
        background: rgba(255, 255, 255, 0.94) !important;
        border-color: rgba(255, 255, 255, 0.22) !important;
      }

      .theme-dark .online-speed-option {
        color: #0f172a !important;
        background: transparent !important;
      }

      .theme-dark .online-speed-option-active {
        color: #064e3b !important;
        background: #34d399 !important;
      }

      .theme-dark .online-score-pill {
        background: #ffffff !important;
        color: #0f172a !important;
        border-color: rgba(15, 23, 42, 0.16) !important;
      }

      .theme-dark .online-match-card-highlight,
      .theme-dark .online-match-card-highlight * {
        color: #0f172a !important;
      }

      .online-table-wide {
        min-width: 360px;
      }

      @media (min-width: 1280px) {
        .online-table-wide {
          min-width: 430px;
        }
      }

      @media (min-width: 1536px) {
        .online-table-wide {
          min-width: 500px;
        }
      }


      .selected-green-card {
        background: #34d399 !important;
        color: #064e3b !important;
        border-color: rgba(16, 185, 129, 0.75) !important;
      }

      .selected-green-card *,
      .theme-dark .selected-green-card,
      .theme-dark .selected-green-card * {
        color: #064e3b !important;
      }

      .selected-green-card .online-score-pill,
      .theme-dark .selected-green-card .online-score-pill {
        background: #052e16 !important;
        color: #ffffff !important;
      }

      .classification-panel-wide {
        min-width: 440px;
      }

      @media (min-width: 1280px) {
        .classification-panel-wide {
          min-width: 520px;
        }
      }

      @media (min-width: 1536px) {
        .classification-panel-wide {
          min-width: 640px;
        }
      }

      .classification-table-scroll {
        overflow-x: auto !important;
      }

      .classification-table-inner {
        min-width: 500px !important;
      }

      .classification-points-cell {
        min-width: 46px !important;
        width: 46px !important;
        text-align: right !important;
        white-space: nowrap !important;
      }

      .classification-team-cell {
        min-width: 170px !important;
        max-width: none !important;
      }

      @media (min-width: 1280px) {
        .classification-team-cell {
          min-width: 230px !important;
        }
      }

      @media (min-width: 1536px) {
        .classification-team-cell {
          min-width: 300px !important;
        }
      }

      .classification-team-name {
        max-width: none !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }


      .classification-panel-wide {
        width: 100% !important;
        min-width: 520px !important;
        max-width: none !important;
      }

      @media (min-width: 1280px) {
        .classification-panel-wide {
          min-width: 620px !important;
        }
      }

      @media (min-width: 1536px) {
        .classification-panel-wide {
          min-width: 720px !important;
        }
      }

      .classification-table-scroll {
        overflow-x: visible !important;
        width: 100% !important;
      }

      .classification-table-inner {
        width: 100% !important;
        min-width: 560px !important;
        table-layout: auto !important;
      }

      .classification-table-inner th,
      .classification-table-inner td {
        white-space: nowrap !important;
      }

      .classification-team-cell,
      .classification-team-name {
        min-width: 220px !important;
        max-width: 320px !important;
        width: auto !important;
      }

      @media (min-width: 1280px) {
        .classification-team-cell,
        .classification-team-name {
          min-width: 280px !important;
          max-width: 420px !important;
        }
      }

      .classification-points-cell {
        min-width: 56px !important;
        width: 56px !important;
        max-width: none !important;
        padding-left: 12px !important;
        padding-right: 12px !important;
        text-align: right !important;
        white-space: nowrap !important;
        overflow: visible !important;
      }

      .leader-card-readable {
        border: 1px solid rgba(16, 185, 129, 0.45) !important;
        box-shadow: 0 14px 32px rgba(5, 150, 105, 0.10) !important;
      }

      .leader-row-readable {
        border: 1px solid rgba(16, 185, 129, 0.22) !important;
      }

      .theme-dark .leader-card-readable {
        border-color: rgba(52, 211, 153, 0.52) !important;
        background: rgba(15, 23, 42, 0.86) !important;
      }

      .theme-dark .leader-row-readable,
      .theme-dark .leader-row-readable * {
        color: #0f172a !important;
      }

      .leader-row-name {
        font-size: 11px !important;
        line-height: 1.05 !important;
        font-weight: 950 !important;
        letter-spacing: -0.01em !important;
      }

      .leader-row-team {
        font-size: 8px !important;
        line-height: 1.05 !important;
        font-weight: 950 !important;
        letter-spacing: 0.08em !important;
      }

      .leader-row-value {
        min-width: 30px !important;
        height: 24px !important;
        font-size: 12px !important;
        font-weight: 950 !important;
      }

      @media (max-width: 900px) {
        .classification-panel-wide {
          min-width: 0 !important;
        }

        .classification-table-scroll {
          overflow-x: auto !important;
        }

        .classification-table-inner {
          min-width: 560px !important;
        }
      }


      .theme-light .highlight-outline-card {
        background: #ffffff !important;
        background-color: #ffffff !important;
        color: #0f172a !important;
        border-color: rgba(16, 185, 129, 0.72) !important;
        box-shadow: inset 4px 0 0 rgba(16, 185, 129, 0.98), 0 10px 24px rgba(15, 23, 42, 0.06) !important;
      }

      .theme-light .highlight-outline-card * {
        color: #0f172a !important;
      }

      .theme-light .highlight-outline-card .highlight-dark-pill,
      .theme-light .highlight-outline-card [class*="bg-slate-950"] {
        background: #020617 !important;
        background-color: #020617 !important;
        color: #ffffff !important;
      }

      .theme-light .highlight-outline-card .highlight-soft-pill,
      .theme-light .highlight-outline-card [class*="bg-emerald"] {
        background: #d1fae5 !important;
        background-color: #d1fae5 !important;
        color: #065f46 !important;
      }

      .theme-dark .highlight-outline-card {
        background: #10b981 !important;
        background-color: #10b981 !important;
        color: #0f172a !important;
        border-color: rgba(52, 211, 153, 0.72) !important;
        box-shadow: 0 12px 28px rgba(16, 185, 129, 0.16) !important;
      }

      .theme-dark .highlight-outline-card * {
        color: #0f172a !important;
      }

      .theme-dark .highlight-outline-card .highlight-dark-pill,
      .theme-dark .highlight-outline-card [class*="bg-slate-950"] {
        background: #020617 !important;
        background-color: #020617 !important;
        color: #ffffff !important;
      }

      .theme-dark .highlight-outline-card .highlight-soft-pill,
      .theme-dark .highlight-outline-card [class*="bg-emerald"] {
        background: rgba(255, 255, 255, 0.28) !important;
        background-color: rgba(255, 255, 255, 0.28) !important;
        color: #064e3b !important;
      }

    `}</style>
  );
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={onToggle}
      className="theme-toggle fixed right-4 top-4 z-50 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] shadow-[0_10px_25px_rgba(15,23,42,0.12)] backdrop-blur transition hover:scale-[1.02] sm:right-6 sm:top-6"
      title={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      <span className="hidden sm:inline">{isDark ? "Claro" : "Escuro"}</span>
    </button>
  );
}


function getPartialCampaignStats(matches) {
  const stats = {
    played: matches.length,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    winStreak: 0,
  };

  matches.forEach((match) => {
    stats.goalsFor += match.userGoals;
    stats.goalsAgainst += match.opponentGoals;

    if (match.result === "V") {
      stats.wins += 1;
      stats.points += 3;
    } else if (match.result === "E") {
      stats.draws += 1;
      stats.points += 1;
    } else {
      stats.losses += 1;
    }
  });

  stats.goalDifference = stats.goalsFor - stats.goalsAgainst;

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index].result !== "V") break;
    stats.winStreak += 1;
  }

  return stats;
}

function getResultBadgeClasses(result) {
  if (result === "V") return "force-dark-text bg-emerald-300 text-emerald-950";
  if (result === "E") return "force-dark-text bg-yellow-300 text-yellow-950";
  return "force-dark-text bg-red-400 text-red-950";
}

function getResultLabel(result) {
  if (result === "V") return "Vitória";
  if (result === "E") return "Empate";
  return "Derrota";
}

function getRandomFormMultiplier(min = 0.82, max = 1.22) {
  return min + Math.random() * (max - min);
}

function getPlayerFormMap(lineup) {
  return Object.fromEntries(
    lineup.map((item) => [
      item.player.id,
      {
        goal: getRandomFormMultiplier(0.78, 1.28),
        assist: getRandomFormMultiplier(0.82, 1.24),
      },
    ])
  );
}

function getHistoricalFormMap(teams = []) {
  const entries = [];

  teams.forEach((team) => {
    (team.players || []).forEach((player) => {
      entries.push([
        player.id,
        {
          goal: getRandomFormMultiplier(0.78, 1.26),
          assist: getRandomFormMultiplier(0.82, 1.22),
        },
      ]);
    });
  });

  return Object.fromEntries(entries);
}

function getUserGoalPositionWeight(position) {
  return {
    CA: 1.28,
    PE: 1.22,
    PD: 1.22,
    MC: 0.88,
    LD: 0.2,
    LE: 0.2,
    ZAG: 0.08,
    GOL: 0,
  }[position] || 0.2;
}

function getUserAssistPositionWeight(position) {
  return {
    MC: 1.45,
    PE: 1.18,
    PD: 1.18,
    CA: 0.62,
    LD: 0.5,
    LE: 0.5,
    ZAG: 0.08,
    GOL: 0,
  }[position] || 0.2;
}

function getWeightedPlayerByPosition(lineup, context = "goal", formMap = {}) {
  const pool = lineup.filter((item) => item.slotPosition !== "GOL");

  return getWeightedRandomItem(pool, (item) => {
    const positionWeight =
      context === "assist"
        ? getUserAssistPositionWeight(item.slotPosition)
        : getUserGoalPositionWeight(item.slotPosition);

    const ovrPower = Math.pow(Math.max(1, item.player.ovr - 64), 1.35);
    const form = formMap[item.player.id]?.[context] || 1;
    const eventNoise = getRandomFormMultiplier(0.86, 1.18);

    return Math.max(1, ovrPower * positionWeight * form * eventNoise);
  });
}

function getHistoricalPlayerPositionWeight(player, context = "goal") {
  const positions = player.positions || [];

  if (context === "assist") {
    if (positions.includes("MC")) return 1.42;
    if (positions.includes("PE") || positions.includes("PD")) return 1.18;
    if (positions.includes("CA")) return 0.6;
    if (positions.includes("LD") || positions.includes("LE")) return 0.48;
    if (positions.includes("ZAG")) return 0.08;
    return 0.15;
  }

  if (positions.includes("CA")) return 1.32;
  if (positions.includes("PE") || positions.includes("PD")) return 1.22;
  if (positions.includes("MC")) return 0.82;
  if (positions.includes("LD") || positions.includes("LE")) return 0.18;
  if (positions.includes("ZAG")) return 0.08;
  return 0;
}

function getWeightedHistoricalScorer(players = [], formMap = {}) {
  const nonGoalkeepers = players.filter((player) => !player.positions?.includes("GOL"));
  const pool = nonGoalkeepers.length ? nonGoalkeepers : players;

  return getWeightedRandomItem(pool, (player) => {
    const ovrPower = Math.pow(Math.max(1, player.ovr - 64), 1.32);
    const positionWeight = getHistoricalPlayerPositionWeight(player, "goal");
    const form = formMap[player.id]?.goal || 1;
    const eventNoise = getRandomFormMultiplier(0.86, 1.18);

    return Math.max(1, ovrPower * positionWeight * form * eventNoise);
  });
}

function getWeightedHistoricalAssistant(players = [], scorer = null, formMap = {}) {
  const candidates = players.filter(
    (player) => !player.positions?.includes("GOL") && player.id !== scorer?.id
  );

  if (!candidates.length) return null;

  return getWeightedRandomItem(candidates, (player) => {
    const ovrPower = Math.pow(Math.max(1, player.ovr - 64), 1.25);
    const positionWeight = getHistoricalPlayerPositionWeight(player, "assist");
    const form = formMap[player.id]?.assist || 1;
    const eventNoise = getRandomFormMultiplier(0.88, 1.16);

    return Math.max(1, ovrPower * positionWeight * form * eventNoise);
  });
}

function getAssistPlayerForGoal(lineup, scorer, formMap = {}) {
  const candidates = lineup.filter((item) => item.player.id !== scorer?.player.id);

  if (!candidates.length) return null;

  return getWeightedPlayerByPosition(candidates, "assist", formMap);
}

function generateGoalEvents(match, lineup, userFormMap = {}, historicalFormMap = {}) {
  const events = [];
  const totalGoals = match.homeGoals + match.awayGoals;
  const usedMinutes = new Set();

  function getMinute(goalIndex) {
    let minute = Math.round(((goalIndex + 1) * 90) / (totalGoals + 1));
    minute += Math.floor(Math.random() * 13) - 6;
    minute = clampNumber(minute, 3, 90);

    while (usedMinutes.has(minute)) {
      minute = clampNumber(minute + 1, 3, 90);
    }

    usedMinutes.add(minute);
    return minute;
  }

  const homeIsUser = match.home === "Seu XI Histórico";
  const awayIsUser = match.away === "Seu XI Histórico";

  function buildGoalEvent(teamName, isUserGoal, teamPlayers = []) {
    if (isUserGoal) {
      const scorer = getWeightedPlayerByPosition(lineup, "goal", userFormMap);
      const assist = getAssistPlayerForGoal(lineup, scorer, userFormMap);

      return {
        minute: getMinute(events.length),
        team: teamName,
        isUserGoal: true,
        scorer: scorer?.player.name || "Seu jogador",
        assist: assist && Math.random() < 0.74 ? assist.player.name : null,
      };
    }

    const scorer = getWeightedHistoricalScorer(teamPlayers, historicalFormMap);
    const assist = getWeightedHistoricalAssistant(teamPlayers, scorer, historicalFormMap);

    return {
      minute: getMinute(events.length),
      team: teamName,
      isUserGoal: false,
      scorer: scorer?.name || `Jogador do ${teamName}`,
      assist: assist && Math.random() < 0.66 ? assist.name : null,
    };
  }

  for (let goal = 0; goal < match.homeGoals; goal += 1) {
    events.push(buildGoalEvent(match.home, homeIsUser, match.homePlayers || []));
  }

  for (let goal = 0; goal < match.awayGoals; goal += 1) {
    events.push(buildGoalEvent(match.away, awayIsUser, match.awayPlayers || []));
  }

  return events.sort((a, b) => a.minute - b.minute);
}

function enrichUserMatchesWithEvents(matches, lineup, leagueTeams = []) {
  const userFormMap = getPlayerFormMap(lineup);
  const historicalFormMap = getHistoricalFormMap(leagueTeams);

  return matches.map((match) => ({
    ...match,
    events: generateGoalEvents(match, lineup, userFormMap, historicalFormMap),
  }));
}

function getPartialCampaignLeaders(matches) {
  const scorers = {};
  const assistants = {};

  matches.forEach((match) => {
    (match.events || []).forEach((event) => {
      if (!event.isUserGoal) return;

      scorers[event.scorer] = (scorers[event.scorer] || 0) + 1;

      if (event.assist) {
        assistants[event.assist] = (assistants[event.assist] || 0) + 1;
      }
    });
  });

  const topScorer = Object.entries(scorers).sort((a, b) => b[1] - a[1])[0];
  const topAssist = Object.entries(assistants).sort((a, b) => b[1] - a[1])[0];

  return {
    topScorer: topScorer
      ? { name: topScorer[0], goals: topScorer[1] }
      : { name: "—", goals: 0 },
    playmaker: topAssist
      ? { name: topAssist[0], assists: topAssist[1] }
      : { name: "—", assists: 0 },
  };
}




function getShareTableWindow(table, userPosition) {
  if (!table?.length) return [];

  const userIndex = Math.max(0, userPosition - 1);
  let start = userIndex - 2;

  if (start < 0) start = 0;
  if (start + 5 > table.length) start = Math.max(0, table.length - 5);

  return table.slice(start, start + 5).map((team, index) => ({
    ...team,
    position: start + index + 1,
  }));
}

function ResultShareCard({ leagueResult, selectedFormation, lineup, siteUrl }) {
  if (!leagueResult || !selectedFormation) return null;

  const { userStanding, userPosition, table } = leagueResult;
  const shareTable = getShareTableWindow(table, userPosition);
  const lineupItems = selectedFormation.slots.map((slot, index) => {
    const lineupItem = lineup.find((item) => item.slotIndex === index);

    return {
      ...slot,
      slotIndex: index,
      player: lineupItem?.player || null,
      team: lineupItem?.team || null,
    };
  });

  const getShortPlayerName = (name) => {
    if (!name) return 'Vazio';
    if (name.length <= 14) return name;

    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 1) return name.slice(0, 14);

    const first = parts[0];
    const last = parts[parts.length - 1];
    const composed = `${first} ${last[0]}.`;

    if (composed.length <= 14) return composed;
    return `${first.slice(0, 12)}.`;
  };

  const getKitBackground = (clubId) => {
    const club = getClubById(clubId);
    if (!club) return '#ffffff';

    const kit = club.kit;
    const colors = kit.colors;
    let background = kit.baseColor;

    if (kit.type === 'horizontal-stripes') {
      background = `repeating-linear-gradient(180deg, ${colors[0]} 0 6px, ${colors[1]} 6px 12px)`;
    }

    if (kit.type === 'vertical-stripes') {
      background = `repeating-linear-gradient(90deg, ${colors[0]} 0 8px, ${colors[1]} 8px 8px, ${colors[1]} 8px 16px, ${colors[2] || colors[0]} 16px 24px)`;
    }

    if (kit.type === 'diagonal-sash') {
      background = `linear-gradient(135deg, ${kit.baseColor} 0 40%, ${kit.accentColor} 40% 60%, ${kit.baseColor} 60% 100%)`;
    }

    if (kit.type === 'diagonal-stripes') {
      background = `repeating-linear-gradient(135deg, ${colors[0]} 0 8px, ${colors[1]} 8px 16px)`;
    }

    if (kit.type === 'split') {
      background = `linear-gradient(90deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
    }

    if (kit.type === 'chest-stripes') {
      background = `linear-gradient(180deg, ${kit.baseColor} 0 38%, ${colors[1]} 38% 48%, ${colors[2]} 48% 58%, ${kit.baseColor} 58% 100%)`;
    }

    return background;
  };

  const getKitTextColor = (clubId) => {
    const club = getClubById(clubId);
    return club?.kit?.textColor || '#0f172a';
  };





  const styles = {
    card: {
      width: 920,
      boxSizing: 'border-box',
      background: 'linear-gradient(180deg, #f7f0df 0%, #efe4c9 100%)',
      color: '#0f172a',
      padding: 28,
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    shell: {
      borderRadius: 34,
      border: '1px solid rgba(15, 23, 42, 0.08)',
      background: 'rgba(255,250,240,0.96)',
      padding: 22,
      boxSizing: 'border-box',
      boxShadow: '0 20px 40px rgba(15, 23, 42, 0.08)',
    },
    brandRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      marginBottom: 18,
    },
    brand: {
      margin: 0,
      color: '#047857',
      fontSize: 13,
      fontWeight: 950,
      textTransform: 'uppercase',
      letterSpacing: 3,
      lineHeight: 1.2,
    },
    brandSub: {
      margin: '6px 0 0',
      color: '#64748b',
      fontSize: 12,
      fontWeight: 800,
      lineHeight: 1.35,
    },
    positionBadge: {
      borderRadius: 999,
      background: '#0f172a',
      color: '#ffffff',
      padding: '10px 14px',
      fontSize: 14,
      fontWeight: 950,
      letterSpacing: 1,
      lineHeight: 1.2,
      flexShrink: 0,
    },
    topGrid: {
      display: 'grid',
      gridTemplateColumns: '1.2fr 0.8fr',
      gap: 16,
      alignItems: 'stretch',
    },
    block: {
      borderRadius: 26,
      background: '#ffffff',
      border: '1px solid rgba(15, 23, 42, 0.06)',
      padding: 20,
      boxSizing: 'border-box',
    },
    blockTitle: {
      margin: 0,
      color: '#0f172a',
      fontSize: 22,
      fontWeight: 950,
      letterSpacing: -0.5,
      lineHeight: 1.18,
    },
    statGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 10,
      marginTop: 14,
    },
    statCard: {
      borderRadius: 18,
      background: '#f7f0df',
      padding: '12px 14px',
      minHeight: 84,
      boxSizing: 'border-box',
    },
    statLabel: {
      margin: 0,
      color: '#64748b',
      fontSize: 10,
      fontWeight: 950,
      textTransform: 'uppercase',
      letterSpacing: 1.6,
      lineHeight: 1.25,
    },
    statValue: {
      margin: '8px 0 0',
      color: '#0f172a',
      fontSize: 20,
      lineHeight: 1.18,
      fontWeight: 950,
      whiteSpace: 'pre-line',
    },
    highlightWrap: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10,
      marginTop: 14,
    },
    highlightCard: {
      borderRadius: 18,
      background: 'linear-gradient(180deg, #dcfce7 0%, #bbf7d0 100%)',
      padding: '14px 14px',
      minHeight: 106,
      boxSizing: 'border-box',
    },
    highlightLabel: {
      margin: 0,
      color: '#047857',
      fontSize: 10,
      fontWeight: 950,
      textTransform: 'uppercase',
      letterSpacing: 1.8,
      lineHeight: 1.25,
    },
    highlightName: {
      margin: '8px 0 0',
      color: '#0f172a',
      fontSize: 17,
      lineHeight: 1.2,
      fontWeight: 950,
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    },
    highlightValue: {
      margin: '6px 0 0',
      color: '#334155',
      fontSize: 13,
      fontWeight: 800,
      lineHeight: 1.25,
    },
    tableList: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      marginTop: 14,
    },
    tableItem: {
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'center',
      gap: 12,
      borderRadius: 18,
      padding: '12px 14px',
      boxSizing: 'border-box',
      minHeight: 52,
    },
    tableText: {
      margin: 0,
      color: '#0f172a',
      fontSize: 13,
      lineHeight: 1.25,
      fontWeight: 900,
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    },
    tablePts: {
      margin: 0,
      flexShrink: 0,
      color: '#0f172a',
      fontSize: 15,
      fontWeight: 950,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
    },
    bottomBlock: {
      borderRadius: 26,
      background: '#ffffff',
      border: '1px solid rgba(15, 23, 42, 0.06)',
      padding: '20px 20px 24px',
      boxSizing: 'border-box',
      marginTop: 16,
    },
    pitchWrapper: {
      marginTop: 14,
      borderRadius: 28,
      overflow: 'hidden',
      border: '1px solid rgba(15, 23, 42, 0.08)',
      background: '#2f8556',
      padding: 10,
      boxSizing: 'border-box',
    },
    pitch: {
      position: 'relative',
      height: 620,
      borderRadius: 20,
      overflow: 'hidden',
      background:
        'repeating-linear-gradient(180deg, #2f8556 0 54px, #2b7a4d 54px 108px)',
      border: '2px solid rgba(255,255,255,0.45)',
      boxSizing: 'border-box',
    },
    pitchLine: {
      position: 'absolute',
      borderColor: 'rgba(255,255,255,0.58)',
      borderStyle: 'solid',
      boxSizing: 'border-box',
    },
    playerWrap: {
      position: 'absolute',
      transform: 'translate(-50%, -50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      width: 116,
      textAlign: 'center',
    },
    playerBallScale: {
      width: 54,
      height: 54,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    playerBall: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 54,
      height: 54,
      borderRadius: '999px',
      border: '4px solid #0f172a',
      boxShadow: '0 8px 16px rgba(15,23,42,0.22)',
      overflow: 'hidden',
    },
    playerBallGlow: {
      position: 'absolute',
      inset: 0,
      borderRadius: '999px',
      background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.28), transparent 34%)',
    },
    playerOverall: {
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 31,
      height: 31,
      padding: '0 5px',
      borderRadius: '999px',
      background: 'rgba(255,255,255,0.92)',
      color: '#0f172a',
      fontSize: 15,
      fontWeight: 950,
      lineHeight: 1,
      boxShadow: '0 3px 10px rgba(15,23,42,0.22)',
      border: '1px solid rgba(15,23,42,0.1)',
    },
    playerLabel: {
      minWidth: 0,
      width: 116,
      maxWidth: 116,
      borderRadius: 0,
      padding: 0,
      boxSizing: 'border-box',
      background: 'transparent',
      border: 'none',
      boxShadow: 'none',
    },
    playerName: {
      margin: 0,
      color: '#ffffff',
      fontSize: 13,
      fontWeight: 950,
      lineHeight: 1.18,
      wordBreak: 'break-word',
      textShadow: '0 2px 3px rgba(0,0,0,0.65)',
    },
    playerPos: {
      display: 'none',
    },
    footer: {
      marginTop: 14,
      textAlign: 'center',
    },
    footerText: {
      margin: 0,
      color: '#94a3b8',
      fontSize: 11,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: 2.2,
      lineHeight: 1.35,
    },
    site: {
      margin: '6px 0 0',
      color: '#047857',
      fontSize: 14,
      fontWeight: 950,
      lineHeight: 1.2,
    },
  };

  return (
    <div style={styles.card}>
      <div style={styles.shell}>
        <div style={styles.brandRow}>
          <div>
            <p style={styles.brand}>38–0 Brasil</p>
            <p style={styles.brandSub}>Resumo compartilhável da sua campanha</p>
          </div>

          <div style={styles.positionBadge}>{userPosition}º lugar</div>
        </div>

        <div style={styles.topGrid}>
          <div style={styles.block}>
            <h2 style={styles.blockTitle}>Resultado + Destaques</h2>

            <div style={styles.statGrid}>
              <div style={styles.statCard}>
                <p style={styles.statLabel}>Campanha</p>
                <p style={styles.statValue}>
                  {userStanding.wins}V {userStanding.draws}E{'\n'}
                  {userStanding.losses}D
                </p>
              </div>

              <div style={styles.statCard}>
                <p style={styles.statLabel}>Gols</p>
                <p style={styles.statValue}>
                  {userStanding.goalsFor} / {userStanding.goalsAgainst}
                </p>
              </div>

              <div style={styles.statCard}>
                <p style={styles.statLabel}>Força</p>
                <p style={styles.statValue}>{leagueResult.userStrength}</p>
              </div>
            </div>

            <div style={styles.highlightWrap}>
              <div style={styles.highlightCard}>
                <p style={styles.highlightLabel}>Artilheiro</p>
                <p style={styles.highlightName}>{leagueResult.topScorer.name}</p>
                <p style={styles.highlightValue}>{leagueResult.topScorer.goals} gols</p>
              </div>

              <div style={styles.highlightCard}>
                <p style={styles.highlightLabel}>Assistente</p>
                <p style={styles.highlightName}>{leagueResult.playmaker.name}</p>
                <p style={styles.highlightValue}>
                  {leagueResult.playmaker.assists} assistências
                </p>
              </div>
            </div>
          </div>

          <div style={styles.block}>
            <h2 style={styles.blockTitle}>Classificação</h2>

            <div style={styles.tableList}>
              {shareTable.map((team) => {
                const isUser = team.isUserTeam;

                return (
                  <div
                    key={team.id}
                    style={{
                      ...styles.tableItem,
                      background: isUser ? '#6ee7b7' : '#f7f0df',
                    }}
                  >
                    <p style={styles.tableText}>
                      {team.position}º {team.label}
                    </p>

                    <p style={styles.tablePts}>{team.points} pts</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={styles.bottomBlock}>
          <h2 style={styles.blockTitle}>Escalação</h2>

          <div style={styles.pitchWrapper}>
            <div style={styles.pitch}>
              <div style={{ ...styles.pitchLine, inset: 12, borderWidth: 2, borderRadius: 20 }} />
              <div style={{ ...styles.pitchLine, left: '50%', top: 12, transform: 'translateX(-50%)', width: 116, height: 54, borderWidth: '0 2px 2px 2px', borderBottomLeftRadius: 58, borderBottomRightRadius: 58 }} />
              <div style={{ ...styles.pitchLine, left: '50%', bottom: 12, transform: 'translateX(-50%)', width: 116, height: 54, borderWidth: '2px 2px 0 2px', borderTopLeftRadius: 58, borderTopRightRadius: 58 }} />
              <div style={{ ...styles.pitchLine, left: 12, right: 12, top: '50%', borderTopWidth: 2 }} />
              <div style={{ ...styles.pitchLine, left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 90, height: 90, borderWidth: 2, borderRadius: '999px' }} />

              {lineupItems.map((item) => {
                const playerName = getShortPlayerName(item.player?.name || item.position);
                const clubId = item.team?.clubId;
                const background = getKitBackground(clubId) || '#ffffff';
                const textColor = getKitTextColor(clubId);
                const club = getClubById(clubId);
                const baseColor = club?.kit?.baseColor || '#ffffff';

                return (
                  <div
                    key={`${selectedFormation.id}-${item.id}-${item.slotIndex}`}
                    style={{
                      ...styles.playerWrap,
                      left: `${item.x}%`,
                      top: `${item.y}%`,
                    }}
                  >
                    <div style={styles.playerBallScale}>
                      <div 
                        style={{ ...styles.playerBall, background, backgroundColor: baseColor }} 
                        className="share-kit-ball" 
                        data-kit-bg={background}
                        data-base-color={baseColor}
                      >
                        <div style={styles.playerBallGlow} />
                        {item.player?.ovr ? (
                          <div style={styles.playerOverall}>{item.player.ovr}</div>
                        ) : (
                          <div style={{ ...styles.playerOverall, color: textColor, background: 'rgba(255,255,255,0.82)' }}>
                            {item.team?.shortName || '?'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={styles.playerLabel}>
                      <p style={styles.playerName}>{playerName}</p>
                      <p style={styles.playerPos}>{item.position}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <p style={styles.footerText}>Monte seu XI. Simule o Brasileirão e tente conquista-lo. Se conseguir, busque o 38–0.</p>
          <p style={styles.site}>{siteUrl || '38-0 Brasil'}</p>
        </div>
      </div>
    </div>
  );
}


const LOGO_LIGHT_SRC = "/logo-38-0-light.png";
const LOGO_DARK_SRC = "/logo-38-0-dark.png";

const PIX_KEY = "bcf96c05-b212-4d13-951a-7e17ee943372";
const PIX_QR_CODE_SRC = "/pix-qrcode.png";

const ONLINE_DEFAULT_CONFIG = {
  roomName: "Sala 38–0",
  teamName: "Meu XI",
  playerName: "Jogador",
  onlineMode: "league",
  draftType: "cards",
  difficulty: "normal",
  pickTime: "30",
  cardsPerTurn: 8,
  picksPerTurn: 1,
  duelFormat: "single",
  duelExtraTime: true,
  duelPenalties: true,
  isPrivate: false,
  roomPassword: "",
};

const ONLINE_LIVE_SPEED_OPTIONS = [
  { value: "turbo", label: "Turbo", interval: 35 },
  { value: "fast", label: "Rápida", interval: 70 },
  { value: "normal", label: "Normal", interval: 95 },
  { value: "slow", label: "Lenta", interval: 200 },
];

function getOnlineLiveSpeedInterval(speed) {
  return ONLINE_LIVE_SPEED_OPTIONS.find((option) => option.value === speed)?.interval || 95;
}

function getLiveMinuteFromStartedAt(
  roundStartedAt,
  speed,
  maxMinute = 90,
  serverClockOffset = 0
) {
  const startedAt = Number(roundStartedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return 0;

  const interval = getOnlineLiveSpeedInterval(speed);
  const safeOffset = Number.isFinite(Number(serverClockOffset))
    ? Number(serverClockOffset)
    : 0;
  const serverSyncedNow = Date.now() + safeOffset;
  const elapsed = serverSyncedNow - startedAt;

  return Math.max(0, Math.min(maxMinute, Math.floor(elapsed / interval)));
}


const ONLINE_DUEL_FORMAT_OPTIONS = [
  { value: "single", label: "Jogo único", description: "Um jogo decide o duelo." },
  { value: "twoLegs", label: "Ida e volta", description: "Dois jogos, um mando para cada lado." },
  { value: "bestOf3", label: "Melhor de 3", description: "Quem vencer 2 jogos leva a série." },
  { value: "bestOf5", label: "Melhor de 5", description: "Quem vencer 3 jogos leva a série." },
];

function getOnlineDuelFormatLabel(format) {
  return ONLINE_DUEL_FORMAT_OPTIONS.find((option) => option.value === format)?.label || "Jogo único";
}

function getOnlineDuelMaxGames(format) {
  if (format === "twoLegs") return 2;
  if (format === "bestOf3") return 3;
  if (format === "bestOf5") return 5;
  return 1;
}

function getOnlineDuelWinsNeeded(format) {
  if (format === "bestOf3") return 2;
  if (format === "bestOf5") return 3;
  return null;
}


function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function getFormationById(formationId) {
  return formations.find((formation) => formation.id === formationId) || formations[0];
}

function getOnlineModeLabel(mode) {
  return mode === "duel" ? "Duelo 1v1" : "Brasileirão Online";
}

function getDraftTypeLabel(type) {
  return type === "teams" ? "Elencos Históricos" : "Cards Aleatórios";
}

function getDifficultyLabel(difficulty) {
  return difficulty === "expert" ? "Especialista" : "Normal";
}

function getPickTimeLabel(value) {
  return value === "none" ? "Sem tempo" : `${value}s`;
}

function shuffleArray(items) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function getAllOnlinePlayerCards() {
  return getTeamsWithPlayers().flatMap((team) =>
    team.players.map((player) => ({
      id: `${team.id}-${player.id}`,
      player,
      team,
      identityKey: getPlayerIdentityKey(player),
    }))
  );
}

function getOnlineCardsFromTeam(team) {
  if (!team) return [];

  return (team.players || []).map((player) => ({
    id: `${team.id}-${player.id}`,
    player,
    team,
    identityKey: getPlayerIdentityKey(player),
  }));
}

function getOnlineOpenSlots(participant, lineupsMap) {
  const formation = getFormationById(participant.formationId);
  const participantLineup = lineupsMap[participant.id] || [];

  return formation.slots
    .map((slot, index) => ({
      ...slot,
      index,
      player: participantLineup.find((item) => item.slotIndex === index)?.player || null,
    }))
    .filter((slot) => !slot.player);
}

function canOnlineCardFitOpenSlot(card, slot) {
  return card.player.positions.includes(slot.position);
}

function getOnlineCardCompatibleSlots(card, openSlots) {
  return openSlots.filter((slot) => canOnlineCardFitOpenSlot(card, slot));
}

function getOnlineCurrentParticipant(order, turnIndex) {
  if (!order.length) return null;

  const roundIndex = Math.floor(turnIndex / order.length);
  const positionInRound = turnIndex % order.length;
  const roundOrder = roundIndex % 2 === 0 ? order : [...order].reverse();

  return roundOrder[positionInRound] || null;
}

function getEligibleOnlineCardsFromPool(pool, openSlots, pickedPlayerKeys) {
  const pickedKeys = new Set(pickedPlayerKeys);

  return pool.filter((card) => {
    if (pickedKeys.has(card.identityKey)) return false;
    return getOnlineCardCompatibleSlots(card, openSlots).length > 0;
  });
}

function dealOnlineRandomCards({ cardsPerTurn, lineupsMap, pickedPlayerKeys, participant }) {
  if (!participant) return [];

  const openSlots = getOnlineOpenSlots(participant, lineupsMap);
  const pool = getEligibleOnlineCardsFromPool(
    getAllOnlinePlayerCards(),
    openSlots,
    pickedPlayerKeys
  );

  return shuffleArray(pool).slice(0, Number(cardsPerTurn) || 8);
}

function dealOnlineRandomHistoricalTeam({ lineupsMap, pickedPlayerKeys, participant }) {
  if (!participant) {
    return {
      team: null,
      cards: [],
    };
  }

  const openSlots = getOnlineOpenSlots(participant, lineupsMap);
  const candidateTeams = shuffleArray(getTeamsWithPlayers())
    .map((team) => {
      const cards = getEligibleOnlineCardsFromPool(
        getOnlineCardsFromTeam(team),
        openSlots,
        pickedPlayerKeys
      );

      return {
        team,
        cards,
      };
    })
    .filter((item) => item.cards.length > 0);

  const selected = candidateTeams[0];

  return {
    team: selected?.team || null,
    cards: selected?.cards || [],
  };
}

function dealOnlineDraftOptions({ room, lineupsMap, pickedPlayerKeys, participant }) {
  if (room?.config?.draftType === "teams") {
    const result = dealOnlineRandomHistoricalTeam({
      lineupsMap,
      pickedPlayerKeys,
      participant,
    });

    return {
      currentTeamOption: result.team,
      currentCards: result.cards,
    };
  }

  return {
    currentTeamOption: null,
    currentCards: dealOnlineRandomCards({
      cardsPerTurn: room?.config?.cardsPerTurn,
      lineupsMap,
      pickedPlayerKeys,
      participant,
    }),
  };
}

function getOnlinePicksNeededThisTurn(participant, lineupsMap, picksPerTurn) {
  if (!participant) return 0;

  const openSlots = getOnlineOpenSlots(participant, lineupsMap);
  return Math.min(Number(picksPerTurn) || 1, openSlots.length);
}

function areOnlineLineupsComplete(order, lineupsMap) {
  return order.every((participant) => {
    const formation = getFormationById(participant.formationId);
    return (lineupsMap[participant.id] || []).length >= formation.slots.length;
  });
}



function getAverageOverallValue(items) {
  if (!items.length) return null;

  return Math.round(
    items.reduce((sum, item) => sum + item.player.ovr, 0) / items.length
  );
}

function getOnlineLineupSummary(lineup, formation = null) {
  const defensePositions = ["GOL", "LD", "ZAG", "LE"];
  const midfieldPositions = ["VOL", "MC", "MEI", "ME", "MD"];
  const attackPositions = ["PE", "PD", "CA", "SA"];

  const defenseItems = lineup.filter((item) => defensePositions.includes(item.slotPosition));
  const midfieldItems = lineup.filter((item) => midfieldPositions.includes(item.slotPosition));
  const attackItems = lineup.filter((item) => attackPositions.includes(item.slotPosition));

  const totalSlots = formation?.slots?.length || 11;

  return {
    defense: getAverageOverallValue(defenseItems),
    midfield: getAverageOverallValue(midfieldItems),
    attack: getAverageOverallValue(attackItems),
    overall: getAverageOverallValue(lineup),
    filled: lineup.length,
    total: totalSlots,
    isComplete: lineup.length >= totalSlots,
  };
}

const DATABASE_CHAMPION_442_SLOTS = [
  { id: "gol", label: "GOL", position: "GOL", x: 50, y: 89 },
  { id: "ld", label: "LD", position: "LD", x: 78, y: 72 },
  { id: "zag1", label: "ZAG", position: "ZAG", x: 60, y: 75 },
  { id: "zag2", label: "ZAG", position: "ZAG", x: 40, y: 75 },
  { id: "le", label: "LE", position: "LE", x: 22, y: 72 },
  { id: "md", label: "PD", position: "PD", x: 78, y: 49 },
  { id: "mc1", label: "MC", position: "MC", x: 58, y: 51 },
  { id: "mc2", label: "MC", position: "MC", x: 42, y: 51 },
  { id: "me", label: "PE", position: "PE", x: 22, y: 49 },
  { id: "ca1", label: "CA", position: "CA", x: 42, y: 24 },
  { id: "ca2", label: "CA", position: "CA", x: 58, y: 24 },
];

function getBestUnusedPlayerForPosition(players, position, usedIds) {
  const exactCandidates = players
    .filter((player) => !usedIds.has(player.id) && (player.positions || []).includes(position))
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0));

  if (exactCandidates.length) return exactCandidates[0];

  const fallback = players
    .filter((player) => !usedIds.has(player.id))
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0));

  return fallback[0] || null;
}

function getDatabaseChampionBase442(players = []) {
  const usedIds = new Set();

  return DATABASE_CHAMPION_442_SLOTS.map((slot) => {
    const player = getBestUnusedPlayerForPosition(players, slot.position, usedIds);

    if (player) usedIds.add(player.id);

    return {
      ...slot,
      player,
    };
  }).filter((item) => item.player);
}

function getChampionRosterForModal(champion) {
  if (!champion) return [];

  if (champion.isOnlineHumanTeam && champion.lineup?.length) {
    return champion.lineup
      .slice()
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((item) => ({
        id: item.player.id,
        name: item.player.name,
        position: item.slotPosition,
        ovr: item.player.ovr,
      }));
  }

  return getDatabaseChampionBase442(champion.players || []).map((item) => ({
    id: item.player.id,
    name: item.player.name,
    position: item.label,
    ovr: item.player.ovr,
    x: item.x,
    y: item.y,
  }));
}

function DatabaseChampionFormation({ champion, roster }) {
  return (
    <div className="rounded-[1.5rem] border border-slate-900/10 bg-emerald-950/95 p-3">
      <div className="relative h-[520px] overflow-hidden rounded-[1.25rem] border-2 border-white/35"
        style={{
          background: "repeating-linear-gradient(180deg, #2f8556 0 50px, #2b7a4d 50px 100px)",
        }}
      >
        <div className="absolute inset-3 rounded-2xl border-2 border-white/35" />
        <div className="absolute left-1/2 top-3 h-[11%] w-[34%] -translate-x-1/2 border-2 border-white/35 border-t-0" />
        <div className="absolute left-1/2 bottom-3 h-[11%] w-[34%] -translate-x-1/2 border-2 border-white/35 border-b-0" />
        <div className="absolute left-3 right-3 top-1/2 border-t-2 border-white/35" />
        <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/35" />

        {roster.map((item) => (
          <div
            key={`${champion.id}-${item.id}-${item.position}`}
            className="absolute flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center"
            style={{ left: `${item.x}%`, top: `${item.y}%` }}
          >
            <KitBallIcon clubId={champion.clubId} overall={item.ovr} />
            <div className="max-w-[96px] rounded-xl bg-white px-2 py-1 shadow-[0_5px_14px_rgba(15,23,42,0.18)]">
              <p className="truncate text-[10px] font-black leading-tight text-slate-950">{item.name}</p>
              <p className="text-[8px] font-black uppercase tracking-[0.12em] text-emerald-700">{item.position}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnlineLiveSpeedControl({ value, onChange, compact = false, disabled = false }) {
  return (
    <div className={`rounded-2xl border border-slate-900/10 bg-white/75 ${compact ? "p-2" : "p-3"} ${disabled ? "opacity-60" : ""}`}>
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
        Velocidade da rodada
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {ONLINE_LIVE_SPEED_OPTIONS.map((option) => {
          const isActive = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded-xl px-2 py-2 text-[10px] font-black transition disabled:cursor-not-allowed ${
                isActive
                  ? "force-dark-text bg-emerald-300 text-emerald-950 shadow-[0_8px_18px_rgba(16,185,129,0.18)]"
                  : "bg-slate-50 text-slate-600 hover:bg-white"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OnlineTeamSummaryStats({ summary, revealValues = true, compact = false }) {
  const items = [
    { label: "DEF", value: summary.defense },
    { label: "MEI", value: summary.midfield },
    { label: "ATA", value: summary.attack },
    { label: "GERAL", value: summary.overall },
  ];

  return (
    <div className={`grid grid-cols-4 ${compact ? "gap-1.5" : "gap-2"}`}>
      {items.map((item) => {
        const isOverall = item.label === "GERAL";

        return (
          <div
            key={item.label}
            className={`rounded-2xl text-center ${compact ? "px-2 py-2" : "px-3 py-3"} ${
              isOverall ? "force-dark-text bg-emerald-300 text-emerald-950" : "force-dark-text bg-slate-50 text-slate-950"
            }`}
          >
            <p
              className={`text-[9px] font-black uppercase tracking-[0.14em] ${
                isOverall ? "text-emerald-950/70" : "text-slate-500"
              }`}
            >
              {item.label}
            </p>
            <p
              className={`${compact ? "text-base" : "text-xl"} mt-1 font-black ${
                isOverall ? "text-emerald-950" : "text-slate-950"
              }`}
            >
              {revealValues ? item.value ?? "—" : "?"}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function getStandingZone(position, total = 20) {
  if (position === 1) {
    return {
      key: "campeao-libertadores",
      label: "LIB",
      title: "Líder e zona de Libertadores",
      rowClass: "border-l-4 border-l-yellow-400",
      positionClass: "text-yellow-600",
      pillClass: "bg-blue-50 text-blue-700 ring-blue-100",
      leaderClass: "bg-yellow-100 text-yellow-800 ring-yellow-200",
    };
  }

  if (position <= 6) {
    return {
      key: "libertadores",
      label: "LIB",
      title: "Zona de Libertadores",
      rowClass: "border-l-4 border-l-blue-500",
      positionClass: "text-blue-600",
      pillClass: "bg-blue-50 text-blue-700 ring-blue-100",
      leaderClass: "",
    };
  }

  if (position <= 12) {
    return {
      key: "sulamericana",
      label: "SULA",
      title: "Zona de Sul-Americana",
      rowClass: "border-l-4 border-l-emerald-500",
      positionClass: "text-emerald-600",
      pillClass: "bg-emerald-300 text-emerald-700 ring-emerald-100",
    };
  }

  if (position > Math.max(0, total - 4)) {
    return {
      key: "rebaixamento",
      label: "Z4",
      title: "Zona de rebaixamento",
      rowClass: "border-l-4 border-l-red-500",
      positionClass: "text-red-600",
      pillClass: "bg-red-50 text-red-700 ring-red-100",
    };
  }

  return {
    key: "meio",
    label: "—",
    title: "Meio da tabela",
    rowClass: "border-l-4 border-l-transparent",
    positionClass: "text-slate-500",
    pillClass: "bg-slate-50 text-slate-500 ring-slate-100",
  };
}

function getStandingPercentage(team) {
  if (!team?.played) return 0;

  return Math.round((team.points / (team.played * 3)) * 100);
}

function StandingLegend() {
  const items = [
    { label: "1º líder", className: "bg-yellow-400" },
    { label: "2º–6º Libertadores", className: "bg-blue-500" },
    { label: "7º–12º Sul-Americana", className: "bg-emerald-3000" },
    { label: "17º–20º Rebaixamento", className: "bg-red-500" },
  ];

  return (
    <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
      {items.map((item) => (
        <span
          key={item.label}
          className="force-white-text inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 ring-1 ring-slate-900/5"
        >
          <span className={`h-2 w-2 rounded-full ${item.className}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function LeagueStandingsTable({
  table,
  limit = null,
  highlightUser = false,
  highlightHuman = false,
  compact = false,
  emptyMessage = "A classificação aparece depois da primeira rodada.",
}) {
  const displayedTable = limit ? table.slice(0, limit) : table;

  if (!displayedTable.length) {
    return (
      <p className="rounded-2xl bg-white/80 px-4 py-4 text-sm font-bold text-slate-500">
        {emptyMessage}
      </p>
    );
  }

  if (compact) {
    return (
      <div className="space-y-3">
        <StandingLegend />

        <div className="rounded-[1.5rem] border border-slate-900/10 bg-white/75 p-2 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
          <div className="grid grid-cols-[42px_minmax(0,1fr)_64px] gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            <span>#</span>
            <span>Time</span>
            <span className="text-right">P</span>
          </div>

          <div className="mt-2 grid gap-1.5">
            {displayedTable.map((team, index) => {
              const position = index + 1;
              const zone = getStandingZone(position, table.length || 20);
              const isHighlighted =
                (highlightUser && team.isUserTeam) ||
                (highlightHuman && team.isOnlineHumanTeam);

              return (
                <div
                  key={team.id}
                  className={`grid grid-cols-[42px_minmax(0,1fr)_64px] items-center gap-2 rounded-2xl border px-3 py-3 text-sm transition ${
                    isHighlighted
                      ? "highlight-outline-card border-emerald-400 bg-white text-slate-950 shadow-[0_10px_24px_rgba(16,185,129,0.08)]"
                      : "border-slate-900/10 bg-white/80 text-slate-950"
                  }`}
                >
                  <span className={`font-black ${isHighlighted ? "text-slate-950" : zone.positionClass}`}>{position}</span>

                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className={`truncate text-sm font-black ${isHighlighted ? "text-slate-950" : "text-slate-950"}`} title={team.label}>
                        {team.label}
                      </p>
                      {isHighlighted && (
                        <span className="highlight-soft-pill shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-200">
                          Seu
                        </span>
                      )}
                    </div>
                    {team.isOnlineHumanTeam && team.playerName && (
                      <p className={`mt-0.5 truncate text-[10px] font-bold ${isHighlighted ? "text-slate-500" : "text-slate-500"}`}>
                        Player: {team.playerName}
                      </p>
                    )}
                  </div>

                  <span className={`text-right text-base font-black ${isHighlighted ? "text-slate-950" : "text-slate-950"}`}>
                    {team.points}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {limit && table.length > limit && (
          <p className="text-center text-[11px] font-bold text-slate-500">
            Mostrando top {limit}. A tabela completa aparece na classificação final.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <StandingLegend />

      <div className="overflow-hidden rounded-[1.5rem] border border-slate-900/10 bg-white/75 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
        <div className="hidden md:block">
          <div className="force-dark-text grid grid-cols-[52px_minmax(170px,1fr)_58px_44px_44px_44px_44px_54px_54px_54px_58px] border-b border-slate-900/10 bg-slate-50/85 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            <span>#</span>
            <span>Time</span>
            <span className="text-center">P</span>
            <span className="text-center">J</span>
            <span className="text-center">V</span>
            <span className="text-center">E</span>
            <span className="text-center">D</span>
            <span className="text-center">GP</span>
            <span className="text-center">GC</span>
            <span className="text-center">SG</span>
            <span className="text-center">%</span>
          </div>

          <div className="divide-y divide-slate-900/8">
            {displayedTable.map((team, index) => {
              const position = index + 1;
              const zone = getStandingZone(position, table.length || 20);
              const isHighlighted =
                (highlightUser && team.isUserTeam) ||
                (highlightHuman && team.isOnlineHumanTeam);

              return (
                <div
                  key={team.id}
                  className={`grid grid-cols-[52px_minmax(170px,1fr)_58px_44px_44px_44px_44px_54px_54px_54px_58px] items-center px-4 py-3 text-sm transition ${zone.rowClass} ${
                    isHighlighted ? "highlight-outline-card bg-white" : "bg-white/55 hover:bg-white/85"
                  }`}
                >
                  <span className={`font-black ${zone.positionClass}`}>{position}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="classification-team-name truncate font-black text-slate-950">{team.label}</p>
                      {isHighlighted && (
                        <span className="highlight-soft-pill rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700">
                          Seu
                        </span>
                      )}
                    </div>
                    {team.isOnlineHumanTeam && team.playerName && (
                      <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500">
                        Player: {team.playerName}
                      </p>
                    )}
                  </div>
                  <span className="classification-points-cell text-center text-base font-black text-slate-950">{team.points}</span>
                  <span className="text-center font-bold text-slate-600">{team.played}</span>
                  <span className="text-center font-bold text-slate-600">{team.wins}</span>
                  <span className="text-center font-bold text-slate-600">{team.draws}</span>
                  <span className="text-center font-bold text-slate-600">{team.losses}</span>
                  <span className="text-center font-bold text-slate-600">{team.goalsFor}</span>
                  <span className="text-center font-bold text-slate-600">{team.goalsAgainst}</span>
                  <span className={`text-center font-black ${team.goalDifference >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {team.goalDifference > 0 ? `+${team.goalDifference}` : team.goalDifference}
                  </span>
                  <span className="text-center font-black text-slate-700">{getStandingPercentage(team)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="divide-y divide-slate-900/10 md:hidden">
          {displayedTable.map((team, index) => {
            const position = index + 1;
            const zone = getStandingZone(position, table.length || 20);
            const isHighlighted =
              (highlightUser && team.isUserTeam) ||
              (highlightHuman && team.isOnlineHumanTeam);

            return (
              <div
                key={team.id}
                className={`p-4 ${zone.rowClass} ${isHighlighted ? "highlight-outline-card bg-white" : "bg-white/60"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-base font-black ${zone.positionClass}`}>{position}</span>
                      <p className="classification-team-name truncate text-base font-black text-slate-950">{team.label}</p>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {isHighlighted && (
                        <span className="highlight-soft-pill rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700">
                          Seu time
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="classification-points-cell text-2xl font-black text-slate-950">{team.points}</p>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">pts</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-7 gap-1 rounded-2xl bg-slate-50/90 p-2 text-center text-[11px] font-black">
                  <div><p className="text-slate-500">J</p><p>{team.played}</p></div>
                  <div><p className="text-slate-500">V</p><p>{team.wins}</p></div>
                  <div><p className="text-slate-500">E</p><p>{team.draws}</p></div>
                  <div><p className="text-slate-500">D</p><p>{team.losses}</p></div>
                  <div><p className="text-slate-500">GP</p><p>{team.goalsFor}</p></div>
                  <div><p className="text-slate-500">GC</p><p>{team.goalsAgainst}</p></div>
                  <div><p className="text-slate-500">SG</p><p className={team.goalDifference >= 0 ? "text-emerald-700" : "text-red-600"}>{team.goalDifference > 0 ? `+${team.goalDifference}` : team.goalDifference}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {limit && table.length > limit && (
        <p className="text-center text-[11px] font-bold text-slate-500">
          Mostrando top {limit}. A tabela completa aparece na classificação final.
        </p>
      )}
    </div>
  );
}


function createOnlineSimulationTeam(participant, lineup) {
  const formation = getFormationById(participant.formationId);
  const strength = getLineupStrength(lineup);

  return normalizeTeamForSimulation({
    id: `online-${participant.id}`,
    clubId: `online-${participant.id}`,
    club: participant.teamName,
    label: participant.teamName,
    era: formation.name,
    type: "Player",
    strength,
    isUserTeam: false,
    isOnlineHumanTeam: true,
    ownerParticipantId: participant.id,
    playerName: participant.playerName,
    formationName: formation.name,
    lineup,
  });
}

function buildOnlineLeagueDatabasePayload(quantity) {
  return getRandomBrazilianLeagueOpponents(quantity).map((team) => ({
    id: team.id,
    clubId: team.clubId,
    club: team.club,
    label: team.label,
    era: team.era,
    type: team.type,
    strength: team.strength,
    players: (team.players || []).map((player) => ({
      id: player.id,
      name: player.name,
      ovr: player.ovr,
      positions: player.positions || [],
    })),
  }));
}

function simulateOnlineBrazilianLeague(room, draftOrder, lineupsMap) {
  const humanTeams = draftOrder.map((participant) =>
    createOnlineSimulationTeam(participant, lineupsMap[participant.id] || [])
  );
  const databaseTeamsNeeded = Math.max(0, 20 - humanTeams.length);
  const databaseTeams = getRandomBrazilianLeagueOpponents(databaseTeamsNeeded).map((team) =>
    normalizeTeamForSimulation(team)
  );
  const leagueTeams = [...humanTeams, ...databaseTeams];
  const schedule = createRoundRobinSchedule(leagueTeams);
  const standingsMap = createStandingsFromTeams(leagueTeams);

  const rounds = schedule.map((roundMatches, roundIndex) => {
    const roundNumber = roundIndex + 1;
    const simulatedMatches = roundMatches.map(({ homeTeam, awayTeam }) => {
      const { homeGoals, awayGoals } = generateMatchScore(homeTeam, awayTeam);

      applyMatchToStandings(standingsMap, homeTeam, awayTeam, homeGoals, awayGoals);

      const match = {
        round: roundNumber,
        homeTeam,
        awayTeam,
        home: homeTeam.label,
        away: awayTeam.label,
        homeGoals,
        awayGoals,
        hasHumanTeam: Boolean(homeTeam.isOnlineHumanTeam || awayTeam.isOnlineHumanTeam),
      };

      return {
        ...match,
        events: generateOnlineMatchEvents(match),
      };
    });

    return {
      round: roundNumber,
      matches: simulatedMatches,
    };
  });

  const table = getSortedTableFromStandingsMap(standingsMap);

  return {
    room,
    leagueTeams,
    humanTeams,
    rounds,
    table,
  };
}

function slimLeagueTeamForFirestore(team) {
  if (!team) return null;

  return {
    id: team.id,
    clubId: team.clubId,
    club: team.club,
    label: team.label,
    era: team.era,
    type: team.type,
    strength: team.strength,
    isUserTeam: team.isUserTeam ?? null,
    isOnlineHumanTeam: team.isOnlineHumanTeam ?? null,
    ownerParticipantId: team.ownerParticipantId ?? null,
    playerName: team.playerName ?? null,
    formationName: team.formationName ?? null,
    lineup: (team.lineup || []).map((item) => ({
      slotIndex: item.slotIndex,
      slotPosition: item.slotPosition,
      player: {
        id: item.player?.id,
        name: item.player?.name,
        ovr: item.player?.ovr,
        positions: item.player?.positions || [],
      },
      team: {
        clubId: item.team?.clubId,
        label: item.team?.label,
        club: item.team?.club,
      },
    })),
    players: (team.players || []).map((player) => ({
      id: player.id,
      name: player.name,
      ovr: player.ovr,
      positions: player.positions || [],
    })),
  };
}

function slimLeagueEventForFirestore(event) {
  if (!event) return null;

  return {
    id: event.id,
    type: event.type,
    icon: event.icon,
    minute: event.minute,
    side: event.side,
    teamId: event.teamId,
    teamLabel: event.teamLabel,
    title: event.title,
    description: event.description,
    playerId: event.playerId || null,
    playerName: event.playerName || null,
    assistId: event.assistId || null,
    assistName: event.assistName || null,
  };
}

function slimLeagueResultForFirestore(result) {
  if (!result) return null;

  return {
    leagueTeams: (result.leagueTeams || []).map(slimLeagueTeamForFirestore),
    table: (result.table || []).map((entry) => ({
      id: entry.id,
      label: entry.label,
      clubId: entry.clubId,
      points: entry.points,
      wins: entry.wins,
      draws: entry.draws,
      losses: entry.losses,
      goalsFor: entry.goalsFor,
      goalsAgainst: entry.goalsAgainst,
      goalDifference: entry.goalDifference,
      isOnlineHumanTeam: entry.isOnlineHumanTeam ?? null,
      ownerParticipantId: entry.ownerParticipantId ?? null,
      playerName: entry.playerName ?? null,
    })),
    rounds: (result.rounds || []).map((round) => ({
      round: round.round,
      matches: (round.matches || []).map((match) => ({
        round: match.round,
        homeTeamId: match.homeTeam?.id ?? null,
        awayTeamId: match.awayTeam?.id ?? null,
        home: match.home,
        away: match.away,
        homeGoals: match.homeGoals,
        awayGoals: match.awayGoals,
        hasHumanTeam: match.hasHumanTeam,
        events: (match.events || []).map(slimLeagueEventForFirestore),
      })),
    })),
    _slim: true,
  };
}

function hydrateLeagueResultFromFirestore(stored) {
  if (!stored) return null;
  if (!stored._slim) {
    return {
      ...stored,
      humanTeams: (stored.humanTeams || stored.leagueTeams || []).filter(
        (team) => team.isOnlineHumanTeam
      ),
    };
  }

  const teamById = Object.fromEntries(
    (stored.leagueTeams || []).map((team) => [team.id, team])
  );

  const hydrated = {
    ...stored,
    rounds: (stored.rounds || []).map((round) => ({
      ...round,
      matches: (round.matches || []).map((match) => ({
        ...match,
        homeTeam: teamById[match.homeTeamId],
        awayTeam: teamById[match.awayTeamId],
      })),
    })),
  };

  hydrated.humanTeams = (hydrated.leagueTeams || []).filter((team) => team.isOnlineHumanTeam);

  return hydrated;
}

function shouldStayOnOnlineSetupScreen(currentScreen) {
  return ["online-home", "online-setup", "online-join", "online-matchmaking"].includes(currentScreen);
}

function getOnlineScreenForRoom(room) {
  return mapRoomStatusToScreen(room?.status);
}

function getLiveMinuteFromRoomSnapshot(room, liveState, maxMinute = 90) {
  if (!liveState) return 0;

  const speed = room?.liveSpeed || "normal";
  const interval = getOnlineLiveSpeedInterval(speed);
  const confirmedMinute = Math.max(
    0,
    Math.min(maxMinute, Number(liveState.minute || 0))
  );

  const fromServerClock = liveState.roundStartedAt
    ? getLiveMinuteFromStartedAt(
        liveState.roundStartedAt,
        speed,
        maxMinute,
        room?._serverClockOffset || 0
      )
    : confirmedMinute;

  const receivedAt = Number(room?._receivedAt);
  const elapsedSinceSnapshot = Number.isFinite(receivedAt)
    ? Math.max(0, Date.now() - receivedAt)
    : 0;
  const fromSnapshotClock = confirmedMinute + Math.floor(elapsedSinceSnapshot / interval);

  return Math.max(
    confirmedMinute,
    Math.min(maxMinute, fromServerClock),
    Math.min(maxMinute, fromSnapshotClock)
  );
}

function buildOnlineLiveRoundFromRoom(room) {
  if (room?.status !== "league" || !room.liveRound) return null;

  const leagueResult = hydrateLeagueResultFromFirestore(room.leagueResult);
  const round = leagueResult?.rounds?.find((entry) => entry.round === room.liveRound.roundNumber);

  if (!round) return null;

  return {
    round,
    minute: getLiveMinuteFromRoomSnapshot(room, room.liveRound, 90),
    roundStartedAt: room.liveRound.roundStartedAt || null,
  };
}

function buildOnlineDuelLiveFromRoom(room) {
  if (room?.status !== "duel" || !room.duelLive || !room.duelResult?.matches?.length) return null;

  const match = room.duelResult.matches[room.duelLive.matchIndex];
  if (!match) return null;

  const endMinute = getDuelLiveEndMinute(match);

  return {
    match,
    matchIndex: room.duelLive.matchIndex,
    minute: getLiveMinuteFromRoomSnapshot(room, room.duelLive, endMinute),
    roundStartedAt: room.duelLive.roundStartedAt || null,
    isFinished: Boolean(room.duelLive.isFinished),
  };
}

function getPartialOnlineLeagueTable(onlineLeagueResult, revealedRounds) {
  if (!onlineLeagueResult?.rounds?.length) return [];

  const standingsMap = createStandingsFromTeams(onlineLeagueResult.leagueTeams || []);
  const roundsToApply = onlineLeagueResult.rounds.slice(0, revealedRounds);

  roundsToApply.forEach((round) => {
    round.matches.forEach((match) => {
      applyMatchToStandings(
        standingsMap,
        match.homeTeam,
        match.awayTeam,
        match.homeGoals,
        match.awayGoals
      );
    });
  });

  return getSortedTableFromStandingsMap(standingsMap);
}

function getHumanOnlineRanking(table) {
  return table
    .filter((team) => team.isOnlineHumanTeam)
    .map((team) => ({
      ...team,
      overallPosition: table.findIndex((tableTeam) => tableTeam.id === team.id) + 1,
    }));
}


function getOnlineTeamPlayersForEvents(team) {
  if (team?.lineup?.length) {
    return team.lineup.map((item) => ({
      id: item.player.id,
      name: item.player.name,
      ovr: item.player.ovr,
      positions: [item.slotPosition, ...(item.player.positions || [])],
    }));
  }

  return team?.players || [];
}

function getOnlineEventPlayerWeight(player, context = "goal") {
  const positions = player.positions || [];
  const ovrPower = Math.max(1, (player.ovr || 75) - 60);

  if (context === "card") {
    if (positions.includes("ZAG")) return ovrPower * 1.35;
    if (positions.includes("LD") || positions.includes("LE")) return ovrPower * 1.15;
    if (positions.includes("MC")) return ovrPower * 1.05;
    if (positions.includes("GOL")) return ovrPower * 0.08;
    return ovrPower * 0.55;
  }

  if (context === "assist") {
    if (positions.includes("MC")) return ovrPower * 1.45;
    if (positions.includes("PE") || positions.includes("PD")) return ovrPower * 1.18;
    if (positions.includes("LD") || positions.includes("LE")) return ovrPower * 0.58;
    if (positions.includes("CA")) return ovrPower * 0.52;
    return ovrPower * 0.16;
  }

  if (positions.includes("CA")) return ovrPower * 1.5;
  if (positions.includes("PE") || positions.includes("PD")) return ovrPower * 1.22;
  if (positions.includes("MC")) return ovrPower * 0.78;
  if (positions.includes("LD") || positions.includes("LE")) return ovrPower * 0.18;
  if (positions.includes("ZAG")) return ovrPower * 0.08;
  return 0;
}

function pickOnlineEventPlayer(team, context = "goal", blockedId = null) {
  const players = getOnlineTeamPlayersForEvents(team).filter((player) => player.id !== blockedId);
  const nonGoalkeepers = players.filter((player) => !(player.positions || []).includes("GOL"));
  const pool = nonGoalkeepers.length ? nonGoalkeepers : players;

  if (!pool.length) return null;

  return getWeightedRandomItem(pool, (player) => getOnlineEventPlayerWeight(player, context));
}

function getUniqueEventMinute(usedMinutes, min = 2, max = 90) {
  let minute = Math.floor(min + Math.random() * (max - min + 1));
  let guard = 0;

  while (usedMinutes.has(minute) && guard < 120) {
    minute = minute >= max ? min : minute + 1;
    guard += 1;
  }

  usedMinutes.add(minute);
  return minute;
}

function getOnlineGoalDescription(scorer, assist) {
  const scorerName = scorer?.name || "O atacante";
  const assistName = assist?.name || null;

  const assistedTemplates = [
    `${assistName} acha ${scorerName} na área, e ele finaliza no canto.`,
    `${assistName} levanta na medida e ${scorerName} aparece para completar.`,
    `${assistName} puxa o ataque e deixa ${scorerName} em ótima condição para marcar.`,
    `${assistName} cruza com precisão, ${scorerName} sobe firme e manda para o gol.`,
  ];

  const soloTemplates = [
    `${scorerName} recebe perto da área, ajeita o corpo e bate colocado.`,
    `${scorerName} aproveita sobra na entrada da área e finaliza sem chance.`,
    `${scorerName} ganha da marcação e toca na saída do goleiro.`,
    `${scorerName} aparece no momento certo e empurra para o fundo da rede.`,
  ];

  const templates = assistName ? assistedTemplates : soloTemplates;
  return templates[Math.floor(Math.random() * templates.length)];
}

function generateOnlineMatchEvents(match) {
  const events = [];
  const usedMinutes = new Set();
  const totalGoals = match.homeGoals + match.awayGoals;

  function goalMinute(goalIndex) {
    let minute = Math.round(((goalIndex + 1) * 90) / (totalGoals + 1));
    minute += Math.floor(Math.random() * 15) - 7;
    minute = clampNumber(minute, 3, 90);

    while (usedMinutes.has(minute)) {
      minute = clampNumber(minute + 1, 3, 90);
    }

    usedMinutes.add(minute);
    return minute;
  }

  function addGoal(side, goalIndex) {
    const team = side === "home" ? match.homeTeam : match.awayTeam;
    const scorer = pickOnlineEventPlayer(team, "goal");
    const assist = Math.random() < 0.7 ? pickOnlineEventPlayer(team, "assist", scorer?.id) : null;

    events.push({
      id: `${match.round}-${match.homeTeam.id}-${match.awayTeam.id}-${side}-goal-${goalIndex}`,
      type: "goal",
      icon: "⚽",
      minute: goalMinute(events.filter((event) => event.type === "goal").length),
      side,
      teamId: team.id,
      teamLabel: team.label,
      title: `Gol de ${scorer?.name || team.label}`,
      description: getOnlineGoalDescription(scorer, assist),
      playerId: scorer?.id || null,
      playerName: scorer?.name || null,
      assistId: assist?.id || null,
      assistName: assist?.name || null,
    });
  }

  for (let goal = 0; goal < match.homeGoals; goal += 1) addGoal("home", goal);
  for (let goal = 0; goal < match.awayGoals; goal += 1) addGoal("away", goal);

  return events.sort((a, b) => a.minute - b.minute);
}

function createOnlineExtraGoalEvent(match, side, minute, index) {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  const scorer = pickOnlineEventPlayer(team, "goal");
  const assist = Math.random() < 0.62 ? pickOnlineEventPlayer(team, "assist", scorer?.id) : null;

  return {
    id: `${match.round}-${match.homeTeam.id}-${match.awayTeam.id}-extra-${side}-${index}`,
    type: "goal",
    icon: "⚽",
    minute,
    side,
    teamId: team.id,
    teamLabel: team.label,
    title: `Gol de ${scorer?.name || team.label} na prorrogação`,
    description: getOnlineGoalDescription(scorer, assist),
    playerId: scorer?.id || null,
    playerName: scorer?.name || null,
    assistId: assist?.id || null,
    assistName: assist?.name || null,
    phase: "extraTime",
  };
}

function addExtraTimeToDuelMatch(match, homeExtraGoals = 0, awayExtraGoals = 0) {
  const extraEvents = [];
  const usedExtraMinutes = new Set();

  function getExtraMinute(goalIndex) {
    let minute = 96 + goalIndex * 8 + Math.floor(Math.random() * 7);
    minute = clampNumber(minute, 91, 120);

    while (usedExtraMinutes.has(minute)) {
      minute = clampNumber(minute + 1, 91, 120);
    }

    usedExtraMinutes.add(minute);
    return minute;
  }

  for (let index = 0; index < homeExtraGoals; index += 1) {
    extraEvents.push(createOnlineExtraGoalEvent(match, "home", getExtraMinute(extraEvents.length), index));
  }

  for (let index = 0; index < awayExtraGoals; index += 1) {
    extraEvents.push(createOnlineExtraGoalEvent(match, "away", getExtraMinute(extraEvents.length), index));
  }

  return {
    ...match,
    extraTimeGoals: {
      homeGoals: homeExtraGoals,
      awayGoals: awayExtraGoals,
    },
    events: [...(match.events || []), ...extraEvents].sort((a, b) => a.minute - b.minute),
  };
}

function getPenaltyTaker(team, index) {
  const players = getOnlineTeamPlayersForEvents(team).filter((player) => !player.positions?.includes("GOL"));
  const ordered = [...players].sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
  return ordered[index % Math.max(1, ordered.length)] || ordered[0] || { name: team.label };
}

function generatePenaltyShootout(homeTeam, awayTeam) {
  const attempts = [];
  let homeGoals = 0;
  let awayGoals = 0;

  for (let index = 0; index < 5; index += 1) {
    const homeTaker = getPenaltyTaker(homeTeam, index);
    const homeScored = Math.random() < 0.76;
    if (homeScored) homeGoals += 1;
    attempts.push({
      order: attempts.length,
      side: "home",
      teamId: homeTeam.id,
      teamLabel: homeTeam.label,
      taker: homeTaker?.name || homeTeam.label,
      scored: homeScored,
      title: homeScored ? "Gol!" : "Perdeu!",
      description: homeScored
        ? `${homeTaker?.name || homeTeam.label} bate com categoria e converte.`
        : `${homeTaker?.name || homeTeam.label} cobra, mas o goleiro leva a melhor.`,
    });

    const awayTaker = getPenaltyTaker(awayTeam, index);
    let awayScored = Math.random() < 0.76;

    if (index === 4 && homeGoals === awayGoals + (awayScored ? 1 : 0)) {
      awayScored = !awayScored;
    }

    if (awayScored) awayGoals += 1;
    attempts.push({
      order: attempts.length,
      side: "away",
      teamId: awayTeam.id,
      teamLabel: awayTeam.label,
      taker: awayTaker?.name || awayTeam.label,
      scored: awayScored,
      title: awayScored ? "Gol!" : "Perdeu!",
      description: awayScored
        ? `${awayTaker?.name || awayTeam.label} desloca o goleiro e marca.`
        : `${awayTaker?.name || awayTeam.label} para na defesa do goleiro.`,
    });
  }

  if (homeGoals === awayGoals) {
    const lastAway = [...attempts].reverse().find((attempt) => attempt.side === "away");
    if (lastAway) {
      if (lastAway.scored) {
        lastAway.scored = false;
        lastAway.title = "Perdeu!";
        lastAway.description = `${lastAway.taker} cobra, mas o goleiro defende e decide a disputa.`;
        awayGoals -= 1;
      } else {
        lastAway.scored = true;
        lastAway.title = "Gol!";
        lastAway.description = `${lastAway.taker} converte e decide a disputa.`;
        awayGoals += 1;
      }
    }
  }

  return {
    attempts,
    homeGoals,
    awayGoals,
  };
}

function getPenaltyStartMinute(match) {
  if (!match?.penalties) return null;

  return match.extraTimeGoals ? 120 : 90;
}

function getDuelLiveEndMinute(match) {
  if (match?.penalties) {
    const penaltyStartMinute = getPenaltyStartMinute(match) || 90;
    return penaltyStartMinute + Math.max(10, match.penalties.attempts?.length || 10);
  }

  if (match?.extraTimeGoals) return 120;
  return 90;
}

function getDuelLivePhaseLabel(match, minute) {
  const penaltyStartMinute = getPenaltyStartMinute(match);

  if (match?.penalties && penaltyStartMinute !== null && minute > penaltyStartMinute) {
    return "Pênaltis";
  }

  if (match?.extraTimeGoals && minute > 90) return `Prorrogação: ${minute}'`;
  return `Tempo: ${minute}'`;
}

function getRevealedPenaltyAttempts(match, minute) {
  const penaltyStartMinute = getPenaltyStartMinute(match);

  if (!match?.penalties || penaltyStartMinute === null || minute <= penaltyStartMinute) return [];

  const revealCount = clampNumber(
    Math.floor((minute - penaltyStartMinute - 1) / 1) + 1,
    0,
    match.penalties.attempts.length
  );

  return match.penalties.attempts.slice(0, revealCount);
}

function getPenaltyScoreFromAttempts(attempts = []) {
  return {
    homeGoals: attempts.filter((attempt) => attempt.side === "home" && attempt.scored).length,
    awayGoals: attempts.filter((attempt) => attempt.side === "away" && attempt.scored).length,
  };
}

function PenaltyShootoutPanel({ match, minute }) {
  const penaltyStartMinute = getPenaltyStartMinute(match);

  if (!match?.penalties || penaltyStartMinute === null || minute <= penaltyStartMinute) return null;

  const revealedAttempts = getRevealedPenaltyAttempts(match, minute);
  const score = getPenaltyScoreFromAttempts(revealedAttempts);
  const latestAttempt = revealedAttempts[revealedAttempts.length - 1] || null;

  const renderDots = (side) => {
    const attempts = revealedAttempts.filter((attempt) => attempt.side === side).slice(0, 5);

    return Array.from({ length: 5 }).map((_, index) => {
      const attempt = attempts[index];
      const content = !attempt ? "" : attempt.scored ? "⚽" : "×";

      return (
        <span
          key={`${side}-penalty-dot-${index}`}
          className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-lg font-black ${
            !attempt
              ? "border-white/35 bg-transparent text-white/60"
              : attempt.scored
              ? "border-emerald-300 bg-emerald-300 text-emerald-950"
              : "border-red-300 bg-red-400 text-red-950"
          }`}
        >
          {content}
        </span>
      );
    });
  };

  return (
    <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/10 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">
            Disputa de pênaltis
          </p>
          <p className="mt-1 text-sm font-bold text-slate-300">
            As cobranças aparecem uma a uma em tempo real.
          </p>
        </div>
        <div className="rounded-2xl bg-white px-4 py-2 text-xl font-black text-slate-950">
          {score.homeGoals} x {score.awayGoals}
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <div className="rounded-2xl bg-white/10 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="truncate text-sm font-black text-white">{match.home}</p>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">{score.homeGoals}</p>
          </div>
          <div className="flex gap-2">{renderDots("home")}</div>
        </div>

        <div className="rounded-2xl bg-white/10 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="truncate text-sm font-black text-white">{match.away}</p>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">{score.awayGoals}</p>
          </div>
          <div className="flex gap-2">{renderDots("away")}</div>
        </div>
      </div>

      {latestAttempt ? (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 ${
            latestAttempt.scored
              ? "border-emerald-300 bg-emerald-300/15"
              : "border-red-300 bg-red-400/15"
          }`}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
            Cobrança {latestAttempt.order + 1}
          </p>
          <p className="mt-1 text-sm font-black text-white">
            {latestAttempt.taker}... {latestAttempt.title}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-300">{latestAttempt.description}</p>
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-slate-300">
          Preparando os cobradores...
        </p>
      )}
    </div>
  );
}

function getLiveMatchScore(match, minute = 0) {
  // No Brasileirão controlado pelo servidor, homeGoals/awayGoals já representam
  // somente os gols liberados até agora. Usar esses valores evita que diferença
  // de relógio do dispositivo esconda um gol que o servidor já revelou.
  if (
    match?.isLive &&
    Number.isFinite(Number(match.homeGoals)) &&
    Number.isFinite(Number(match.awayGoals))
  ) {
    return {
      homeGoals: Math.max(0, Number(match.homeGoals)),
      awayGoals: Math.max(0, Number(match.awayGoals)),
    };
  }

  const safeMinute = Math.max(0, Number(minute || 0));
  const revealedGoals = (match?.events || []).filter(
    (event) => event.type === "goal" && event.minute <= safeMinute
  );

  return {
    homeGoals: revealedGoals.filter((event) => event.side === "home").length,
    awayGoals: revealedGoals.filter((event) => event.side === "away").length,
  };
}

function getRecentLiveEvents(match, minute = 0, limit = 3) {
  const safeMinute = Math.max(0, Number(minute || 0));

  return (match?.events || [])
    .filter(
      (event) =>
        event.type === "goal" &&
        (match?.isLive || event.minute <= safeMinute)
    )
    .sort((a, b) => b.minute - a.minute)
    .slice(0, limit);
}

function getGoalEventTeamBadgeClasses(event) {
  if (event?.side === "home") {
    return "bg-blue-100 text-blue-800";
  }

  if (event?.side === "away") {
    return "bg-emerald-100 text-emerald-800";
  }

  return "bg-slate-100 text-slate-700";
}

function normalizeSoloMatchEvent(event, match) {
  if (!event) return null;

  const isHomeEvent = event.team === match.home;

  return {
    id: `${match.round}-${event.minute}-${event.scorer || event.team}`,
    type: "goal",
    icon: "⚽",
    minute: event.minute,
    side: isHomeEvent ? "home" : "away",
    teamLabel: event.team,
    title: `Gol de ${event.scorer || event.team}`,
    description: event.assist
      ? `${event.scorer || "O atacante"} completa jogada com assistência de ${event.assist}.`
      : `${event.scorer || "O atacante"} aparece no momento certo e balança a rede.`,
    playerName: event.scorer || null,
    isUserGoal: event.isUserGoal || false,
  };
}

function getSoloLiveMatchEvents(match) {
  return (match?.events || [])
    .map((event) => normalizeSoloMatchEvent(event, match))
    .filter(Boolean)
    .sort((a, b) => a.minute - b.minute);
}

function getSoloLiveMatchScore(match, minute = 0) {
  const events = getSoloLiveMatchEvents(match).filter((event) => event.minute <= minute);

  return {
    homeGoals: events.filter((event) => event.side === "home").length,
    awayGoals: events.filter((event) => event.side === "away").length,
  };
}

function getRecentSoloLiveEvents(match, minute = 0, limit = 3) {
  return getSoloLiveMatchEvents(match)
    .filter((event) => event.minute <= minute)
    .sort((a, b) => b.minute - a.minute)
    .slice(0, limit);
}

function getLeaderboardTeamLabel(event, match) {
  if (event.teamLabel) return event.teamLabel;
  if (event.team) return event.team;
  if (event.side === "home") return match?.homeTeam?.label || match?.home || "Mandante";
  if (event.side === "away") return match?.awayTeam?.label || match?.away || "Visitante";
  return "Time";
}

function buildLeaderboardsFromMatches(matches = []) {
  const scorers = new Map();
  const assistants = new Map();

  matches.forEach((match) => {
    (match.events || []).forEach((event) => {
      if (event.type !== "goal") return;

      const scorerName = event.playerName || event.scorer;
      const teamLabel = getLeaderboardTeamLabel(event, match);

      if (scorerName) {
        const key = `${scorerName}__${teamLabel}`;
        const current = scorers.get(key) || { name: scorerName, team: teamLabel, total: 0 };
        current.total += 1;
        scorers.set(key, current);
      }

      const assistName = event.assistName || event.assist;

      if (assistName) {
        const key = `${assistName}__${teamLabel}`;
        const current = assistants.get(key) || { name: assistName, team: teamLabel, total: 0 };
        current.total += 1;
        assistants.set(key, current);
      }
    });
  });

  const sortLeaders = (items) =>
    Array.from(items.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    });

  return {
    scorers: sortLeaders(scorers),
    assistants: sortLeaders(assistants),
  };
}

function getLeagueLeaderboards({
  rounds = [],
  revealedRounds = 0,
  liveRound = null,
  liveMinute = 0,
  baseLeaderboards = null,
}) {
  const completedMatches = rounds
    .slice(0, revealedRounds)
    .flatMap((round) => round.matches || []);

  const completed = baseLeaderboards || buildLeaderboardsFromMatches(completedMatches);
  const liveMatches = liveRound
    ? (liveRound.matches || []).map((match) => ({
        ...match,
        // O servidor nunca envia eventos futuros. Em partidas server-authoritative,
        // tudo que chegou já pode entrar imediatamente na artilharia/assistências.
        events: match.isLive
          ? (match.events || []).filter((event) => event.type === "goal")
          : (match.events || []).filter(
              (event) => event.type === "goal" && event.minute <= liveMinute
            ),
      }))
    : [];
  const live = buildLeaderboardsFromMatches(liveMatches);

  const merge = (baseItems = [], liveItems = []) => {
    const map = new Map();
    [...baseItems, ...liveItems].forEach((item) => {
      const key = `${item.name}__${item.team}`;
      const current = map.get(key) || { name: item.name, team: item.team, total: 0 };
      current.total += item.total || 0;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    });
  };

  return {
    scorers: merge(completed.scorers, live.scorers),
    assistants: merge(completed.assistants, live.assistants),
  };
}

function LeaderboardPanel({ title, leaders, valueLabel = "gols", emptyMessage, limit = 10, compact = false }) {
  const topLeaders = (leaders || []).slice(0, limit);

  return (
    <div className={`rounded-[2rem] border border-slate-900/10 bg-white/85 ${compact ? "p-4" : "p-5"} shadow-[0_16px_45px_rgba(15,23,42,0.08)]`}>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
        {title}
      </p>
      <div className="mt-4 grid gap-2">
        {topLeaders.length ? (
          topLeaders.map((leader, index) => (
            <div
              key={`${title}-${leader.name}-${leader.team}-${index}`}
              className={`highlight-outline-card grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-emerald-400/55 bg-white text-slate-950 shadow-[0_10px_22px_rgba(16,185,129,0.10)] ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${index === 0 ? "bg-yellow-300 text-yellow-950" : "force-white-text bg-white/90 text-slate-700"}`}>
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className={`${compact ? "text-xs" : "text-sm"} truncate font-black text-slate-950`}>{leader.name}</p>
                <p className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{leader.team}</p>
              </div>
              <span className="highlight-dark-pill leader-total-badge rounded-xl bg-slate-950 px-3 py-1 text-sm font-black text-white">
                {leader.total}
              </span>
            </div>
          ))
        ) : (
          <p className="force-white-text rounded-2xl bg-white/80 px-4 py-4 text-sm font-bold text-slate-500">
            {emptyMessage || `Os líderes de ${valueLabel} aparecem depois dos primeiros lances.`}
          </p>
        )}
      </div>
    </div>
  );
}

function createOnlineDuelMatch(homeTeam, awayTeam, gameNumber, config = {}) {
  const { homeGoals, awayGoals } = generateMatchScore(homeTeam, awayTeam);
  const match = {
    round: gameNumber,
    gameNumber,
    homeTeam,
    awayTeam,
    home: homeTeam.label,
    away: awayTeam.label,
    homeGoals,
    awayGoals,
    hasHumanTeam: true,
    extraTimeGoals: null,
    penalties: null,
    winnerId: null,
    winnerLabel: null,
    decidedBy: "normal",
  };

  if (homeGoals > awayGoals) {
    match.winnerId = homeTeam.id;
    match.winnerLabel = homeTeam.label;
  } else if (awayGoals > homeGoals) {
    match.winnerId = awayTeam.id;
    match.winnerLabel = awayTeam.label;
  }

  return {
    ...match,
    events: generateOnlineMatchEvents(match),
  };
}

function getDuelMatchScoreLabel(match) {
  if (!match) return "0 x 0";

  let label = `${match.homeGoals} x ${match.awayGoals}`;

  if (match.extraTimeGoals) {
    label += ` · Prorr. ${match.extraTimeGoals.homeGoals} x ${match.extraTimeGoals.awayGoals}`;
  }

  if (match.penalties) {
    label += ` · Pên. ${match.penalties.homeGoals} x ${match.penalties.awayGoals}`;
  }

  return label;
}

function getOnlineDuelSeriesSummary(result, untilIndex = null) {
  if (!result?.matches?.length) {
    return {
      homeWins: 0,
      awayWins: 0,
      draws: 0,
      homeAggregate: 0,
      awayAggregate: 0,
      winnerId: null,
      winnerLabel: null,
      isComplete: false,
    };
  }

  const matches = result.matches.slice(0, untilIndex === null ? result.matches.length : untilIndex + 1);
  const homeTeam = result.teams[0];
  const awayTeam = result.teams[1];
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let homeAggregate = 0;
  let awayAggregate = 0;

  matches.forEach((match) => {
    const homeIsFirstTeam = match.homeTeam.id === homeTeam.id;
    const firstTeamGoals = homeIsFirstTeam ? match.homeGoals : match.awayGoals;
    const secondTeamGoals = homeIsFirstTeam ? match.awayGoals : match.homeGoals;
    const firstTeamExtraGoals = homeIsFirstTeam
      ? match.extraTimeGoals?.homeGoals || 0
      : match.extraTimeGoals?.awayGoals || 0;
    const secondTeamExtraGoals = homeIsFirstTeam
      ? match.extraTimeGoals?.awayGoals || 0
      : match.extraTimeGoals?.homeGoals || 0;

    homeAggregate += firstTeamGoals + firstTeamExtraGoals;
    awayAggregate += secondTeamGoals + secondTeamExtraGoals;

    if (match.winnerId === homeTeam.id) homeWins += 1;
    else if (match.winnerId === awayTeam.id) awayWins += 1;
    else draws += 1;
  });

  let winnerId = null;
  let winnerLabel = null;
  const winsNeeded = getOnlineDuelWinsNeeded(result.format);

  if (winsNeeded && homeWins >= winsNeeded) {
    winnerId = homeTeam.id;
    winnerLabel = homeTeam.label;
  } else if (winsNeeded && awayWins >= winsNeeded) {
    winnerId = awayTeam.id;
    winnerLabel = awayTeam.label;
  } else if (!winsNeeded && result.format === "single" && matches.length >= 1) {
    const match = matches[0];
    winnerId = match.winnerId;
    winnerLabel = match.winnerLabel;
  } else if (!winsNeeded && result.format === "twoLegs" && matches.length >= 2) {
    if (homeAggregate > awayAggregate) {
      winnerId = homeTeam.id;
      winnerLabel = homeTeam.label;
    } else if (awayAggregate > homeAggregate) {
      winnerId = awayTeam.id;
      winnerLabel = awayTeam.label;
    } else {
      const lastMatch = matches[matches.length - 1];
      if (lastMatch?.winnerId) {
        winnerId = lastMatch.winnerId;
        winnerLabel = lastMatch.winnerLabel;
      }
    }
  }

  if (!winnerId && matches.length === result.matches.length) {
    if (homeWins > awayWins) {
      winnerId = homeTeam.id;
      winnerLabel = homeTeam.label;
    } else if (awayWins > homeWins) {
      winnerId = awayTeam.id;
      winnerLabel = awayTeam.label;
    } else if (homeAggregate > awayAggregate) {
      winnerId = homeTeam.id;
      winnerLabel = homeTeam.label;
    } else if (awayAggregate > homeAggregate) {
      winnerId = awayTeam.id;
      winnerLabel = awayTeam.label;
    }
  }

  return {
    homeWins,
    awayWins,
    draws,
    homeAggregate,
    awayAggregate,
    winnerId,
    winnerLabel,
    isComplete: Boolean(winnerId || matches.length >= result.matches.length),
  };
}



function getOnlineDuelLiveSeriesSummary(result, currentIndex = 0, currentScore = null, currentMinute = 0, currentFinished = false) {
  if (!result?.matches?.length) {
    return {
      homeWins: 0,
      awayWins: 0,
      draws: 0,
      homeAggregate: 0,
      awayAggregate: 0,
      winnerId: null,
      winnerLabel: null,
      isComplete: false,
    };
  }

  const homeTeam = result.teams[0];
  const awayTeam = result.teams[1];
  const matchesToReveal = result.matches.slice(0, Math.max(0, currentIndex));
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let homeAggregate = 0;
  let awayAggregate = 0;

  matchesToReveal.forEach((match) => {
    const homeIsFirstTeam = match.homeTeam.id === homeTeam.id;
    const firstTeamGoals = homeIsFirstTeam ? match.homeGoals : match.awayGoals;
    const secondTeamGoals = homeIsFirstTeam ? match.awayGoals : match.homeGoals;
    const firstTeamExtraGoals = homeIsFirstTeam
      ? match.extraTimeGoals?.homeGoals || 0
      : match.extraTimeGoals?.awayGoals || 0;
    const secondTeamExtraGoals = homeIsFirstTeam
      ? match.extraTimeGoals?.awayGoals || 0
      : match.extraTimeGoals?.homeGoals || 0;

    homeAggregate += firstTeamGoals + firstTeamExtraGoals;
    awayAggregate += secondTeamGoals + secondTeamExtraGoals;

    if (match.winnerId === homeTeam.id) homeWins += 1;
    else if (match.winnerId === awayTeam.id) awayWins += 1;
    else draws += 1;
  });

  const currentMatch = result.matches[currentIndex];

  if (currentMatch && currentScore) {
    const homeIsFirstTeam = currentMatch.homeTeam.id === homeTeam.id;
    const firstTeamLiveGoals = homeIsFirstTeam ? currentScore.homeGoals : currentScore.awayGoals;
    const secondTeamLiveGoals = homeIsFirstTeam ? currentScore.awayGoals : currentScore.homeGoals;

    homeAggregate += firstTeamLiveGoals;
    awayAggregate += secondTeamLiveGoals;

    if (currentFinished) {
      if (currentMatch.winnerId === homeTeam.id) homeWins += 1;
      else if (currentMatch.winnerId === awayTeam.id) awayWins += 1;
      else draws += 1;
    }
  }

  let winnerId = null;
  let winnerLabel = null;
  const winsNeeded = getOnlineDuelWinsNeeded(result.format);

  if (currentFinished) {
    if (winsNeeded && homeWins >= winsNeeded) {
      winnerId = homeTeam.id;
      winnerLabel = homeTeam.label;
    } else if (winsNeeded && awayWins >= winsNeeded) {
      winnerId = awayTeam.id;
      winnerLabel = awayTeam.label;
    } else if (!winsNeeded && result.format === "single" && currentIndex >= 0) {
      const match = result.matches[0];
      if (match && currentIndex === 0 && currentFinished) {
        winnerId = match.winnerId;
        winnerLabel = match.winnerLabel;
      }
    } else if (!winsNeeded && result.format === "twoLegs" && currentIndex >= 1) {
      const lastMatch = result.matches[1];

      if (homeAggregate > awayAggregate) {
        winnerId = homeTeam.id;
        winnerLabel = homeTeam.label;
      } else if (awayAggregate > homeAggregate) {
        winnerId = awayTeam.id;
        winnerLabel = awayTeam.label;
      } else if (lastMatch?.winnerId && currentFinished) {
        winnerId = lastMatch.winnerId;
        winnerLabel = lastMatch.winnerLabel;
      }
    }
  }

  return {
    homeWins,
    awayWins,
    draws,
    homeAggregate,
    awayAggregate,
    winnerId,
    winnerLabel,
    isComplete: Boolean(winnerId && currentFinished),
  };
}


function duelFormatRequiresPenalties(format) {
  return ["bestOf3", "bestOf5"].includes(format);
}

function duelFormatAllowsExtraTime(format) {
  return format === "twoLegs";
}

function shouldResolveMatchDrawWithPenalties(format, config = {}) {
  return duelFormatRequiresPenalties(format) || Boolean(config.duelPenalties);
}

function applyPenaltyShootoutToDuelMatch(match, decidedBy = "pênaltis") {
  const shootout = generatePenaltyShootout(match.homeTeam, match.awayTeam);

  return {
    ...match,
    penalties: shootout,
    winnerId: shootout.homeGoals > shootout.awayGoals ? match.homeTeam.id : match.awayTeam.id,
    winnerLabel: shootout.homeGoals > shootout.awayGoals ? match.homeTeam.label : match.awayTeam.label,
    decidedBy,
  };
}

function getDuelConfigWithRules(config = {}) {
  const format = config.duelFormat || "single";
  const extraTimeAllowed = duelFormatAllowsExtraTime(format);
  const extraTime = extraTimeAllowed && Boolean(config.duelExtraTime);
  const penalties = extraTime || duelFormatRequiresPenalties(format) || Boolean(config.duelPenalties);

  return {
    ...config,
    duelFormat: format,
    duelExtraTime: extraTime,
    duelPenalties: penalties,
  };
}


function simulateOnlineDuel(room, draftOrder, lineupsMap) {
  const participants = draftOrder.slice(0, 2);
  const teams = participants.map((participant) =>
    createOnlineSimulationTeam(participant, lineupsMap[participant.id] || [])
  );

  if (teams.length < 2) return null;

  const homeTeam = teams[0];
  const awayTeam = teams[1];
  const rawConfig = room?.config || {};
  const config = getDuelConfigWithRules(rawConfig);
  const format = config.duelFormat || "single";
  const maxGames = getOnlineDuelMaxGames(format);
  const matches = [];

  for (let gameIndex = 0; gameIndex < maxGames; gameIndex += 1) {
    const invertHome = gameIndex % 2 === 1;
    const gameHomeTeam = invertHome ? awayTeam : homeTeam;
    const gameAwayTeam = invertHome ? homeTeam : awayTeam;
    let match = createOnlineDuelMatch(gameHomeTeam, gameAwayTeam, gameIndex + 1, config);

    const winsNeeded = getOnlineDuelWinsNeeded(format);

    if (winsNeeded && !match.winnerId && shouldResolveMatchDrawWithPenalties(format, config)) {
      match = applyPenaltyShootoutToDuelMatch(match);
    }

    if (format === "single" && !match.winnerId && shouldResolveMatchDrawWithPenalties(format, config)) {
      match = applyPenaltyShootoutToDuelMatch(match);
    }

    matches.push(match);

    if (winsNeeded) {
      const partialSummary = getOnlineDuelSeriesSummary({ format, teams, matches });
      if (partialSummary.winnerId) break;
    }
  }

  if (format === "twoLegs" && matches.length >= 2) {
    const firstLeg = matches[0];
    const secondLeg = matches[1];
    const firstTeamAggregate = firstLeg.homeGoals + secondLeg.awayGoals;
    const secondTeamAggregate = firstLeg.awayGoals + secondLeg.homeGoals;

    if (firstTeamAggregate === secondTeamAggregate) {
      let updatedSecondLeg = secondLeg;

      if (config.duelExtraTime) {
        let homeExtra = Math.random() < 0.32 ? 1 : 0;
        let awayExtra = Math.random() < 0.32 ? 1 : 0;
        updatedSecondLeg = addExtraTimeToDuelMatch(secondLeg, homeExtra, awayExtra);

        const firstTeamExtra = awayExtra;
        const secondTeamExtra = homeExtra;
        const firstAfterExtra = firstTeamAggregate + firstTeamExtra;
        const secondAfterExtra = secondTeamAggregate + secondTeamExtra;

        if (firstAfterExtra > secondAfterExtra) {
          updatedSecondLeg.winnerId = homeTeam.id;
          updatedSecondLeg.winnerLabel = homeTeam.label;
          updatedSecondLeg.decidedBy = "prorrogação";
        } else if (secondAfterExtra > firstAfterExtra) {
          updatedSecondLeg.winnerId = awayTeam.id;
          updatedSecondLeg.winnerLabel = awayTeam.label;
          updatedSecondLeg.decidedBy = "prorrogação";
        } else if (config.duelPenalties) {
          updatedSecondLeg = applyPenaltyShootoutToDuelMatch(updatedSecondLeg);
        }
      } else if (config.duelPenalties) {
        updatedSecondLeg = applyPenaltyShootoutToDuelMatch(updatedSecondLeg);
      }

      matches[1] = updatedSecondLeg;
    }
  }

  const result = {
    room,
    teams,
    format,
    formatLabel: getOnlineDuelFormatLabel(format),
    hasExtraTime: Boolean(config.duelExtraTime),
    hasPenalties: Boolean(config.duelPenalties),
    matches,
    match: matches[0],
  };

  return {
    ...result,
    summary: getOnlineDuelSeriesSummary(result),
  };
}


function getMainHumanLiveMatch(round, participantId = null) {
  if (!round?.matches?.length) return null;

  if (participantId) {
    const participantMatch = round.matches.find(
      (match) =>
        match.homeTeam?.ownerParticipantId === participantId ||
        match.awayTeam?.ownerParticipantId === participantId
    );

    if (participantMatch) return participantMatch;
  }

  return round.matches.find((match) => match.hasHumanTeam) || round.matches[0];
}

function getLiveOnlineLeagueTable(onlineLeagueResult, revealedRounds, onlineLiveRound) {
  if (!onlineLiveRound) return getPartialOnlineLeagueTable(onlineLeagueResult, revealedRounds);

  const standingsMap = createStandingsFromTeams(onlineLeagueResult.leagueTeams || []);
  const completedRounds = onlineLeagueResult.rounds.slice(0, revealedRounds);

  completedRounds.forEach((round) => {
    round.matches.forEach((match) => {
      applyMatchToStandings(
        standingsMap,
        match.homeTeam,
        match.awayTeam,
        match.homeGoals,
        match.awayGoals
      );
    });
  });

  onlineLiveRound.round.matches.forEach((match) => {
    const { homeGoals, awayGoals } = getLiveMatchScore(match, onlineLiveRound.minute);

    applyMatchToStandings(standingsMap, match.homeTeam, match.awayTeam, homeGoals, awayGoals);
  });

  return getSortedTableFromStandingsMap(standingsMap);
}


function App() {
  const [theme, setTheme] = useState("light");
  const themeClass = theme === "dark" ? "theme-dark" : "theme-light";

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  const [screen, setScreen] = useState("home");
  const [selectedFormation, setSelectedFormation] = useState(null);
  const [gameMode, setGameMode] = useState("normal");
  const [lineup, setLineup] = useState([]);
  const [currentTeam, setCurrentTeam] = useState(null);
  const [rollingTeam, setRollingTeam] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const [rerollsRemaining, setRerollsRemaining] = useState(getDraftRerollLimit("normal"));
  const [pendingSelection, setPendingSelection] = useState(null);
  const [leagueResult, setLeagueResult] = useState(null);
  const [revealedMatchesCount, setRevealedMatchesCount] = useState(0);
  const currentMatchRef = useRef(null);
  const [copiedResult, setCopiedResult] = useState(false);
  const shareCardRef = useRef(null);
  const [shareImageUrl, setShareImageUrl] = useState("");
  const [isGeneratingShareImage, setIsGeneratingShareImage] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [copiedPixKey, setCopiedPixKey] = useState(false);
  const [pixCopyMessage, setPixCopyMessage] = useState("");
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [joinRoomFeedback, setJoinRoomFeedback] = useState("");
  const [joinRoomPassword, setJoinRoomPassword] = useState("");
  const [matchmakingSetup, setMatchmakingSetup] = useState({
    onlineMode: "duel",
    difficulty: "normal",
  });

  const [onlineSetup, setOnlineSetup] = useState({
    ...ONLINE_DEFAULT_CONFIG,
    formationId: formations[0]?.id || "",
  });
  const [onlineRoom, setOnlineRoom] = useState(null);
  const [onlineDraftOrder, setOnlineDraftOrder] = useState([]);
  const [isDrawingOnlineOrder, setIsDrawingOnlineOrder] = useState(false);
  const [rollingOnlineParticipant, setRollingOnlineParticipant] = useState("");
  const [onlineDraftState, setOnlineDraftState] = useState(null);
  const [onlinePendingSelection, setOnlinePendingSelection] = useState(null);
  const [onlinePickCountdown, setOnlinePickCountdown] = useState(null);
  const [onlineLeagueResult, setOnlineLeagueResult] = useState(null);
  const [onlineRevealedRounds, setOnlineRevealedRounds] = useState(0);
  const [onlineLiveRound, setOnlineLiveRound] = useState(null);
  const [onlineLiveSpeed, setOnlineLiveSpeed] = useState("normal");
  const [soloLiveMatch, setSoloLiveMatch] = useState(null);
  const [onlineDuelResult, setOnlineDuelResult] = useState(null);
  const [onlineDuelLive, setOnlineDuelLive] = useState(null);
  const [dismissedOnlineChampionModal, setDismissedOnlineChampionModal] = useState(false);
  const [isStartingOnlineLeague, setIsStartingOnlineLeague] = useState(false);
  const [onlinePitchTeamId, setOnlinePitchTeamId] = useState("");
  const [localParticipantId, setLocalParticipantId] = useState("");
  const [isCreatingOnlineRoom, setIsCreatingOnlineRoom] = useState(false);
  const [isJoiningOnlineRoom, setIsJoiningOnlineRoom] = useState(false);
  const [savedRoomCode, setSavedRoomCode] = useState(() => getRememberedRoomCode());
  const [isResumingOnlineRoom, setIsResumingOnlineRoom] = useState(false);
  const [resumeRoomFeedback, setResumeRoomFeedback] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState([]);
  const [isLoadingLobbyRooms, setIsLoadingLobbyRooms] = useState(false);
  const [lobbyRoomsFeedback, setLobbyRoomsFeedback] = useState("");
  const [joiningLobbyRoomCode, setJoiningLobbyRoomCode] = useState("");

  // Para entrar em salas com senha a partir da lista de salas abertas:
  // mostramos todas as salas, mas pedimos a senha num "popup" (prompt inline) antes de concluir o join.
  const [pendingPrivateLobbyRoom, setPendingPrivateLobbyRoom] = useState(null);
  const [lobbyJoinPassword, setLobbyJoinPassword] = useState("");
  const onlineRoomRef = useRef(null);
  const onlineRoomRevisionRef = useRef(0);
  const autoResumeAttemptedRef = useRef("");
  const onlineApiRef = useRef(null);
  const localParticipantIdRef = useRef("");
  const myParticipantIdRef = useRef(""); // the exact participant id we used when we successfully joined/created this room
  const hasSeenSelfInRoomRef = useRef(false); // only eject on remote data if we previously saw ourselves in a server-provided room state
  const liveSpeedRef = useRef("normal");
  const [isOnlineApiLoading, setIsOnlineApiLoading] = useState(false);
  const [isOnlineApiReady, setIsOnlineApiReady] = useState(false);
  const [onlineApiError, setOnlineApiError] = useState("");
  const [onlineConnectionStatus, setOnlineConnectionStatus] = useState("idle");
  const [justBecameHost, setJustBecameHost] = useState(false); // feedback leve quando vira host por promoção automática

  async function ensureOnlineApi() {
    if (onlineApiRef.current && isOnlineApiReady) {
      const uid = await onlineApiRef.current.ensureAnonymousAuth();
      // Always keep the local id in sync with the live auth UID.
      // The "my id" for ejection protection is the one we used to join (myParticipantIdRef),
      // but for actual Firestore writes the live UID must match what is stored as hostId/participant id.
      localParticipantIdRef.current = uid;
      setLocalParticipantId(uid);
      return onlineApiRef.current;
    }

    setIsOnlineApiLoading(true);
    setOnlineApiError("");

    try {
      const api = await loadOnlineRoom();
      const uid = await api.ensureAnonymousAuth();
      onlineApiRef.current = api;
      localParticipantIdRef.current = uid;
      setLocalParticipantId(uid);
      setIsOnlineApiReady(true);
      return api;
    } catch (error) {
      console.error(error);
      onlineApiRef.current = null;
      setIsOnlineApiReady(false);
      setOnlineApiError(error?.message || "Não foi possível carregar o modo online.");
      throw error;
    } finally {
      setIsOnlineApiLoading(false);
    }
  }

  async function withRetry(fn, maxRetries = 3, baseDelay = 150) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const code = error?.code || '';
        if (attempt < maxRetries - 1 && (code === 'failed-precondition' || code === 'aborted' || code === 'unavailable')) {
          await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  async function enterOnlineScreen(targetScreen) {
    setOnlineApiError("");
    setScreen(targetScreen);

    try {
      await ensureOnlineApi();
    } catch (error) {
      setScreen("home");
      throw error;
    }
  }

  function handleEnterOnlineClick(targetScreen = "online-home") {
    if (isOnlineApiLoading) return;

    enterOnlineScreen(targetScreen).catch((error) => {
      console.error(error);
    });
  }

  async function fetchRoomByCode(code) {
    return (await ensureOnlineApi()).fetchRoomByCode(code);
  }

  async function createRoomDocument(room) {
    return (await ensureOnlineApi()).createRoomDocument(room);
  }

  async function joinRoomDocument(code, participant, options = {}) {
    return (await ensureOnlineApi()).joinRoomDocument(code, participant, options);
  }

  async function leaveRoomDocument(code, participantId) {
    return (await ensureOnlineApi()).leaveRoomDocument(code, participantId);
  }

  async function patchRoomDocument(code, updates) {
    return (await ensureOnlineApi()).patchRoomDocument(code, updates);
  }

  async function saveOnlineLeagueResult(code, leagueResult) {
    return (await ensureOnlineApi()).saveOnlineLeagueResult(code, leagueResult);
  }

  async function clearOnlineLeagueResult(code) {
    return (await ensureOnlineApi()).clearOnlineLeagueResult(code);
  }

  async function startOnlineLeagueSimulation(code, payload) {
    const api = await ensureOnlineApi();
    if (!api.startOnlineLeagueSimulation) return null;
    return api.startOnlineLeagueSimulation(code, payload);
  }

  async function startOnlineLeagueRound(code) {
    const api = await ensureOnlineApi();
    if (!api.startOnlineLeagueRound) return null;
    return api.startOnlineLeagueRound(code);
  }

  async function simulateAllOnlineLeagueRounds(code) {
    const api = await ensureOnlineApi();
    if (!api.simulateAllOnlineLeagueRounds) return null;
    return api.simulateAllOnlineLeagueRounds(code);
  }

  async function updateOnlineSimulationSpeed(code, speed) {
    const api = await ensureOnlineApi();
    if (!api.updateOnlineSimulationSpeed) return null;
    return api.updateOnlineSimulationSpeed(code, speed);
  }

  async function resetOnlineRoomToLobby(code) {
    const api = await ensureOnlineApi();
    if (!api.resetOnlineRoomToLobby) return null;
    return api.resetOnlineRoomToLobby(code);
  }

  async function listLobbyRooms(filters = {}) {
    return (await ensureOnlineApi()).listLobbyRooms(filters);
  }

  async function cleanupOldRooms(maxAgeMs) {
    return (await ensureOnlineApi()).cleanupOldRooms(maxAgeMs);
  }

  async function touchParticipantPresence(code, participantId) {
    return (await ensureOnlineApi()).touchParticipantPresence(code, participantId);
  }

  async function pruneStaleParticipants(code) {
    return (await ensureOnlineApi()).pruneStaleParticipants(code);
  }

  const isOnlineHost = useMemo(() => {
    if (!onlineRoom || !localParticipantId) return false;

    return (
      onlineRoom.hostId === localParticipantId ||
      Boolean(onlineRoom.participants?.find((participant) => participant.id === localParticipantId)?.isHost)
    );
  }, [onlineRoom, localParticipantId]);

  const localOnlineParticipant = useMemo(() => {
    if (!onlineRoom?.participants?.length || !localParticipantId) return null;

    return onlineRoom.participants.find((participant) => participant.id === localParticipantId) || null;
  }, [onlineRoom, localParticipantId]);

  const databaseStats = useMemo(() => {
    const teamsWithPlayers = getTeamsWithPlayers();
    const uniqueClubIds = new Set(teamsWithPlayers.map((team) => team.clubId));

    return {
      clubs: uniqueClubIds.size,
      squads: teamsWithPlayers.length,
      players: teamsWithPlayers.reduce(
        (total, team) => total + (team.players?.length || 0),
        0
      ),
    };
  }, []);

  function applyRemoteRoomState(room, isRemote = false) {
    if (!room) return;

    const nextRevision = Number(room.stateRevision || 0);
    const currentRevision = Number(onlineRoomRevisionRef.current || 0);
    if (nextRevision > 0 && currentRevision > 0 && nextRevision < currentRevision) {
      return;
    }
    if (nextRevision > 0) {
      onlineRoomRevisionRef.current = Math.max(currentRevision, nextRevision);
    }

    const activeParticipantId = myParticipantIdRef.current || localParticipantIdRef.current || localParticipantId;

    if (activeParticipantId && room.participants?.length) {
      const stillInRoom = room.participants.some((participant) => participant.id === activeParticipantId);

      if (stillInRoom) {
        if (isRemote) {
          hasSeenSelfInRoomRef.current = true;
        }
      } else if (hasSeenSelfInRoomRef.current && isRemote) {
        // We were previously present according to server data, but this remote update no longer lists us.
        // Real removal (pruned for inactivity, host removed, room changed, etc.).
        resetOnlineSessionState();
        setScreen("online-home");
        setLobbyRoomsFeedback("Você saiu da sala ou foi removido por inatividade.");
        return;
      } else if (!stillInRoom && isRemote && !hasSeenSelfInRoomRef.current) {
        // Remote state arrived without us, but we haven't confirmed presence via a previous remote state yet.
        // This can happen right after join if the listener sees a pre-write snapshot.
        // Keep our optimistic state; do not apply a state that would eject us.
        return;
      }
      // If !isRemote (optimistic after join/create), we trust the synthetic list we just built.
    }

    onlineRoomRef.current = room;
    setOnlineRoom(room);
    setOnlineDraftOrder(room.draftOrder || []);
    setIsDrawingOnlineOrder(Boolean(room.isDrawingOrder));
    setRollingOnlineParticipant(room.rollingParticipant || "");
    setOnlineDraftState(room.draftState || null);
    setOnlineLeagueResult(hydrateLeagueResultFromFirestore(room.leagueResult));
    setOnlineDuelResult(room.duelResult || null);
    setOnlineRevealedRounds(room.revealedRounds || 0);
    const nextLiveRound = buildOnlineLiveRoundFromRoom(room);
    setOnlineLiveRound((current) => {
      if (!nextLiveRound) return null;
      if (!current || current.round?.round !== nextLiveRound.round?.round) {
        return nextLiveRound;
      }

      return {
        ...nextLiveRound,
        minute: Math.max(Number(current.minute || 0), Number(nextLiveRound.minute || 0)),
      };
    });
    setOnlineDuelLive(buildOnlineDuelLiveFromRoom(room));

    if (room.liveSpeed && !isOnlineHost) {
      liveSpeedRef.current = room.liveSpeed;
      setOnlineLiveSpeed(room.liveSpeed);
    }

    // Quando recebemos atualização remota e o usuário local virou (ou continua sendo) o host,
    // fazemos prune imediato + sync de liveSpeed. Isso garante que se o host anterior caiu,
    // o novo host assume o controle de presença e velocidade sem esperar o próximo intervalo.
    if (isRemote) {
      const localId = localParticipantIdRef.current || localParticipantId;
      const amHostNow = room.hostId === localId ||
        Boolean(room.participants?.find((p) => p.id === localId)?.isHost);

      if (amHostNow) {
        if (!onlineApiRef.current?.usesSocketPresence) {
          pruneStaleParticipants(room.code).catch(console.error);
        }
        if (room.liveSpeed) {
          syncHostLiveSpeedFromRoom(room);
        }
      }
    }
  }



  function syncHostLiveSpeedFromRoom(room) {
    if (!room?.liveSpeed) return;

    liveSpeedRef.current = room.liveSpeed;
    setOnlineLiveSpeed(room.liveSpeed);
  }

  function syncOnlineScreenWithRoom(room) {
    if (!room?.status) return;

    setScreen((currentScreen) =>
      shouldStayOnOnlineSetupScreen(currentScreen)
        ? currentScreen
        : getOnlineScreenForRoom(room)
    );
  }

  async function resumeSavedOnlineRoom() {
    const rememberedCode = savedRoomCode || getRememberedRoomCode();
    if (!rememberedCode || onlineRoom) return;

    setIsResumingOnlineRoom(true);
    setResumeRoomFeedback("");

    try {
      await ensureOnlineApi();
      const room = await fetchRoomByCode(rememberedCode);

      if (!room) {
        clearActiveRoomCode();
        setSavedRoomCode("");
        setResumeRoomFeedback("Sala não encontrada. O código salvo foi removido.");
        return;
      }

      const playerId = localParticipantIdRef.current || localParticipantId;
      const isParticipant = room.participants?.some((participant) => participant.id === playerId);

      if (!isParticipant) {
        clearActiveRoomCode();
        setSavedRoomCode("");
        setResumeRoomFeedback("Você não participa mais dessa sala.");
        return;
      }

      myParticipantIdRef.current = playerId;
      localParticipantIdRef.current = playerId;
      setLocalParticipantId(playerId);
      rememberActiveRoomCode(room.code);
      setSavedRoomCode(room.code);
      autoResumeAttemptedRef.current = room.code;
      applyRemoteRoomState(room, true);
      if (room.hostId === playerId || room.participants?.some((entry) => entry.id === playerId && entry.isHost)) {
        syncHostLiveSpeedFromRoom(room);
      }
      // Ao retomar manualmente, precisamos forçar a navegação para a tela
      // correspondente ao estado atual da sala. A sincronização comum evita
      // tirar o usuário das telas de configuração, mas isso fazia o botão
      // "Retomar sala" permanecer no menu mesmo após recuperar a sessão.
      setScreen(getOnlineScreenForRoom(room));
    } catch (error) {
      console.error(error);
      setResumeRoomFeedback("Não foi possível retomar a sala agora.");
    } finally {
      setIsResumingOnlineRoom(false);
    }
  }

  function dismissSavedOnlineRoom() {
    const code = savedRoomCode || getRememberedRoomCode();
    forgetRememberedRoom(code);
    setSavedRoomCode("");
    setResumeRoomFeedback("");
    autoResumeAttemptedRef.current = "";
  }

  useEffect(() => {
    if (!screen.startsWith("online-") || isOnlineApiReady || isOnlineApiLoading) {
      return undefined;
    }

    ensureOnlineApi().catch(console.error);
    return undefined;
  }, [screen, isOnlineApiReady, isOnlineApiLoading]);

  useEffect(() => {
    if (screen !== "online-league" || !onlineLeagueResult?.humanTeams?.length) return;

    const ownTeam = onlineLeagueResult.humanTeams.find(
      (team) => team.ownerParticipantId === localParticipantId
    );
    const fallbackTeam = ownTeam || onlineLeagueResult.humanTeams[0];

    setOnlinePitchTeamId((currentId) => {
      const stillExists = onlineLeagueResult.humanTeams.some((team) => team.id === currentId);
      return stillExists ? currentId : fallbackTeam?.id || "";
    });
  }, [screen, onlineLeagueResult, localParticipantId]);

  useEffect(() => {
    const resumableCode = savedRoomCode || getRememberedRoomCode();
    if (
      screen !== "online-home" ||
      !resumableCode ||
      onlineRoom ||
      !isOnlineApiReady ||
      isResumingOnlineRoom ||
      autoResumeAttemptedRef.current === resumableCode
    ) {
      return undefined;
    }

    autoResumeAttemptedRef.current = resumableCode;
    setSavedRoomCode(resumableCode);
    const timer = window.setTimeout(() => {
      resumeSavedOnlineRoom().catch?.(console.error);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [
    screen,
    savedRoomCode,
    onlineRoom,
    isOnlineApiReady,
    isResumingOnlineRoom,
  ]);

  useEffect(() => {
    if (!onlineRoom?.code || !isOnlineApiReady || !onlineApiRef.current) {
      return undefined;
    }

    let cancelled = false;
    let unsubscribe = () => {};

    unsubscribe = onlineApiRef.current.subscribeToRoom(
      onlineRoom.code,
      (remoteRoom) => {
        if (cancelled) return;

        if (!remoteRoom) {
          clearActiveRoomCode();
          setSavedRoomCode("");
          setOnlineRoom(null);
          setScreen("online-home");
          return;
        }

        applyRemoteRoomState(remoteRoom, true);
        syncOnlineScreenWithRoom(remoteRoom);
      },
      (error) => {
        console.error(error);
        setOnlineConnectionStatus("reconnecting");
      },
      (connection) => {
        setOnlineConnectionStatus(connection?.status || "idle");
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [onlineRoom?.code, isOnlineApiReady]);

  useEffect(() => {
    if (onlineApiRef.current?.usesSocketPresence) return undefined;

    // Firebase: mantém o heartbeat legado enquanto ele continuar selecionado como backend.
    const heartbeatParticipantId = myParticipantIdRef.current || localParticipantIdRef.current || localParticipantId;
    if (!onlineRoom?.code || !heartbeatParticipantId) return undefined;

    const sendHeartbeat = async () => {
      try {
        await touchParticipantPresence(onlineRoom.code, heartbeatParticipantId);
      } catch (error) {
        const code = error?.code || '';
        if (code === 'failed-precondition' || code === 'aborted' || code === 'unavailable') {
          return;
        }
        console.error(error);
      }
    };

    sendHeartbeat();
    const heartbeatId = window.setInterval(sendHeartbeat, 30000);

    return () => window.clearInterval(heartbeatId);
  }, [onlineRoom?.code, localParticipantId, isOnlineApiReady]);

  useEffect(() => {
    if (onlineApiRef.current?.usesSocketPresence) return undefined;
    if (!isOnlineHost || !onlineRoom?.code) return undefined;

    const pruneId = window.setInterval(() => {
      pruneStaleParticipants(onlineRoom.code).catch((error) => {
        const code = error?.code || '';
        if (code === 'failed-precondition' || code === 'aborted' || code === 'unavailable') {
          return;
        }
        console.error(error);
      });
    }, 30000);

    return () => window.clearInterval(pruneId);
  }, [isOnlineHost, onlineRoom?.code, isOnlineApiReady]);

  useEffect(() => {
    if (!onlineRoom?.code || !localParticipantId) return undefined;
    if (onlineApiRef.current?.leaveOnPageHide === false) return undefined;

    const handlePageHide = () => {
      const roomCode = onlineRoomRef.current?.code;
      const participantId = myParticipantIdRef.current || localParticipantIdRef.current;

      if (!roomCode || !participantId) return;

      leaveRoomDocument(roomCode, participantId).catch(console.error);
    };

    window.addEventListener("pagehide", handlePageHide);

    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [onlineRoom?.code, localParticipantId, isOnlineApiReady]);

  // Feedback leve quando o usuário vira host automaticamente (promoção por queda do anterior)
  useEffect(() => {
    if (isOnlineHost && onlineRoom?.hostId) {
      const timer = setTimeout(() => {
        setJustBecameHost(true);
        setTimeout(() => setJustBecameHost(false), 3800);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOnlineHost, onlineRoom?.hostId]);

  useEffect(() => {
    if (screen !== "online-matchmaking" || !isOnlineApiReady) return undefined;

    const api = onlineApiRef.current;
    const filters = {
      onlineMode: matchmakingSetup.onlineMode,
      difficulty:
        matchmakingSetup.onlineMode === "league" ? matchmakingSetup.difficulty : null,
    };

    refreshLobbyRooms().catch(console.error);

    if (typeof api?.subscribeToLobby === "function") {
      return api.subscribeToLobby(
        filters,
        (rooms) => {
          setLobbyRooms(rooms);
          setLobbyRoomsFeedback("");
          setIsLoadingLobbyRooms(false);
        },
        (error) => {
          console.error(error);
          setLobbyRoomsFeedback("Não foi possível acompanhar as salas em tempo real.");
        }
      );
    }

    // Firebase legado: continua usando consultas periódicas enquanto estiver selecionado.
    cleanupOldRooms().catch(console.error);
    const cleanupInterval = window.setInterval(() => {
      cleanupOldRooms().catch(console.error);
    }, 120000);
    const refreshInterval = window.setInterval(() => {
      refreshLobbyRooms().catch(console.error);
    }, 20000);

    return () => {
      clearInterval(cleanupInterval);
      clearInterval(refreshInterval);
    };
  }, [screen, isOnlineApiReady, matchmakingSetup.onlineMode, matchmakingSetup.difficulty]);

  const homeStatsCards = [
    {
      label: "Times na base",
      value: databaseStats.clubs,
      description: "clubes diferentes com elencos jogáveis",
      icon: Users,
    },
    {
      label: "Elencos históricos",
      value: databaseStats.squads,
      description: "versões clássicas, cult e marcantes",
      icon: LayoutGrid,
    },
    {
      label: "Jogadores cadastrados",
      value: databaseStats.players,
      description: "cartas disponíveis entre todos os elencos",
      icon: Shirt,
    },
  ];


  useEffect(() => {
    if (!onlineRoom?.liveRound?.roundStartedAt || onlineRoom.status !== "league") {
      return undefined;
    }

    const roundNumber = onlineRoom.liveRound.roundNumber;

    const tick = () => {
      const room = onlineRoomRef.current;
      if (
        !room?.liveRound?.roundStartedAt ||
        room.status !== "league" ||
        room.liveRound.roundNumber !== roundNumber
      ) {
        return;
      }

      const minute = getLiveMinuteFromRoomSnapshot(room, room.liveRound, 90);

      setOnlineLiveRound((current) => {
        if (!current || current.round?.round !== roundNumber) return current;
        const nextMinute = Math.max(Number(current.minute || 0), minute);
        if (current.minute === nextMinute) return current;

        return { ...current, minute: nextMinute };
      });
    };

    tick();
    const intervalId = window.setInterval(tick, 40);

    return () => window.clearInterval(intervalId);
  }, [
    onlineRoom?.liveRound?.roundStartedAt,
    onlineRoom?.liveRound?.roundNumber,
    onlineRoom?.status,
    onlineLiveSpeed,
    onlineRoom?.liveSpeed,
  ]);

  useEffect(() => {
    if (onlineApiRef.current?.serverControlsLiveSimulation) return undefined;

    if (
      !isOnlineHost ||
      !onlineRoom?.code ||
      onlineRoom.status !== "league" ||
      !onlineRoom.liveRound?.roundStartedAt
    ) {
      return undefined;
    }

    const roundNumber = onlineRoom.liveRound.roundNumber;
    let ended = false;

    const checkEnd = async () => {
      if (ended) return;

      const room = onlineRoomRef.current;
      if (!room?.liveRound || room.liveRound.roundNumber !== roundNumber) return;

      const minute = getLiveMinuteFromStartedAt(
        room.liveRound.roundStartedAt,
        liveSpeedRef.current,
        90,
        room._serverClockOffset || 0
      );

      if (minute < 90) return;

      ended = true;

      try {
        await patchRoomDocument(room.code, {
          liveRound: null,
          revealedRounds: roundNumber,
        });
      } catch (error) {
        console.error(error);
        ended = false;
      }
    };

    const intervalId = window.setInterval(checkEnd, 120);

    return () => window.clearInterval(intervalId);
  }, [
    isOnlineHost,
    onlineRoom?.code,
    onlineRoom?.status,
    onlineRoom?.liveRound?.roundNumber,
    onlineRoom?.liveRound?.roundStartedAt,
    onlineLiveSpeed,
    onlineRoom?.liveSpeed,
  ]);

  useEffect(() => {
    if (
      !onlineRoom?.duelLive?.roundStartedAt ||
      onlineRoom.status !== "duel" ||
      onlineRoom.duelLive.isFinished
    ) {
      return undefined;
    }

    const roundStartedAt = onlineRoom.duelLive.roundStartedAt;
    const matchIndex = onlineRoom.duelLive.matchIndex;

    const tick = () => {
      const room = onlineRoomRef.current;
      const match = room?.duelResult?.matches?.[matchIndex];
      if (!match) return;

      const endMinute = getDuelLiveEndMinute(match);
      const minute = getLiveMinuteFromStartedAt(
        roundStartedAt,
        liveSpeedRef.current,
        endMinute,
        onlineRoomRef.current?._serverClockOffset || 0
      );

      setOnlineDuelLive((current) => {
        if (!current || current.matchIndex !== matchIndex) return current;
        if (current.minute === minute && current.isFinished === room.duelLive.isFinished) return current;

        return {
          ...current,
          minute,
          isFinished: Boolean(room.duelLive.isFinished),
        };
      });
    };

    tick();
    const intervalId = window.setInterval(tick, 40);

    return () => window.clearInterval(intervalId);
  }, [
    onlineRoom?.duelLive?.roundStartedAt,
    onlineRoom?.duelLive?.matchIndex,
    onlineRoom?.duelLive?.isFinished,
    onlineRoom?.status,
    onlineLiveSpeed,
    onlineRoom?.liveSpeed,
  ]);

  useEffect(() => {
    if (
      !isOnlineHost ||
      !onlineRoom?.code ||
      onlineRoom.status !== "duel" ||
      !onlineRoom.duelLive?.roundStartedAt ||
      onlineRoom.duelLive.isFinished
    ) {
      return undefined;
    }

    const matchIndex = onlineRoom.duelLive.matchIndex;
    let ended = false;

    const checkEnd = async () => {
      if (ended) return;

      const room = onlineRoomRef.current;
      if (!room?.duelLive || room.duelLive.matchIndex !== matchIndex || room.duelLive.isFinished) {
        return;
      }

      const match = room.duelResult?.matches?.[matchIndex];
      if (!match) return;

      const endMinute = getDuelLiveEndMinute(match);
      const minute = getLiveMinuteFromStartedAt(
        room.duelLive.roundStartedAt,
        liveSpeedRef.current,
        endMinute
      );

      if (minute < endMinute) return;

      ended = true;

      try {
        await patchRoomDocument(room.code, {
          duelLive: {
            matchIndex,
            minute: endMinute,
            isFinished: true,
            roundStartedAt: null,
          },
        });
      } catch (error) {
        console.error(error);
        ended = false;
      }
    };

    const intervalId = window.setInterval(checkEnd, 120);

    return () => window.clearInterval(intervalId);
  }, [
    isOnlineHost,
    onlineRoom?.code,
    onlineRoom?.status,
    onlineRoom?.duelLive?.matchIndex,
    onlineRoom?.duelLive?.roundStartedAt,
    onlineRoom?.duelLive?.isFinished,
    onlineLiveSpeed,
    onlineRoom?.liveSpeed,
  ]);

  useEffect(() => {
    if (!soloLiveMatch) return undefined;

    const interval = window.setInterval(() => {
      setSoloLiveMatch((currentLiveMatch) => {
        if (!currentLiveMatch) return null;

        const nextMinute = currentLiveMatch.minute + 1;

        if (nextMinute > 90) {
          window.clearInterval(interval);

          const finishedRound = currentLiveMatch.match?.round || 0;

          setRevealedMatchesCount((currentCount) =>
            Math.min(
              Math.max(currentCount, finishedRound),
              leagueResult?.userMatches?.length || currentCount
            )
          );

          window.setTimeout(() => {
            currentMatchRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 80);

          return null;
        }

        return {
          ...currentLiveMatch,
          minute: nextMinute,
        };
      });
    }, getOnlineLiveSpeedInterval(onlineLiveSpeed));

    return () => window.clearInterval(interval);
  }, [soloLiveMatch?.match?.round, leagueResult, onlineLiveSpeed]);

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
    const pickedPlayerKeys = lineup.map((item) => getPlayerIdentityKey(item.player));

    return currentTeam.players
      .filter((player) => !pickedPlayerIds.includes(player.id))
      .map((player) => {
        const compatibleSlots = openSlots.filter((slot) =>
          canPlayerFitSlot(player, slot)
        );
        const isDuplicatePlayer = pickedPlayerKeys.includes(getPlayerIdentityKey(player));

        return {
          ...player,
          compatibleSlots,
          isDuplicatePlayer,
          isAvailable: compatibleSlots.length > 0 && !isDuplicatePlayer,
        };
      });
  }, [currentTeam, lineup, openSlots]);

  useEffect(() => {
    if (screen !== "online-draft") return undefined;
    if (!onlineRoom || !onlineDraftState || onlineDraftState.isComplete) return undefined;
    if (onlineRoom.config.pickTime === "none") return undefined;

    const currentParticipant = getOnlineCurrentParticipant(
      onlineDraftOrder,
      onlineDraftState.currentTurnIndex
    );

    if (!currentParticipant || currentParticipant.id !== localParticipantId) {
      setOnlinePickCountdown(null);
      return undefined;
    }

    if (onlinePickCountdown === null) {
      setOnlinePickCountdown(Number(onlineRoom.config.pickTime));
      return undefined;
    }

    if (onlinePickCountdown <= 0) {
      handleOnlineAutoPick();
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setOnlinePickCountdown((currentValue) =>
        currentValue === null ? null : Math.max(0, currentValue - 1)
      );
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [
    screen,
    onlineRoom,
    onlineDraftState,
    onlineDraftOrder,
    onlinePickCountdown,
    localParticipantId,
  ]);

  useEffect(() => {
    if (screen !== "online-draft" || !onlineDraftState || onlineDraftState.isComplete) return;

    setOnlinePickCountdown(
      onlineRoom?.config?.pickTime === "none" ? null : Number(onlineRoom.config.pickTime)
    );
  }, [onlineDraftState?.currentTurnIndex, onlineDraftState?.picksMadeThisTurn, screen]);

  // Se o host estiver no draft e o jogador do turno atual já saiu da sala,
  // avança automaticamente o estado pra não travar o draft pros demais.
  useEffect(() => {
    if (!isOnlineHost || screen !== "online-draft" || !onlineRoom || !onlineDraftState || onlineDraftState.isComplete) return;

    const current = getOnlineCurrentParticipant(onlineDraftOrder, onlineDraftState.currentTurnIndex);
    if (!current) return;

    const stillInRoom = onlineRoom.participants?.some((p) => p.id === current.id);
    if (stillInRoom) return;

    const nextState = getNextOnlineDraftState(onlineDraftState);
    patchRoomDocument(onlineRoom.code, { draftState: nextState }).catch(console.error);
  }, [isOnlineHost, screen, onlineRoom, onlineDraftState, onlineDraftOrder]);

  function startDraft() {
    setScreen("formations");
  }

  async function leaveCurrentOnlineRoom() {
    if (!onlineRoom?.code || !localParticipantId) return;

    try {
      await leaveRoomDocument(onlineRoom.code, localParticipantId);
    } catch (error) {
      console.error(error);
    }
  }

  async function exitOnlineRoom() {
    await leaveCurrentOnlineRoom();
    resetOnlineSessionState();
    await enterOnlineScreen("online-home");
  }

  function renderExitOnlineRoomButton(className = "") {
    return (
      <button
        type="button"
        onClick={exitOnlineRoom}
        className={
          className ||
          "inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-black text-rose-800 transition hover:bg-rose-100"
        }
      >
        <X size={16} />
        Sair da sala
      </button>
    );
  }

  function resetOnlineSessionState() {
    clearActiveRoomCode();
    setSavedRoomCode("");
    setResumeRoomFeedback("");
    setOnlineRoom(null);
    setOnlineDraftOrder([]);
    setIsDrawingOnlineOrder(false);
    setRollingOnlineParticipant("");
    setOnlineDraftState(null);
    setOnlinePendingSelection(null);
    setOnlinePickCountdown(null);
    setOnlineLeagueResult(null);
    setOnlineRevealedRounds(0);
    setDismissedOnlineChampionModal(false);
    onlineRoomRevisionRef.current = 0;
    setOnlineConnectionStatus("idle");
    myParticipantIdRef.current = "";
    hasSeenSelfInRoomRef.current = false;
  }

  async function goHome() {
    if (onlineRoom?.code) {
      await leaveCurrentOnlineRoom();
    }

    setScreen("home");
    setSelectedFormation(null);
    setGameMode("normal");
    setLineup([]);
    setCurrentTeam(null);
    setRollingTeam(null);
    setIsRolling(false);
    setRerollsRemaining(getDraftRerollLimit("normal"));
    setPendingSelection(null);
    setLeagueResult(null);
    setRevealedMatchesCount(0);
    setCopiedResult(false);
    resetOnlineSessionState();
  }

  function restartSoloFromFormation() {
    setLineup([]);
    setCurrentTeam(null);
    setRollingTeam(null);
    setIsRolling(false);
    setRerollsRemaining(getDraftRerollLimit(gameMode));
    setPendingSelection(null);
    setLeagueResult(null);
    setRevealedMatchesCount(0);
    setSoloLiveMatch(null);
    setCopiedResult(false);
    setShareImageUrl("");
    setShareMessage("");
    setScreen("formations");
  }

  async function restartOnlineFromLobby() {
    if (!onlineRoom) {
      openOnlineSetup();
      return;
    }

    if (!isOnlineHost) return;

    try {
      const api = await ensureOnlineApi();
      if (api.resetOnlineRoomToLobby) {
        const updatedRoom = await resetOnlineRoomToLobby(onlineRoom.code);
        if (updatedRoom) applyRemoteRoomState(updatedRoom, false);
      } else {
        await clearOnlineLeagueResult(onlineRoom.code);
        await patchRoomDocument(onlineRoom.code, {
          status: "lobby",
          draftOrder: [],
          draftState: null,
          isDrawingOrder: false,
          rollingParticipant: "",
          leagueResult: null,
          leagueResultStored: false,
          duelResult: null,
          revealedRounds: 0,
          liveRound: null,
          duelLive: null,
        });
      }

      setOnlineLiveRound(null);
      setOnlineDuelLive(null);
      setOnlinePendingSelection(null);
      setOnlinePickCountdown(null);
      setDismissedOnlineChampionModal(false);
      setScreen("online-lobby");
    } catch (error) {
      console.error(error);
      window.alert("Não foi possível reiniciar a sala agora.");
    }
  }

  function updateOnlineRoomConfig(field, value) {
    if (!isOnlineHost || !onlineRoom) return;

    setOnlineRoom((currentRoom) => {
      if (!currentRoom) return currentRoom;

      const nextConfig = {
        ...currentRoom.config,
        [field]: value,
      };

      if (field === "draftType") {
        nextConfig.draftType = value;
      }

      if (field === "difficulty") {
        nextConfig.difficulty = value;
      }

      if (field === "pickTime") {
        nextConfig.pickTime = value;
      }

      if (field === "cardsPerTurn") {
        nextConfig.cardsPerTurn = Number(value);
      }

      if (field === "picksPerTurn") {
        nextConfig.picksPerTurn = Number(value);
      }

      if (field === "duelFormat") {
        nextConfig.duelFormat = value;

        if (!duelFormatAllowsExtraTime(value)) {
          nextConfig.duelExtraTime = false;
        }

        if (duelFormatRequiresPenalties(value)) {
          nextConfig.duelPenalties = true;
        }
      }

      if (field === "duelExtraTime") {
        nextConfig.duelExtraTime = duelFormatAllowsExtraTime(nextConfig.duelFormat) ? Boolean(value) : false;

        if (nextConfig.duelExtraTime) {
          nextConfig.duelPenalties = true;
        }
      }

      if (field === "duelPenalties") {
        nextConfig.duelPenalties =
          nextConfig.duelExtraTime || duelFormatRequiresPenalties(nextConfig.duelFormat)
            ? true
            : Boolean(value);
      }

      const normalizedConfig = getDuelConfigWithRules(nextConfig);
      const nextRoom = {
        ...currentRoom,
        config: normalizedConfig,
      };

      patchRoomDocument(currentRoom.code, { config: normalizedConfig }).catch(console.error);

      return nextRoom;
    });
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
    setRerollsRemaining(getDraftRerollLimit(gameMode));
    setPendingSelection(null);
    setLeagueResult(null);
    setRevealedMatchesCount(0);
    setSoloLiveMatch(null);
    setCopiedResult(false);
    setScreen("draft");
  }

  function openOnlineSetup() {
    handleEnterOnlineClick("online-setup");
  }

  function openOnlineJoin() {
    setJoinRoomCode("");
    setJoinRoomFeedback("");
    handleEnterOnlineClick("online-join");
  }

  function openOnlineMatchmaking() {
    handleEnterOnlineClick("online-matchmaking");
  }

  async function tryJoinOnlineRoom() {
    const normalizedCode = joinRoomCode.trim().toUpperCase();

    if (!normalizedCode) {
      setJoinRoomFeedback("Digite o código da sala para entrar.");
      return;
    }

    if (!onlineSetup.playerName.trim()) {
      setJoinRoomFeedback("Digite seu nome para entrar na sala.");
      return;
    }

    if (!onlineSetup.teamName.trim()) {
      setJoinRoomFeedback("Digite o nome do seu time para entrar na sala.");
      return;
    }

    setIsJoiningOnlineRoom(true);
    setJoinRoomFeedback("Entrando na sala... (pode levar alguns segundos em salas movimentadas)");

    try {
      const room = await fetchRoomByCode(normalizedCode);

      if (!room) {
        setJoinRoomFeedback("Sala não encontrada. Confira o código e tente de novo.");
        return;
      }

      if (room.status !== "lobby") {
        setJoinRoomFeedback("Essa sala já está em andamento. Só é possível entrar enquanto ela estiver no lobby.");
        return;
      }

      const hasClientVisiblePassword = !!(
        room.config?.password && String(room.config.password).trim()
      );
      const isProtected = room.config?.isPrivate || hasClientVisiblePassword;
      const enteredPass = (joinRoomPassword || "").trim();

      if (isProtected && !enteredPass) {
        setJoinRoomFeedback("Digite a senha para entrar nesta sala privada.");
        return;
      }

      // Compatibilidade com o Firebase legado. Na Cloudflare, a senha nunca é enviada ao navegador
      // e a validação acontece exclusivamente no servidor.
      if (
        hasClientVisiblePassword &&
        enteredPass !== String(room.config.password || "").trim()
      ) {
        setJoinRoomFeedback("Senha incorreta. Esta é uma sala privada.");
        return;
      }

      await ensureOnlineApi();
      const playerId = localParticipantIdRef.current || localParticipantId;
      const selectedFormation = getFormationById(onlineSetup.formationId);
      const participant = {
        id: playerId,
        playerName: onlineSetup.playerName.trim() || "Jogador",
        teamName: onlineSetup.teamName.trim() || "Meu XI",
        formationId: selectedFormation.id,
        formationName: selectedFormation.name,
        isHost: false,
        isReady: true,
      };

      // Lock the exact id we used to join this room (used for ejection checks and heartbeats).
      myParticipantIdRef.current = playerId;
      localParticipantIdRef.current = playerId;
      setLocalParticipantId(playerId);

      await joinRoomDocument(normalizedCode, participant, { password: enteredPass });

      rememberActiveRoomCode(normalizedCode);
      setSavedRoomCode(normalizedCode);
      applyRemoteRoomState({
        ...room,
        participants: [...(room.participants || []), participant],
        participantIds: [
          ...(room.participantIds || (room.participants || []).map((entry) => entry.id)),
          playerId,
        ],
      });
      setScreen("online-lobby");
    } catch (error) {
      setJoinRoomFeedback(error?.message || "Não foi possível entrar na sala.");
    } finally {
      setIsJoiningOnlineRoom(false);
    }
  }

  function updateMatchmakingSetup(field, value) {
    setMatchmakingSetup((currentSetup) => ({
      ...currentSetup,
      [field]: value,
    }));
  }

  async function refreshLobbyRooms() {
    // Ao atualizar a lista, fechamos qualquer prompt de senha pendente
    setPendingPrivateLobbyRoom(null);
    setLobbyJoinPassword("");
    setLobbyRoomsFeedback("");

    setIsLoadingLobbyRooms(true);

    try {
      // Cleanup de rooms antigas é feito de forma esporádica (não em todo refresh)
      // para reduzir contenção em documentos de salas populares.
      const rooms = await listLobbyRooms({
        onlineMode: matchmakingSetup.onlineMode,
        difficulty:
          matchmakingSetup.onlineMode === "league" ? matchmakingSetup.difficulty : null,
      });
      setLobbyRooms(rooms);
    } catch (error) {
      console.error(error);
      setLobbyRoomsFeedback("Não foi possível carregar as salas abertas.");
    } finally {
      setIsLoadingLobbyRooms(false);
    }
  }

  async function joinLobbyRoom(roomCode) {
    const normalizedCode = String(roomCode || "").trim().toUpperCase();

    if (!onlineSetup.teamName.trim()) {
      setLobbyRoomsFeedback("Digite o nome do seu time antes de entrar.");
      return;
    }

    // Limpa qualquer prompt anterior de senha
    setPendingPrivateLobbyRoom(null);
    setLobbyJoinPassword("");

    setJoiningLobbyRoomCode(normalizedCode);
    setLobbyRoomsFeedback("Verificando sala...");

    try {
      await ensureOnlineApi();

      const playerId = await (async () => {
        try {
          const api = onlineApiRef.current;
          if (api && typeof api.ensureAnonymousAuth === "function") {
            return await api.ensureAnonymousAuth();
          }
        } catch {}
        return localParticipantIdRef.current || localParticipantId;
      })();

      const room = await fetchRoomByCode(normalizedCode);

      if (!room) {
        setLobbyRoomsFeedback("Sala não encontrada.");
        setJoiningLobbyRoomCode("");
        return;
      }

      if (room.status !== "lobby") {
        setLobbyRoomsFeedback("Essa sala já começou.");
        await refreshLobbyRooms();
        setJoiningLobbyRoomCode("");
        return;
      }

      // Detecta se a sala foi criada com senha.
      // Se sim, NÃO entra direto: abre o prompt de senha (popup inline) e guarda os dados.
      const hasPassword = !!(room.config?.password && String(room.config.password).trim());
      const isProtected = room.config?.isPrivate || hasPassword;

      if (isProtected) {
        setPendingPrivateLobbyRoom({ code: normalizedCode, room });
        setLobbyJoinPassword("");
        setLobbyRoomsFeedback("");
        setJoiningLobbyRoomCode("");
        return;
      }

      // Sala pública (sem senha): entra normalmente
      setLobbyRoomsFeedback("Entrando na sala... (salas populares podem demorar alguns segundos devido à alta atividade simultânea)");

      const selectedFormation = getFormationById(onlineSetup.formationId);
      const participant = {
        id: playerId,
        playerName: onlineSetup.playerName.trim() || "Jogador",
        teamName: onlineSetup.teamName.trim() || "Meu XI",
        formationId: selectedFormation.id,
        formationName: selectedFormation.name,
        isHost: false,
        isReady: true,
      };

      myParticipantIdRef.current = playerId;
      localParticipantIdRef.current = playerId;
      setLocalParticipantId(playerId);

      await joinRoomDocument(normalizedCode, participant);
      rememberActiveRoomCode(normalizedCode);
      setSavedRoomCode(normalizedCode);
      applyRemoteRoomState({
        ...room,
        participants: [...(room.participants || []), participant],
        participantIds: [...(room.participantIds || []), playerId],
      });
      setScreen("online-lobby");
    } catch (error) {
      const message = error?.message || "Não foi possível entrar na sala.";
      if (error?.code === "permission-denied" || /permission|insufficient|Missing or insufficient/i.test(message)) {
        setLobbyRoomsFeedback(
          "Erro de permissão. Verifique se o login anônimo está ativado no Firebase e se as regras do Firestore estão publicadas."
        );
      } else {
        setLobbyRoomsFeedback(message);
      }
    } finally {
      setJoiningLobbyRoomCode("");
    }
  }

  // Confirma entrada em sala protegida por senha (chamado do prompt que aparece na lista)
  async function confirmJoinPrivateLobbyRoom() {
    if (!pendingPrivateLobbyRoom) return;

    const { code: normalizedCode, room } = pendingPrivateLobbyRoom;
    const enteredPass = (lobbyJoinPassword || "").trim();
    const clientVisiblePassword = String(room.config?.password || "").trim();

    if (!enteredPass) {
      setLobbyRoomsFeedback("Digite a senha da sala.");
      return;
    }

    // Somente o Firebase legado expõe a senha no documento. Na Cloudflare, o servidor valida.
    if (clientVisiblePassword && enteredPass !== clientVisiblePassword) {
      setLobbyRoomsFeedback("Senha incorreta. Tente novamente.");
      return;
    }

    if (!onlineSetup.teamName.trim()) {
      setLobbyRoomsFeedback("Digite o nome do seu time antes de entrar.");
      return;
    }

    setJoiningLobbyRoomCode(normalizedCode);
    setLobbyRoomsFeedback("Entrando na sala... (salas populares podem demorar alguns segundos devido à alta atividade simultânea)");

    try {
      await ensureOnlineApi();

      const playerId = await (async () => {
        try {
          const api = onlineApiRef.current;
          if (api && typeof api.ensureAnonymousAuth === "function") {
            return await api.ensureAnonymousAuth();
          }
        } catch {}
        return localParticipantIdRef.current || localParticipantId;
      })();

      const selectedFormation = getFormationById(onlineSetup.formationId);
      const participant = {
        id: playerId,
        playerName: onlineSetup.playerName.trim() || "Jogador",
        teamName: onlineSetup.teamName.trim() || "Meu XI",
        formationId: selectedFormation.id,
        formationName: selectedFormation.name,
        isHost: false,
        isReady: true,
      };

      myParticipantIdRef.current = playerId;
      localParticipantIdRef.current = playerId;
      setLocalParticipantId(playerId);

      await joinRoomDocument(normalizedCode, participant, { password: enteredPass });
      rememberActiveRoomCode(normalizedCode);
      setSavedRoomCode(normalizedCode);
      applyRemoteRoomState({
        ...room,
        participants: [...(room.participants || []), participant],
        participantIds: [...(room.participantIds || []), playerId],
      });

      // Limpa o prompt de senha
      setPendingPrivateLobbyRoom(null);
      setLobbyJoinPassword("");
      setScreen("online-lobby");
    } catch (error) {
      const message = error?.message || "Não foi possível entrar na sala.";
      if (error?.code === "permission-denied" || /permission|insufficient|Missing or insufficient/i.test(message)) {
        setLobbyRoomsFeedback(
          "Erro de permissão. Verifique se o login anônimo está ativado no Firebase e se as regras do Firestore estão publicadas."
        );
      } else {
        setLobbyRoomsFeedback(message);
      }
      // Mantém o prompt aberto para o usuário tentar de novo ou cancelar
    } finally {
      setJoiningLobbyRoomCode("");
    }
  }

  function cancelPrivateLobbyPasswordPrompt() {
    setPendingPrivateLobbyRoom(null);
    setLobbyJoinPassword("");
    setLobbyRoomsFeedback("");
  }

  function updateOnlineSetup(field, value) {
    setOnlineSetup((currentSetup) => {
      const nextSetup = {
        ...currentSetup,
        [field]: value,
      };

      if (field === "duelFormat") {
        if (!duelFormatAllowsExtraTime(value)) {
          nextSetup.duelExtraTime = false;
        }

        if (duelFormatRequiresPenalties(value)) {
          nextSetup.duelPenalties = true;
        }
      }

      if (field === "duelExtraTime") {
        if (!duelFormatAllowsExtraTime(currentSetup.duelFormat)) {
          nextSetup.duelExtraTime = false;
        }

        if (value) {
          nextSetup.duelPenalties = true;
        }
      }

      if (field === "duelPenalties") {
        if (currentSetup.duelExtraTime || duelFormatRequiresPenalties(currentSetup.duelFormat)) {
          nextSetup.duelPenalties = true;
        }
      }

      return nextSetup;
    });
  }

  async function createOnlineRoom() {
    const selectedOnlineFormation = getFormationById(onlineSetup.formationId);
    await ensureOnlineApi();

    // Always get the *live* UID right before building the room payload.
    // The service layer will also enforce this UID to satisfy security rules.
    const playerId = await (async () => {
      try {
        const api = onlineApiRef.current;
        if (api && typeof api.ensureAnonymousAuth === "function") {
          const liveUid = await api.ensureAnonymousAuth();
          console.log("[createOnlineRoom] live uid from ensure before build:", liveUid);
          return liveUid;
        }
      } catch (e) {
        console.warn("[createOnlineRoom] failed to get live uid, falling back", e);
      }
      const fallback = localParticipantIdRef.current || localParticipantId;
      console.log("[createOnlineRoom] using fallback playerId:", fallback);
      return fallback;
    })();

    const roomCode = createRoomCode();

    // Prevent creating private rooms without a password (would be unusable)
    if (onlineSetup.isPrivate) {
      const pw = (onlineSetup.roomPassword || "").trim();
      if (!pw) {
        window.alert("Para criar uma sala privada, defina uma senha.");
        return;
      }
    }

    const hostParticipant = {
      id: playerId,
      playerName: onlineSetup.playerName.trim() || "Jogador",
      teamName: onlineSetup.teamName.trim() || "Meu XI",
      formationId: selectedOnlineFormation.id,
      formationName: selectedOnlineFormation.name,
      isHost: true,
      isReady: true,
    };

    // Build a clean persisted config. Never include `undefined` values (Firestore rejects them)
    // and do not leak the transient UI field `roomPassword`.
    const baseConfig = {
      ...onlineSetup,
      roomName: onlineSetup.roomName.trim() || "Sala 38–0",
      teamName: onlineSetup.teamName.trim() || "Meu XI",
      playerName: onlineSetup.playerName.trim() || "Jogador",
      formationId: selectedOnlineFormation.id,
      maxPlayers: onlineSetup.onlineMode === "duel" ? 2 : 20,
      cardsPerTurn: Number(onlineSetup.cardsPerTurn),
      picksPerTurn: Number(onlineSetup.picksPerTurn),
      isPrivate: !!onlineSetup.isPrivate,
    };

    if (baseConfig.isPrivate) {
      const pw = (onlineSetup.roomPassword || "").trim();
      if (pw) {
        baseConfig.password = pw;
      }
    }
    delete baseConfig.roomPassword;

    const room = {
      id: roomCode,
      code: roomCode,
      roomName: onlineSetup.roomName.trim() || "Sala 38–0",
      status: "lobby",
      hostId: playerId,
      config: baseConfig,
      participants: [hostParticipant],
      participantIds: [playerId],
      draftOrder: [],
      draftState: null,
      isDrawingOrder: false,
      rollingParticipant: "",
      leagueResult: null,
      leagueResultStored: false,
      duelResult: null,
      revealedRounds: 0,
      liveRound: null,
      duelLive: null,
      liveSpeed: "normal",
    };

    setIsCreatingOnlineRoom(true);

    try {
      const created = await createRoomDocument(room);
      const effectiveId = created?.hostId || playerId;

      myParticipantIdRef.current = effectiveId;
      localParticipantIdRef.current = effectiveId;
      setLocalParticipantId(effectiveId);
      setSavedRoomCode(created?.code || roomCode);
      applyRemoteRoomState(created || room);
      syncHostLiveSpeedFromRoom(created || room);
      setScreen("online-lobby");
    } catch (error) {
      const message = error?.message || "Não foi possível criar a sala.";
      console.error("Failed to create online room:", error?.message || error);


      // Surface permission errors more clearly (often means anonymous auth is disabled or rules need deploy)
      if (error?.code === "permission-denied" || /permission|insufficient|Missing or insufficient/i.test(message)) {
        window.alert(
          "Erro de permissão ao criar a sala (Missing or insufficient permissions).\n\n" +
            "Regras publicadas estão corretas (você confirmou). Anonymous está ativado.\n\n" +
            "Possíveis causas restantes:\n" +
            "• O auth token não está sendo enviado junto com o setDoc (veja o log 'live auth.currentUser?.uid at write time').\n" +
            "• Build antigo em cache no navegador.\n" +
            "• Sessão anônima 'velha' com problema.\n\n" +
            "FAÇA ISSO AGORA:\n" +
            "1. Pare o dev server, rode `npm run dev` de novo.\n" +
            "2. Abra uma janela **Anônima/Incognito** do navegador.\n" +
            "3. Acesse a página, vá até criar sala.\n" +
            "4. ANTES de clicar em Criar, abra o Console (F12).\n" +
            "5. Clique em Criar sala e cole aqui **tudo** que aparecer com [createRoom].\n\n" +
            "Procure especialmente a linha:\n" +
            "  [createRoom] live auth.currentUser?.uid at write time: xxxxx\n\n" +
            "Detalhe técnico: " + message
        );
      } else {
        window.alert(message);
      }
    } finally {
      setIsCreatingOnlineRoom(false);
    }
  }

  async function startOnlineOrderScreen() {
    if (!isOnlineHost || !onlineRoom || onlineRoom.participants.length < 2) return;

    if (onlineApiRef.current?.supportsGameFlow === false) {
      window.alert(
        "O lobby já está conectado à Cloudflare. O sorteio, draft e simulação serão ligados na próxima etapa."
      );
      return;
    }

    await patchRoomDocument(onlineRoom.code, {
      status: "order",
      draftOrder: [],
      rollingParticipant: "",
      isDrawingOrder: false,
    });
  }

  async function startOnlineOrderDraw() {
    if (!isOnlineHost || !onlineRoom || isDrawingOnlineOrder) return;

    const finalOrder = shuffleArray(onlineRoom.participants);

    await patchRoomDocument(onlineRoom.code, {
      draftOrder: [],
      rollingParticipant: "",
      isDrawingOrder: true,
    });

    finalOrder.forEach((participant, index) => {
      window.setTimeout(() => {
        patchRoomDocument(onlineRoom.code, {
          rollingParticipant: participant.teamName,
        }).catch(console.error);
      }, index * 780);

      window.setTimeout(() => {
        const nextOrder = finalOrder.slice(0, index + 1);

        patchRoomDocument(onlineRoom.code, {
          draftOrder: nextOrder,
          rollingParticipant: "",
          isDrawingOrder: index < finalOrder.length - 1,
        }).catch(console.error);
      }, index * 780 + 520);
    });
  }

  function createOnlineDraftStateFromRoom(room, order) {
    const lineupsMap = Object.fromEntries(order.map((participant) => [participant.id, []]));
    const pickedPlayerKeys = [];
    const currentParticipant = getOnlineCurrentParticipant(order, 0);
    const draftOptions = dealOnlineDraftOptions({
      room,
      lineupsMap,
      pickedPlayerKeys,
      participant: currentParticipant,
    });

    return {
      currentTurnIndex: 0,
      picksMadeThisTurn: 0,
      lineupsMap,
      pickedPlayerKeys,
      currentCards: draftOptions.currentCards,
      currentTeamOption: draftOptions.currentTeamOption,
      log: [],
      isComplete: false,
    };
  }

  async function goToOnlineDraftPreview() {
    if (!isOnlineHost || !onlineRoom || !onlineDraftOrder.length) return;

    const draftState = createOnlineDraftStateFromRoom(onlineRoom, onlineDraftOrder);

    setOnlinePendingSelection(null);
    setOnlinePickCountdown(onlineRoom.config.pickTime === "none" ? null : Number(onlineRoom.config.pickTime));

    await patchRoomDocument(onlineRoom.code, {
      status: "draft",
      draftState,
    });
  }

  function getNextOnlineDraftState(currentState) {
    if (!onlineRoom || !currentState) return currentState;

    let nextTurnIndex = currentState.currentTurnIndex + 1;
    let nextParticipant = getOnlineCurrentParticipant(onlineDraftOrder, nextTurnIndex);
    let safety = 0;

    while (
      nextParticipant &&
      getOnlineOpenSlots(nextParticipant, currentState.lineupsMap).length === 0 &&
      safety < onlineDraftOrder.length * 12
    ) {
      nextTurnIndex += 1;
      nextParticipant = getOnlineCurrentParticipant(onlineDraftOrder, nextTurnIndex);
      safety += 1;
    }

    const isComplete = areOnlineLineupsComplete(onlineDraftOrder, currentState.lineupsMap);

    if (isComplete || !nextParticipant) {
      return {
        ...currentState,
        isComplete: true,
        currentCards: [],
        currentTeamOption: null,
      };
    }

    return {
      ...currentState,
      currentTurnIndex: nextTurnIndex,
      picksMadeThisTurn: 0,
      ...dealOnlineDraftOptions({
        room: onlineRoom,
        lineupsMap: currentState.lineupsMap,
        pickedPlayerKeys: currentState.pickedPlayerKeys,
        participant: nextParticipant,
      }),
    };
  }

  async function applyOnlinePick(card, source = "manual", forcedSlot = null) {
    if (!onlineRoom || !onlineDraftState || onlineDraftState.isComplete || !card) return;

    const participant = getOnlineCurrentParticipant(
      onlineDraftOrder,
      onlineDraftState.currentTurnIndex
    );

    if (!participant || participant.id !== localParticipantId) return;

    // Proteção extra: se o jogador do turno atual não está mais na sala, não permite pick
    const stillInRoom = onlineRoom.participants?.some((p) => p.id === participant.id);
    if (!stillInRoom) return;

    const openSlots = getOnlineOpenSlots(participant, onlineDraftState.lineupsMap);
    const compatibleSlots = getOnlineCardCompatibleSlots(card, openSlots);

    if (!compatibleSlots.length) return;

    const slot = forcedSlot && compatibleSlots.some((compatibleSlot) => compatibleSlot.index === forcedSlot.index)
      ? forcedSlot
      : compatibleSlots[0];
    const participantLineup = onlineDraftState.lineupsMap[participant.id] || [];
    const nextLineupsMap = {
      ...onlineDraftState.lineupsMap,
      [participant.id]: [
        ...participantLineup,
        {
          slotIndex: slot.index,
          slotPosition: slot.position,
          player: card.player,
          team: card.team,
        },
      ],
    };
    const nextPickedKeys = [...onlineDraftState.pickedPlayerKeys, card.identityKey];
    const picksNeededThisTurn = getOnlinePicksNeededThisTurn(
      participant,
      onlineDraftState.lineupsMap,
      onlineRoom.config.picksPerTurn
    );
    const nextPicksMadeThisTurn = onlineDraftState.picksMadeThisTurn + 1;
    const nextLog = [
      {
        id: `${Date.now()}-${card.id}`,
        participant: participant.teamName,
        player: card.player.name,
        team: card.team.label,
        source,
      },
      ...onlineDraftState.log,
    ].slice(0, 8);

    let nextState = {
      ...onlineDraftState,
      lineupsMap: nextLineupsMap,
      pickedPlayerKeys: nextPickedKeys,
      picksMadeThisTurn: nextPicksMadeThisTurn,
      currentCards: onlineDraftState.currentCards.filter((currentCard) => currentCard.id !== card.id),
      log: nextLog,
    };

    const participantIsComplete = getOnlineOpenSlots(participant, nextLineupsMap).length === 0;
    const shouldAdvanceTurn = nextPicksMadeThisTurn >= picksNeededThisTurn || participantIsComplete;

    if (areOnlineLineupsComplete(onlineDraftOrder, nextLineupsMap)) {
      nextState = {
        ...nextState,
        isComplete: true,
        currentCards: [],
        currentTeamOption: null,
      };
    } else if (shouldAdvanceTurn) {
      nextState = getNextOnlineDraftState(nextState);
    }

    setOnlinePendingSelection(null);
    setOnlinePickCountdown(
      onlineRoom.config.pickTime === "none" || nextState.isComplete
        ? null
        : Number(onlineRoom.config.pickTime)
    );

    try {
      await patchRoomDocument(onlineRoom.code, { draftState: nextState });
    } catch (error) {
      console.error(error);
    }
  }

  function handleOnlineCardClick(card) {
    if (!onlineRoom || !onlineDraftState || onlineDraftState.isComplete || !card) return;

    const participant = getOnlineCurrentParticipant(
      onlineDraftOrder,
      onlineDraftState.currentTurnIndex
    );

    if (!participant || participant.id !== localParticipantId) return;

    const openSlots = getOnlineOpenSlots(participant, onlineDraftState.lineupsMap);
    const compatibleSlots = getOnlineCardCompatibleSlots(card, openSlots);

    if (!compatibleSlots.length) return;

    if (compatibleSlots.length === 1) {
      applyOnlinePick(card, "manual", compatibleSlots[0]);
      return;
    }

    setOnlinePendingSelection({
      card,
      player: card.player,
      team: card.team,
      compatibleSlots,
    });
  }

  function handleOnlinePendingSlotClick(slot) {
    if (!onlinePendingSelection) return;

    applyOnlinePick(onlinePendingSelection.card, "manual", slot);
  }

  function handleOnlineAutoPick() {
    if (!onlineRoom || !onlineDraftState || onlineDraftState.isComplete) return;

    const participant = getOnlineCurrentParticipant(
      onlineDraftOrder,
      onlineDraftState.currentTurnIndex
    );

    if (!participant) return;

    const stillInRoom = onlineRoom.participants?.some((p) => p.id === participant.id);
    if (!stillInRoom) return;

    const openSlots = getOnlineOpenSlots(participant, onlineDraftState.lineupsMap);
    const shuffledOpenSlots = shuffleArray(openSlots);
    let candidates = [];

    for (const slot of shuffledOpenSlots) {
      candidates = onlineDraftState.currentCards.filter((card) =>
        canOnlineCardFitOpenSlot(card, slot)
      );

      if (candidates.length) break;
    }

    const fallbackCandidates = candidates.length ? candidates : onlineDraftState.currentCards;
    const randomCard = fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)];

    if (!randomCard) {
      setOnlineDraftState((currentState) => getNextOnlineDraftState(currentState));
      setOnlinePickCountdown(onlineRoom.config.pickTime === "none" ? null : Number(onlineRoom.config.pickTime));
      return;
    }

    setOnlinePendingSelection(null);
    applyOnlinePick(randomCard, "auto");
  }


  async function startOnlineBrazilianLeague() {
    if (!isOnlineHost || !onlineRoom || !onlineDraftState?.isComplete) return;

    setIsStartingOnlineLeague(true);

    try {
      const api = await ensureOnlineApi();

      if (api.supportsLeagueSimulation === false) {
        window.alert("A simulação do Brasileirão ainda não está disponível neste backend.");
        return;
      }

      if (api.startOnlineLeagueSimulation) {
        const databaseTeamsNeeded = Math.max(0, 20 - onlineDraftOrder.length);
        const databaseTeams = buildOnlineLeagueDatabasePayload(databaseTeamsNeeded);
        const updatedRoom = await startOnlineLeagueSimulation(onlineRoom.code, {
          databaseTeams,
          liveSpeed: onlineLiveSpeed || "normal",
        });

        if (updatedRoom) {
          applyRemoteRoomState(updatedRoom, false);
          syncOnlineScreenWithRoom(updatedRoom);
        }
        setDismissedOnlineChampionModal(false);
        setScreen("online-league");
        return;
      }

      const result = simulateOnlineBrazilianLeague(
        onlineRoom,
        onlineDraftOrder,
        onlineDraftState.lineupsMap
      );
      const slimResult = slimLeagueResultForFirestore(result);

      const currentId = localParticipantIdRef.current || localParticipantId;
      const amStillHost = onlineRoom.hostId === currentId ||
        Boolean(onlineRoom.participants?.find((p) => p.id === currentId)?.isHost);
      if (!amStillHost) {
        window.alert("Você não é mais o host desta sala.");
        return;
      }

      await withRetry(() => saveOnlineLeagueResult(onlineRoom.code, slimResult));
      await withRetry(() => patchRoomDocument(onlineRoom.code, {
        status: "league",
        leagueResultStored: true,
        leagueResult: null,
        draftState: null,
        revealedRounds: 0,
        liveRound: null,
        liveSpeed: onlineLiveSpeed || "normal",
        duelLive: null,
      }));

      setDismissedOnlineChampionModal(false);
      setOnlineLeagueResult(result);
      setScreen("online-league");
    } catch (error) {
      console.error("Failed to start online league:", error);
      const detail = error?.code || error?.message || String(error);
      window.alert(
        "Não foi possível sincronizar o Brasileirão com os outros jogadores.\n\n" +
        "Detalhe técnico: " + detail
      );
    } finally {
      setIsStartingOnlineLeague(false);
    }
  }

  async function updateOnlineLiveSpeed(speed) {
    if (!isOnlineHost) return;

    const previousSpeed = liveSpeedRef.current;
    liveSpeedRef.current = speed;
    setOnlineLiveSpeed(speed);

    const room = onlineRoomRef.current;
    if (room) {
      onlineRoomRef.current = { ...room, liveSpeed: speed };
    }
    if (!onlineRoom?.code) return;

    try {
      const api = await ensureOnlineApi();
      if (api.updateOnlineSimulationSpeed) {
        const updatedRoom = await updateOnlineSimulationSpeed(onlineRoom.code, speed);
        if (updatedRoom) applyRemoteRoomState(updatedRoom, false);
        return;
      }

      const updates = { liveSpeed: speed };
      if (room?.liveRound?.roundStartedAt && room.status === "league") {
        const currentMinute = getLiveMinuteFromStartedAt(room.liveRound.roundStartedAt, previousSpeed);
        updates.liveRound = {
          ...room.liveRound,
          roundStartedAt: Date.now() - currentMinute * getOnlineLiveSpeedInterval(speed),
        };
      }
      if (room?.duelLive?.roundStartedAt && room.status === "duel" && !room.duelLive.isFinished) {
        const match = room.duelResult?.matches?.[room.duelLive.matchIndex];
        const endMinute = match ? getDuelLiveEndMinute(match) : 90;
        const currentMinute = getLiveMinuteFromStartedAt(
          room.duelLive.roundStartedAt,
          previousSpeed,
          endMinute
        );
        updates.duelLive = {
          ...room.duelLive,
          roundStartedAt: Date.now() - currentMinute * getOnlineLiveSpeedInterval(speed),
        };
      }
      await patchRoomDocument(onlineRoom.code, updates);
    } catch (error) {
      console.error(error);
    }
  }

  async function revealNextOnlineRound() {
    if (!isOnlineHost || !onlineRoom || !onlineLeagueResult || onlineRoom.liveRound || onlineLiveRound) {
      return;
    }

    const round = onlineLeagueResult.rounds[onlineRevealedRounds];
    if (!round) return;

    try {
      const api = await ensureOnlineApi();
      if (api.startOnlineLeagueRound) {
        const updatedRoom = await startOnlineLeagueRound(onlineRoom.code);
        if (updatedRoom) applyRemoteRoomState(updatedRoom, false);
        return;
      }

      await patchRoomDocument(onlineRoom.code, {
        liveRound: {
          roundNumber: round.round,
          minute: 0,
          roundStartedAt: Date.now(),
        },
      });
    } catch (error) {
      console.error(error);

      // Se o cliente estava atrasado, buscamos o snapshot autoritativo em vez
      // de deixá-lo travado na rodada anterior.
      try {
        const latestRoom = await fetchRoomByCode(onlineRoom.code);
        if (latestRoom) {
          applyRemoteRoomState(latestRoom, true);
          syncOnlineScreenWithRoom(latestRoom);
          return;
        }
      } catch (syncError) {
        console.error(syncError);
      }

      window.alert("Não foi possível iniciar a rodada agora. A sala tentará sincronizar novamente.");
    }
  }

  async function simulateAllOnlineRounds() {
    if (!isOnlineHost || !onlineRoom || !onlineLeagueResult) return;

    try {
      const api = await ensureOnlineApi();
      if (api.simulateAllOnlineLeagueRounds) {
        const updatedRoom = await simulateAllOnlineLeagueRounds(onlineRoom.code);
        if (updatedRoom) applyRemoteRoomState(updatedRoom, false);
        return;
      }

      await patchRoomDocument(onlineRoom.code, {
        liveRound: null,
        revealedRounds: onlineLeagueResult.rounds.length,
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function startOnlineDuel() {
    if (!isOnlineHost || !onlineRoom || !onlineDraftState?.isComplete) return;

    if (onlineApiRef.current?.supportsDuelSimulation === false) {
      window.alert(
        "O Brasileirão já está no servidor da Cloudflare. A simulação do duelo será ligada na próxima etapa."
      );
      return;
    }

    const result = simulateOnlineDuel(
      onlineRoom,
      onlineDraftOrder,
      onlineDraftState.lineupsMap
    );

    if (!result) return;

    try {
      await ensureOnlineApi();
      const currentId = localParticipantIdRef.current || localParticipantId;
      const amStillHost = onlineRoom.hostId === currentId ||
        Boolean(onlineRoom.participants?.find((p) => p.id === currentId)?.isHost);
      if (!amStillHost) {
        window.alert("Você não é mais o host desta sala.");
        return;
      }

      const duelUpdates = {
        status: "duel",
        duelResult: result,
        liveRound: null,
        liveSpeed: onlineLiveSpeed || "normal",
        duelLive: {
          matchIndex: 0,
          minute: 0,
          isFinished: false,
          roundStartedAt: Date.now(),
        },
      };
      const cleanDuelUpdates = Object.fromEntries(
        Object.entries(duelUpdates).filter(([, v]) => v !== undefined)
      );

      await withRetry(() => patchRoomDocument(onlineRoom.code, cleanDuelUpdates));

      setOnlineDuelResult(result);
      setScreen("online-duel");
    } catch (error) {
      console.error("Failed to start online duel:", error);
      const detail = error?.code || error?.message || String(error);
      window.alert(
        "Não foi possível sincronizar o duelo com os outros jogadores.\n\n" +
        "Detalhe técnico: " + detail + "\n\n" +
        "Possíveis causas: sua sessão de autenticação anônima mudou (recarregue a página) ou o hostId no servidor não bate mais com seu UID atual. " +
        "Tente sair da sala e entrar novamente, ou recarregar ambos os navegadores."
      );
    }
  }

  async function restartOnlineDuelLive() {
    if (!isOnlineHost || !onlineRoom || !onlineDuelResult?.matches?.length) return;

    try {
      await patchRoomDocument(onlineRoom.code, {
        duelLive: {
          matchIndex: 0,
          minute: 0,
          isFinished: false,
          roundStartedAt: Date.now(),
        },
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function revealFullOnlineDuel() {
    if (!isOnlineHost || !onlineRoom || !onlineDuelResult?.matches?.length) return;

    const lastIndex = onlineDuelResult.matches.length - 1;

    try {
      await patchRoomDocument(onlineRoom.code, {
        duelLive: {
          matchIndex: lastIndex,
          minute: getDuelLiveEndMinute(onlineDuelResult.matches[lastIndex]),
          isFinished: true,
        },
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function startNextOnlineDuelMatch() {
    if (!isOnlineHost || !onlineRoom || !onlineDuelResult?.matches?.length || !onlineDuelLive) return;

    const nextIndex = (onlineDuelLive.matchIndex || 0) + 1;
    if (!onlineDuelResult.matches[nextIndex]) return;

    try {
      await patchRoomDocument(onlineRoom.code, {
        duelLive: {
          matchIndex: nextIndex,
          minute: 0,
          isFinished: false,
          roundStartedAt: Date.now(),
        },
      });
    } catch (error) {
      console.error(error);
    }
  }


  function rollToTeam(finalTeam, roulettePool = getTeamsWithPlayers()) {
    if (isRolling || !finalTeam) return;

    const teamsWithPlayers = roulettePool.length ? roulettePool : getTeamsWithPlayers();

    if (!teamsWithPlayers.length) {
      setCurrentTeam(null);
      setRollingTeam(null);
      return;
    }

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

  function drawTeam() {
    const teamsWithPlayers = getTeamsWithPlayers();

    if (!teamsWithPlayers.length) {
      setCurrentTeam(null);
      setRollingTeam(null);
      return;
    }

    rollToTeam(getRandomHistoricalTeamWithPlayers(), teamsWithPlayers);
  }

  function rerollAnyTeam() {
    if (isRolling || pendingSelection || !currentTeam || rerollsRemaining <= 0) return;

    const teamsWithPlayers = getTeamsWithPlayers().filter((team) => team.id !== currentTeam.id);
    const finalTeam = getRandomTeamFromList(teamsWithPlayers);

    if (!finalTeam) return;

    setRerollsRemaining((currentValue) => Math.max(0, currentValue - 1));
    rollToTeam(finalTeam, teamsWithPlayers);
  }

  function rerollSameClubVersion() {
    if (isRolling || pendingSelection || !currentTeam || rerollsRemaining <= 0) return;

    const alternativeVersions = getAlternativeTeamVersions(currentTeam);
    const finalTeam = getRandomTeamFromList(alternativeVersions);

    if (!finalTeam) return;

    setRerollsRemaining((currentValue) => Math.max(0, currentValue - 1));
    rollToTeam(finalTeam, alternativeVersions);
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
    setRerollsRemaining(getDraftRerollLimit(gameMode));
    setPendingSelection(null);
    setLeagueResult(null);
    setRevealedMatchesCount(0);
    setSoloLiveMatch(null);
    setCopiedResult(false);
  }

  function runSimulation(mode = "full") {
    if (!selectedFormation || lineup.length !== selectedFormation.slots.length) return;

    const result = simulateBrazilianLeague(lineup, selectedFormation);
    setLeagueResult(result);
    setSoloLiveMatch(null);
    setCopiedResult(false);
    setShareImageUrl("");
    setShareMessage("");

    if (mode === "step") {
      setRevealedMatchesCount(0);
      setScreen("campaign");
      return;
    }

    setScreen("result");
  }

  function revealNextMatch() {
    if (!leagueResult || soloLiveMatch) return;

    const nextMatch = leagueResult.userMatches[revealedMatchesCount];

    if (!nextMatch) return;

    setSoloLiveMatch({
      match: nextMatch,
      minute: 0,
    });
  }

  function simulateAllSoloMatches() {
    if (!leagueResult) return;

    setSoloLiveMatch(null);
    setRevealedMatchesCount(leagueResult.userMatches.length);
  }

  function finishCampaignSimulation() {
    setSoloLiveMatch(null);
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

  async function copySupportPix(value) {
    try {
      await navigator.clipboard.writeText(value);
      setPixCopyMessage("");
      setCopiedPixKey(true);

      window.setTimeout(() => {
        setCopiedPixKey(false);
      }, 1800);
    } catch {
      setPixCopyMessage("Não consegui copiar automaticamente. Selecione e copie manualmente.");
    }
  }

  async function createShareImageBlob() {
    const element = shareCardRef.current;

    if (!element) {
      throw new Error("Card de compartilhamento não foi encontrado.");
    }

    // Clonamos manualmente e renderizamos offscreen com position absolute + opacity 0.
    // Isso força o layout correto no DOM (melhor que fixed negative para html2canvas)
    // e evita flash visual. Copiamos os estilos inline do card (que já são self-contained).
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '920px';
    container.style.background = '#f7f0df';
    container.style.backgroundColor = '#f7f0df';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '-99999';
    document.body.appendChild(container);

    const clone = element.cloneNode(true);
    // Força tema claro e fundo explícito no clone para evitar herança de tema escuro ou preto
    clone.style.width = '920px';
    clone.style.background = '#f7f0df';
    clone.style.backgroundColor = '#f7f0df';
    clone.style.color = '#0f172a';
    clone.style.fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    clone.style.position = 'relative';
    clone.style.overflow = 'visible';
    clone.style.boxSizing = 'border-box';

    // Re-aplica os kits do campinho (gradientes dos uniformes)
    // Garante que todos tenham background, mesmo se o atributo estiver faltando em algum caso
    clone.querySelectorAll('.share-kit-ball').forEach((ball) => {
      const bg = ball.getAttribute('data-kit-bg') || '#ffffff';
      ball.style.background = bg;
      // also set base color to prevent transparent in capture for some kits
      const base = ball.getAttribute('data-base-color') || '#ffffff';
      ball.style.backgroundColor = base;
    });

    container.appendChild(clone);

    // Força reflow e múltiplos frames para garantir que tudo (pitch, tabelas, textos, kits) seja layoutado
    void container.offsetHeight;
    void clone.offsetHeight;
    await new Promise((r) => window.requestAnimationFrame(r));
    await new Promise((r) => window.requestAnimationFrame(r));
    await new Promise((r) => window.setTimeout(r, 200));

    try {
      const canvas = await html2canvas(clone, {
        backgroundColor: '#f7f0df',
        scale: 2,
        useCORS: true,
        logging: false,
        removeContainer: true,
        foreignObjectRendering: true,
        imageTimeout: 15000,
      });

      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Não foi possível criar o PNG.'));
            return;
          }
          resolve(blob);
        }, 'image/png', 1);
      });
    } finally {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    }
  }

  async function generateShareImage() {
    try {
      setIsGeneratingShareImage(true);
      setShareMessage("");

      const blob = await createShareImageBlob();

      if (!blob) {
        setShareMessage("Não consegui gerar a imagem.");
        return;
      }

      if (shareImageUrl) {
        URL.revokeObjectURL(shareImageUrl);
      }

      const imageUrl = URL.createObjectURL(blob);
      setShareImageUrl(imageUrl);
      setShareMessage("Imagem gerada.");
    } catch (error) {
      console.error(error);
      setShareMessage(`Erro ao gerar imagem: ${error?.message || "tente novamente."}`);
    } finally {
      setIsGeneratingShareImage(false);
    }
  }

  async function copyShareImage() {
    try {
      setIsGeneratingShareImage(true);
      setShareMessage("");

      const blob = await createShareImageBlob();

      if (!blob) {
        setShareMessage("Não consegui gerar a imagem.");
        return;
      }

      if (
        navigator.clipboard?.write &&
        typeof ClipboardItem !== "undefined"
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": blob,
          }),
        ]);
        setShareMessage("Imagem copiada.");
        return;
      }

      setShareMessage("Seu navegador não permite copiar imagem direto. Use Compartilhar.");
    } catch (error) {
      console.error(error);
      setShareMessage(`Não consegui copiar a imagem: ${error?.message || "tente compartilhar."}`);
    } finally {
      setIsGeneratingShareImage(false);
    }
  }

  async function downloadShareImage() {
    try {
      setIsGeneratingShareImage(true);
      setShareMessage("");

      const blob = await createShareImageBlob();

      if (!blob) {
        setShareMessage("Não consegui gerar a imagem.");
        return;
      }

      const imageUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = "38-0-brasil-campanha.png";
      link.click();

      URL.revokeObjectURL(imageUrl);
      setShareMessage("Imagem baixada.");
    } catch (error) {
      console.error(error);
      setShareMessage(`Erro ao baixar imagem: ${error?.message || "tente novamente."}`);
    } finally {
      setIsGeneratingShareImage(false);
    }
  }

  async function shareResultImage() {
    try {
      setIsGeneratingShareImage(true);
      setShareMessage("");

      const blob = await createShareImageBlob();

      if (!blob) {
        setShareMessage("Não consegui gerar a imagem.");
        return;
      }

      const file = new File([blob], "38-0-brasil-campanha.png", {
        type: "image/png",
      });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Minha campanha no 38–0 Brasil",
          text: `Minha campanha no 38–0 Brasil. Jogue também: ${getSiteShareUrl()}`,
          files: [file],
        });
        setShareMessage("Compartilhamento aberto.");
        return;
      }

      const imageUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = "38-0-brasil-campanha.png";
      link.click();
      URL.revokeObjectURL(imageUrl);

      setShareMessage("Seu navegador não compartilha imagem direto. Baixei o PNG para você enviar no WhatsApp.");
    } catch (error) {
      console.error(error);
      setShareMessage(`Não consegui compartilhar: ${error?.message || "tente baixar a imagem."}`);
    } finally {
      setIsGeneratingShareImage(false);
    }
  }

  if (screen.startsWith("online-") && !isOnlineApiReady) {
    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <section className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
            Modo online
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight">
            {onlineApiError ? "Não foi possível conectar" : "Preparando sincronização..."}
          </h1>
          <p className="mt-3 text-sm font-bold leading-relaxed text-slate-600">
            {onlineApiError
              ? onlineApiError
              : "O Firebase só carrega quando você entra no online. Isso deixa o modo solo mais rápido."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {onlineApiError ? (
              <button
                type="button"
                onClick={() => handleEnterOnlineClick(screen)}
                className="force-dark-text rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-black text-emerald-950 transition hover:bg-emerald-200"
              >
                Tentar de novo
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOnlineApiError("");
                setScreen("home");
              }}
              className="rounded-2xl border border-slate-900/10 bg-white px-5 py-3 text-sm font-black text-slate-800 transition hover:bg-slate-50"
            >
              Voltar ao início
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online-home") {
    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-5xl px-6 py-10">
          <button
            onClick={goHome}
            className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
          >
            <ArrowLeft size={18} />
            Voltar
          </button>

          <div className="rounded-[2rem] border border-slate-900/10 bg-white/80 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-8">
            <div className="force-dark-text mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm font-bold text-emerald-950">
              <Users size={18} />
              Modo Online
            </div>

            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Jogar Online
            </h1>
            <p className="mt-4 max-w-2xl text-base font-bold leading-relaxed text-slate-600">
              Crie uma sala para jogar com amigos, entre por código ou procure uma partida aleatória. As salas ficam sincronizadas em tempo real pelo novo servidor online.
            </p>

            {savedRoomCode ? (
              <div className="mt-8 rounded-[1.75rem] border border-amber-300/70 bg-amber-50 px-5 py-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
                  Sala salva neste aparelho
                </p>
                <p className="mt-2 text-sm font-bold leading-relaxed text-amber-950">
                  Código <span className="font-black tracking-[0.2em]">{savedRoomCode}</span>. Retome só se você ainda estiver jogando essa partida.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={resumeSavedOnlineRoom}
                    disabled={isResumingOnlineRoom}
                    className="rounded-2xl bg-amber-400 px-4 py-2 text-sm font-black text-amber-950 transition hover:bg-amber-300 disabled:opacity-60"
                  >
                    {isResumingOnlineRoom ? "Retomando..." : "Retomar sala"}
                  </button>
                  <button
                    type="button"
                    onClick={dismissSavedOnlineRoom}
                    className="rounded-2xl border border-amber-400/60 bg-white px-4 py-2 text-sm font-black text-amber-900 transition hover:bg-amber-100"
                  >
                    Esquecer código
                  </button>
                </div>
                {resumeRoomFeedback ? (
                  <p className="mt-3 text-sm font-bold text-amber-900">{resumeRoomFeedback}</p>
                ) : null}
              </div>
            ) : null}

            <div className={`grid gap-4 md:grid-cols-3 ${savedRoomCode ? "mt-4" : "mt-8"}`}>
              <button
                type="button"
                onClick={openOnlineSetup}
                className="force-dark-text rounded-[1.75rem] border border-emerald-400/45 bg-emerald-300 p-5 text-left text-emerald-950 shadow-[0_16px_35px_rgba(16,185,129,0.18)] transition hover:-translate-y-1"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-950 text-white">
                  <Users size={22} />
                </div>
                <h2 className="mt-5 text-2xl font-black">Criar sala</h2>
                <p className="mt-2 text-sm font-bold leading-relaxed text-emerald-950/80">
                  Crie uma sala, configure o modo, convide amigos e controle o início pelo lobby.
                </p>
              </button>

              <button
                type="button"
                onClick={openOnlineJoin}
                className="rounded-[1.75rem] border border-slate-900/10 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:border-emerald-400/50"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <Copy size={22} />
                </div>
                <h2 className="mt-5 text-2xl font-black text-slate-950">Entrar na sala</h2>
                <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600">
                  Digite o código da sala. Só dá para entrar enquanto ela ainda estiver no lobby.
                </p>
              </button>

              <button
                type="button"
                onClick={openOnlineMatchmaking}
                className="rounded-[1.75rem] border border-slate-900/10 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:border-emerald-400/50"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <Shuffle size={22} />
                </div>
                <h2 className="mt-5 text-2xl font-black text-slate-950">Buscar partida</h2>
                <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600">
                  Escolha X1, Brasileirão Online e tipo de draft para procurar adversários aleatórios.
                </p>
              </button>
            </div>

            <div className="mt-6 rounded-2xl border border-emerald-300/40 bg-emerald-50 px-4 py-3 text-xs font-bold leading-relaxed text-emerald-900">
              Criar sala, entrar por código e ver salas abertas já funcionam entre aparelhos diferentes.
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online-join") {
    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-3xl px-6 py-10">
          <button
            onClick={() => setScreen("online-home")}
            className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
          >
            <ArrowLeft size={18} />
            Voltar ao online
          </button>

          <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-8">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
              Entrar na sala
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Código da sala
            </h1>
            <p className="mt-3 text-sm font-bold leading-relaxed text-slate-600">
              Digite o código da sala e configure seu time. A entrada só é permitida enquanto a sala estiver no lobby.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Código da sala
                </span>
                <input
                  value={joinRoomCode}
                  onChange={(event) => {
                    setJoinRoomCode(event.target.value.toUpperCase());
                    setJoinRoomFeedback("");
                  }}
                  placeholder="Ex: A7K9Q"
                  className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white px-4 py-4 text-center text-2xl font-black uppercase tracking-[0.3em] text-slate-950 outline-none focus:border-emerald-400"
                />

                <input
                  type="password"
                  value={joinRoomPassword}
                  onChange={(event) => setJoinRoomPassword(event.target.value)}
                  placeholder="Senha (se a sala for privada)"
                  className="mt-3 w-full rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Seu nome
                </span>
                <input
                  value={onlineSetup.playerName}
                  onChange={(event) => updateOnlineSetup("playerName", event.target.value)}
                  placeholder="Vinicius"
                  className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Nome do seu time
                </span>
                <input
                  value={onlineSetup.teamName}
                  onChange={(event) => updateOnlineSetup("teamName", event.target.value)}
                  placeholder="Vini FC"
                  className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Formação
                </span>
                <select
                  value={onlineSetup.formationId}
                  onChange={(event) => updateOnlineSetup("formationId", event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                >
                  {formations.map((formation) => (
                    <option key={`join-formation-${formation.id}`} value={formation.id}>
                      {formation.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {joinRoomFeedback && (
              <div className="mt-4 rounded-2xl border border-yellow-300/60 bg-yellow-100 px-4 py-3 text-sm font-black text-yellow-950">
                {joinRoomFeedback}
              </div>
            )}

            <button
              type="button"
              onClick={tryJoinOnlineRoom}
              disabled={isJoiningOnlineRoom}
              className="force-dark-text mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 text-sm font-black uppercase tracking-[0.14em] text-emerald-950 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isJoiningOnlineRoom ? "Entrando..." : "Entrar"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online-matchmaking") {
    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-5xl px-6 py-10">
          <button
            onClick={() => setScreen("online-home")}
            className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
          >
            <ArrowLeft size={18} />
            Voltar ao online
          </button>

          <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-8">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
              Salas abertas
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Encontrar partida
            </h1>
            <p className="mt-3 text-sm font-bold leading-relaxed text-slate-600">
              Veja as salas no lobby com vagas e entre direto. É mais prático que matchmaking aleatório quando a comunidade ainda está crescendo.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Seu nome
                </span>
                <input
                  value={onlineSetup.playerName}
                  onChange={(event) => updateOnlineSetup("playerName", event.target.value)}
                  placeholder="Vinicius"
                  className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Nome do seu time
                </span>
                <input
                  value={onlineSetup.teamName}
                  onChange={(event) => updateOnlineSetup("teamName", event.target.value)}
                  placeholder="Meu XI"
                  className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                />
              </label>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() => updateMatchmakingSetup("onlineMode", "duel")}
                className={`rounded-[1.75rem] border p-5 text-left transition hover:-translate-y-1 ${
                  matchmakingSetup.onlineMode === "duel"
                    ? "force-dark-text border-emerald-400 bg-emerald-300 text-emerald-950 shadow-[0_16px_35px_rgba(16,185,129,0.18)]"
                    : "border-slate-900/10 bg-white text-slate-950"
                }`}
              >
                <h2 className="text-2xl font-black">Duelo 1v1</h2>
                <p className="mt-2 text-sm font-bold leading-relaxed opacity-80">
                  Mostrar salas de X1 com vaga.
                </p>
              </button>

              <button
                type="button"
                onClick={() => updateMatchmakingSetup("onlineMode", "league")}
                className={`rounded-[1.75rem] border p-5 text-left transition hover:-translate-y-1 ${
                  matchmakingSetup.onlineMode === "league"
                    ? "force-dark-text border-emerald-400 bg-emerald-300 text-emerald-950 shadow-[0_16px_35px_rgba(16,185,129,0.18)]"
                    : "border-slate-900/10 bg-white text-slate-950"
                }`}
              >
                <h2 className="text-2xl font-black">Brasileirão Online</h2>
                <p className="mt-2 text-sm font-bold leading-relaxed opacity-80">
                  Mostrar salas de Brasileirão no lobby.
                </p>
              </button>
            </div>

            {matchmakingSetup.onlineMode === "league" && (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => updateMatchmakingSetup("difficulty", "normal")}
                  className={`rounded-2xl border px-4 py-3 text-sm font-black ${
                    matchmakingSetup.difficulty === "normal"
                      ? "force-dark-text border-emerald-400 bg-emerald-300 text-emerald-950"
                      : "border-slate-900/10 bg-white text-slate-950"
                  }`}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => updateMatchmakingSetup("difficulty", "expert")}
                  className={`rounded-2xl border px-4 py-3 text-sm font-black ${
                    matchmakingSetup.difficulty === "expert"
                      ? "force-dark-text border-emerald-400 bg-emerald-300 text-emerald-950"
                      : "border-slate-900/10 bg-white text-slate-950"
                  }`}
                >
                  Especialista
                </button>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-600">
                {isLoadingLobbyRooms
                  ? "Carregando salas..."
                  : `${lobbyRooms.length} sala(s) aberta(s) com vaga`}
              </p>
              <button
                type="button"
                onClick={() => refreshLobbyRooms().catch(console.error)}
                disabled={isLoadingLobbyRooms}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white px-4 py-2 text-sm font-black text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw size={16} />
                Atualizar
              </button>
            </div>

            {/* Prompt de senha (estilo "popup") para salas protegidas clicadas na lista */}
            {pendingPrivateLobbyRoom && (
              <div className="mt-4 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 shadow-[0_10px_30px_rgba(245,158,11,0.15)]">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">🔒</div>
                  <div className="flex-1">
                    <p className="text-base font-black text-amber-950">
                      Sala privada: {pendingPrivateLobbyRoom.room?.roomName || pendingPrivateLobbyRoom.code}
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-amber-900">
                      Esta sala foi criada com senha. Digite a senha para poder entrar.
                    </p>

                    {lobbyRoomsFeedback && (
                      <p className="mt-2 text-sm font-bold text-red-700">{lobbyRoomsFeedback}</p>
                    )}

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input
                        type="password"
                        value={lobbyJoinPassword}
                        onChange={(event) => setLobbyJoinPassword(event.target.value)}
                        placeholder="Digite a senha da sala"
                        className="w-full rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-amber-500 sm:w-72"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            confirmJoinPrivateLobbyRoom().catch(console.error);
                          }
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => confirmJoinPrivateLobbyRoom().catch(console.error)}
                          disabled={!!joiningLobbyRoomCode || !lobbyJoinPassword.trim()}
                          className="force-dark-text rounded-2xl bg-emerald-300 px-5 py-2.5 text-sm font-black text-emerald-950 transition hover:bg-emerald-200 disabled:opacity-50"
                        >
                          {joiningLobbyRoomCode === pendingPrivateLobbyRoom.code ? "Entrando..." : "Entrar com senha"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelPrivateLobbyPasswordPrompt}
                          className="rounded-2xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-black text-amber-950 transition hover:bg-amber-100"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {lobbyRoomsFeedback && !pendingPrivateLobbyRoom ? (
              <p className="mt-4 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                {lobbyRoomsFeedback}
              </p>
            ) : null}

            <div className="mt-4 grid gap-3">
              {lobbyRooms.length ? (
                lobbyRooms.map((room) => {
                  const playerCount = room.participants?.length || 0;
                  const modeLabel = room.config?.onlineMode === "duel" ? "Duelo 1v1" : "Brasileirão";
                  const difficultyLabel =
                    room.config?.onlineMode === "league"
                      ? room.config?.difficulty === "expert"
                        ? "Especialista"
                        : "Normal"
                      : null;

                  const isPrivateRoom = !!(room.config?.password && String(room.config.password).trim()) || room.config?.isPrivate;
                  const isThisPending = pendingPrivateLobbyRoom?.code === room.code;

                  return (
                    <div
                      key={room.code}
                      className={`flex flex-col gap-4 rounded-[1.5rem] border p-4 sm:flex-row sm:items-center sm:justify-between ${
                        isThisPending
                          ? "border-amber-400 bg-amber-50/60 ring-1 ring-amber-300"
                          : "border-slate-900/10 bg-white/80"
                      }`}
                    >
                      <div>
                        <p className="text-lg font-black text-slate-950">
                          {room.roomName || "Sala 38–0"}
                          {isPrivateRoom && (
                            <span className="ml-2 align-middle text-sm font-bold text-amber-600">🔒 Privada</span>
                          )}
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-600">
                          {modeLabel}
                          {difficultyLabel ? ` · ${difficultyLabel}` : ""} · Código {room.code}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white">
                          {playerCount} {playerCount === 1 ? "jogador" : "jogadores"}
                        </span>
                        <button
                          type="button"
                          onClick={() => joinLobbyRoom(room.code).catch(console.error)}
                          disabled={joiningLobbyRoomCode === room.code || isThisPending}
                          className="force-dark-text rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-black text-emerald-950 transition hover:bg-emerald-200 disabled:opacity-60"
                        >
                          {joiningLobbyRoomCode === room.code
                            ? "Entrando..."
                            : isPrivateRoom
                            ? "Entrar (senha)"
                            : "Entrar"}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-slate-900/15 bg-white/70 px-5 py-8 text-center">
                  <p className="text-sm font-bold text-slate-600">
                    Nenhuma sala aberta com vaga agora. Crie uma sala e compartilhe o código, ou atualize daqui a pouco.
                  </p>
                  <button
                    type="button"
                    onClick={openOnlineSetup}
                    className="force-dark-text mt-4 rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-black text-emerald-950 transition hover:bg-emerald-200"
                  >
                    Criar sala
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online-setup") {
    const selectedOnlineFormation = getFormationById(onlineSetup.formationId);
    const isCardsDraft = onlineSetup.draftType === "cards";

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-6xl px-6 py-10">
          <button
            onClick={goHome}
            className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
          >
            <ArrowLeft size={18} />
            Voltar
          </button>

          <div className="mb-8">
            <div className="force-dark-text mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm font-bold text-emerald-950">
              <Users size={18} />
              Modo Online
            </div>

            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Criar sala
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-700">
              Configure a sala, escolha seu time e compartilhe o código com seus amigos para jogarem juntos em tempo real.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)] sm:p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Nome da sala
                  </span>
                  <input
                    value={onlineSetup.roomName}
                    onChange={(event) => updateOnlineSetup("roomName", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none transition focus:border-emerald-500"
                    placeholder="Sala 38–0"
                  />
                </label>

                <div className="md:col-span-2">
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={onlineSetup.isPrivate}
                      onChange={(event) => {
                        updateOnlineSetup("isPrivate", event.target.checked);
                        if (!event.target.checked) {
                          updateOnlineSetup("roomPassword", "");
                        }
                      }}
                      className="h-4 w-4 accent-emerald-500"
                    />
                    <span className="text-sm font-black text-slate-700">
                      Sala privada (somente com código + senha)
                    </span>
                  </label>

                  {onlineSetup.isPrivate && (
                    <label className="mt-3 block">
                      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                        Senha da sala
                      </span>
                      <input
                        type="password"
                        value={onlineSetup.roomPassword}
                        onChange={(event) => updateOnlineSetup("roomPassword", event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none transition focus:border-emerald-500"
                        placeholder="Defina uma senha"
                        required
                      />
                    </label>
                  )}
                </div>

                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Seu nome
                  </span>
                  <input
                    value={onlineSetup.playerName}
                    onChange={(event) => updateOnlineSetup("playerName", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none transition focus:border-emerald-500"
                    placeholder="Vinicius"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Nome do seu time
                  </span>
                  <input
                    value={onlineSetup.teamName}
                    onChange={(event) => updateOnlineSetup("teamName", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none transition focus:border-emerald-500"
                    placeholder="Vini FC"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Formação
                  </span>
                  <select
                    value={onlineSetup.formationId}
                    onChange={(event) => updateOnlineSetup("formationId", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none transition focus:border-emerald-500"
                  >
                    {formations.map((formation) => (
                      <option key={formation.id} value={formation.id}>
                        {formation.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-slate-900/10 bg-white/70 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Tipo de sala
                  </p>
                  <div className="mt-3 grid gap-2">
                    {[
                      ["league", "Brasileirão Online", "Liga com vários jogadores. A sala cresce conforme as pessoas entram."],
                      ["duel", "Duelo 1v1", "Dois times montados no draft e confronto direto."],
                    ].map(([value, title, description]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setOnlineSetup((currentSetup) => ({
                            ...currentSetup,
                            onlineMode: value,
                          }))
                        }
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          onlineSetup.onlineMode === value
                            ? "selected-green-card border-emerald-500"
                            : "border-slate-900/10 bg-white/60 hover:bg-white"
                        }`}
                      >
                        <p className="font-black text-slate-950">{title}</p>
                        <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                          {description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-900/10 bg-white/70 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Tipo de draft
                  </p>
                  <div className="mt-3 grid gap-2">
                    {[
                      ["cards", "Cards Aleatórios", "Aparecem jogadores sortidos da base inteira."],
                      ["teams", "Elencos Históricos", "Sorteia um clube/ano e você escolhe do elenco."],
                    ].map(([value, title, description]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateOnlineSetup("draftType", value)}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          onlineSetup.draftType === value
                            ? "selected-green-card border-emerald-500"
                            : "border-slate-900/10 bg-white/60 hover:bg-white"
                        }`}
                      >
                        <p className="font-black text-slate-950">{title}</p>
                        <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                          {description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-slate-900/10 bg-white/70 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Configurações do draft
                </p>

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                      Dificuldade
                    </span>
                    <select
                      value={onlineSetup.difficulty}
                      onChange={(event) => updateOnlineSetup("difficulty", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none"
                    >
                      <option value="normal">Normal</option>
                      <option value="expert">Especialista</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                      Tempo por escolha
                    </span>
                    <select
                      value={onlineSetup.pickTime}
                      onChange={(event) => updateOnlineSetup("pickTime", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none"
                    >
                      <option value="15">15s</option>
                      <option value="30">30s</option>
                      <option value="60">60s</option>
                      <option value="none">Sem tempo</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                      Escolhas por turno
                    </span>
                    <select
                      value={onlineSetup.picksPerTurn}
                      onChange={(event) => updateOnlineSetup("picksPerTurn", Number(event.target.value))}
                      className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none"
                    >
                      <option value={1}>1 escolha</option>
                      <option value={2}>2 escolhas</option>
                      {isCardsDraft && <option value={3}>3 escolhas</option>}
                    </select>
                  </label>
                </div>

                {isCardsDraft && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                        Cards por turno
                      </span>
                      <select
                        value={onlineSetup.cardsPerTurn}
                        onChange={(event) => updateOnlineSetup("cardsPerTurn", Number(event.target.value))}
                        className="mt-2 w-full rounded-2xl border border-slate-900/10 bg-white/80 px-4 py-3 text-sm font-bold outline-none"
                      >
                        <option value={8}>8 cards</option>
                        <option value={10}>10 cards</option>
                        <option value={12}>12 cards</option>
                      </select>
                    </label>

                    <div className="selected-green-card rounded-2xl p-4">
                      <p className="text-sm font-black text-emerald-800">
                        Sorteio realmente aleatório
                      </p>
                      <p className="mt-1 text-xs font-bold leading-relaxed text-emerald-900/80">
                        Os cards vêm misturados da base: craques, médios e nomes mais fracos.
                        Quem for escolhido sai da pool da sala.
                      </p>
                    </div>
                  </div>
                )}
              </div>



              {onlineSetup.onlineMode === "duel" && (
                <div className="mt-6 rounded-3xl border border-slate-900/10 bg-white/70 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Formato do Duelo 1v1
                  </p>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {ONLINE_DUEL_FORMAT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateOnlineSetup("duelFormat", option.value)}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          onlineSetup.duelFormat === option.value
                            ? "selected-green-card border-emerald-500"
                            : "border-slate-900/10 bg-white/60 hover:bg-white"
                        }`}
                      >
                        <p className="font-black text-slate-950">{option.label}</p>
                        <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                          {option.description}
                        </p>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-3">
                      <span>
                        <span className="block text-sm font-black text-slate-950">Prorrogação</span>
                        <span className="block text-xs font-bold text-slate-500">Só no ida e volta, se o agregado empatar após o 2º jogo.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={onlineSetup.duelExtraTime}
                        disabled={!duelFormatAllowsExtraTime(onlineSetup.duelFormat)}
                        onChange={(event) => updateOnlineSetup("duelExtraTime", event.target.checked)}
                        className="h-5 w-5 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-3">
                      <span>
                        <span className="block text-sm font-black text-slate-950">Pênaltis</span>
                        <span className="block text-xs font-bold text-slate-500">Decide empates. Obrigatório em melhor de 3/5 e quando há prorrogação.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={onlineSetup.duelPenalties}
                        disabled={onlineSetup.duelExtraTime || duelFormatRequiresPenalties(onlineSetup.duelFormat)}
                        onChange={(event) => updateOnlineSetup("duelPenalties", event.target.checked)}
                        className="h-5 w-5 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={createOnlineRoom}
                disabled={isCreatingOnlineRoom}
                className="force-dark-text mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Users size={20} />
                {isCreatingOnlineRoom ? "Criando sala..." : "Criar sala"}
              </button>
            </div>

            <aside className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)] sm:p-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
                Prévia
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight">
                {onlineSetup.teamName || "Meu XI"}
              </h2>
              <p className="mt-1 text-sm font-bold text-slate-500">
                {selectedOnlineFormation?.name || "Formação"} · {getOnlineModeLabel(onlineSetup.onlineMode)}
              </p>

              {selectedOnlineFormation && <FormationMiniPreview formation={selectedOnlineFormation} />}

              <div className="mt-5 space-y-2 text-sm font-bold text-slate-600">
                <p>Draft: {getDraftTypeLabel(onlineSetup.draftType)}</p>
                <p>Dificuldade: {getDifficultyLabel(onlineSetup.difficulty)}</p>
                <p>Tempo: {getPickTimeLabel(onlineSetup.pickTime)}</p>
                <p>Escolhas por turno: {onlineSetup.picksPerTurn}</p>
                {isCardsDraft && <p>Cards por turno: {onlineSetup.cardsPerTurn}</p>}
              </div>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online-lobby" && onlineRoom) {
    const canStartRoom = onlineRoom.participants.length >= 2 && isOnlineHost;

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-6xl px-6 py-10">
          <button
            onClick={() => setScreen("online-setup")}
            className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
          >
            <ArrowLeft size={18} />
            Voltar
          </button>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-6 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-700">
                    Lobby de espera
                  </p>
                  <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                    {onlineRoom.roomName}
                  </h1>
                  <p className="mt-2 text-sm font-bold text-slate-500">
                    {isOnlineHost
                      ? "Compartilhe o código. Quando todos entrarem, você inicia a sala."
                      : "Aguardando o ADM iniciar. Novos jogadores entram pelo mesmo código."}
                  </p>
                  {justBecameHost && (
                    <p className="mt-1 text-xs font-black text-emerald-600">
                      Você agora é o ADM da sala (o anterior saiu).
                    </p>
                  )}
                </div>

                <div className="rounded-3xl bg-slate-950 px-5 py-4 text-center text-white">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">
                    Código
                  </p>
                  <p className="mt-1 text-3xl font-black tracking-[0.18em]">
                    {onlineRoom.code}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                {onlineRoom.participants.map((participant, index) => (
                  <div
                    key={participant.id}
                    className="flex flex-col gap-3 rounded-3xl border border-slate-900/10 bg-white/75 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-lg font-black">
                        {index + 1}. {participant.teamName}
                        {participant.isHost && (
                          <span className="ml-2 rounded-full bg-emerald-300 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-950">
                            ADM
                          </span>
                        )}
                        {participant.id === localParticipantId && (
                          <span className="ml-2 rounded-full bg-slate-900 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                            Você
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {participant.playerName} · {participant.formationName}
                      </p>
                    </div>

                    <span className="force-dark-text inline-flex w-fit items-center gap-2 rounded-full bg-emerald-300 px-3 py-1 text-xs font-black text-emerald-950">
                      <Check size={14} />
                      Pronto
                    </span>
                  </div>
                ))}
              </div>

              {isOnlineHost ? (
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={startOnlineOrderScreen}
                    disabled={onlineRoom.participants.length < 2}
                    className="force-dark-text inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-4 font-black text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play size={20} fill="currentColor" />
                    Iniciar sala
                  </button>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-slate-900/10 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-600">
                  Você entrou como {localOnlineParticipant?.teamName || "convidado"}. Aguarde o ADM iniciar.
                </div>
              )}

              {isOnlineHost && onlineRoom.participants.length < 2 && (
                <p className="mt-3 text-sm font-bold text-slate-500">
                  A sala precisa de pelo menos 2 participantes para iniciar. Compartilhe o código {onlineRoom.code}.
                </p>
              )}

              <button
                type="button"
                onClick={exitOnlineRoom}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
              >
                <X size={16} />
                Sair da sala
              </button>
            </div>

            <aside className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
                Configurações da sala
              </p>
              <p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">
                {isOnlineHost
                  ? "Você pode ajustar antes de iniciar outro draft. O modo da sala permanece o mesmo."
                  : "Somente o ADM pode alterar as configurações da sala."}
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                    Draft
                  </label>
                  <select
                    value={onlineRoom.config.draftType}
                    disabled={!isOnlineHost}
                    onChange={(event) => updateOnlineRoomConfig("draftType", event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-slate-900/10 bg-white px-3 py-3 text-sm font-black text-slate-950 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="cards">Cards Aleatórios</option>
                    <option value="teams">Elencos Históricos</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                    Dificuldade
                  </label>
                  <select
                    value={onlineRoom.config.difficulty}
                    disabled={!isOnlineHost}
                    onChange={(event) => updateOnlineRoomConfig("difficulty", event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-slate-900/10 bg-white px-3 py-3 text-sm font-black text-slate-950 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="normal">Normal</option>
                    <option value="expert">Especialista</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                    Tempo por escolha
                  </label>
                  <select
                    value={onlineRoom.config.pickTime}
                    disabled={!isOnlineHost}
                    onChange={(event) => updateOnlineRoomConfig("pickTime", event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-slate-900/10 bg-white px-3 py-3 text-sm font-black text-slate-950 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="15">15s</option>
                    <option value="30">30s</option>
                    <option value="60">60s</option>
                    <option value="none">Sem tempo</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Escolhas
                    </label>
                    <select
                      value={onlineRoom.config.picksPerTurn}
                      disabled={!isOnlineHost}
                      onChange={(event) => updateOnlineRoomConfig("picksPerTurn", event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-slate-900/10 bg-white px-3 py-3 text-sm font-black text-slate-950 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {[1, 2, 3].map((value) => (
                        <option key={`lobby-picks-${value}`} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>

                  {onlineRoom.config.draftType === "cards" && (
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                        Cards
                      </label>
                      <select
                        value={onlineRoom.config.cardsPerTurn}
                        disabled={!isOnlineHost}
                        onChange={(event) => updateOnlineRoomConfig("cardsPerTurn", event.target.value)}
                        className="mt-1 w-full rounded-2xl border border-slate-900/10 bg-white px-3 py-3 text-sm font-black text-slate-950 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {[8, 10, 12].map((value) => (
                          <option key={`lobby-cards-${value}`} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {onlineRoom.config.onlineMode === "duel" && (
                  <div className="rounded-2xl border border-slate-900/10 bg-white/70 p-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Formato do X1
                    </label>
                    <select
                      value={onlineRoom.config.duelFormat}
                      disabled={!isOnlineHost}
                      onChange={(event) => updateOnlineRoomConfig("duelFormat", event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-slate-900/10 bg-white px-3 py-3 text-sm font-black text-slate-950 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {ONLINE_DUEL_FORMAT_OPTIONS.map((option) => (
                        <option key={`lobby-duel-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <label className="mt-3 flex items-start gap-3 rounded-2xl bg-white px-3 py-3">
                      <input
                        type="checkbox"
                        checked={onlineRoom.config.duelExtraTime}
                        disabled={!isOnlineHost || !duelFormatAllowsExtraTime(onlineRoom.config.duelFormat)}
                        onChange={(event) => updateOnlineRoomConfig("duelExtraTime", event.target.checked)}
                        className="mt-0.5 h-5 w-5 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>
                        <span className="block text-sm font-black text-slate-950">Prorrogação</span>
                        <span className="block text-xs font-bold text-slate-500">Só no ida e volta com agregado empatado.</span>
                      </span>
                    </label>

                    <label className="mt-2 flex items-start gap-3 rounded-2xl bg-white px-3 py-3">
                      <input
                        type="checkbox"
                        checked={onlineRoom.config.duelPenalties}
                        disabled={
                          !isOnlineHost ||
                          onlineRoom.config.duelExtraTime ||
                          duelFormatRequiresPenalties(onlineRoom.config.duelFormat)
                        }
                        onChange={(event) => updateOnlineRoomConfig("duelPenalties", event.target.checked)}
                        className="mt-0.5 h-5 w-5 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>
                        <span className="block text-sm font-black text-slate-950">Pênaltis</span>
                        <span className="block text-xs font-bold text-slate-500">Obrigatório em melhor de 3/5 e com prorrogação.</span>
                      </span>
                    </label>
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-2xl bg-emerald-300/15 p-4">
                <p className="text-sm font-black text-emerald-800">
                  Próxima etapa
                </p>
                <p className="mt-1 text-xs font-bold leading-relaxed text-slate-600">
                  Ao iniciar, a sala vai para o sorteio da ordem do draft. Depois o ADM avança para a tela do draft.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online-order" && onlineRoom) {
    const hasFullOrder = onlineDraftOrder.length === onlineRoom.participants.length;
    const waitingParticipants = onlineRoom.participants.filter(
      (participant) => !onlineDraftOrder.some((drafted) => drafted.id === participant.id)
    );

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-6xl px-6 py-10">
          {isOnlineHost ? (
            <button
              onClick={() => patchRoomDocument(onlineRoom.code, { status: "lobby" }).catch(console.error)}
              disabled={isDrawingOnlineOrder}
              className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowLeft size={18} />
              Voltar ao lobby
            </button>
          ) : (
            <div className="mb-8 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-600">
              Sorteio em andamento na sala
            </div>
          )}

          <div className="mb-6">{renderExitOnlineRoomButton()}</div>

          <div className="rounded-[2.25rem] border border-slate-900/10 bg-white/85 p-6 text-center shadow-[0_18px_50px_rgba(15,23,42,0.10)] sm:p-8">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-700">
              Sorteio da ordem
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
              Ordem do draft
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm font-bold leading-relaxed text-slate-500">
              O ADM inicia o sorteio. A ordem define o primeiro round e depois o draft segue em snake.
            </p>

            <div className="mx-auto mt-8 max-w-2xl rounded-[2rem] border border-slate-900/10 bg-slate-950 p-6 text-white">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">
                {hasFullOrder ? "Sorteio finalizado" : isDrawingOnlineOrder ? "Sorteando agora" : "Pronto para sortear"}
              </p>

              <div className="mt-4 min-h-[88px] rounded-3xl bg-white/10 p-5">
                {rollingOnlineParticipant ? (
                  <>
                    <p className="text-sm font-bold text-emerald-200">Escolhendo posição...</p>
                    <p className="mt-2 animate-pulse text-3xl font-black tracking-tight">
                      {rollingOnlineParticipant}
                    </p>
                  </>
                ) : hasFullOrder ? (
                  <>
                    <p className="text-sm font-bold text-emerald-200">Ordem completa</p>
                    <p className="mt-2 text-3xl font-black tracking-tight">
                      {onlineDraftOrder[0]?.teamName} abre o draft
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-slate-300">Aguardando ADM</p>
                    <p className="mt-2 text-3xl font-black tracking-tight">
                      {onlineDraftOrder.length + 1}º pick
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
              <div className="rounded-[2rem] border border-slate-900/10 bg-white/75 p-5 text-left">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                  Ordem definida
                </p>

                <div className="mt-4 grid gap-2">
                  {onlineDraftOrder.length ? (
                    onlineDraftOrder.map((participant, index) => (
                      <div
                        key={participant.id}
                        className="flex items-center justify-between rounded-2xl bg-white/80 px-4 py-3"
                      >
                        <p className="font-black">
                          {index + 1}º {participant.teamName}
                        </p>
                        <p className="text-xs font-bold text-slate-500">
                          {participant.formationName}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl bg-white/80 px-4 py-4 text-sm font-bold text-slate-500">
                      Nenhum pick sorteado ainda.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border border-slate-900/10 bg-white/75 p-5 text-left">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Ainda faltam
                </p>

                <div className="mt-4 grid gap-2">
                  {waitingParticipants.length ? (
                    waitingParticipants.map((participant) => (
                      <div
                        key={participant.id}
                        className="rounded-2xl bg-white/80 px-4 py-3 text-sm font-black"
                      >
                        {participant.teamName}
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl bg-white/80 px-4 py-4 text-sm font-bold text-slate-500">
                      Todos já foram sorteados.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {isOnlineHost ? (
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={startOnlineOrderDraw}
                  disabled={isDrawingOnlineOrder || hasFullOrder}
                  className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Shuffle size={20} />
                  Iniciar sorteio
                </button>

                <button
                  type="button"
                  onClick={goToOnlineDraftPreview}
                  disabled={!hasFullOrder || isDrawingOnlineOrder}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white/80 px-6 py-4 font-black text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Play size={20} />
                  Ir para o draft
                </button>
              </div>
            ) : (
              <p className="mt-8 text-sm font-bold text-slate-500">
                Aguardando o ADM sortear a ordem e iniciar o draft.
              </p>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online-draft" && onlineRoom && onlineDraftState) {
    const currentParticipant = getOnlineCurrentParticipant(
      onlineDraftOrder,
      onlineDraftState.currentTurnIndex
    );
    const currentLineup = currentParticipant
      ? onlineDraftState.lineupsMap[currentParticipant.id] || []
      : [];
    const currentFormation = currentParticipant
      ? getFormationById(currentParticipant.formationId)
      : formations[0];
    const openSlotsForCurrent = currentParticipant
      ? getOnlineOpenSlots(currentParticipant, onlineDraftState.lineupsMap)
      : [];
    const picksNeededThisTurn = currentParticipant
      ? getOnlinePicksNeededThisTurn(
          currentParticipant,
          onlineDraftState.lineupsMap,
          onlineRoom.config.picksPerTurn
        )
      : 0;
    const remainingPicksThisTurn = Math.max(
      0,
      picksNeededThisTurn - onlineDraftState.picksMadeThisTurn
    );
    const roundIndex = Math.floor(onlineDraftState.currentTurnIndex / onlineDraftOrder.length) + 1;
    const isExpertDraftCurrentlyHidingOveralls =
      onlineRoom.config.difficulty === "expert" &&
      onlineRoom.status === "draft" &&
      !onlineDraftState.isComplete;
    const revealOnlineOveralls = !isExpertDraftCurrentlyHidingOveralls;
    const isOnlineTeamDraft = onlineRoom.config.draftType === "teams";
    const currentTeamOption = onlineDraftState.currentTeamOption;
    const currentLineupSummary = getOnlineLineupSummary(currentLineup, currentFormation);
    const isMyOnlineDraftTurn = currentParticipant?.id === localParticipantId;

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 sm:py-8">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {isOnlineHost ? (
              <button
                onClick={() => patchRoomDocument(onlineRoom.code, { status: "order" }).catch(console.error)}
                className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
              >
                <ArrowLeft size={18} />
                Voltar ao sorteio
              </button>
            ) : (
              <div className="inline-flex w-fit rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-600">
                Draft sincronizado
              </div>
            )}

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="rounded-2xl border border-slate-900/10 bg-white/75 px-4 py-2 text-sm font-black text-slate-700">
                <span>{onlineRoom.roomName} · {onlineRoom.code}</span>
                {onlineConnectionStatus !== "connected" && onlineConnectionStatus !== "idle" ? (
                  <span className="ml-2 text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                    {onlineConnectionStatus === "syncing" ? "Sincronizando" : "Reconectando"}
                  </span>
                ) : null}
              </div>
              {renderExitOnlineRoomButton()}
            </div>
          </div>

          {onlineDraftState.isComplete ? (
            <div className="rounded-[2.25rem] border border-slate-900/10 bg-white/85 p-6 text-center shadow-[0_18px_50px_rgba(15,23,42,0.10)] sm:p-8">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-700">
                Draft finalizado
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
                Todos os times foram montados
              </h1>
              <p className="mx-auto mt-3 max-w-2xl text-sm font-bold leading-relaxed text-slate-500">
                Os elencos estão prontos. {isOnlineHost ? "Inicie a partida quando todos estiverem vendo os times." : "Aguarde o ADM iniciar a partida."}
              </p>

              {isOnlineHost && onlineRoom.config.onlineMode === "league" ? (
                <div className="mx-auto mt-6 max-w-xl space-y-4">
                  <OnlineLiveSpeedControl
                    value={onlineLiveSpeed}
                    onChange={updateOnlineLiveSpeed}
                  />
                  <button
                    type="button"
                    onClick={startOnlineBrazilianLeague}
                    disabled={isStartingOnlineLeague}
                    className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-emerald-950 shadow-[0_14px_30px_rgba(16,185,129,0.22)] transition hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Play size={18} />
                    {isStartingOnlineLeague ? "Iniciando..." : "Iniciar Brasileirão Online"}
                  </button>
                </div>
              ) : isOnlineHost ? (
                <div className="mx-auto mt-6 max-w-xl space-y-4">
                  <OnlineLiveSpeedControl
                    value={onlineLiveSpeed}
                    onChange={updateOnlineLiveSpeed}
                  />
                  <button
                    type="button"
                    onClick={startOnlineDuel}
                    className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-yellow-300 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-yellow-950 shadow-[0_14px_30px_rgba(234,179,8,0.22)] transition hover:scale-[1.02]"
                  >
                    <Play size={18} />
                    Iniciar Duelo 1v1
                  </button>
                </div>
              ) : null}

              <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {onlineDraftOrder.map((participant) => {
                  const participantLineup = onlineDraftState.lineupsMap[participant.id] || [];
                  const participantFormation = getFormationById(participant.formationId);
                  const participantSummary = getOnlineLineupSummary(
                    participantLineup,
                    participantFormation
                  );

                  return (
                    <div
                      key={participant.id}
                      className="rounded-3xl border border-slate-900/10 bg-white/75 p-5 text-left"
                    >
                      <p className="text-lg font-black">{participant.teamName}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {participant.formationName} · {participantSummary.filled}/{participantSummary.total} jogadores
                      </p>

                      <div className="mt-4 rounded-3xl border border-slate-900/10 bg-white/70 p-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">
                            Resumo do time
                          </p>
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                            participantSummary.isComplete
                              ? "selected-green-card online-speed-option-active bg-emerald-300 text-emerald-950"
                              : "bg-slate-100 text-slate-500"
                          }`}>
                            {participantSummary.isComplete ? "Completo" : "Parcial"}
                          </span>
                        </div>
                        {/* O modo especialista esconde os números somente enquanto o draft está em andamento. */}
                        <OnlineTeamSummaryStats
                          summary={participantSummary}
                          revealValues
                        />
                      </div>

                      <div className="mt-4 grid gap-2">
                        {participantLineup
                          .slice()
                          .sort((a, b) => a.slotIndex - b.slotIndex)
                          .map((item) => (
                            <div
                              key={`${participant.id}-${item.slotIndex}`}
                              className="flex items-center gap-3 rounded-2xl bg-white/80 px-3 py-2"
                            >
                              <KitBallIcon
                                clubId={item.team.clubId}
                                overall={item.player.ovr}
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black">{item.player.name}</p>
                                <p className="truncate text-[11px] font-bold text-slate-500">
                                  {item.slotPosition} · {item.team.label}
                                </p>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[190px_minmax(0,1fr)_230px] 2xl:grid-cols-[210px_minmax(0,1fr)_250px] xl:items-start">
              <aside className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.08)] xl:sticky xl:top-5">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
                  Draft online
                </p>
                <h1 className="mt-3 text-3xl font-black tracking-tight">
                  Round {roundIndex}
                </h1>

                <div className="mt-5 rounded-3xl bg-slate-950 p-4 text-white">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
                    Vez de escolher
                  </p>
                  <p className="mt-2 text-2xl font-black leading-tight">
                    {currentParticipant?.teamName}
                  </p>
                  <p className="mt-2 text-xs font-bold text-slate-300">
                    Escolha {onlineDraftState.picksMadeThisTurn + 1}/{picksNeededThisTurn} do turno
                  </p>

                  <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">
                      Tempo
                    </p>
                    <p className="mt-1 text-3xl font-black text-emerald-200">
                      {onlineRoom.config.pickTime === "none"
                        ? "Sem tempo"
                        : isMyOnlineDraftTurn
                          ? `${onlinePickCountdown ?? onlineRoom.config.pickTime}s`
                          : "—"}
                    </p>
                  </div>
                </div>

                {!isMyOnlineDraftTurn && (
                  <p className="mt-4 rounded-2xl border border-slate-900/10 bg-slate-50 px-4 py-3 text-xs font-bold leading-relaxed text-slate-600">
                    Aguarde sua vez. As escolhas aparecem aqui em tempo real para todos.
                  </p>
                )}

                <div className="mt-4 rounded-3xl border border-slate-900/10 bg-white/75 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Regras da sala
                  </p>
                  <div className="mt-3 grid gap-1 text-sm font-bold text-slate-600">
                    <p>{getOnlineModeLabel(onlineRoom.config.onlineMode)}</p>
                    <p>{getDraftTypeLabel(onlineRoom.config.draftType)}</p>
                    <p>{getDifficultyLabel(onlineRoom.config.difficulty)}</p>
                    {isOnlineTeamDraft ? (
                      <p>1 elenco sorteado por turno</p>
                    ) : (
                      <p>{onlineRoom.config.cardsPerTurn} cards por turno</p>
                    )}
                    <p>{onlineRoom.config.picksPerTurn} escolha(s) por turno</p>
                    <p>Auto-pick aleatório por posição vaga</p>
                  </div>
                </div>
              </aside>

              <div className="grid gap-5 xl:grid-cols-[minmax(380px,1fr)_minmax(380px,440px)] 2xl:grid-cols-[minmax(460px,1fr)_minmax(420px,480px)] xl:items-start">
                <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)] xl:order-2 xl:sticky xl:top-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
                        {isOnlineTeamDraft ? "Elenco sorteado" : "Cards disponíveis"}
                      </p>
                      <h2 className="mt-2 text-3xl font-black tracking-tight">
                        Escolha {remainingPicksThisTurn || 1} jogador{remainingPicksThisTurn === 1 ? "" : "es"}
                      </h2>
                      {isOnlineTeamDraft && currentTeamOption && (
                        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-3xl border border-slate-900/10 bg-white/75 p-3">
                          <TeamKitIcon clubId={currentTeamOption.clubId} size="sm" />
                          <div className="min-w-0">
                            <p className="text-lg font-black leading-tight">{currentTeamOption.label}</p>
                            <p className="text-xs font-bold text-slate-500">
                              Escolha direto do elenco sorteado para este turno.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="rounded-2xl bg-emerald-300/20 px-4 py-2 text-xs font-black text-emerald-800">
                      Overalls {revealOnlineOveralls ? "visíveis" : "ocultos"}
                    </p>
                  </div>

                  <div
                    className={
                      isOnlineTeamDraft
                        ? "mt-4 grid max-h-[430px] gap-1.5 overflow-y-auto pr-1 sm:max-h-[500px] xl:max-h-[calc(100vh-320px)]"
                        : "mt-5 grid gap-3 sm:grid-cols-2"
                    }
                  >
                    {onlineDraftState.currentCards.length ? (
                      onlineDraftState.currentCards.map((card) => {
                        const compatibleSlots = getOnlineCardCompatibleSlots(card, openSlotsForCurrent);
                        const isAvailable = compatibleSlots.length > 0;
                        const compatibleLabel = [...new Set(compatibleSlots.map((slot) => slot.position))].join(", ") || "nenhuma vaga";
                        const isPendingCard = onlinePendingSelection?.card?.id === card.id;

                        if (isOnlineTeamDraft) {
                          return (
                            <button
                              key={card.id}
                              type="button"
                              onClick={() => handleOnlineCardClick(card)}
                              disabled={!isMyOnlineDraftTurn || !isAvailable}
                              className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
                                isAvailable && isMyOnlineDraftTurn
                                  ? isPendingCard
                                  ? "border-yellow-300 bg-yellow-50 shadow-[0_0_24px_rgba(253,224,71,0.28)]"
                                  : "border-slate-900/10 bg-white/95 hover:border-emerald-300 hover:bg-emerald-300 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
                                  : "cursor-not-allowed border-slate-900/5 bg-slate-100/70 opacity-50"
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black leading-tight text-slate-950 sm:text-[15px]">
                                  {card.player.name}
                                </p>
                                <p className="mt-0.5 truncate text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
                                  {card.team.club || card.team.label} · {card.player.positions.join("/")}
                                </p>
                                <p className="mt-1 truncate text-[10px] font-bold text-slate-500">
                                  Encaixa em: {compatibleLabel}
                                </p>
                              </div>

                              <div className="shrink-0 text-2xl font-black leading-none text-slate-950 sm:text-3xl">
                                {revealOnlineOveralls ? card.player.ovr : "?"}
                              </div>
                            </button>
                          );
                        }

                        return (
                          <button
                            key={card.id}
                            type="button"
                            onClick={() => handleOnlineCardClick(card)}
                            disabled={!isMyOnlineDraftTurn || !isAvailable}
                            className={`rounded-3xl border p-4 text-left transition ${
                              isAvailable && isMyOnlineDraftTurn
                                ? isPendingCard
                                ? "border-yellow-300 bg-yellow-50 shadow-[0_0_24px_rgba(253,224,71,0.28)]"
                                : "border-slate-900/10 bg-white/90 hover:-translate-y-0.5 hover:shadow-[0_16px_35px_rgba(15,23,42,0.12)]"
                                : "cursor-not-allowed border-slate-900/5 bg-slate-100/70 opacity-50"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <KitBallIcon
                                clubId={card.team.clubId}
                                overall={revealOnlineOveralls ? card.player.ovr : "?"}
                              />
                              <div className="min-w-0">
                                <p className="break-words text-base font-black leading-tight">{card.player.name}</p>
                                <p className="mt-1 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-700">
                                  {card.player.positions.join("/")}
                                </p>
                                <p className="mt-1 break-words text-xs font-bold leading-snug text-slate-500">
                                  {card.team.label}
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
                              Encaixa em: {compatibleLabel}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-3xl border border-slate-900/10 bg-white/75 p-5 text-sm font-bold text-slate-500 sm:col-span-2 lg:col-span-4">
                        {isOnlineTeamDraft
                          ? "Não há jogadores compatíveis neste elenco sorteado."
                          : "Não há cards compatíveis para este turno."}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)] xl:order-1 xl:sticky xl:top-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                        Campo atual
                      </p>
                      <h2 className="mt-1 text-2xl font-black">{currentParticipant?.teamName}</h2>
                    </div>
                    <p className="rounded-2xl bg-white/80 px-3 py-2 text-xs font-black text-slate-600">
                      {currentLineup.length}/{currentFormation.slots.length}
                    </p>
                  </div>

                  <div className="mb-4 rounded-3xl border border-slate-900/10 bg-white/70 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">
                        Resumo {currentLineupSummary.isComplete ? "do time" : "parcial"}
                      </p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                        currentLineupSummary.isComplete
                          ? "selected-green-card online-speed-option-active bg-emerald-300 text-emerald-950"
                          : "bg-slate-100 text-slate-500"
                      }`}>
                        {currentLineupSummary.filled}/{currentLineupSummary.total}
                      </span>
                    </div>
                    <OnlineTeamSummaryStats
                      summary={currentLineupSummary}
                      revealValues={revealOnlineOveralls}
                      compact
                    />
                  </div>

                  <TacticalPitch
                    formation={currentFormation}
                    lineup={currentLineup}
                    pendingSelection={onlinePendingSelection}
                    onHighlightedSlotClick={handleOnlinePendingSlotClick}
                    revealOveralls={revealOnlineOveralls}
                  />
                </div>
              </div>

              <aside className="space-y-4 xl:sticky xl:top-5">
                <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                    Ordem snake
                  </p>
                  <div className="mt-4 grid gap-2">
                    {onlineDraftOrder.map((participant, index) => {
                      const isCurrent = participant.id === currentParticipant?.id;
                      const participantLineup = onlineDraftState.lineupsMap[participant.id] || [];
                      const formation = getFormationById(participant.formationId);
                      const participantSummary = getOnlineLineupSummary(participantLineup, formation);

                      return (
                        <div
                          key={participant.id}
                          className={`rounded-2xl px-4 py-3 ${
                            isCurrent ? "selected-green-card online-speed-option-active bg-emerald-300 text-emerald-950" : "bg-white/80"
                          }`}
                        >
                          <p className="text-sm font-black">
                            {index + 1}º {participant.teamName}
                          </p>
                          <p className="mt-1 text-[11px] font-bold opacity-75">
                            {participantLineup.length}/{formation.slots.length} jogadores
                          </p>
                          {participantLineup.length > 0 && (
                            <p className="mt-2 text-[10px] font-black opacity-75">
                              DEF {revealOnlineOveralls ? participantSummary.defense ?? "—" : "?"} · MEI {revealOnlineOveralls ? participantSummary.midfield ?? "—" : "?"} · ATA {revealOnlineOveralls ? participantSummary.attack ?? "—" : "?"} · GER {revealOnlineOveralls ? participantSummary.overall ?? "—" : "?"}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Últimas escolhas
                  </p>
                  <div className="mt-4 grid gap-2">
                    {onlineDraftState.log.length ? (
                      onlineDraftState.log.map((item) => (
                        <div key={item.id} className="rounded-2xl bg-white/80 px-4 py-3">
                          <p className="text-sm font-black">{item.participant}</p>
                          <p className="mt-1 text-xs font-bold text-slate-500">
                            {item.source === "auto" ? "Auto-pick" : "Escolheu"}: {item.player}
                          </p>
                          <p className="mt-0.5 text-[11px] font-bold text-slate-400">
                            {item.team}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-2xl bg-white/80 px-4 py-4 text-sm font-bold text-slate-500">
                        Nenhuma escolha ainda.
                      </p>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          )}
        </section>
      </main>
    );
  }



  if (screen === "online-duel" && onlineRoom && onlineDuelResult) {
    const duelMatchIndex = onlineDuelLive?.matchIndex || 0;
    const duelMatch = onlineDuelLive?.match || onlineDuelResult.matches?.[duelMatchIndex] || onlineDuelResult.match;
    const duelMinute = onlineDuelLive?.minute ?? 90;
    const duelScore = getLiveMatchScore(duelMatch, duelMinute);
    const duelEvents = getRecentLiveEvents(duelMatch, duelMinute, 6);
    const duelEndMinute = getDuelLiveEndMinute(duelMatch);
    const isDuelFinished = Boolean(onlineDuelLive?.isFinished || duelMinute >= duelEndMinute);
    const seriesSummary = getOnlineDuelLiveSeriesSummary(
      onlineDuelResult,
      duelMatchIndex,
      duelScore,
      duelMinute,
      isDuelFinished
    );
    const finalSeriesSummary = isDuelFinished
      ? getOnlineDuelSeriesSummary(onlineDuelResult)
      : seriesSummary;
    const hasNextDuelMatch = isDuelFinished && duelMatchIndex < (onlineDuelResult.matches?.length || 1) - 1;
    const isDuelSeriesFinished = isDuelFinished && !hasNextDuelMatch;
    const winnerLabel = isDuelSeriesFinished
      ? finalSeriesSummary.winnerLabel || "Empate"
      : duelScore.homeGoals > duelScore.awayGoals
      ? duelMatch.home
      : duelScore.awayGoals > duelScore.homeGoals
      ? duelMatch.away
      : "Empate";

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => setScreen("online-draft")}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <ArrowLeft size={18} />
              Voltar aos times
            </button>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="rounded-2xl border border-slate-900/10 bg-white/75 px-4 py-2 text-sm font-black text-slate-700">
                {onlineRoom.roomName} · {onlineDuelResult.formatLabel}
              </div>
              {renderExitOnlineRoomButton()}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-6 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
                  Duelo 1v1 ao vivo
                </p>
                <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                  {isDuelSeriesFinished ? "Duelo finalizado" : isDuelFinished ? `Fim do jogo ${duelMatchIndex + 1}` : getDuelLivePhaseLabel(duelMatch, duelMinute)}
                </h1>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  {onlineDuelResult.formatLabel} · Jogo {duelMatchIndex + 1}/{onlineDuelResult.matches.length} · {onlineDuelResult.hasExtraTime ? "com prorrogação" : "sem prorrogação"} · {onlineDuelResult.hasPenalties ? "com pênaltis" : "sem pênaltis"}
                </p>
              </div>

              <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[360px]">
                <OnlineLiveSpeedControl
                  value={onlineLiveSpeed}
                  onChange={updateOnlineLiveSpeed}
                  compact
                  disabled={!isOnlineHost}
                />
                {isOnlineHost ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={restartOnlineDuelLive}
                        className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-emerald-950 transition hover:scale-[1.02]"
                      >
                        <Play size={18} />
                        Rever série
                      </button>
                      <button
                        type="button"
                        onClick={revealFullOnlineDuel}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white/85 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-slate-800 transition hover:bg-white"
                      >
                        <RefreshCw size={18} />
                        Simular tudo
                      </button>
                      {isDuelSeriesFinished && (
                        <button
                          type="button"
                          onClick={restartOnlineFromLobby}
                          className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-yellow-300 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-yellow-950 transition hover:scale-[1.02] sm:col-span-2"
                        >
                          <RefreshCw size={18} />
                          Jogar de novo
                        </button>
                      )}
                    </div>
                    {hasNextDuelMatch && (
                      <button
                        type="button"
                        onClick={startNextOnlineDuelMatch}
                        className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-yellow-300 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-yellow-950 transition hover:scale-[1.02]"
                      >
                        <Play size={18} />
                        Iniciar próximo jogo
                      </button>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl border border-emerald-300/40 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
                    {isDuelSeriesFinished
                      ? "Duelo finalizado."
                      : isDuelFinished
                        ? "Aguardando o ADM iniciar o próximo jogo."
                        : `Jogo ao vivo sincronizado · ${duelMinute}'`}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-slate-900/10 bg-white/75 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                Times do duelo
              </p>

              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                {(onlineDuelResult.teams || []).slice(0, 2).map((team, index) => (
                  <div
                    key={`duel-team-card-${team.id}`}
                    className="rounded-2xl border border-slate-900/10 bg-white px-4 py-4 shadow-sm"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      {index === 0 ? "Time 1" : "Time 2"}
                    </p>
                    <h2 className="mt-1 truncate text-2xl font-black text-slate-950">
                      {team.label}
                    </h2>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      Player: {team.playerName || "Jogador"} · Formação: {team.formationName || team.era || "—"}
                    </p>

                    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                      {[
                        ["DEF", Math.round(team.sectors?.defense?.average || 0)],
                        ["MEI", Math.round(team.sectors?.midfield?.average || 0)],
                        ["ATA", Math.round(team.sectors?.attack?.average || 0)],
                        ["GERAL", team.strength || "—"],
                      ].map(([label, value]) => (
                        <div
                          key={`${team.id}-${label}`}
                          className={`rounded-xl px-2 py-2 ${
                            label === "GERAL"
                              ? "force-dark-text bg-emerald-300 text-emerald-950"
                              : "force-dark-text bg-slate-100 text-slate-950"
                          }`}
                        >
                          <p className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-500">
                            {label}
                          </p>
                          <p className="mt-1 text-sm font-black">{value || "—"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="hidden items-center justify-center md:flex">
                  <div className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black uppercase tracking-[0.16em] text-white shadow-lg">
                    VS
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 rounded-[1.5rem] border border-slate-900/10 bg-white/70 p-4 md:grid-cols-3">
              <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Série</p>
                <p className="mt-1 text-xl font-black text-slate-950">
                  {onlineDuelResult.teams[0]?.label} {seriesSummary.homeWins} x {seriesSummary.awayWins} {onlineDuelResult.teams[1]?.label}
                </p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Agregado</p>
                <p className="mt-1 text-xl font-black text-slate-950">
                  {seriesSummary.homeAggregate} x {seriesSummary.awayAggregate}
                </p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Formato</p>
                <p className="mt-1 text-xl font-black text-slate-950">{onlineDuelResult.formatLabel}</p>
              </div>
            </div>

            <div className="mt-6 rounded-[1.5rem] bg-slate-950 p-5 text-white">
              <p className="mb-4 text-center text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">Jogo atual · {duelMatch.home} x {duelMatch.away}</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <p className="truncate text-right text-lg font-black sm:text-3xl">{duelMatch.home}</p>
                <p className="leader-row-readable rounded-2xl bg-white px-5 py-3 text-3xl font-black text-slate-950 sm:text-5xl">
                  {duelScore.homeGoals} x {duelScore.awayGoals}
                </p>
                <p className="truncate text-left text-lg font-black sm:text-3xl">{duelMatch.away}</p>
              </div>

              {duelMatch.penalties && duelMinute > (getPenaltyStartMinute(duelMatch) || 90) && (
                <PenaltyShootoutPanel match={duelMatch} minute={duelMinute} />
              )}

              {isDuelFinished && (
                <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-center">
                  <p className="text-sm font-black uppercase tracking-[0.18em] text-yellow-300">
                    {isDuelSeriesFinished
                      ? winnerLabel === "Empate"
                        ? "Duelo terminou empatado"
                        : `${winnerLabel} venceu o duelo`
                      : duelMatch.winnerLabel
                      ? `${duelMatch.winnerLabel} venceu o jogo ${duelMatchIndex + 1}${duelMatch.decidedBy !== "normal" ? ` nos ${duelMatch.decidedBy}` : ""}`
                      : "Empate neste jogo"}
                  </p>
                  {isDuelFinished && (duelMatch.extraTimeGoals || duelMatch.penalties) && (
                    <p className="mt-2 text-xs font-bold text-slate-300">
                      Placar completo: {getDuelMatchScoreLabel(duelMatch)}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-5 rounded-2xl bg-white/10 p-3">
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                  Lances do jogo
                </p>
                {duelEvents.length ? (
                  <div className="grid gap-2">
                    {duelEvents.map((event) => (
                      <div key={event.id} className="rounded-2xl bg-white/10 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base">{event.icon}</span>
                          <span className="event-minute-badge rounded-full bg-emerald-3000 px-2 py-0.5 text-[10px] font-black text-white">
                            {event.minute}'
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${getGoalEventTeamBadgeClasses(event)}`}>
                            {event.teamLabel || (event.side === "home" ? duelMainMatch.home : duelMainMatch.away)}
                          </span>
                          <p className="truncate text-sm font-black">{event.title}</p>
                        </div>
                        <p className="mt-1 text-xs font-bold leading-relaxed text-slate-300">
                          {event.description}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-slate-300">
                    A bola está rolando. Os lances aparecem conforme o relógio avança.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-slate-900/10 bg-white/75 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                Jogos do confronto
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {onlineDuelResult.matches.map((match, index) => {
                  const wasPlayed = index < duelMatchIndex || (index === duelMatchIndex && isDuelFinished);
                  const isCurrent = index === duelMatchIndex && !isDuelSeriesFinished;

                  return (
                    <div
                      key={`duel-match-${index}`}
                      className={`rounded-2xl border px-4 py-3 ${
                        isCurrent
                          ? "border-emerald-400 bg-emerald-300/20"
                          : wasPlayed
                          ? "border-slate-900/10 bg-white"
                          : "border-slate-900/10 bg-white/55 opacity-70"
                      }`}
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                        Jogo {index + 1}
                      </p>
                      <p className="mt-1 text-sm font-black text-slate-950">
                        {match.home} {wasPlayed ? getDuelMatchScoreLabel(match) : "x"} {match.away}
                      </p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {wasPlayed
                          ? match.winnerLabel
                            ? `Vencedor: ${match.winnerLabel}${match.decidedBy !== "normal" ? ` (${match.decidedBy})` : ""}`
                            : "Empate"
                          : "Aguardando"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online-league" && onlineRoom) {
    if (!onlineLeagueResult) {
      return (
        <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
          <ThemeStyles />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-black">Carregando o Brasileirão Online...</p>
              <p className="mt-2 text-sm font-bold text-slate-600">Sincronizando o resultado com o host. Aguarde alguns segundos.</p>
            </div>
          </div>
        </main>
      );
    }
    const currentRound = onlineLeagueResult.rounds[onlineRevealedRounds] || null;
    const previousRound = onlineRevealedRounds > 0
      ? onlineLeagueResult.rounds[onlineRevealedRounds - 1]
      : null;
    const partialTable = getLiveOnlineLeagueTable(onlineLeagueResult, onlineRevealedRounds, onlineLiveRound);
    const humanRanking = getHumanOnlineRanking(partialTable);
    const isRoundLive = Boolean(onlineLiveRound);
    const liveMainMatch = getMainHumanLiveMatch(onlineLiveRound?.round, localParticipantId);
    const liveMainScore = liveMainMatch ? getLiveMatchScore(liveMainMatch, onlineLiveRound?.minute || 0) : null;
    const liveMainEvents = liveMainMatch ? getRecentLiveEvents(liveMainMatch, onlineLiveRound?.minute || 0, 3) : [];
    const isLeagueFinished = !isRoundLive && onlineRevealedRounds >= onlineLeagueResult.rounds.length;
    const onlineChampion = isLeagueFinished ? partialTable[0] : null;
    const onlineChampionRoster = getChampionRosterForModal(onlineChampion);
    const championUsesDatabaseFormation = Boolean(onlineChampion && !onlineChampion.isOnlineHumanTeam && onlineChampionRoster.length);
    const onlineLeaderboards = getLeagueLeaderboards({
      rounds: onlineLeagueResult.rounds,
      revealedRounds: onlineRevealedRounds,
      liveRound: onlineLiveRound?.round || null,
      liveMinute: onlineLiveRound?.minute || 0,
      baseLeaderboards: onlineLeagueResult.leaderboards || null,
    });
    const ownOnlinePitchTeam = onlineLeagueResult.humanTeams.find(
      (team) => team.ownerParticipantId === localParticipantId
    );
    const selectedOnlinePitchTeam = onlineLeagueResult.humanTeams.find(
      (team) => team.id === onlinePitchTeamId
    ) || ownOnlinePitchTeam || onlineLeagueResult.humanTeams[0] || null;
    const selectedOnlinePitchFormation = selectedOnlinePitchTeam
      ? getFormationById(selectedOnlinePitchTeam.formationName || selectedOnlinePitchTeam.era)
      : formations[0];
    const selectedOnlinePitchSummary = selectedOnlinePitchTeam
      ? getOnlineLineupSummary(selectedOnlinePitchTeam.lineup || [], selectedOnlinePitchFormation)
      : null;
    const selectedOnlinePitchStats = selectedOnlinePitchTeam
      ? getOnlineTeamPitchStats({
          leagueResult: onlineLeagueResult,
          team: selectedOnlinePitchTeam,
          liveRound: onlineLiveRound?.round || null,
          liveMinute: onlineLiveRound?.minute || 0,
        })
      : {};

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        {onlineChampion && !dismissedOnlineChampionModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 px-4 py-6 backdrop-blur-sm">
            <div className="champion-modal-surface force-dark-text relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-yellow-300/40 bg-[#f7f0df] p-6 text-center shadow-[0_30px_90px_rgba(15,23,42,0.35)] sm:p-8">
              <button
                type="button"
                onClick={() => setDismissedOnlineChampionModal(true)}
                className="absolute right-4 top-4 rounded-full bg-white/80 p-2 text-slate-700 shadow-sm transition hover:scale-105"
                aria-label="Fechar comemoração"
              >
                <X size={18} />
              </button>

              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-yellow-300 text-yellow-950 shadow-[0_14px_35px_rgba(234,179,8,0.35)]">
                <Trophy size={32} />
              </div>

              <p className="mt-5 text-xs font-black uppercase tracking-[0.28em] text-yellow-700">
                Campeão do Brasileirão Online
              </p>
              <h2 className="mt-2 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Parabéns, {onlineChampion.label}!
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-relaxed text-slate-600">
                O elenco campeão terminou na liderança com {onlineChampion.points} pontos, {onlineChampion.wins} vitórias e saldo de {onlineChampion.goalDifference > 0 ? `+${onlineChampion.goalDifference}` : onlineChampion.goalDifference}.
              </p>

              <div className="mt-6 rounded-[1.5rem] bg-white/80 p-4 text-left ring-1 ring-slate-900/10">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Elenco campeão
                  </p>
                  {onlineChampion.isOnlineHumanTeam && onlineChampion.playerName && (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
                      Player: {onlineChampion.playerName}
                    </span>
                  )}
                </div>

                {onlineChampionRoster.length ? (
                  championUsesDatabaseFormation ? (
                    <div>
                      <p className="mb-3 rounded-2xl bg-yellow-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-yellow-800">
                        Escalação base 4-4-2 com os melhores encaixes por posição
                      </p>
                      <DatabaseChampionFormation
                        champion={onlineChampion}
                        roster={onlineChampionRoster}
                      />
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {onlineChampionRoster.map((player) => (
                        <div
                          key={`${onlineChampion.id}-${player.id}-${player.position}`}
                          className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-950">{player.name}</p>
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">{player.position}</p>
                          </div>
                          <span className="text-lg font-black text-slate-950">{player.ovr}</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
                    Elenco detalhado indisponível para este campeão.
                  </p>
                )}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDismissedOnlineChampionModal(true)}
                  className="force-dark-text inline-flex items-center justify-center rounded-2xl bg-yellow-300 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-yellow-950 shadow-[0_14px_30px_rgba(234,179,8,0.22)] transition hover:scale-[1.02]"
                >
                  Ver classificação final
                </button>

                <button
                  type="button"
                  onClick={restartOnlineFromLobby}
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-900/10 bg-white px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-slate-800 transition hover:bg-slate-50"
                >
                  Jogar de novo
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="mx-auto max-w-[1760px] px-4 py-5 sm:px-6 sm:py-8">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => setScreen("online-draft")}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <ArrowLeft size={18} />
              Voltar aos times
            </button>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="rounded-2xl border border-slate-900/10 bg-white/75 px-4 py-2 text-sm font-black text-slate-700">
                {onlineRoom.roomName} · {onlineRoom.code}
              </div>
              {renderExitOnlineRoomButton()}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[250px_minmax(0,1fr)_440px] xl:items-start">
            <aside className="space-y-5 xl:sticky xl:top-5">
              <LeaderboardPanel
                title="Artilharia"
                leaders={onlineLeaderboards.scorers}
                valueLabel="gols"
                limit={5}
                compact
              />

              <LeaderboardPanel
                title="Assistências"
                leaders={onlineLeaderboards.assistants}
                valueLabel="assistências"
                limit={5}
                compact
              />
            </aside>

            <div className="space-y-5">
              <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-6 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
                  Brasileirão Online
                </p>
                <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h1 className="text-4xl font-black tracking-tight md:text-5xl">
                      {isLeagueFinished ? "Campeonato finalizado" : `Rodada ${onlineRevealedRounds + 1}/38`}
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-slate-500">
                      Liga com {onlineLeagueResult.humanTeams.length} time(s) humano(s) e {Math.max(0, 20 - onlineLeagueResult.humanTeams.length)} time(s) da database.
                      {isOnlineHost
                        ? " Você controla as rodadas e todos veem a mesma simulação ao vivo."
                        : " A simulação roda sincronizada para todos. Acompanhe os placares em tempo real."}
                    </p>
                  </div>

                  <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[360px]">
                    <OnlineLiveSpeedControl
                      value={onlineLiveSpeed}
                      onChange={updateOnlineLiveSpeed}
                      compact
                      disabled={!isOnlineHost}
                    />
                    {isOnlineHost ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={revealNextOnlineRound}
                          disabled={isLeagueFinished || isRoundLive}
                          className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-emerald-950 shadow-[0_14px_30px_rgba(16,185,129,0.20)] transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Play size={18} />
                          {isRoundLive ? "Rodada em andamento" : onlineRevealedRounds === 0 ? "Iniciar rodada 1" : isLeagueFinished ? "Finalizado" : "Iniciar próxima rodada"}
                        </button>

                        <button
                          type="button"
                          onClick={simulateAllOnlineRounds}
                          disabled={isLeagueFinished || isRoundLive}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white/85 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RefreshCw size={18} />
                          Simular tudo
                        </button>

                        {isLeagueFinished && (
                          <button
                            type="button"
                            onClick={restartOnlineFromLobby}
                            className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-yellow-300 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-yellow-950 transition hover:scale-[1.02] sm:col-span-2"
                          >
                            <RefreshCw size={18} />
                            Jogar de novo
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-emerald-300/40 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
                        {isRoundLive
                          ? `Rodada ${onlineLiveRound?.round?.round || onlineRevealedRounds + 1} ao vivo · ${onlineLiveRound?.minute || 0}'`
                          : isLeagueFinished
                            ? "Campeonato finalizado."
                            : "Aguardando o ADM iniciar a próxima rodada."}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {isRoundLive && liveMainMatch ? (
                <div className="rounded-[2rem] border border-emerald-300/50 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                        Rodada ao vivo · {onlineLiveRound.round.round}/38
                      </p>
                      <h2 className="mt-1 text-2xl font-black">Seu jogo em destaque</h2>
                    </div>
                    <span className="force-dark-text w-fit rounded-2xl bg-emerald-300 px-4 py-2 text-xl font-black text-emerald-950">
                      {onlineLiveRound.minute}'
                    </span>
                  </div>

                  <div className="rounded-[1.5rem] bg-slate-950 p-5 text-white">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <p className="truncate text-right text-lg font-black sm:text-2xl">{liveMainMatch.home}</p>
                      <p className="force-white-text rounded-2xl bg-white px-4 py-2 text-2xl font-black text-slate-950 sm:text-3xl">
                        {liveMainScore.homeGoals} x {liveMainScore.awayGoals}
                      </p>
                      <p className="truncate text-left text-lg font-black sm:text-2xl">{liveMainMatch.away}</p>
                    </div>

                    <div className="mt-5 rounded-2xl bg-white/10 p-3">
                      <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                        Gols
                      </p>
                      {liveMainEvents.length ? (
                        <div className="grid gap-2">
                          {liveMainEvents.map((event) => (
                            <div key={event.id} className="rounded-2xl bg-white/10 px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-base">{event.icon}</span>
                                <span className="event-minute-badge rounded-full bg-emerald-3000 px-2 py-0.5 text-[10px] font-black text-white">
                                  {event.minute}'
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${getGoalEventTeamBadgeClasses(event)}`}>
                                  {event.teamLabel || (event.side === "home" ? liveMainMatch.home : liveMainMatch.away)}
                                </span>
                                <p className="truncate text-sm font-black">{event.title}</p>
                              </div>
                              <p className="mt-1 text-xs font-bold leading-relaxed text-slate-300">
                                {event.description}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-slate-300">
                          A bola está rolando. Os gols aparecem aqui conforme o relógio avança.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-5">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                      Outros jogos da rodada
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {onlineLiveRound.round.matches.map((match, index) => {
                        const score = getLiveMatchScore(match, onlineLiveRound.minute);
                        const isMainMatch = match.homeTeam.id === liveMainMatch.homeTeam.id && match.awayTeam.id === liveMainMatch.awayTeam.id;

                        return (
                          <div
                            key={`${onlineLiveRound.round.round}-${match.homeTeam.id}-${match.awayTeam.id}-${index}`}
                            className={`rounded-2xl border px-4 py-3 ${
                              isMainMatch
                                ? "highlight-outline-card border-emerald-400 bg-white text-slate-950"
                                : "border-slate-900/10 bg-white/80"
                            }`}
                          >
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs font-black sm:text-sm">
                              <p className="truncate text-right">{match.home}</p>
                              <p className="highlight-dark-pill rounded-xl bg-slate-950 px-3 py-1 text-white">
                                {score.homeGoals} x {score.awayGoals}
                              </p>
                              <p className="truncate text-left">{match.away}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : previousRound ? (
                <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                        Última rodada simulada
                      </p>
                      <h2 className="mt-1 text-2xl font-black">Rodada {previousRound.round}</h2>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                      {previousRound.matches.length} jogos
                    </span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {previousRound.matches.map((match, index) => (
                      <div
                        key={`${previousRound.round}-${match.homeTeam.id}-${match.awayTeam.id}-${index}`}
                        className={`rounded-2xl border px-4 py-3 ${
                          match.hasHumanTeam
                            ? "highlight-outline-card border-emerald-400 bg-white text-slate-950"
                            : "border-slate-900/10 bg-white/80"
                        }`}
                      >
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm font-black">
                          <p className="truncate text-right">{match.home}</p>
                          <p className="highlight-dark-pill rounded-xl bg-slate-950 px-3 py-1 text-white">
                            {match.homeGoals} x {match.awayGoals}
                          </p>
                          <p className="truncate text-left">{match.away}</p>
                        </div>
                        {match.hasHumanTeam && (
                          <p className="mt-2 text-center text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                            Jogo com player
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-[2rem] border border-dashed border-slate-900/15 bg-white/60 p-8 text-center">
                  <p className="text-sm font-bold text-slate-500">
                    Clique em “Iniciar rodada 1” para começar a simulação ao vivo.
                  </p>
                </div>
              )}

              {selectedOnlinePitchTeam && selectedOnlinePitchFormation && (
                <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.08)] sm:p-5">
                  <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                        Escalação e desempenho
                      </p>
                      <h2 className="mt-1 text-2xl font-black text-slate-950">
                        {selectedOnlinePitchTeam.label}
                      </h2>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {selectedOnlinePitchTeam.ownerParticipantId === localParticipantId
                          ? `Seu time · ${selectedOnlinePitchFormation.name}`
                          : `Player: ${selectedOnlinePitchTeam.playerName || "Jogador"} · ${selectedOnlinePitchFormation.name}`}
                      </p>
                    </div>

                    <label className="block w-full lg:w-[320px]">
                      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                        Visualizar time
                      </span>
                      <select
                        value={selectedOnlinePitchTeam.id}
                        onChange={(event) => setOnlinePitchTeamId(event.target.value)}
                        className="w-full rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-200/45"
                      >
                        {onlineLeagueResult.humanTeams.map((team) => (
                          <option key={`pitch-team-${team.id}`} value={team.id}>
                            {team.label} — {team.playerName || "Jogador"}
                            {team.ownerParticipantId === localParticipantId ? " (Você)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {selectedOnlinePitchSummary && (
                    <div className="mb-4 grid grid-cols-4 gap-2">
                      {[
                        ["DEF", selectedOnlinePitchSummary.defense],
                        ["MEI", selectedOnlinePitchSummary.midfield],
                        ["ATA", selectedOnlinePitchSummary.attack],
                        ["GER", selectedOnlinePitchSummary.overall],
                      ].map(([label, value]) => (
                        <div
                          key={`pitch-summary-${label}`}
                          className="rounded-2xl border border-slate-900/10 bg-slate-50 px-2 py-2 text-center sm:px-3 sm:py-3"
                        >
                          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500 sm:text-[10px]">
                            {label}
                          </p>
                          <p className="mt-0.5 text-lg font-black text-slate-950 sm:text-2xl">
                            {value ?? "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  <OnlineSeasonPitch
                    formation={selectedOnlinePitchFormation}
                    lineup={selectedOnlinePitchTeam.lineup || []}
                    playerStats={selectedOnlinePitchStats}
                  />

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                    <span>Número antes do ícone: 8 ⚽ 4 🅰️</span>
                    <span>A nota exibida é a média no campeonato</span>
                  </div>
                </div>
              )}

              {currentRound && !isLeagueFinished && !isRoundLive && (
                <div className="rounded-[2rem] border border-slate-900/10 bg-white/70 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Próximos jogos
                  </p>
                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    {currentRound.matches.map((match, index) => (
                      <div
                        key={`${currentRound.round}-${match.homeTeam.id}-${match.awayTeam.id}-${index}`}
                        className="rounded-2xl bg-white/80 px-4 py-3 text-sm font-bold text-slate-600"
                      >
                        {match.home} x {match.away}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="space-y-5 xl:sticky xl:top-5">
              <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Classificação geral
                </p>
                <div className="mt-4 max-h-[640px] overflow-y-auto pr-1">
                  <LeagueStandingsTable
                    table={partialTable}
                    highlightHuman
                    compact
                    emptyMessage="A tabela começa zerada e atualiza rodada por rodada."
                  />
                </div>
              </div>

              <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                  Ranking dos players
                </p>
                <div className="mt-4 grid gap-2">
                  {humanRanking.length ? (
                    humanRanking.map((team, index) => (
                      <div
                        key={team.id}
                        className="highlight-outline-card rounded-2xl border border-emerald-400/55 bg-white px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black text-slate-950">
                            {index + 1}º {team.label}
                          </p>
                          <p className="classification-points-cell text-sm font-black text-slate-950">
                            {team.points} pts
                          </p>
                        </div>
                        <p className="mt-1 text-[11px] font-bold text-slate-500">
                          {team.overallPosition}º geral · {team.wins}V {team.draws}E {team.losses}D · SG {team.goalDifference}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl bg-white/80 px-4 py-4 text-sm font-bold text-slate-500">
                      A classificação aparece depois da primeira rodada.
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "campaign" && leagueResult) {
    const revealedMatches = leagueResult.userMatches.slice(0, revealedMatchesCount);
    const campaignStats = getPartialCampaignStats(revealedMatches);
    const partialStandingInfo = getPartialUserStanding(leagueResult, revealedMatchesCount);
    const partialTable = partialStandingInfo.table;
    const campaignLeaders = getPartialCampaignLeaders(revealedMatches);
    const soloLeaderboards = getLeagueLeaderboards({
      rounds: leagueResult.rounds,
      revealedRounds: revealedMatchesCount,
      liveRound: soloLiveMatch
        ? {
            round: soloLiveMatch.match.round,
            matches: [{
              ...soloLiveMatch.match,
              events: getSoloLiveMatchEvents(soloLiveMatch.match),
            }],
          }
        : null,
      liveMinute: soloLiveMatch?.minute || 0,
    });
    const partialPosition = partialStandingInfo.position;
    const isFinished = revealedMatchesCount >= leagueResult.userMatches.length;
    const nextMatch = leagueResult.userMatches[revealedMatchesCount] || null;

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-[1760px] px-4 py-5 sm:px-6 sm:py-8">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => setScreen("draft")}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <ArrowLeft size={18} />
              Voltar ao draft
            </button>

            <button
              onClick={restartSoloFromFormation}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <RefreshCw size={16} />
              Jogar de novo
            </button>
          </div>

          <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)_320px] xl:items-start">
            <aside className="hidden xl:sticky xl:top-5 xl:block">
              <div className="rounded-[2rem] border border-slate-900/10 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-700">
                  Sua campanha
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-white/75 p-3">
                    <p className="text-3xl font-black text-emerald-700">
                      {partialPosition}
                    </p>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                      posição
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/75 p-3">
                    <p className="classification-points-cell text-3xl font-black">{campaignStats.points}</p>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                      pontos
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl bg-white/75 p-3 text-sm font-black">
                  {campaignStats.wins}V {campaignStats.draws}E {campaignStats.losses}D
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    GP {campaignStats.goalsFor} / GC {campaignStats.goalsAgainst} / SG {campaignStats.goalDifference}
                  </p>
                </div>

                <div className="mt-3 rounded-2xl bg-white/75 p-3">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                    sequência
                  </p>
                  <p className="mt-1 text-2xl font-black">
                    {campaignStats.winStreak} vitória{campaignStats.winStreak === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="rounded-2xl bg-white/75 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                      artilheiro
                    </p>
                    <p className="mt-1 truncate text-sm font-black">
                      {campaignLeaders.topScorer.name}
                    </p>
                    <p className="text-xs font-bold text-slate-500">
                      {campaignLeaders.topScorer.goals} gols
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/75 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                      assistente
                    </p>
                    <p className="mt-1 truncate text-sm font-black">
                      {campaignLeaders.playmaker.name}
                    </p>
                    <p className="text-xs font-bold text-slate-500">
                      {campaignLeaders.playmaker.assists} assists
                    </p>
                  </div>
                </div>
              </div>
            </aside>

            <div className="min-w-0">
              <div className="mb-6 rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-700">
                  Brasileirão jogo a jogo
                </p>

                <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h1 className="text-4xl font-black tracking-tight md:text-5xl">
                      Campanha
                    </h1>
                    <p className="mt-2 text-sm font-bold text-slate-500">
                      Rodada {Math.min(revealedMatchesCount + 1, 38)}/38
                    </p>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center lg:hidden">
                    <div className="rounded-2xl border border-slate-900/10 bg-white/75 px-3 py-2">
                      <p className="classification-points-cell text-xl font-black text-emerald-700">{campaignStats.points}</p>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                        pts
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-900/10 bg-white/75 px-3 py-2">
                      <p className="text-xl font-black">{campaignStats.wins}V</p>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                        vit
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-900/10 bg-white/75 px-3 py-2">
                      <p className="text-xl font-black">{partialPosition}</p>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                        pos
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-900/10 bg-white/75 px-3 py-2">
                      <p className="text-xl font-black">{campaignStats.winStreak}</p>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                        seq
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 rounded-2xl border border-slate-900/10 bg-white/75 p-3 text-sm font-bold text-slate-700 sm:grid-cols-3">
                  <span>{campaignStats.wins}V {campaignStats.draws}E {campaignStats.losses}D</span>
                  <span>GP {campaignStats.goalsFor} / GC {campaignStats.goalsAgainst}</span>
                  <span>{isFinished ? "Campanha encerrada" : nextMatch ? `Próximo: ${nextMatch.opponent}` : "Pronto"}</span>
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-900/10 bg-white/75 p-3 sm:flex-row sm:items-end sm:justify-between">
                  <OnlineLiveSpeedControl
                    value={onlineLiveSpeed}
                    onChange={setOnlineLiveSpeed}
                    compact
                  />

                  <button
                    onClick={simulateAllSoloMatches}
                    disabled={isFinished}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white/90 px-4 py-3 text-sm font-black text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw size={18} />
                    Simular tudo
                  </button>
                </div>
              </div>

              {soloLiveMatch ? (
                <div className="rounded-[2rem] border border-emerald-600/20 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-700">
                        Rodada ao vivo · {soloLiveMatch.match.round}/38
                      </p>
                      <h2 className="mt-1 text-2xl font-black">Seu jogo em tempo real</h2>
                    </div>
                    <div className="force-dark-text rounded-2xl bg-emerald-300 px-5 py-3 text-2xl font-black text-emerald-950">
                      {soloLiveMatch.minute}'
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
                    <p className="truncate text-right text-lg font-black sm:text-2xl">{soloLiveMatch.match.home}</p>
                    <div className="rounded-2xl bg-slate-950 px-5 py-3 text-2xl font-black text-white sm:text-3xl">
                      {getSoloLiveMatchScore(soloLiveMatch.match, soloLiveMatch.minute).homeGoals} x {getSoloLiveMatchScore(soloLiveMatch.match, soloLiveMatch.minute).awayGoals}
                    </div>
                    <p className="truncate text-left text-lg font-black sm:text-2xl">{soloLiveMatch.match.away}</p>
                  </div>

                  <div className="mt-5 rounded-3xl border border-slate-900/10 bg-white/75 p-4">
                    <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-slate-500">
                      Últimos lances
                    </p>
                    <div className="space-y-2">
                      {getRecentSoloLiveEvents(soloLiveMatch.match, soloLiveMatch.minute, 3).length ? (
                        getRecentSoloLiveEvents(soloLiveMatch.match, soloLiveMatch.minute, 3).map((event) => (
                          <div
                            key={event.id}
                            className={`rounded-2xl border px-3 py-3 ${
                              event.isUserGoal
                                ? "force-dark-text border-emerald-600/20 bg-emerald-100/80"
                                : "border-slate-900/10 bg-white/85"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span className="event-minute-badge flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                                {event.minute}'
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-black">{event.icon} {event.title}</p>
                                <p className="mt-0.5 text-xs font-bold text-slate-500">{event.description}</p>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-900/10 bg-white/85 p-4 text-center text-sm font-bold text-slate-500">
                          A bola está rolando. Os principais lances aparecem aqui.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : revealedMatchesCount === 0 ? (
                <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-6 text-center shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                  <Play className="mx-auto mb-4 text-emerald-700" size={52} />
                  <h2 className="text-3xl font-black">Começar campanha</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                    Revele um jogo por vez. O jogo anterior fecha automaticamente e a tela acompanha o próximo resultado.
                  </p>

                  <button
                    onClick={revealNextMatch}
                    className="force-dark-text mt-7 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-200"
                  >
                    <Play size={20} fill="currentColor" />
                    Iniciar 1ª rodada ao vivo
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {revealedMatches.map((match, index) => {
                    const isCurrent = index === revealedMatches.length - 1;

                    return (
                      <div
                        key={match.round}
                        ref={isCurrent ? currentMatchRef : null}
                        className={`rounded-[1.5rem] border p-4 transition ${
                          isCurrent
                            ? "border-emerald-600/25 bg-white/90 shadow-[0_16px_45px_rgba(15,23,42,0.10)]"
                            : "border-slate-900/10 bg-white/70"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                              Rodada {match.round}/38
                            </p>
                            <p className="mt-1 truncate text-sm font-black sm:text-base">
                              {match.home} {match.homeGoals} x {match.awayGoals} {match.away}
                            </p>
                          </div>

                          <span
                            className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${getResultBadgeClasses(match.result)}`}
                          >
                            {isCurrent ? getResultLabel(match.result) : match.result}
                          </span>
                        </div>

                        {isCurrent && (
                          <div className="mt-4 rounded-2xl border border-slate-900/10 bg-white/75 p-4">
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black">{match.home}</p>
                              </div>

                              <div className="rounded-2xl bg-slate-950 px-5 py-3 text-2xl font-black text-white">
                                {match.homeGoals} x {match.awayGoals}
                              </div>

                              <div className="min-w-0">
                                <p className="truncate text-sm font-black">{match.away}</p>
                              </div>
                            </div>

                            <div className="mt-5 space-y-2">
                              {(match.events || []).length ? (
                                match.events.map((event, eventIndex) => (
                                  <div
                                    key={`${match.round}-${event.minute}-${eventIndex}`}
                                    className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${
                                      event.isUserGoal
                                        ? "force-dark-text border-emerald-600/20 bg-emerald-100/80"
                                        : "border-slate-900/10 bg-white/80"
                                    }`}
                                  >
                                    <span className="event-minute-badge flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                                      {event.minute}'
                                    </span>

                                    <div className="min-w-0 text-left">
                                      <p className="truncate text-sm font-black">
                                        ⚽ {event.scorer}
                                      </p>
                                      <p className="truncate text-xs font-bold text-slate-500">
                                        {event.team}
                                        {event.assist ? ` • assistência: ${event.assist}` : ""}
                                      </p>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-2xl border border-slate-900/10 bg-white/80 px-3 py-3 text-center text-sm font-bold text-slate-500">
                                  Partida truncada, sem gols.
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="pt-3 text-center">
                    {isFinished ? (
                      <button
                        onClick={finishCampaignSimulation}
                        className="force-dark-text inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-200"
                      >
                        <Trophy size={20} />
                        Ver classificação final
                      </button>
                    ) : (
                      <button
                        onClick={revealNextMatch}
                        className="force-dark-text inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-200"
                      >
                        <Play size={20} fill="currentColor" />
                        Iniciar próxima rodada
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <aside className="hidden xl:sticky xl:top-5 xl:block">
              <div className="space-y-5">
                <LeaderboardPanel
                  title="Artilharia"
                  leaders={soloLeaderboards.scorers}
                  valueLabel="gols"
                />

                <LeaderboardPanel
                  title="Assistências"
                  leaders={soloLeaderboards.assistants}
                  valueLabel="assistências"
                />

                <div className="rounded-[2rem] border border-slate-900/10 bg-white/90 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-black">Tabela parcial</h2>
                  <span className="force-dark-text rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-950">
                    Rod. {revealedMatchesCount}
                  </span>
                </div>

                <LeagueStandingsTable
                  table={partialTable}
                  limit={20}
                  highlightUser
                  compact
                  emptyMessage="A tabela parcial aparece conforme a campanha avança."
                />

                <div className="mt-3 rounded-2xl border border-slate-900/10 bg-white/75 p-3 text-xs font-bold text-slate-500">
                  A tabela atualiza rodada por rodada com todos os jogos simulados da rodada, não só o seu jogo.
                </div>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "result" && leagueResult) {
    const { userStanding, userPosition, table, userMatches, userStrength } = leagueResult;
    const lastFive = userMatches.slice(-5);
    const siteUrl = getSiteShareUrl();

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <section className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => setScreen("draft")}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <ArrowLeft size={18} />
              Voltar ao draft
            </button>

            <button
              onClick={restartSoloFromFormation}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <RefreshCw size={16} />
              Jogar de novo
            </button>
          </div>

          <div className="mb-8">
            <div className="force-dark-text mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm font-bold text-emerald-950">
              <Trophy size={18} />
              Etapa 3 de 3
            </div>

            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Brasileirão simulado
            </h1>

            <p className="mt-4 max-w-3xl text-lg text-slate-700">
              Seu XI entrou contra 19 elencos históricos sorteados sem repetir clubes.
            </p>
          </div>

          <div className="mb-6 overflow-hidden rounded-[2rem] border border-emerald-600/20 bg-[radial-gradient(circle_at_top,_rgba(253,186,116,0.28),_rgba(255,255,255,0.82))] p-5 shadow-[0_0_50px_rgba(16,185,129,0.08)] md:p-7">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="force-white-text text-xs font-black uppercase tracking-[0.28em] text-white">
                  Resultado final
                </p>

                <h2 className="mt-3 text-5xl font-black tracking-tight text-slate-950 md:text-7xl">
                  {userPosition}º
                </h2>

                <p className="mt-2 text-lg font-bold text-slate-700">
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
                <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Pontos
                  </p>
                  <p className="classification-points-cell mt-2 text-3xl font-black text-emerald-700">
                    {userStanding.points}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Campanha
                  </p>
                  <p className="mt-2 text-xl font-black text-slate-950">
                    {userStanding.wins}V {userStanding.draws}E {userStanding.losses}D
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Saldo
                  </p>
                  <p className="mt-2 text-3xl font-black text-slate-950">
                    {userStanding.goalDifference}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Força
                  </p>
                  <p className="mt-2 text-3xl font-black text-slate-950">
                    {userStrength}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Defesa
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {Math.round(leagueResult.userSectors.defense.average)}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Meio
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {Math.round(leagueResult.userSectors.midfield.average)}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Ataque
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {Math.round(leagueResult.userSectors.attack.average)}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                  Artilheiro
                </p>
                <p className="mt-2 text-xl font-black">
                  {leagueResult.topScorer.name}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {leagueResult.topScorer.goals} gols
                </p>
              </div>

              <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                  Garçom
                </p>
                <p className="mt-2 text-xl font-black">
                  {leagueResult.playmaker.name}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {leagueResult.playmaker.assists} assistências
                </p>
              </div>
            </div>

            <div className="mt-8 rounded-[2rem] border border-slate-900/10 bg-white/75 p-4">
              <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-black">Imagem da campanha</h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    Este é o card que será copiado ou compartilhado.
                  </p>
                </div>
              </div>

              <div className="w-full overflow-x-auto rounded-[2rem] bg-[#f7f0df] p-3">
                <div ref={shareCardRef} data-share-card-root="true" style={{ width: "920px", background: "#f7f0df" }}>
                  <ResultShareCard
                    leagueResult={leagueResult}
                    selectedFormation={selectedFormation}
                    lineup={lineup}
                    siteUrl={siteUrl}
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <button
                onClick={copyShareImage}
                disabled={isGeneratingShareImage}
                className="force-dark-text inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-4 font-black text-emerald-950 transition hover:bg-emerald-200 disabled:opacity-60"
              >
                <Copy size={18} />
                {isGeneratingShareImage ? "Copiando..." : "Copiar imagem"}
              </button>

              <button
                onClick={shareResultImage}
                disabled={isGeneratingShareImage}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white/75 px-5 py-4 font-black text-slate-950 transition hover:bg-white disabled:opacity-60"
              >
                <Share2 size={18} />
                Compartilhar
              </button>

              <button
                onClick={copyResultText}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white/75 px-5 py-4 font-black text-slate-950 transition hover:bg-white"
              >
                <Copy size={18} />
                {copiedResult ? "Copiado!" : "Copiar texto"}
              </button>
            </div>

            {shareMessage && (
              <p className="mt-3 text-sm font-bold text-slate-500">
                {shareMessage}
              </p>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_0.75fr]">
            <div className="overflow-hidden rounded-[2rem] border border-slate-900/10 bg-white/80 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
              <div className="border-b border-slate-900/10 p-5">
                <h2 className="text-2xl font-black">Tabela final</h2>
              </div>

              <div className="p-4 sm:p-5">
                <LeagueStandingsTable
                  table={table}
                  highlightUser
                  emptyMessage="A tabela final aparece ao terminar a campanha."
                />
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-900/10 bg-white/80 shadow-[0_16px_45px_rgba(15,23,42,0.08)] p-5">
              <h2 className="text-2xl font-black">Reta final</h2>

              <div className="mt-4 space-y-3">
                {lastFive.map((match) => (
                  <div
                    key={match.round}
                    className="rounded-2xl border border-slate-900/10 bg-white/75 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                        Rodada {match.round}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          match.result === "V"
                            ? "selected-green-card online-speed-option-active bg-emerald-300 text-emerald-950"
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

              <div className="mt-6 rounded-2xl border border-slate-900/10 bg-white/75 p-4 text-sm text-slate-700">
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
    const isExpertMode = gameMode === "expert";
    const revealDraftValues = !isExpertMode || isComplete;
    const draftRerollLimit = getDraftRerollLimit(gameMode);
    const alternativeVersions = getAlternativeTeamVersions(currentTeam);
    const canUseReroll = !!currentTeam && !pendingSelection && rerollsRemaining > 0 && !isRolling;
    const hasAnyPlayerDatabase = historicalTeams.some((team) => team.players.length > 0);

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <section className="mx-auto max-w-[1760px] px-6 py-8">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => setScreen("formations")}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <ArrowLeft size={18} />
              Voltar
            </button>

            <button
              onClick={restartDraft}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <RefreshCw size={16} />
              Reiniciar draft
            </button>
          </div>

          <div className="mb-5 text-center">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-700">
              {selectedFormation.name} • {lineup.length}/11
            </p>

            <h1 className="mt-2 text-4xl font-black tracking-tight md:text-6xl">
              Monte seu XI
            </h1>

            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-500 sm:text-base">
              Role um elenco, escolha um jogador e complete o time.
            </p>
          </div>

          <DraftSectorPanel lineup={lineup} revealValues={revealDraftValues} />

          <div className="mx-auto grid max-w-[1760px] gap-6 lg:grid-cols-[minmax(360px,0.92fr)_minmax(520px,1.08fr)] lg:items-start">
            <div className="space-y-6 lg:sticky lg:top-5">
              <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
              {isComplete ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center sm:min-h-[360px] lg:min-h-[420px]">
                  <Trophy className="mb-5 text-emerald-700" size={54} />
                  <h2 className="text-3xl font-black">XI completo!</h2>
                  <p className="mt-3 max-w-md text-slate-700">
                    {isExpertMode
                      ? "Overalls revelados. Agora é hora de colocar esse time no Brasileirão histórico."
                      : "Agora é hora de colocar esse time no Brasileirão histórico."}
                  </p>

                  <div className="mt-8 grid w-full max-w-md gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => runSimulation("step")}
                      className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-4 font-black text-emerald-950 transition hover:bg-emerald-200"
                    >
                      <Play size={20} fill="currentColor" />
                      Jogo a jogo
                    </button>

                    <button
                      onClick={() => runSimulation("full")}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white/75 px-5 py-4 font-black text-slate-950 transition hover:bg-white"
                    >
                      <Shuffle size={20} />
                      Simular tudo
                    </button>
                  </div>
                </div>
              ) : !hasAnyPlayerDatabase ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center sm:min-h-[360px] lg:min-h-[420px]">
                  <Shirt className="mb-5 text-emerald-700" size={54} />
                  <h2 className="text-3xl font-black">Base criada</h2>
                  <p className="mt-3 max-w-md text-slate-700">
                    Os elencos históricos já estão cadastrados, mas ainda estão sem
                    jogadores. O próximo passo é preencher os primeiros times com 18
                    jogadores.
                  </p>
                </div>
              ) : isRolling ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center sm:min-h-[360px] lg:min-h-[420px]">
                  <div className="mb-5 rounded-full border border-emerald-600/20 bg-emerald-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
                    Roletando...
                  </div>

                  <div className="w-full max-w-sm overflow-hidden rounded-[2rem] border border-slate-900/10 bg-white/80 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.10)]">
                    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl border border-slate-900/10 bg-white/70">
                      {rollingTeam ? (
                        <TeamKitIcon clubId={rollingTeam.clubId} size="lg" />
                      ) : (
                        <Shuffle className="text-emerald-700" size={34} />
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

                  <p className="mt-5 text-sm text-slate-500">
                    Segura... vai cair um elenco.
                  </p>
                </div>
              ) : !currentTeam ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center sm:min-h-[360px] lg:min-h-[420px]">
                  <Shuffle className="mb-4 text-emerald-700" size={46} />
                  <h2 className="text-3xl font-black">Próximo elenco</h2>
                  <p className="mt-2 max-w-sm text-sm text-slate-500">
                    {isExpertMode
                      ? "Modo especialista: 1 troca por escolha."
                      : "Modo normal: 3 trocas por escolha."}
                  </p>

                  <button
                    onClick={drawTeam}
                    disabled={isRolling}
                    className="mt-7 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-3xl bg-emerald-300 px-8 py-5 text-xl font-black uppercase tracking-[0.14em] text-emerald-950 shadow-[0_12px_35px_rgba(16,185,129,0.16)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Shuffle size={24} />
                    Rolar
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex items-center gap-3 rounded-3xl border border-slate-900/10 bg-white/75 p-4">
                    <TeamKitIcon clubId={currentTeam.clubId} size="lg" />

                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
                        Caiu
                      </p>
                      <h2 className="break-words text-xl font-black leading-tight sm:text-2xl">
                        {currentTeam.label}
                      </h2>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {currentTeam.era}
                      </p>
                    </div>
                  </div>

                  <div className="mb-4 rounded-3xl border border-slate-900/10 bg-white/75 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                        Trocas restantes
                      </p>
                      <span className="force-dark-text rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-950">
                        {rerollsRemaining}/{draftRerollLimit}
                      </span>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        onClick={rerollAnyTeam}
                        disabled={!canUseReroll}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Shuffle size={16} />
                        Trocar time
                      </button>

                      <button
                        onClick={rerollSameClubVersion}
                        disabled={!canUseReroll || alternativeVersions.length === 0}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <RefreshCw size={16} />
                        Outra versão
                      </button>
                    </div>

                    <p className="mt-2 text-center text-[11px] font-bold text-slate-500">
                      Cada botão gasta 1 troca. Escolheu jogador, as trocas resetam.
                    </p>
                  </div>

                  <div
                    className={`mb-3 rounded-2xl border p-3 text-sm ${
                      pendingSelection
                        ? "border-yellow-400/40 bg-yellow-100/80 text-amber-900"
                        : "border-amber-400/30 bg-amber-100/80 text-amber-900"
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
                          className="inline-flex items-center gap-1 rounded-full border border-slate-900/10 bg-white/70 px-3 py-1 text-xs font-bold text-slate-800 hover:bg-white"
                        >
                          <X size={14} />
                          cancelar
                        </button>
                      </div>
                    ) : (
                      "Escolha 1 jogador para liberar o próximo sorteio."
                    )}
                  </div>

                  <div className="max-h-[390px] space-y-2 overflow-y-auto pr-1 lg:max-h-[460px]">
                    {availablePlayers.map((player) => {
                      const isPendingPlayer = pendingSelection?.player.id === player.id;

                      return (
                        <button
                          key={player.id}
                          onClick={() => pickPlayer(player)}
                          disabled={!player.isAvailable}
                          className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${
                            isPendingPlayer
                              ? "border-yellow-200 bg-yellow-300/15"
                              : player.isAvailable
                              ? "border-slate-900/10 bg-white/75 hover:border-emerald-300/40 hover:bg-emerald-200/10"
                              : "cursor-not-allowed border-slate-900/5 bg-slate-900/5 opacity-40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <h3 className="text-sm font-black sm:text-base">{player.name}</h3>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {player.nationality ? `${player.nationality} • ` : ""}
                                {player.positions.join("/")}
                              </p>
                            </div>

                            <div className="flex min-w-[36px] justify-end">
                              <span className="text-2xl font-black leading-none text-slate-950">
                                {revealDraftValues ? player.ovr : "?"}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            </div>

            <div className="lg:sticky lg:top-5">
              <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.08)] lg:min-h-[620px] lg:[&>div]:h-full">
                <TacticalPitch
                  formation={selectedFormation}
                  lineup={lineup}
                  pendingSelection={pendingSelection}
                  onHighlightedSlotClick={choosePendingSlot}
                  revealOveralls={revealDraftValues}
                />
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "formations") {
    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <section className="mx-auto max-w-6xl px-6 py-10">
          <button
            onClick={goHome}
            className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
          >
            <ArrowLeft size={18} />
            Voltar
          </button>

          <div className="mb-10">
            <div className="force-dark-text mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm font-bold text-emerald-950">
              <LayoutGrid size={18} />
              Pré-draft
            </div>

            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Prepare seu draft
            </h1>

            <p className="mt-4 max-w-2xl text-lg text-slate-700">
              Escolha a formação e o modo de jogo antes de começar. No modo especialista, os overalls ficam escondidos até o XI ficar completo.
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
                      ? "force-dark-text border-emerald-300 bg-emerald-300/15 shadow-[0_14px_35px_rgba(16,185,129,0.12)]"
                      : "border-slate-900/10 bg-white/80 shadow-[0_16px_45px_rgba(15,23,42,0.08)] hover:border-emerald-300/40 hover:bg-white"
                  }`}
                >
                  <div className="mb-5 flex items-center justify-between">
                    <span className="text-3xl font-black">{formation.name}</span>

                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        isSelected
                          ? "selected-green-card online-speed-option-active bg-emerald-300 text-emerald-950"
                          : "bg-white/10 text-slate-700"
                      }`}
                    >
                      {isSelected ? <Check size={20} /> : <Shirt size={20} />}
                    </span>
                  </div>

                  <p className="min-h-[48px] text-sm leading-relaxed text-slate-700">
                    {formation.description}
                  </p>

                  <FormationMiniPreview formation={formation} />
                </button>
              );
            })}
          </div>


          <div className="mt-8 rounded-[2rem] border border-slate-900/10 bg-white/80 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-700">
              Modo de jogo
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setGameMode("normal")}
                className={`rounded-3xl border p-5 text-left transition ${
                  gameMode === "normal"
                    ? "force-dark-text border-emerald-300 bg-emerald-300/15 shadow-[0_14px_35px_rgba(16,185,129,0.12)]"
                    : "border-slate-900/10 bg-white/75 hover:bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-black">Normal</h2>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      gameMode === "normal"
                        ? "selected-green-card online-speed-option-active bg-emerald-300 text-emerald-950"
                        : "bg-white/70 text-slate-700"
                    }`}
                  >
                    {gameMode === "normal" ? <Check size={20} /> : <Shirt size={20} />}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-slate-700">
                  Overalls e médias aparecem durante o draft. Melhor para testar,
                  aprender os elencos e comparar escolhas.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setGameMode("expert")}
                className={`rounded-3xl border p-5 text-left transition ${
                  gameMode === "expert"
                    ? "force-dark-text border-emerald-300 bg-emerald-300/15 shadow-[0_14px_35px_rgba(16,185,129,0.12)]"
                    : "border-slate-900/10 bg-white/75 hover:bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-black">Especialista</h2>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xl font-black ${
                      gameMode === "expert"
                        ? "selected-green-card online-speed-option-active bg-emerald-300 text-emerald-950"
                        : "bg-white/70 text-slate-700"
                    }`}
                  >
                    ?
                  </span>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-slate-700">
                  Overalls dos jogadores e médias de DEF/MEI/ATA ficam ocultos.
                  Tudo só é revelado quando você fecha os 11 titulares.
                </p>
              </button>
            </div>
          </div>

          {selectedFormation && (
            <div className="force-dark-text mt-8 rounded-3xl border border-emerald-600/20 bg-emerald-300/10 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-700">
                    Formação selecionada
                  </p>
                  <h2 className="mt-1 text-3xl font-black">
                    {selectedFormation.name}
                  </h2>
                  <p className="mt-2 text-slate-700">
                    Modo selecionado: {gameMode === "expert" ? "Especialista" : "Normal"}. Próxima etapa: começar o draft.
                  </p>
                </div>

                <button
                  onClick={continueToDraft}
                  className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-7 py-4 font-bold text-emerald-950 transition hover:bg-emerald-200"
                >
                  <Play size={20} fill="currentColor" />
                  Começar draft
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (screen === "support") {
    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-12">
          <button
            onClick={goHome}
            className="mb-8 inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
          >
            <ArrowLeft size={18} />
            Voltar
          </button>

          <div className="rounded-[2.25rem] border border-slate-900/10 bg-white/85 p-6 text-left shadow-[0_18px_50px_rgba(15,23,42,0.10)] sm:p-8 md:p-10">
            <div className="force-dark-text mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm font-bold text-emerald-950">
              <Trophy size={18} />
              Apoie!
            </div>

            <h1 className="max-w-3xl text-4xl font-black tracking-tight md:text-6xl">
              Apoie o 38–0 Brasil
            </h1>

            <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-700">
              O projeto está crescendo com novos elencos, ajustes de overall, melhorias no
              draft e novas formas de compartilhar sua campanha. Seu apoio ajuda a manter
              a base atualizada e a criar novas funções para o jogo.
            </p>

            <div className="mt-8 overflow-hidden rounded-3xl border border-emerald-600/20 bg-emerald-300/10">
              <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
                <div className="force-dark-text flex flex-col items-center justify-center gap-4 bg-white/70 p-6 text-center">
                  <div className="rounded-3xl border border-slate-900/10 bg-white p-3 shadow-[0_14px_30px_rgba(15,23,42,0.10)]">
                    <img
                      src={PIX_QR_CODE_SRC}
                      alt="QR Code Pix para apoiar o 38–0 Brasil"
                      className="h-56 w-56 rounded-2xl object-contain sm:h-64 sm:w-64"
                    />
                  </div>

                  <p className="max-w-xs text-xs font-bold leading-relaxed text-slate-600">
                    Escaneie o QR Code no app do seu banco. O Pix é de valor livre.
                  </p>
                </div>

                <div className="p-6 sm:p-7">
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-700">
                    Apoio via Pix
                  </p>

                  <h2 className="mt-2 text-2xl font-black text-slate-950">
                    Qualquer valor ajuda o projeto a continuar evoluindo.
                  </h2>

                  <p className="mt-3 text-sm leading-relaxed text-slate-700">
                    Você pode escanear o QR Code ou copiar a chave Pix aleatória. O nome do
                    recebedor aparece normalmente na confirmação do Pix.
                  </p>

                  <div className="mt-5 space-y-4">
                    <div className="rounded-2xl border border-slate-900/10 bg-white/80 p-4">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                        Chave Pix aleatória
                      </p>

                      <p className="mt-2 break-all font-mono text-sm font-bold text-slate-800">
                        {PIX_KEY}
                      </p>

                      <button
                        type="button"
                        onClick={() => copySupportPix(PIX_KEY)}
                        className="force-dark-text mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-emerald-950 transition hover:bg-emerald-200"
                      >
                        <Copy size={16} />
                        {copiedPixKey ? "Chave copiada!" : "Copiar chave Pix"}
                      </button>
                    </div>


                  </div>

                  {pixCopyMessage && (
                    <p className="mt-4 rounded-2xl bg-yellow-100 px-4 py-3 text-sm font-bold text-yellow-900">
                      {pixCopyMessage}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-12 text-center">
        <div className="force-dark-text mb-6 flex items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm font-bold text-emerald-950">
          <Trophy size={18} />
         Conquiste o Brasileirão. E se conseguir? Busque o 38-0.
        </div>

        <div className="flex justify-center">
          <img
            src={theme === "dark" ? LOGO_DARK_SRC : LOGO_LIGHT_SRC}
            alt="38–0 Brasil"
            className="h-auto w-[260px] max-w-[80vw] sm:w-[340px] md:w-[420px]"
          />
        </div>

        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-700 md:text-xl">
          Monte um XI com lendas de várias eras do futebol brasileiro e tente
          fazer a campanha perfeita no Brasileirão.
        </p>

        <div className="mt-6 w-full max-w-2xl rounded-3xl border border-emerald-500/25 bg-white/75 px-5 py-4 text-sm font-bold leading-relaxed text-slate-700 shadow-[0_12px_32px_rgba(15,23,42,0.06)] backdrop-blur">
          <p>
            <span className="font-black uppercase tracking-[0.12em] text-emerald-700">
              Aviso importante:
            </span>{" "}
            a partir do dia 14, o único domínio oficial do site será{" "}
            <a
              href="https://38-0-brasil.pages.dev"
              target="_blank"
              rel="noreferrer"
              className="force-dark-text inline-flex rounded-full bg-emerald-300 px-2.5 py-1 text-xs font-black text-emerald-950 underline-offset-4 transition hover:bg-emerald-200 sm:text-sm"
            >
              38-0-brasil.pages.dev
            </a>{" "}
            devido aos limites de uso do Vercel.
          </p>
        </div>

        <div className="mt-8 flex w-full max-w-3xl flex-col items-center gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:justify-center">
            <button
              type="button"
              onClick={startDraft}
              className="force-dark-text inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-7 py-4 font-bold text-emerald-950 transition hover:bg-emerald-200"
            >
              <Play size={20} fill="currentColor" />
              Jogar Solo
            </button>

            <button
              type="button"
              onClick={() => handleEnterOnlineClick("online-home")}
              disabled={isOnlineApiLoading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/25 bg-white/80 px-7 py-4 font-bold text-slate-950 transition hover:bg-white disabled:cursor-wait disabled:opacity-70"
            >
              <Users size={20} />
              {isOnlineApiLoading ? "Conectando..." : "Jogar Online"}
            </button>

            <button
              type="button"
              onClick={() => setScreen("support")}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-7 py-4 font-bold text-slate-950 transition hover:bg-white"
            >
              <Trophy size={20} />
              Apoia-se
            </button>

            <a
              href="https://x.com/38ZeroBrasil"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-7 py-4 font-bold text-slate-950 transition hover:bg-white"
            >
              <Share2 size={20} />
              Contato
            </a>
          </div>

          {onlineApiError ? (
            <p className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
              {onlineApiError}
            </p>
          ) : null}
        </div>

        <div className="mt-10 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          {homeStatsCards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.label}
                className="rounded-3xl border border-emerald-600/15 bg-white/85 p-5 text-left shadow-[0_16px_45px_rgba(15,23,42,0.08)]"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <Icon className="text-emerald-700" size={26} />
                  <span className="rounded-full bg-emerald-300 px-3 py-1 text-xs font-black text-emerald-950">
                    Base
                  </span>
                </div>

                <p className="text-4xl font-black tracking-tight text-slate-950">
                  {card.value.toLocaleString("pt-BR")}
                </p>
                <h2 className="mt-2 text-sm font-black uppercase tracking-[0.18em] text-emerald-700">
                  {card.label}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {card.description}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-900/10 bg-white/80 shadow-[0_16px_45px_rgba(15,23,42,0.08)] p-6 text-left">
            <Shirt className="mb-4 text-emerald-700" size={28} />
            <h2 className="text-lg font-bold">Escolha a formação</h2>
            <p className="mt-2 text-sm text-slate-500">
              4-3-3, 4-4-2, 4-2-3-1, 3-5-2 e outras opções.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-900/10 bg-white/80 shadow-[0_16px_45px_rgba(15,23,42,0.08)] p-6 text-left">
            <Shuffle className="mb-4 text-emerald-700" size={28} />
            <h2 className="text-lg font-bold">Sorteie elencos históricos</h2>
            <p className="mt-2 text-sm text-slate-500">
              Mais de 100 elencos históricos, cult e marcantes do futebol brasileiro.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-900/10 bg-white/80 shadow-[0_16px_45px_rgba(15,23,42,0.08)] p-6 text-left">
            <Trophy className="mb-4 text-emerald-700" size={28} />
            <h2 className="text-lg font-bold">Simule o Brasileirão</h2>
            <p className="mt-2 text-sm text-slate-500">
              Seu XI contra 19 times históricos sorteados sem repetir clubes.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
