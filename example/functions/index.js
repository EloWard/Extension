const functions = require("firebase-functions");
const express = require("express");
const fetch = require("node-fetch");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const leagueApiKey = functions.config().riotgames.apikey;
const tftApiKey = functions.config().riotgames.tftapikey;

// CORS headers
const allowedOrigins = [
  "chrome-extension://dfnglmloeedjemiomnhigjancdnhnajj",
  "chrome-extension://pacbioldapihkjamoobmnfebdeaginaj",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next();
});

// Use league username, tagline and region, responds with flex rank/solo rank/tft rank
app.get("/api/proxy/:username/:tag/:region", async (req, res) => {
  try {
    const { username, tag, region } = req.params;

    if (username && tag && region) {
      let adjustedRegion = region;
      if (["br", "eun", "euw", "jp", "na", "oc", "tr"].includes(region)) {
        adjustedRegion = region + "1";
      } else if (["ph", "sg", "th", "tw", "vn"].includes(region)) {
        adjustedRegion = region + "2";
      } else if ("las".includes(region)) {
        adjustedRegion = "la2";
      } else if ("lan".includes(region)) {
        adjustedRegion = "la1";
      }

      //Account API call to get puuid
      const accountResponse = await fetch(
        `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${username}/${tag}?api_key=${leagueApiKey}`
      ).then((response) => response.json());

      const puuid = accountResponse.puuid;

      // Summoner API call using puuid
      const summonerResponse = await fetch(
        `https://${adjustedRegion}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}?api_key=${leagueApiKey}`
      ).then((response) => response.json());

      const summonerID = summonerResponse.id;

      const lolRankResponse = await fetch(
        `https://${adjustedRegion}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerID}?api_key=${leagueApiKey}`
      ).then((response) => response.json());

      const tftRankResponse = await fetch(
        `https://${adjustedRegion}.api.riotgames.com/tft/league/v1/entries/by-summoner/${summonerID}?api_key=${tftApiKey}`
      ).then((response) => response.json());

      let ranks = [];

      if (lolRankResponse.length > 0) {
        ranks = lolRankResponse
          .filter((rankInfo) => rankInfo.queueType !== "CHERRY")
          .map((rankInfo) => {
            if (rankInfo.queueType === "RANKED_SOLO_5x5") {
              rankInfo.queueType = "LEAGUE SOLO QUEUE";
            }
            if (rankInfo.queueType === "RANKED_FLEX_SR") {
              rankInfo.queueType = "LEAGUE FLEX QUEUE";
            }
            const rank = `${rankInfo.queueType}: ${rankInfo.tier} ${rankInfo.rank} - ${rankInfo.leaguePoints} lp`;
            return rank;
          });
      }

      let tftRank = [];

      if (tftRankResponse.length > 0) {
        // Filter out "RANKED_TFT_DOUBLE_UP" rank
        tftRank = tftRankResponse
          .filter((rankInfo) => rankInfo.queueType === "RANKED_TFT")
          .map((rankInfo) => {
            const rank = `TFT: ${rankInfo.tier} ${rankInfo.rank} - ${rankInfo.leaguePoints} lp`;
            return rank;
          });
      }
      ranks = ranks.concat(tftRank);

      res.json({ ranks });
    } else {
      res.status(400).json({ error: "Invalid request parameters" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Proxy request failed" });
  }
});

app.get("/api/proxy/refreshTFT/:username/:tag/:region", async (req, res) => {
  try {
    const { username, tag, region } = req.params;

    if (username && region) {
      let adjustedRegion = region;
      if (["br", "eun", "euw", "jp", "na", "oc", "tr"].includes(region)) {
        adjustedRegion = region + "1";
      } else if (["ph", "sg", "th", "tw", "vn"].includes(region)) {
        adjustedRegion = region + "2";
      } else if ("las".includes(region)) {
        adjustedRegion = "la2";
      } else if ("lan".includes(region)) {
        adjustedRegion = "la1";
      }

      //Account API call to get puuid
      const accountResponse = await fetch(
        `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${username}/${tag}?api_key=${leagueApiKey}`
      ).then((response) => response.json());

      const puuid = accountResponse.puuid;

      // Summoner API call using puuid
      const summonerResponse = await fetch(
        `https://${adjustedRegion}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}?api_key=${leagueApiKey}`
      ).then((response) => response.json());

      const summonerID = summonerResponse.id;

      const tftRankResponse = await fetch(
        `https://${adjustedRegion}.api.riotgames.com/tft/league/v1/entries/by-summoner/${summonerID}?api_key=${tftApiKey}`
      ).then((response) => response.json());

      if (tftRankResponse.length > 0) {
        // Filter out "RANKED_TFT_DOUBLE_UP" rank
        const tftRanks = tftRankResponse
          .filter((rank) => rank.queueType === "RANKED_TFT")
          .map((rank) => {
            return `TFT: ${rank.tier} ${rank.rank} - ${rank.leaguePoints} lp`;
          });

        res.json({ tftRanks }); // Return an array of TFT ranks
      } else {
        res.json({ tftRanks: [] }); // Return an empty array if no ranks found
      }
    } else {
      res.status(400).json({ error: "Invalid request parameters" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Proxy request failed" });
  }
});

app.get("/api/proxy/refreshLOL/:username/:tag/:region", async (req, res) => {
  try {
    const { username, tag, region } = req.params;

    if (username && region) {
      let adjustedRegion = region;
      if (["br", "eun", "euw", "jp", "na", "oc", "tr"].includes(region)) {
        adjustedRegion = region + "1";
      } else if (["ph", "sg", "th", "tw", "vn"].includes(region)) {
        adjustedRegion = region + "2";
      } else if ("las".includes(region)) {
        adjustedRegion = "la2";
      } else if ("lan".includes(region)) {
        adjustedRegion = "la1";
      }

      //Account API call to get puuid
      const accountResponse = await fetch(
        `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${username}/${tag}?api_key=${leagueApiKey}`
      ).then((response) => response.json());

      const puuid = accountResponse.puuid;

      // Summoner API call using puuid
      const summonerResponse = await fetch(
        `https://${adjustedRegion}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}?api_key=${leagueApiKey}`
      ).then((response) => response.json());

      const summonerID = summonerResponse.id;

      const lolRankResponse = await fetch(
        `https://${adjustedRegion}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerID}?api_key=${leagueApiKey}`
      ).then((response) => response.json());

      let ranks = [];

      if (lolRankResponse.length > 0) {
        ranks = lolRankResponse
          .filter((rankInfo) => rankInfo.queueType !== "CHERRY")
          .map((rankInfo) => {
            if (rankInfo.queueType === "RANKED_SOLO_5x5") {
              rankInfo.queueType = "LEAGUE SOLO QUEUE";
            }
            if (rankInfo.queueType === "RANKED_FLEX_SR") {
              rankInfo.queueType = "LEAGUE FLEX QUEUE";
            }
            const rank = `${rankInfo.queueType}: ${rankInfo.tier} ${rankInfo.rank} - ${rankInfo.leaguePoints} lp`;
            return rank;
          });
      }
      res.json({ ranks });
    } else {
      res.status(400).json({ error: "Invalid request parameters" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Proxy request failed" });
  }
});

app.post("/api/proxy/activatelicense", async (req, res) => {
  try {
    const { licenseKey } = req.body;

    const apiUrl = "https://api.gumroad.com/v2/licenses/verify";
    const productId = "xARNTd9jt0RbQjYrguErMQ==";
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `product_id=${productId}&license_key=${licenseKey}`,
    });
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Proxy request failed" });
  }
});

exports.app = functions.https.onRequest(app);
