const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const root = __dirname;
loadEnv(path.join(root, ".env"));

const config = {
  port: Number(process.env.PORT || 3000),
  region: process.env.REGION || "eu",
  riotName: process.env.RIOT_NAME || "Unfazeur",
  riotTag: process.env.RIOT_TAG || "EUW",
  trackerKey: cleanApiKey(process.env.TRACKER_API_KEY || "")
  ,riotKey: cleanApiKey(process.env.RIOT_API_KEY || "")
};

const cacheDir = path.join(root, ".cache");
const riotCacheDir = path.join(cacheDir, "riot");
let riotLastRequestAt = 0;
const RIOT_MIN_INTERVAL_MS = 1250;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/config") return json(res, publicConfig());
    if (url.pathname === "/api/rank") return json(res, await getRank());
    if (url.pathname === "/api/tracker") return json(res, await getTracker());
    if (url.pathname === "/api/tracker/debug") return json(res, getTrackerDebug());
    if (url.pathname === "/api/riot/account") return json(res, await getRiotAccount());
    if (url.pathname === "/api/riot/matches") return json(res, await getRiotMatches(Number(url.searchParams.get("limit") || 5)));
    if (url.pathname === "/api/riot/import-act") return json(res, await getRiotActImport(Number(url.searchParams.get("limit") || 40)));

    const filePath = safePath(url.pathname === "/" ? "/index.html" : url.pathname);
    if (!filePath) return text(res, 403, "Forbidden");
    fs.readFile(filePath, (err, data) => {
      if (err) return text(res, 404, "Not found");
      res.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  } catch (error) {
    json(res, { ok: false, error: error.message }, 500);
  }
});

server.listen(config.port, () => {
  console.log(`VALCOACH V3 lance : http://localhost:${config.port}`);
});

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#") || !clean.includes("=")) continue;
    const index = clean.indexOf("=");
    const key = clean.slice(0, index).trim();
    const value = clean.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] = value;
  }
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath).replaceAll("\\", "/");
  const full = path.resolve(root, "." + decoded);
  return full.startsWith(root) ? full : null;
}

function text(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function json(res, body, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(body, null, 2));
}

function cleanApiKey(value) {
  return String(value || "").trim().replace(/^['\"]|['\"]$/g, "");
}

function publicConfig() {
  return {
    ok: true,
    riotName: config.riotName,
    riotTag: config.riotTag,
    region: config.region,
    trackerConfigured: Boolean(config.trackerKey)
    ,riotConfigured: Boolean(config.riotKey)
  };
}

async function getRank() {
  const url = `https://valorantrank.chat/${config.region}/${encodeURIComponent(config.riotName)}/${encodeURIComponent(config.riotTag.toLowerCase())}?onlyRank=true&mmrChange=true`;
  try {
    const raw = await fetchText(url);
    const clean = stripHtml(raw);
    const rank = parseRank(clean);
    return { ok: true, source: url, raw: clean, ...rank };
  } catch (error) {
    return { ok: false, source: url, error: error.message };
  }
}

async function getTracker() {
  if (!config.trackerKey) {
    return {
      ok: false,
      configured: false,
      error: "TRACKER_API_KEY manquant dans .env"
    };
  }

  const riotId = `${config.riotName}%23${config.riotTag}`;
  const url = `https://public-api.tracker.gg/v2/valorant/standard/profile/riot/${riotId}`;
  try {
    const body = await fetchJson(url, { "TRN-Api-Key": config.trackerKey });
    return { ok: true, configured: true, source: url, data: body.data || body };
  } catch (error) {
    const message = String(error.message || "");
    const authHint = message.includes("401")
      ? "Tracker rejette la cle API. Verifie que tu as copie la vraie API Key, sans espaces/guillemets, et que l application Tracker est active/approuvee."
      : null;
    return { ok: false, configured: true, source: url, error: message, hint: authHint, debug: getTrackerDebug() };
  }
}

function getTrackerDebug() {
  return {
    configured: Boolean(config.trackerKey),
    keyLength: config.trackerKey.length,
    keyLooksUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.trackerKey),
    riotName: config.riotName,
    riotTag: config.riotTag,
    expectedHeader: "TRN-Api-Key",
    note: "La cle est masquee volontairement. 401 = cle refusee par Tracker, pas probleme de lecture .env."
  };
}

async function getRiotAccount() {
  if (!config.riotKey) {
    return { ok: false, configured: false, error: "RIOT_API_KEY manquant dans .env" };
  }

  const url = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(config.riotName)}/${encodeURIComponent(config.riotTag)}`;
  try {
    const account = await riotFetchJson(url);
    return { ok: true, configured: true, source: url, account };
  } catch (error) {
    return { ok: false, configured: true, source: url, error: sanitizeSecret(error.message) };
  }
}

async function getRiotMatches(limit = 5) {
  if (!config.riotKey) {
    return { ok: false, configured: false, error: "RIOT_API_KEY manquant dans .env" };
  }

  const accountResult = await getRiotAccount();
  if (!accountResult.ok) return accountResult;

  const puuid = accountResult.account.puuid;
  const matchlistUrl = `https://${config.region}.api.riotgames.com/val/match/v1/matchlists/by-puuid/${encodeURIComponent(puuid)}`;
  try {
    const matchlist = await riotFetchJson(matchlistUrl);
    const history = Array.isArray(matchlist.history) ? matchlist.history.slice(0, Math.max(1, Math.min(limit, 10))) : [];
    const matches = [];
    for (const item of history) {
      const matchId = item.matchId || item.id;
      if (!matchId) continue;
      const matchUrl = `https://${config.region}.api.riotgames.com/val/match/v1/matches/${encodeURIComponent(matchId)}`;
      try {
        const match = await getCachedRiotMatch(matchId, matchUrl);
        matches.push(summarizeRiotMatch(match, puuid));
      } catch (error) {
        matches.push({ matchId, ok: false, error: sanitizeSecret(error.message) });
      }
    }
    return { ok: true, configured: true, account: accountResult.account, count: matches.length, matches };
  } catch (error) {
    return { ok: false, configured: true, source: matchlistUrl, error: sanitizeSecret(error.message) };
  }
}

