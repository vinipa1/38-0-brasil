const LEAGUE_META_KEY = "league-secret-meta";
const LEAGUE_ROUND_PREFIX = "league-secret-round:";
const MAX_DATABASE_TEAMS = 20;
const MAX_TEAM_PLAYERS = 32;

const SPEED_INTERVALS = {
  turbo: 35,
  fast: 70,
  normal: 95,
  slow: 200,
};

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanText(value, fallback = "", maxLength = 120) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return (text || fallback).slice(0, maxLength);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values, fallback = 76) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return fallback;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function sanitizePlayer(player, index = 0) {
  const ovr = clampNumber(Number(player?.ovr || 75), 40, 99);
  const positions = Array.isArray(player?.positions)
    ? player.positions.map((position) => cleanText(position, "", 8)).filter(Boolean).slice(0, 6)
    : [];

  return {
    id: cleanText(player?.id, `player-${index}`, 160),
    name: cleanText(player?.name, `Jogador ${index + 1}`, 80),
    ovr,
    positions,
  };
}

function sanitizeDatabaseTeam(team, index = 0) {
  const players = (Array.isArray(team?.players) ? team.players : [])
    .slice(0, MAX_TEAM_PLAYERS)
    .map((player, playerIndex) => sanitizePlayer(player, playerIndex));

  const id = cleanText(team?.id, `database-${index}`, 160);
  const clubId = cleanText(team?.clubId, id, 160);
  const label = cleanText(team?.label || team?.club, `Time ${index + 1}`, 80);

  return {
    id,
    clubId,
    club: cleanText(team?.club, label, 80),
    label,
    era: cleanText(team?.era, "Histórico", 80),
    type: cleanText(team?.type, "Database", 30),
    strength: clampNumber(Number(team?.strength || 76), 50, 99),
    players,
    isUserTeam: false,
    isOnlineHumanTeam: false,
    ownerParticipantId: null,
    playerName: null,
    formationName: "4-4-2",
    lineup: [],
  };
}

