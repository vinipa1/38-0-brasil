import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
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
      };

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
      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-white/25 shadow-lg sm:h-12 sm:w-12"
      style={{ background }}
      title={club.name}
    >
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.45),transparent_34%)]" />
      {overall ? (
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[10px] font-black leading-none text-slate-950 shadow-[0_3px_10px_rgba(15,23,42,0.22)] ring-1 ring-black/10 sm:h-7 sm:w-7 sm:text-xs">
          {overall}
        </span>
      ) : (
        <span
          className="relative text-[7px] font-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:text-[9px]"
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
    <div className="relative min-h-[410px] overflow-hidden rounded-[1.5rem] border border-slate-900/10 bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.22),_rgba(6,20,13,0.95))] p-3 sm:min-h-[520px] sm:rounded-[2rem] sm:p-4">
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
                <KitBallIcon clubId={team.clubId} overall={revealOveralls ? player.ovr : "?"} />
              </div>
            ) : (
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-[9px] font-black shadow-xl transition sm:h-12 sm:w-12 sm:text-[11px] md:h-14 md:w-14 md:text-xs ${
                  isHighlighted
                    ? "border-yellow-200 bg-yellow-300 text-yellow-950 shadow-[0_0_32px_rgba(253,224,71,0.65)]"
                    : "border-white/20 bg-black/40 text-slate-700"
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
                  ? "border-emerald-300/30 bg-emerald-300/15"
                  : "border-slate-900/10 bg-white/80"
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
  if (result === "V") return "bg-emerald-300 text-emerald-950";
  if (result === "E") return "bg-yellow-300 text-yellow-950";
  return "bg-red-400 text-red-950";
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

function getPartialUserPosition(leagueResult, revealedMatches) {
  if (!leagueResult || !revealedMatches.length) return "—";

  return getPartialUserStanding(leagueResult, revealedMatches.length).position;
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
  const lineupRows = selectedFormation.slots.map((slot, index) => {
    const lineupItem = lineup.find((item) => item.slotIndex === index);

    return {
      position: slot.position,
      name: lineupItem?.player.name || "Vazio",
      ovr: lineupItem?.player.ovr || "—",
    };
  });

  return (
    <div className="w-[900px] overflow-hidden rounded-[42px] bg-[#f7f0df] p-10 text-slate-950 shadow-2xl">
      <div className="rounded-[34px] border border-slate-900/10 bg-white/85 p-8">
        <div className="flex items-start justify-between gap-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.3em] text-emerald-700">
              38–0 Brasil
            </p>
            <h1 className="mt-3 text-6xl font-black tracking-tight">
              {userPosition}º lugar
            </h1>
            <p className="mt-2 text-2xl font-black text-slate-700">
              {userPosition === 1
                ? "Campeão do Brasileirão histórico"
                : userPosition <= 4
                ? "Campanha de G-4"
                : userPosition <= 6
                ? "Campanha forte"
                : "Campanha encerrada"}
            </p>
          </div>

          <div className="rounded-[28px] bg-emerald-300 px-8 py-6 text-center text-emerald-950">
            <p className="text-6xl font-black leading-none">{userStanding.points}</p>
            <p className="mt-1 text-sm font-black uppercase tracking-[0.22em]">
              pontos
            </p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-4 gap-4">
          <div className="rounded-3xl bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
              Campanha
            </p>
            <p className="mt-2 text-2xl font-black">
              {userStanding.wins}V {userStanding.draws}E {userStanding.losses}D
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
              Gols
            </p>
            <p className="mt-2 text-2xl font-black">
              {userStanding.goalsFor}/{userStanding.goalsAgainst}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
              Saldo
            </p>
            <p className="mt-2 text-2xl font-black">
              {userStanding.goalDifference > 0 ? "+" : ""}
              {userStanding.goalDifference}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
              Força
            </p>
            <p className="mt-2 text-2xl font-black">{leagueResult.userStrength}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-[1.1fr_0.9fr] gap-6">
          <div className="rounded-[30px] bg-white p-6">
            <h2 className="text-2xl font-black">Escalação</h2>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {lineupRows.map((player, index) => (
                <div
                  key={`${player.position}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-[#f7f0df] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">
                      {player.position}
                    </p>
                    <p className="truncate text-sm font-black">{player.name}</p>
                  </div>

                  <p className="shrink-0 text-xl font-black">{player.ovr}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[30px] bg-white p-6">
              <h2 className="text-2xl font-black">Destaques</h2>

              <div className="mt-4 space-y-3">
                <div className="rounded-2xl bg-[#f7f0df] p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">
                    Artilheiro
                  </p>
                  <p className="mt-1 truncate text-lg font-black">
                    {leagueResult.topScorer.name}
                  </p>
                  <p className="text-sm font-bold text-slate-500">
                    {leagueResult.topScorer.goals} gols
                  </p>
                </div>

                <div className="rounded-2xl bg-[#f7f0df] p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">
                    Assistente
                  </p>
                  <p className="mt-1 truncate text-lg font-black">
                    {leagueResult.playmaker.name}
                  </p>
                  <p className="text-sm font-bold text-slate-500">
                    {leagueResult.playmaker.assists} assists
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[30px] bg-white p-6">
              <h2 className="text-2xl font-black">Classificação</h2>

              <div className="mt-4 space-y-2">
                {shareTable.map((team) => (
                  <div
                    key={team.id}
                    className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ${
                      team.isUserTeam ? "bg-emerald-300 text-emerald-950" : "bg-[#f7f0df]"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">
                        {team.position}º {team.label}
                      </p>
                      <p className="text-xs font-bold opacity-70">
                        {team.wins}V {team.draws}E {team.losses}D • SG {team.goalDifference}
                      </p>
                    </div>

                    <p className="shrink-0 text-xl font-black">{team.points}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-7 rounded-2xl bg-[#f7f0df] px-5 py-4 text-center">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
            Monte seu XI. Simule o Brasileirão. Busque o 38–0.
          </p>
          <p className="mt-2 text-sm font-black text-emerald-700">
            {siteUrl || "38-0 Brasil"}
          </p>
        </div>
      </div>
    </div>
  );
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
  const [pendingSelection, setPendingSelection] = useState(null);
  const [leagueResult, setLeagueResult] = useState(null);
  const [revealedMatchesCount, setRevealedMatchesCount] = useState(0);
  const currentMatchRef = useRef(null);
  const [copiedResult, setCopiedResult] = useState(false);
  const shareCardRef = useRef(null);
  const [shareImageUrl, setShareImageUrl] = useState("");
  const [isGeneratingShareImage, setIsGeneratingShareImage] = useState(false);
  const [shareMessage, setShareMessage] = useState("");

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
    setGameMode("normal");
    setLineup([]);
    setCurrentTeam(null);
    setRollingTeam(null);
    setIsRolling(false);
    setPendingSelection(null);
    setLeagueResult(null);
    setRevealedMatchesCount(0);
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
    setRevealedMatchesCount(0);
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
    setRevealedMatchesCount(0);
    setCopiedResult(false);
  }

  function runSimulation(mode = "full") {
    if (!selectedFormation || lineup.length !== selectedFormation.slots.length) return;

    const result = simulateBrazilianLeague(lineup, selectedFormation);
    setLeagueResult(result);
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
    if (!leagueResult) return;

    setRevealedMatchesCount((currentCount) => {
      const nextCount = Math.min(currentCount + 1, leagueResult.userMatches.length);

      window.setTimeout(() => {
        currentMatchRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 80);

      return nextCount;
    });
  }

  function finishCampaignSimulation() {
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

  async function createShareImageBlob() {
    const element = shareCardRef.current;

    if (!element) {
      throw new Error("Card de compartilhamento não foi encontrado.");
    }

    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => window.setTimeout(resolve, 160));

    const rect = element.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      throw new Error("Card de compartilhamento está sem tamanho para captura.");
    }

    const canvas = await html2canvas(element, {
      backgroundColor: "#f7f0df",
      scale: 2,
      useCORS: true,
      logging: false,
      removeContainer: true,
    });

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Não foi possível criar o PNG."));
          return;
        }

        resolve(blob);
      }, "image/png", 1);
    });
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

  if (screen === "campaign" && leagueResult) {
    const revealedMatches = leagueResult.userMatches.slice(0, revealedMatchesCount);
    const campaignStats = getPartialCampaignStats(revealedMatches);
    const partialStandingInfo = getPartialUserStanding(leagueResult, revealedMatchesCount);
    const partialTable = partialStandingInfo.table;
    const campaignLeaders = getPartialCampaignLeaders(revealedMatches);
    const partialPosition = partialStandingInfo.position;
    const isFinished = revealedMatchesCount >= leagueResult.userMatches.length;
    const nextMatch = leagueResult.userMatches[revealedMatchesCount] || null;

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />

        <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => setScreen("draft")}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <ArrowLeft size={18} />
              Voltar ao draft
            </button>

            <button
              onClick={goHome}
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
                    <p className="text-3xl font-black">{campaignStats.points}</p>
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
                      <p className="text-xl font-black text-emerald-700">{campaignStats.points}</p>
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
              </div>

              {revealedMatchesCount === 0 ? (
                <div className="rounded-[2rem] border border-slate-900/10 bg-white/85 p-6 text-center shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                  <Play className="mx-auto mb-4 text-emerald-700" size={52} />
                  <h2 className="text-3xl font-black">Começar campanha</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                    Revele um jogo por vez. O jogo anterior fecha automaticamente e a tela acompanha o próximo resultado.
                  </p>

                  <button
                    onClick={revealNextMatch}
                    className="mt-7 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-200"
                  >
                    <Play size={20} fill="currentColor" />
                    Revelar 1º jogo
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
                                        ? "border-emerald-600/20 bg-emerald-100/80"
                                        : "border-slate-900/10 bg-white/80"
                                    }`}
                                  >
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
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
                        className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-200"
                      >
                        <Trophy size={20} />
                        Ver classificação final
                      </button>
                    ) : (
                      <button
                        onClick={revealNextMatch}
                        className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-4 font-black text-emerald-950 transition hover:bg-emerald-200"
                      >
                        <Play size={20} fill="currentColor" />
                        Próximo jogo
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <aside className="hidden xl:sticky xl:top-5 xl:block">
              <div className="rounded-[2rem] border border-slate-900/10 bg-white/90 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-black">Tabela parcial</h2>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                    Rod. {revealedMatchesCount}
                  </span>
                </div>

                <div className="space-y-2">
                  {partialTable.slice(0, 10).map((team, index) => (
                    <div
                      key={team.id}
                      className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-sm ${
                        team.isUserTeam
                          ? "border-emerald-500/30 bg-emerald-100/90"
                          : "border-slate-900/10 bg-white/75"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-black">
                          {index + 1}. {team.label}
                        </p>
                        <p className="text-[11px] font-bold text-slate-500">
                          {team.wins}V {team.draws}E {team.losses}D • SG {team.goalDifference}
                        </p>
                      </div>

                      <p className="shrink-0 text-lg font-black text-emerald-700">
                        {team.points}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 rounded-2xl border border-slate-900/10 bg-white/75 p-3 text-xs font-bold text-slate-500">
                  A tabela atualiza rodada por rodada com todos os jogos simulados da rodada, não só o seu jogo.
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
              onClick={goHome}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
            >
              <RefreshCw size={16} />
              Jogar de novo
            </button>
          </div>

          <div className="mb-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-700">
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
                <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-700">
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
                  <p className="mt-2 text-3xl font-black text-emerald-700">
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
                    Este é o card que será baixado ou compartilhado.
                  </p>
                </div>
              </div>

              <div className="w-full overflow-x-auto rounded-[2rem] bg-[#f7f0df] p-3">
                <div ref={shareCardRef} className="origin-top-left">
                  <ResultShareCard
                    leagueResult={leagueResult}
                    selectedFormation={selectedFormation}
                    lineup={lineup}
                    siteUrl={siteUrl}
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              <button
                onClick={generateShareImage}
                disabled={isGeneratingShareImage}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-4 font-black text-emerald-950 transition hover:bg-emerald-200 disabled:opacity-60"
              >
                <Copy size={18} />
                {isGeneratingShareImage ? "Gerando..." : "Gerar imagem"}
              </button>

              <button
                onClick={downloadShareImage}
                disabled={isGeneratingShareImage}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-900/10 bg-white/75 px-5 py-4 font-black text-slate-950 transition hover:bg-white disabled:opacity-60"
              >
                <Download size={18} />
                Baixar PNG
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

            {shareImageUrl && (
              <div className="mt-5 rounded-2xl border border-slate-900/10 bg-white/75 p-4">
                <p className="mb-3 text-sm font-black text-slate-700">
                  PNG gerado:
                </p>
                <img
                  src={shareImageUrl}
                  alt="Resumo da campanha"
                  className="w-full rounded-2xl border border-slate-900/10"
                />
              </div>
            )}

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

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-white/75 text-xs uppercase tracking-[0.18em] text-slate-500">
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
                          team.isUserTeam ? "bg-emerald-300/15" : ""
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
                    className={`p-4 ${team.isUserTeam ? "bg-emerald-300/15" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-black">
                          {index + 1}. {team.label}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {team.wins}V {team.draws}E {team.losses}D • SG {team.goalDifference}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-2xl font-black text-emerald-700">
                          {team.points}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                          pts
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                      <div className="rounded-xl bg-white/75 px-2 py-2">
                        <p className="font-black">{team.played}</p>
                        <p className="text-slate-500">J</p>
                      </div>
                      <div className="rounded-xl bg-white/75 px-2 py-2">
                        <p className="font-black">{team.goalsFor}</p>
                        <p className="text-slate-500">GP</p>
                      </div>
                      <div className="rounded-xl bg-white/75 px-2 py-2">
                        <p className="font-black">{team.goalsAgainst}</p>
                        <p className="text-slate-500">GC</p>
                      </div>
                      <div className="rounded-xl bg-white/75 px-2 py-2">
                        <p className="font-black">{team.goalDifference}</p>
                        <p className="text-slate-500">SG</p>
                      </div>
                    </div>
                  </div>
                ))}
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
                            ? "bg-emerald-300 text-emerald-950"
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
    const hasAnyPlayerDatabase = historicalTeams.some((team) => team.players.length > 0);

    return (
      <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <section className="mx-auto max-w-7xl px-6 py-8">
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

          <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(360px,0.92fr)_minmax(520px,1.08fr)] lg:items-start">
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
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-4 font-black text-emerald-950 transition hover:bg-emerald-200"
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
                    Sem re-roll. Caiu, escolheu.
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
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-700">
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
                      ? "border-emerald-300 bg-emerald-300/15 shadow-[0_14px_35px_rgba(16,185,129,0.12)]"
                      : "border-slate-900/10 bg-white/80 shadow-[0_16px_45px_rgba(15,23,42,0.08)] hover:border-emerald-300/40 hover:bg-white"
                  }`}
                >
                  <div className="mb-5 flex items-center justify-between">
                    <span className="text-3xl font-black">{formation.name}</span>

                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        isSelected
                          ? "bg-emerald-300 text-emerald-950"
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
                    ? "border-emerald-300 bg-emerald-300/15 shadow-[0_14px_35px_rgba(16,185,129,0.12)]"
                    : "border-slate-900/10 bg-white/75 hover:bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-black">Normal</h2>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      gameMode === "normal"
                        ? "bg-emerald-300 text-emerald-950"
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
                    ? "border-emerald-300 bg-emerald-300/15 shadow-[0_14px_35px_rgba(16,185,129,0.12)]"
                    : "border-slate-900/10 bg-white/75 hover:bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-black">Especialista</h2>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xl font-black ${
                      gameMode === "expert"
                        ? "bg-emerald-300 text-emerald-950"
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
            <div className="mt-8 rounded-3xl border border-emerald-600/20 bg-emerald-300/10 p-6">
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
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-7 py-4 font-bold text-emerald-950 transition hover:bg-emerald-200"
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

  return (
    <main className={`min-h-screen bg-[#f7f0df] text-slate-950 ${themeClass}`}>
        <ThemeStyles />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-6 flex items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-700">
          <Trophy size={18} />
          Futebol brasileiro histórico • v33 card visível • v21 draft refinado • v20 layout claro • v19 setores no draft • v18 simulação por setores • v17 resumo escalação • v16 resultado compartilhável • v15 nome legível • v14 nome justo • v13 nome compacto • v12 fontes ajustadas • v11 roleta • v10 bolinhas • v9 mobile compacto • v8 draft dinâmico • v7 líderes variados • v6 simulação balanceada • v5 simulação
        </div>

        <h1 className="max-w-3xl text-5xl font-black tracking-tight md:text-7xl">
          38–0 Brasil
        </h1>

        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-700 md:text-xl">
          Monte um XI com lendas de várias eras do futebol brasileiro e tente
          fazer a campanha perfeita no Brasileirão.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <button
            onClick={startDraft}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-7 py-4 font-bold text-emerald-950 transition hover:bg-emerald-200"
          >
            <Play size={20} fill="currentColor" />
            Começar Draft
          </button>

          <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-7 py-4 font-bold text-slate-950 transition hover:bg-white">
            <Shuffle size={20} />
            Ver exemplo
          </button>
        </div>

        <div className="mt-14 grid w-full max-w-4xl gap-4 md:grid-cols-3">
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