async function getRiotActImport(limit = 40) {
  if (!config.riotKey) {
    return { ok: false, configured: false, error: "RIOT_API_KEY manquant dans .env" };
  }

  const accountResult = await getRiotAccount();
  if (!accountResult.ok) return accountResult;

  const puuid = accountResult.account.puuid;
  const content = await getRiotContent().catch(() => ({ acts: [], characters: [], maps: [] }));
  const activeAct = getActiveAct(content);
  const lookup = buildContentLookup(content);
  const max = Math.max(1, Math.min(limit, 80));
  const matchlistUrl = `https://${config.region}.api.riotgames.com/val/match/v1/matchlists/by-puuid/${encodeURIComponent(puuid)}`;

  try {
    const matchlist = await riotFetchJson(matchlistUrl);
    const history = Array.isArray(matchlist.history) ? matchlist.history.slice(0, Math.min(max * 3, 120)) : [];
    const imported = [];
    const skipped = { nonCompetitive: 0, otherAct: 0, failed: 0 };

    for (const item of history) {
      if (imported.length >= max) break;
      const matchId = item.matchId || item.id;
      if (!matchId) continue;
      const matchUrl = `https://${config.region}.api.riotgames.com/val/match/v1/matches/${encodeURIComponent(matchId)}`;
      try {
        const match = await getCachedRiotMatch(matchId, matchUrl);
        const info = match.matchInfo || {};
        if (info.queueId && info.queueId !== "competitive") {
          skipped.nonCompetitive += 1;
          continue;
        }
        if (activeAct && info.seasonId && info.seasonId !== activeAct.id) {
          skipped.otherAct += 1;
          continue;
        }
        imported.push(toValcoachMatch(match, puuid, lookup));
      } catch (error) {
        skipped.failed += 1;
      }
    }

    return {
      ok: true,
      configured: true,
      account: accountResult.account,
      activeAct,
      source: matchlistUrl,
      count: imported.length,
      skipped,
      matches: imported
    };
  } catch (error) {
    return { ok: false, configured: true, source: matchlistUrl, error: sanitizeSecret(error.message) };
  }
}

function summarizeRiotMatch(match, puuid) {
  const info = match.matchInfo || {};
  const players = match.players || [];
  const player = players.find((p) => p.puuid === puuid) || {};
  const stats = player.stats || {};
  const teams = match.teams || [];
  const team = teams.find((t) => t.teamId === player.teamId) || {};
  return {
    ok: true,
    matchId: info.matchId,
    queueId: info.queueId,
    mapId: info.mapId,
    gameStartMillis: info.gameStartMillis,
    agent: player.characterId,
    teamId: player.teamId,
    won: typeof team.won === "boolean" ? team.won : null,
    kills: stats.kills || 0,
    deaths: stats.deaths || 0,
    assists: stats.assists || 0,
    score: stats.score || 0,
    roundsPlayed: match.roundResults ? match.roundResults.length : null
  };
}