function getLineupSectors(lineup) {
  const defense = lineup.filter((item) => ["GOL", "LD", "ZAG", "LE"].includes(item.slotPosition));
  const midfield = lineup.filter((item) => item.slotPosition === "MC");
  const attack = lineup.filter((item) => ["PE", "PD", "CA"].includes(item.slotPosition));

  const defenseAverage = average(defense.map((item) => Number(item.player?.ovr)), 76);
  const midfieldAverage = average(midfield.map((item) => Number(item.player?.ovr)), defenseAverage);
  const attackAverage = average(attack.map((item) => Number(item.player?.ovr)), midfieldAverage);

  return {
    defense: { average: defenseAverage, count: defense.length },
    midfield: { average: midfieldAverage, count: midfield.length },
    attack: { average: attackAverage, count: attack.length },
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
  const defenders = players.filter((player) => player.positions.some((position) => ["LD", "ZAG", "LE"].includes(position)));
  const midfielders = players.filter((player) => player.positions.includes("MC"));
  const attackers = players.filter((player) => player.positions.some((position) => ["PE", "PD", "CA"].includes(position)));

  const defenseAverage = average([...goalkeepers, ...defenders].map((player) => player.ovr), team.strength || 76);
  const midfieldAverage = average(midfielders.map((player) => player.ovr), team.strength || defenseAverage);
  const attackAverage = average(attackers.map((player) => player.ovr), team.strength || midfieldAverage);

  return {
    defense: { average: defenseAverage, count: goalkeepers.length + defenders.length },
    midfield: { average: midfieldAverage, count: midfielders.length },
    attack: { average: attackAverage, count: attackers.length },
  };
}

function calculateTeamStrengthFromSectors(sectors) {
  return Math.round(
    sectors.defense.average * 0.35 +
    sectors.midfield.average * 0.3 +
    sectors.attack.average * 0.35,
  );
}

function getLineupStrength(lineup) {
  if (!lineup.length) return 75;
  const sectors = getLineupSectors(lineup);
  const averageOvr = lineup.reduce((sum, item) => sum + Number(item.player?.ovr || 75), 0) / lineup.length;
  const structureBonus =
    Math.min(sectors.defense.count, 5) * 0.16 +
    Math.min(sectors.midfield.count, 4) * 0.14 +
    Math.min(sectors.attack.count, 3) * 0.18;
  const sectorStrength = calculateTeamStrengthFromSectors(sectors);
  return Math.round(clampNumber(averageOvr * 0.38 + sectorStrength * 0.62 + structureBonus, 60, 99));
}

function normalizeTeamForSimulation(team) {
  const sectors = team.isOnlineHumanTeam ? getLineupSectors(team.lineup || []) : getHistoricalTeamSectors(team);
  const sectorStrength = calculateTeamStrengthFromSectors(sectors);
  const originalStrength = team.strength || sectorStrength;
  return {
    ...team,
    sectors,
    strength: Math.round(originalStrength * 0.25 + sectorStrength * 0.75),
  };
}

function createHumanTeam(participant, lineup) {
  const cleanLineup = (Array.isArray(lineup) ? lineup : []).map((item, index) => ({
    slotIndex: Number.isInteger(item?.slotIndex) ? item.slotIndex : index,
    slotPosition: cleanText(item?.slotPosition, "MC", 8),
    player: sanitizePlayer(item?.player || {}, index),
    team: item?.team ? {
      clubId: cleanText(item.team.clubId, "", 160),
      label: cleanText(item.team.label || item.team.club, "", 80),
      club: cleanText(item.team.club || item.team.label, "", 80),
    } : null,
  }));

  const team = {
    id: `online-${participant.id}`,
    clubId: `online-${participant.id}`,
    club: cleanText(participant.teamName, "Meu XI", 80),
    label: cleanText(participant.teamName, "Meu XI", 80),
    era: cleanText(participant.formationName || participant.formationId, "Formação", 80),
    type: "Player",
    strength: getLineupStrength(cleanLineup),
    isUserTeam: false,
    isOnlineHumanTeam: true,
    ownerParticipantId: participant.id,
    playerName: cleanText(participant.playerName, "Jogador", 80),
    formationName: cleanText(participant.formationName || participant.formationId, "Formação", 80),
    lineup: cleanLineup,
    players: [],
  };

  return normalizeTeamForSimulation(team);
}

function getTeamAttackStrength(team) {
  return Math.round(team.sectors.attack.average * 0.58 + team.sectors.midfield.average * 0.28 + team.strength * 0.14);
}

function getTeamDefenseStrength(team) {
  return Math.round(team.sectors.defense.average * 0.62 + team.sectors.midfield.average * 0.23 + team.strength * 0.15);
}

function getTeamControlStrength(team) {
  return Math.round(
    team.sectors.midfield.average * 0.56 +
    team.sectors.attack.average * 0.2 +
    team.sectors.defense.average * 0.14 +
    team.strength * 0.1,
  );
}

function getMatchExpectation(attackingTeam, defendingTeam, homeBonus = 0) {
  const attack = getTeamAttackStrength(attackingTeam);
  const defense = getTeamDefenseStrength(defendingTeam);
  const controlGap = getTeamControlStrength(attackingTeam) - getTeamControlStrength(defendingTeam);
  const overallGap = attackingTeam.strength - defendingTeam.strength;
  const diff = attack - defense + controlGap * 0.3 + overallGap * 0.32 + homeBonus;
  let expected = 1.15 + diff / 17.5;
  if (homeBonus > 0) expected += 0.08;
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
  const homeExpected = getMatchExpectation(homeTeam, awayTeam, 1.35);
  const awayExpected = getMatchExpectation(awayTeam, homeTeam, 0);
  let homeGoals = generateGoalsFromExpected(homeExpected);
  let awayGoals = generateGoalsFromExpected(awayExpected);
  const strengthGap = homeTeam.strength - awayTeam.strength;
  const expectedGap = homeExpected - awayExpected;

  if (strengthGap >= 8 && homeGoals < awayGoals && Math.random() < 0.35) homeGoals = awayGoals;
  if (strengthGap <= -8 && homeGoals > awayGoals && Math.random() < 0.32) awayGoals = homeGoals;
  if (strengthGap >= 12 && homeGoals === awayGoals && Math.random() < 0.28) homeGoals += 1;
  if (strengthGap <= -12 && homeGoals === awayGoals && Math.random() < 0.25) awayGoals += 1;
  if (expectedGap >= 1.0 && homeGoals < awayGoals && Math.random() < 0.45) homeGoals = awayGoals;
  if (expectedGap <= -1.0 && homeGoals > awayGoals && Math.random() < 0.42) awayGoals = homeGoals;

  return { homeGoals, awayGoals };
}

function createRoundRobinSchedule(teams) {
  const fixedTeams = [...teams];
  if (fixedTeams.length % 2 !== 0) fixedTeams.push(null);
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
      matches.push({ homeTeam: invertHome ? teamB : teamA, awayTeam: invertHome ? teamA : teamB });
    }
    firstTurn.push(matches);
    const fixed = rotation[0];
    const rest = rotation.slice(1);
    rest.unshift(rest.pop());
    rotation.splice(0, rotation.length, fixed, ...rest);
  }

  const secondTurn = firstTurn.map((matches) => matches.map((match) => ({
    homeTeam: match.awayTeam,
    awayTeam: match.homeTeam,
  })));
  return [...firstTurn, ...secondTurn];
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
    isUserTeam: false,
    isOnlineHumanTeam: Boolean(team.isOnlineHumanTeam),
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

function sortTable(standings) {
  return Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });
}

function weightedRandom(items, getWeight) {
  const total = items.reduce((sum, item) => sum + Math.max(0, getWeight(item)), 0);
  if (total <= 0) return items[0] || null;
  let random = Math.random() * total;
  for (const item of items) {
    random -= Math.max(0, getWeight(item));
    if (random <= 0) return item;
  }
  return items.at(-1) || null;
}

function getEventPlayers(team) {
  if (team.lineup?.length) {
    return team.lineup.map((item) => ({
      id: item.player.id,
      name: item.player.name,
      ovr: item.player.ovr,
      positions: [item.slotPosition, ...(item.player.positions || [])],
    }));
  }
  return team.players || [];
}

function eventPlayerWeight(player, context = "goal") {
  const positions = player.positions || [];
  const power = Math.max(1, (player.ovr || 75) - 60);
  if (context === "assist") {
    if (positions.includes("MC")) return power * 1.45;
    if (positions.includes("PE") || positions.includes("PD")) return power * 1.18;
    if (positions.includes("LD") || positions.includes("LE")) return power * 0.58;
    if (positions.includes("CA")) return power * 0.52;
    return power * 0.16;
  }
  if (positions.includes("CA")) return power * 1.5;
  if (positions.includes("PE") || positions.includes("PD")) return power * 1.22;
  if (positions.includes("MC")) return power * 0.78;
  if (positions.includes("LD") || positions.includes("LE")) return power * 0.18;
  if (positions.includes("ZAG")) return power * 0.08;
  return 0;
}

function pickEventPlayer(team, context = "goal", blockedId = null) {
  const players = getEventPlayers(team).filter((player) => player.id !== blockedId);
  const outfield = players.filter((player) => !(player.positions || []).includes("GOL"));
  const pool = outfield.length ? outfield : players;
  return weightedRandom(pool, (player) => eventPlayerWeight(player, context));
}

function getPlayerRole(slotPosition) {
  if (slotPosition === "GOL") return "goalkeeper";
  if (["LD", "ZAG", "LE"].includes(slotPosition)) return "defender";
  if (["MC", "VOL", "MEI", "ME", "MD"].includes(slotPosition)) return "midfielder";
  return "attacker";
}

function getGoalRatingBonus(role) {
  if (role === "goalkeeper") return 2;
  if (role === "defender") return 1.4;
  if (role === "midfielder") return 1.15;
  return 1;
}

function getAssistRatingBonus(role) {
  if (role === "goalkeeper") return 1;
  if (role === "defender") return 0.85;
  if (role === "midfielder") return 0.7;
  return 0.55;
}

function getDefensiveRatingAdjustment(role, goalsAgainst) {
  if (goalsAgainst === 0) {
    if (role === "goalkeeper") return 0.75;
    if (role === "defender") return 0.55;
    if (role === "midfielder") return 0.2;
    return 0;
  }

  if (role === "goalkeeper") return -goalsAgainst * 0.22;
  if (role === "defender") return -goalsAgainst * 0.18;
  if (role === "midfielder") return -goalsAgainst * 0.06;
  return 0;
}