function toValcoachMatch(match, puuid, lookup) {
  const info = match.matchInfo || {};
  const players = match.players || [];
  const player = players.find((p) => p.puuid === puuid) || {};
  const stats = player.stats || {};
  const teams = match.teams || [];
  const team = teams.find((t) => t.teamId === player.teamId) || {};
  const rounds = match.roundResults || [];
  const roundStats = getRoundMetrics(match, puuid, player.teamId);
  const roundsPlayed = rounds.length || roundStats.roundsPlayed || 1;
  const kills = Number(stats.kills || 0);
  const deaths = Number(stats.deaths || 0);
  const assists = Number(stats.assists || 0);
  const score = Number(stats.score || 0);
  const hsTotal = roundStats.headshots + roundStats.bodyshots + roundStats.legshots;
  const hs = hsTotal ? Math.round((roundStats.headshots / hsTotal) * 100) : 0;
  const acs = roundsPlayed ? Math.round(score / roundsPlayed) : 0;
  const result = team.won === true ? "win" : team.won === false ? "loss" : "unknown";

  return {
    source: "riot",
    matchId: info.matchId || "",
    gameStartMillis: info.gameStartMillis || null,
    queueId: info.queueId || "",
    seasonId: info.seasonId || "",
    result,
    rr: 0,
    agent: lookup.characters[player.characterId] || player.characterId || "Riot Import",
    map: lookup.maps[info.mapId] || simplifyMapId(info.mapId),
    focus: "Riot Import",
    acs,
    kills,
    deathCount: deaths,
    deaths,
    assists,
    firstKills: roundStats.firstBloods,
    firstBloods: roundStats.firstBloods,
    firstDeaths: roundStats.firstDeaths,
    firstDeath: roundStats.firstDeaths > 0 ? "yes" : "no",
    hs,
    kast: roundStats.kast,
    kastRounds: roundStats.kastRounds,
    tradedDeaths: roundStats.tradedDeaths,
    untradedDeaths: Math.max(0, deaths - roundStats.tradedDeaths),
    avoidable: 0,
    crosshair: 3,
    peek: 3,
    comms: 3,
    tilt: 3,
    utility: 3,
    reasons: [],
    mood: "neutral",
    vod: [],
    riot: {
      score,
      roundsPlayed,
      headshots: roundStats.headshots,
      bodyshots: roundStats.bodyshots,
      legshots: roundStats.legshots,
      damage: roundStats.damage,
      kastRounds: roundStats.kastRounds,
      firstBloods: roundStats.firstBloods,
      firstDeaths: roundStats.firstDeaths,
      tradedDeaths: roundStats.tradedDeaths
    }
  };
}

function getRoundMetrics(match, puuid, teamId) {
  const playerTeam = new Map((match.players || []).map((p) => [p.puuid, p.teamId]));
  const rounds = match.roundResults || [];
  let headshots = 0;
  let bodyshots = 0;
  let legshots = 0;
  let damage = 0;
  let firstBloods = 0;
  let firstDeaths = 0;
  let kastRounds = 0;
  let tradedDeaths = 0;

  for (const round of rounds) {
    const playerStats = round.playerStats || [];
    const myRound = playerStats.find((p) => p.puuid === puuid) || {};
    const allKills = [];
    for (const ps of playerStats) {
      for (const kill of ps.kills || []) {
        allKills.push({ ...kill, killer: ps.puuid, time: getKillTime(kill) });
      }
    }
    allKills.sort((a, b) => a.time - b.time);

    for (const entry of myRound.damage || []) {
      headshots += Number(entry.headshots || 0);
      bodyshots += Number(entry.bodyshots || 0);
      legshots += Number(entry.legshots || 0);
      damage += Number(entry.damage || 0);
    }

    const first = allKills[0];
    if (first?.killer === puuid) firstBloods += 1;
    if (first?.victim === puuid) firstDeaths += 1;

    const myKills = (myRound.kills || []).length;
    const assisted = allKills.some((kill) => Array.isArray(kill.assistants) && kill.assistants.includes(puuid));
    const death = allKills.find((kill) => kill.victim === puuid);
    const survived = !death;
    let traded = false;
    if (death) {
      traded = allKills.some((kill) => {
        if (kill.time < death.time || kill.time - death.time > 5000) return false;
        if (playerTeam.get(kill.killer) !== teamId) return false;
        return kill.victim === death.killer;
      });
      if (traded) tradedDeaths += 1;
    }
    if (myKills > 0 || assisted || survived || traded) kastRounds += 1;
  }

  const roundsPlayed = rounds.length;
  return {
    roundsPlayed,
    headshots,
    bodyshots,
    legshots,
    damage,
    firstBloods,
    firstDeaths,
    tradedDeaths,
    kastRounds,
    kast: roundsPlayed ? Math.round((kastRounds / roundsPlayed) * 100) : 0
  };
}