function calculateHumanTeamMatchRatings(team, opponent, goalsFor, goalsAgainst, events) {
  if (!team?.isOnlineHumanTeam || !team.lineup?.length) return [];

  const resultBonus = goalsFor > goalsAgainst ? 0.3 : goalsFor < goalsAgainst ? -0.3 : 0;
  const goalDifferenceBonus = clampNumber((goalsFor - goalsAgainst) * 0.08, -0.4, 0.4);
  const opponentGap = Number(opponent?.strength || 76) - Number(team?.strength || 76);
  const upsetBonus = goalsFor > goalsAgainst && opponentGap > 3
    ? clampNumber(opponentGap * 0.018, 0, 0.25)
    : goalsFor < goalsAgainst && opponentGap < -3
      ? -clampNumber(Math.abs(opponentGap) * 0.012, 0, 0.18)
      : 0;

  return team.lineup.map((item) => {
    const player = item.player || {};
    const role = getPlayerRole(item.slotPosition);
    const playerGoals = (events || []).filter(
      (event) => event.type === "goal" &&
        event.teamId === team.id &&
        (event.playerId === player.id || (!event.playerId && event.playerName === player.name)),
    ).length;
    const playerAssists = (events || []).filter(
      (event) => event.type === "goal" &&
        event.teamId === team.id &&
        (event.assistId === player.id || (!event.assistId && event.assistName === player.name)),
    ).length;
    const ovr = Number(player.ovr || 75);
    const talentAdjustment = clampNumber((ovr - 78) * 0.012, -0.24, 0.24);
    const variationRange = clampNumber(0.58 - (ovr - 60) * 0.008, 0.3, 0.58);
    const individualVariation = (Math.random() * 2 - 1) * variationRange;
    const attackingContribution =
      playerGoals * getGoalRatingBonus(role) +
      playerAssists * getAssistRatingBonus(role);
    const defensiveAdjustment = getDefensiveRatingAdjustment(role, goalsAgainst);

    const rawRating =
      6.5 +
      resultBonus +
      goalDifferenceBonus +
      upsetBonus +
      talentAdjustment +
      individualVariation +
      attackingContribution +
      defensiveAdjustment;

    return {
      teamId: team.id,
      playerId: player.id,
      playerName: player.name,
      slotIndex: item.slotIndex,
      slotPosition: item.slotPosition,
      rating: Math.round(clampNumber(rawRating, 3, 10) * 10) / 10,
    };
  });
}

function goalDescription(scorer, assist) {
  const scorerName = scorer?.name || "O atacante";
  const assistName = assist?.name || null;
  const templates = assistName
    ? [
      `${assistName} acha ${scorerName} na área, e ele finaliza no canto.`,
      `${assistName} levanta na medida e ${scorerName} aparece para completar.`,
      `${assistName} puxa o ataque e deixa ${scorerName} em ótima condição para marcar.`,
      `${assistName} cruza com precisão, ${scorerName} sobe firme e manda para o gol.`,
    ]
    : [
      `${scorerName} recebe perto da área, ajeita o corpo e bate colocado.`,
      `${scorerName} aproveita sobra na entrada da área e finaliza sem chance.`,
      `${scorerName} ganha da marcação e toca na saída do goleiro.`,
      `${scorerName} aparece no momento certo e empurra para o fundo da rede.`,
    ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function generateEvents(match) {
  const events = [];
  const usedMinutes = new Set();
  const totalGoals = match.homeGoals + match.awayGoals;

  function nextGoalMinute(goalIndex) {
    let minute = Math.round(((goalIndex + 1) * 90) / (totalGoals + 1));
    minute += Math.floor(Math.random() * 15) - 7;
    minute = clampNumber(minute, 3, 90);
    while (usedMinutes.has(minute)) minute = clampNumber(minute + 1, 3, 90);
    usedMinutes.add(minute);
    return minute;
  }

  function addGoal(side, goalIndex) {
    const team = side === "home" ? match.homeTeam : match.awayTeam;
    const scorer = pickEventPlayer(team, "goal");
    const assist = Math.random() < 0.7 ? pickEventPlayer(team, "assist", scorer?.id) : null;
    events.push({
      id: `${match.round}-${match.homeTeam.id}-${match.awayTeam.id}-${side}-goal-${goalIndex}`,
      type: "goal",
      icon: "⚽",
      minute: nextGoalMinute(events.length),
      side,
      teamId: team.id,
      teamLabel: team.label,
      title: `Gol de ${scorer?.name || team.label}`,
      description: goalDescription(scorer, assist),
      playerId: scorer?.id || null,
      playerName: scorer?.name || null,
      assistId: assist?.id || null,
      assistName: assist?.name || null,
    });
  }

  for (let index = 0; index < match.homeGoals; index += 1) addGoal("home", index);
  for (let index = 0; index < match.awayGoals; index += 1) addGoal("away", index);
  return events.sort((a, b) => a.minute - b.minute);
}

function slimTeam(team) {
  return {
    id: team.id,
    clubId: team.clubId,
    club: team.club,
    label: team.label,
    era: team.era,
    type: team.type,
    strength: team.strength,
    sectors: cloneJson(team.sectors),
    isUserTeam: false,
    isOnlineHumanTeam: Boolean(team.isOnlineHumanTeam),
    ownerParticipantId: team.ownerParticipantId || null,
    playerName: team.playerName || null,
    formationName: team.formationName || null,
    lineup: cloneJson(team.lineup || []),
    players: cloneJson(team.players || []),
  };
}

function createInitialPlayerStats(humanTeams) {
  return Object.fromEntries(
    humanTeams.map((team) => [
      team.id,
      {
        teamId: team.id,
        teamLabel: team.label,
        ownerParticipantId: team.ownerParticipantId || null,
        playerName: team.playerName || null,
        formationName: team.formationName || null,
        players: (team.lineup || []).map((item) => ({
          playerId: item.player?.id || `${team.id}-${item.slotIndex}`,
          name: item.player?.name || "Jogador",
          ovr: Number(item.player?.ovr || 75),
          slotIndex: item.slotIndex,
          slotPosition: item.slotPosition,
          clubId: item.team?.clubId || null,
          matches: 0,
          goals: 0,
          assists: 0,
          ratingTotal: 0,
          averageRating: null,
          lastRating: null,
          lastRound: 0,
        })),
      },
    ]),
  );
}

function publicMatchSkeleton(match) {
  return {
    round: match.round,
    homeTeamId: match.homeTeam.id,
    awayTeamId: match.awayTeam.id,
    home: match.home,
    away: match.away,
    homeGoals: null,
    awayGoals: null,
    hasHumanTeam: match.hasHumanTeam,
    events: [],
    isRevealed: false,
  };
}

function sortLeaderboard(items) {
  return items.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.name.localeCompare(b.name);
  });
}

export function addRoundToLeaderboards(publicResult, hiddenRound) {
  const current = publicResult?.leaderboards || { scorers: [], assistants: [] };
  const scorerMap = new Map((current.scorers || []).map((item) => [`${item.name}__${item.team}`, { ...item }]));
  const assistantMap = new Map((current.assistants || []).map((item) => [`${item.name}__${item.team}`, { ...item }]));

  for (const match of hiddenRound?.matches || []) {
    for (const event of match.events || []) {
      if (event.type !== "goal") continue;
      const team = event.teamLabel || (event.side === "home" ? match.home : match.away);
      if (event.playerName) {
        const key = `${event.playerName}__${team}`;
        const item = scorerMap.get(key) || { name: event.playerName, team, total: 0 };
        item.total += 1;
        scorerMap.set(key, item);
      }
      if (event.assistName) {
        const key = `${event.assistName}__${team}`;
        const item = assistantMap.get(key) || { name: event.assistName, team, total: 0 };
        item.total += 1;
        assistantMap.set(key, item);
      }
    }
  }

  return {
    ...publicResult,
    leaderboards: {
      scorers: sortLeaderboard([...scorerMap.values()]),
      assistants: sortLeaderboard([...assistantMap.values()]),
    },
  };
}