function getKillTime(kill) {
  return Number(kill.roundTimeMillis ?? kill.timeSinceRoundStartMillis ?? kill.gameTimeMillis ?? 0);
}

async function getRiotContent() {
  const cached = readJsonCache("content.json", 1000 * 60 * 60 * 24);
  if (cached) return cached;
  const url = `https://${config.region}.api.riotgames.com/val/content/v1/contents?locale=en-US`;
  const content = await riotFetchJson(url);
  writeJsonCache("content.json", content);
  return content;
}

function getActiveAct(content) {
  const acts = Array.isArray(content.acts) ? content.acts : [];
  const active = acts.find((act) => act.isActive);
  if (!active) return null;
  return { id: active.id, name: active.name || "Acte actuel" };
}

function buildContentLookup(content) {
  const characters = {};
  const maps = {};
  for (const character of content.characters || []) {
    if (character.id) characters[character.id] = character.name || character.localizedNames?.["en-US"] || character.id;
  }
  for (const map of content.maps || []) {
    if (map.id) maps[map.id] = map.name || map.localizedNames?.["en-US"] || map.id;
    if (map.assetPath) maps[map.assetPath] = map.name || map.localizedNames?.["en-US"] || map.assetPath;
  }
  return { characters, maps };
}

function simplifyMapId(mapId) {
  if (!mapId) return "Riot Map";
  const last = String(mapId).split("/").filter(Boolean).pop() || mapId;
  return capitalize(last.replace(/map$/i, "").replace(/_/g, " "));
}

async function getCachedRiotMatch(matchId, url) {
  const file = `match-${safeCacheName(matchId)}.json`;
  const cached = readJsonCache(file, 1000 * 60 * 60 * 24 * 30);
  if (cached) return cached;
  const match = await riotFetchJson(url);
  writeJsonCache(file, match);
  return match;
}

async function riotFetchJson(url) {
  await waitForRiotRateLimit();
  return fetchJson(url, { "X-Riot-Token": config.riotKey });
}

async function waitForRiotRateLimit() {
  const elapsed = Date.now() - riotLastRequestAt;
  if (elapsed < RIOT_MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, RIOT_MIN_INTERVAL_MS - elapsed));
  }
  riotLastRequestAt = Date.now();
}

function readJsonCache(name, maxAgeMs) {
  try {
    const file = path.join(riotCacheDir, name);
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonCache(name, value) {
  fs.mkdirSync(riotCacheDir, { recursive: true });
  fs.writeFileSync(path.join(riotCacheDir, name), JSON.stringify(value, null, 2), "utf8");
}

function safeCacheName(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, "_");
}

function sanitizeSecret(message) {
  return String(message).replace(/RGAPI-[a-f0-9-]+/gi, "RGAPI-***");
}

function stripHtml(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRank(textValue) {
  const ranks = [
    "Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond",
    "Ascendant", "Immortal", "Radiant"
  ];
  const rankMatch = new RegExp(`(${ranks.join("|")})\\s*([123])?`, "i").exec(textValue);
  const rrMatch = /(\d{1,2})\s*(?:\/\s*100|RR)/i.exec(textValue);
  const changeMatch = /([+-]\s*\d{1,2})\s*(?:RR)?/i.exec(textValue);
  const rank = rankMatch ? `${capitalize(rankMatch[1])}${rankMatch[2] ? ` ${rankMatch[2]}` : ""}` : "";
  return {
    rank,
    rr: rrMatch ? Number(rrMatch[1]) : null,
    mmrChange: changeMatch ? changeMatch[1].replace(/\s+/g, "") : null
  };
}

function capitalize(value) {
  const lower = String(value).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function fetchText(url, headers = {}) {
  return request(url, headers).then((result) => result.body);
}

function fetchJson(url, headers = {}) {
  return request(url, headers).then((result) => JSON.parse(result.body));
}

function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (req) req.destroy();
      reject(new Error("Timeout API externe"));
    }, 6000);

    let req;
    req = https.get(url, { headers: { "user-agent": "VALCOACH/3.0", ...headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 180)}`));
        } else {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
  });
}