export function addRoundToPlayerStats(publicResult, hiddenRound) {
  const humanTeams = (publicResult?.leagueTeams || []).filter((team) => team.isOnlineHumanTeam);
  const currentStats = cloneJson(
    publicResult?.playerStats && Object.keys(publicResult.playerStats).length
      ? publicResult.playerStats
      : createInitialPlayerStats(humanTeams),
  );

  for (const match of hiddenRound?.matches || []) {
    const events = match.events || [];
    const ratings = match.playerRatings?.length
      ? match.playerRatings
      : [
        ...calculateHumanTeamMatchRatings(
          match.homeTeam,
          match.awayTeam,
          match.homeGoals,
          match.awayGoals,
          events,
        ),
        ...calculateHumanTeamMatchRatings(
          match.awayTeam,
          match.homeTeam,
          match.awayGoals,
          match.homeGoals,
          events,
        ),
      ];

    for (const ratingEntry of ratings) {
      const teamStats = currentStats[ratingEntry.teamId];
      if (!teamStats?.players?.length) continue;

      const playerIndex = teamStats.players.findIndex(
        (player) => player.playerId === ratingEntry.playerId ||
          (!ratingEntry.playerId && player.name === ratingEntry.playerName),
      );
      if (playerIndex < 0) continue;

      const player = teamStats.players[playerIndex];
      const goals = events.filter(
        (event) => event.type === "goal" &&
          event.teamId === ratingEntry.teamId &&
          (event.playerId === player.playerId || (!event.playerId && event.playerName === player.name)),
      ).length;
      const assists = events.filter(
        (event) => event.type === "goal" &&
          event.teamId === ratingEntry.teamId &&
          (event.assistId === player.playerId || (!event.assistId && event.assistName === player.name)),
      ).length;
      const nextMatches = Number(player.matches || 0) + 1;
      const nextRatingTotal = Number(player.ratingTotal || 0) + Number(ratingEntry.rating || 0);

      teamStats.players[playerIndex] = {
        ...player,
        matches: nextMatches,
        goals: Number(player.goals || 0) + goals,
        assists: Number(player.assists || 0) + assists,
        ratingTotal: Math.round(nextRatingTotal * 10) / 10,
        averageRating: Math.round((nextRatingTotal / nextMatches) * 10) / 10,
        lastRating: Number(ratingEntry.rating || 0),
        lastRound: hiddenRound.round,
      };
    }
  }

  return {
    ...publicResult,
    playerStats: currentStats,
  };
}

export function getSpeedInterval(speed) {
  return SPEED_INTERVALS[speed] || SPEED_INTERVALS.normal;
}

export function getLiveMinute(startedAt, speed, maxMinute = 90, now = Date.now()) {
  if (!startedAt) return 0;
  return Math.min(maxMinute, Math.max(0, Math.floor((now - startedAt) / getSpeedInterval(speed))));
}

export function createLeagueSimulation(room, databaseTeamsInput) {
  const order = Array.isArray(room.draftOrder) ? room.draftOrder : [];
  if (!order.length) throw new Error("A ordem do draft está vazia.");
  if (!room.draftState?.isComplete) throw new Error("Finalize o draft antes de iniciar o Brasileirão.");

  const humanTeams = order.map((participant) => {
    const lineup = room.draftState?.lineupsMap?.[participant.id] || [];
    if (lineup.length < 11) throw new Error(`O elenco de ${participant.playerName || participant.teamName} está incompleto.`);
    return createHumanTeam(participant, lineup);
  });

  const databaseNeeded = Math.max(0, 20 - humanTeams.length);
  const rawDatabaseTeams = Array.isArray(databaseTeamsInput) ? databaseTeamsInput : [];
  if (rawDatabaseTeams.length < databaseNeeded) {
    throw new Error(`O servidor recebeu apenas ${rawDatabaseTeams.length} adversários da database, mas precisa de ${databaseNeeded}.`);
  }

  const usedClubIds = new Set();
  const databaseTeams = [];
  for (let index = 0; index < rawDatabaseTeams.length && databaseTeams.length < databaseNeeded; index += 1) {
    const team = sanitizeDatabaseTeam(rawDatabaseTeams[index], index);
    if (usedClubIds.has(team.clubId)) continue;
    usedClubIds.add(team.clubId);
    databaseTeams.push(normalizeTeamForSimulation(team));
  }

  if (databaseTeams.length !== databaseNeeded || databaseTeams.length > MAX_DATABASE_TEAMS) {
    throw new Error("Não foi possível montar uma liga com 20 clubes distintos.");
  }

  const leagueTeams = [...humanTeams, ...databaseTeams];
  const standings = Object.fromEntries(leagueTeams.map((team) => [team.id, createEmptyStanding(team)]));
  const schedule = createRoundRobinSchedule(leagueTeams);
  const hiddenRounds = schedule.map((roundMatches, roundIndex) => {
    const roundNumber = roundIndex + 1;
    const matches = roundMatches.map(({ homeTeam, awayTeam }) => {
      const { homeGoals, awayGoals } = generateMatchScore(homeTeam, awayTeam);
      applyMatchToStandings(standings, homeTeam, awayTeam, homeGoals, awayGoals);
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
      const events = generateEvents(match);
      const playerRatings = [
        ...calculateHumanTeamMatchRatings(
          homeTeam,
          awayTeam,
          homeGoals,
          awayGoals,
          events,
        ),
        ...calculateHumanTeamMatchRatings(
          awayTeam,
          homeTeam,
          awayGoals,
          homeGoals,
          events,
        ),
      ];
      return { ...match, events, playerRatings };
    });
    return { round: roundNumber, matches };
  });

  const slimTeams = leagueTeams.map(slimTeam);
  const publicResult = {
    leagueTeams: slimTeams,
    table: [],
    leaderboards: { scorers: [], assistants: [] },
    playerStats: createInitialPlayerStats(humanTeams),
    rounds: hiddenRounds.map((round) => ({
      round: round.round,
      matches: round.matches.map(publicMatchSkeleton),
    })),
    _slim: true,
    serverAuthoritative: true,
  };

  return {
    publicResult,
    hiddenRounds,
    meta: {
      roundCount: hiddenRounds.length,
      createdAt: Date.now(),
    },
  };
}

export function buildPublicLiveRound(hiddenRound, minute) {
  return {
    round: hiddenRound.round,
    matches: hiddenRound.matches.map((match) => {
      const events = (match.events || []).filter((event) => event.minute <= minute);
      return {
        ...publicMatchSkeleton(match),
        homeGoals: events.filter((event) => event.type === "goal" && event.side === "home").length,
        awayGoals: events.filter((event) => event.type === "goal" && event.side === "away").length,
        events: cloneJson(events),
        isRevealed: false,
        isLive: true,
      };
    }),
  };
}

export function buildPublicCompletedRound(hiddenRound) {
  return {
    round: hiddenRound.round,
    matches: hiddenRound.matches.map((match) => ({
      ...publicMatchSkeleton(match),
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      events: [],
      isRevealed: true,
      isLive: false,
    })),
  };
}

export function replacePublicRound(publicResult, roundNumber, replacement) {
  if (!publicResult?.rounds?.length) return publicResult;
  const rounds = publicResult.rounds.map((round) => round.round === roundNumber ? replacement : round);
  return { ...publicResult, rounds };
}

export function getNextLeagueAlarmAt(room, hiddenRound, now = Date.now()) {
  if (!room?.liveRound?.roundStartedAt || !hiddenRound) return null;
  const speed = room.liveSpeed || "normal";
  const currentMinute = getLiveMinute(room.liveRound.roundStartedAt, speed, 90, now);
  const futureMinutes = hiddenRound.matches
    .flatMap((match) => (match.events || []).map((event) => event.minute))
    .filter((minute) => minute > currentMinute);
  const nextMinute = futureMinutes.length ? Math.min(...futureMinutes) : 90;
  const timestamp = Number(room.liveRound.roundStartedAt) + nextMinute * getSpeedInterval(speed);
  return Math.max(now + 10, timestamp);
}

export async function storeLeagueSimulation(storage, simulation) {
  await clearLeagueStorage(storage);
  await storage.put(LEAGUE_META_KEY, simulation.meta);
  for (const round of simulation.hiddenRounds) {
    await storage.put(`${LEAGUE_ROUND_PREFIX}${round.round}`, round);
  }
}

export async function getHiddenLeagueRound(storage, roundNumber) {
  return (await storage.get(`${LEAGUE_ROUND_PREFIX}${roundNumber}`)) || null;
}

export async function getLeagueMeta(storage) {
  return (await storage.get(LEAGUE_META_KEY)) || null;
}

export async function clearLeagueStorage(storage) {
  const entries = await storage.list({ prefix: LEAGUE_ROUND_PREFIX });
  const keys = [...entries.keys(), LEAGUE_META_KEY];
  if (keys.length) await storage.delete(keys);
}
