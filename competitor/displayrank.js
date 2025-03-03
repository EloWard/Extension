let twitchUser = "";
let userRankArray = [];
let retries = 0;
const maxRetries = 3;
const retryDelay = 2000; // milliseconds

function getUsernameFromCookie() {
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === "login") {
      const username = decodeURIComponent(value);
      twitchUser = username;
      chrome.runtime.sendMessage({
        type: "sendingTwitchUsername",
        twitchUser,
      });
      return username;
    }
  }
  console.error("Username not found in cookies.");
}

async function getStreamCategory(retry = false) {
  //stream category element
  const gameLink = document.querySelector(
    'a[data-a-target="stream-game-link"]'
  );
  if (gameLink) {
    const streamCategoryElement = gameLink.textContent.trim();
    getUsersRanksByCategory(streamCategoryElement);
  } else if (retry && retries < maxRetries) {
    setTimeout(() => {
      retries++;
      getStreamCategory(true);
    }, retryDelay);
  } else {
    console.log("Stream category not found");
  }
}

async function getUsersRanksByCategory(category) {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "gettingAllRanksByCategory", category },
        (response) => {
          resolve(response);
        }
      );
    });

    userRankArray = response || [];
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.message === "stream changed") {
    setTimeout(getStreamCategory, 1000);
  }
});

// Observe body for SPA changes
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.addedNodes) {
      mutation.addedNodes.forEach((node) => {
        if (
          node.querySelector &&
          node.querySelector('a[data-a-target="stream-game-link"]')
        ) {
          getStreamCategory();
        }
      });
    }
  });
});

observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener("DOMContentLoaded", () => {
  getUsernameFromCookie();

  getStreamCategory(true);
});

const chatContainer = document.querySelector(".Layout-sc-1xcs6mc-0");
if (chatContainer) {
  const observer = new MutationObserver(handleMutation);
  observer.observe(chatContainer, { childList: true, subtree: true });
}
function handleMutation(mutationsList) {
  for (const mutation of mutationsList) {
    if (mutation.type === "childList") {
      const newMessages = Array.from(mutation.addedNodes).filter(
        (node) => node.nodeType === Node.ELEMENT_NODE
      );

      for (const message of newMessages) {
        const authorNameElement = message.querySelector(
          ".chat-author__display-name"
        );

        if (authorNameElement) {
          const matchedUser =
            userRankArray.length > 0
              ? userRankArray.find(
                  (user) =>
                    user.twitchUsername ===
                    authorNameElement.textContent.trim().toLowerCase()
                )
              : null;

          if (matchedUser) {
            const rankString = matchedUser.rank;
            const iconChoice = matchedUser.legacyIcon;
            const imgElement = document.createElement("img");
            //if rank is league or tft
            if (rankString.includes("LEAGUE") || rankString.includes("TFT")) {
              const rankPattern =
                /(IRON|BRONZE|SILVER|GOLD|PLATINUM|EMERALD|DIAMOND|MASTER|GRANDMASTER|CHALLENGER)/i;
              const matches = rankString.match(rankPattern);
              const rankTier = matches[0].toLowerCase();
              imgElement.src = chrome.runtime.getURL(
                `../images/${iconChoice}LOLEmblems/${rankTier}.png`
              );
            } else if (rankString.includes("DOTA 2")) {
              // Extract the tier from rankString. Assuming the format "Dota 2 Rank: Tier SubTier"
              const rankPattern = /DOTA 2: (\w+)/; // This will capture the tier name only
              const matches = rankString.match(rankPattern);
              if (matches) {
                const tier = matches[1]; // e.g., "Legend"
                const iconName = tier.toLowerCase(); // Use the tier name directly, e.g., "legend"
                imgElement.src = chrome.runtime.getURL(
                  `../images/Dota2Emblems/${iconName}.png`
                );
              }
            } else if (
              rankString.includes("CHESS") ||
              rankString.includes("FIDE")
            ) {
              let chessIconURL = chrome.runtime.getURL(
                `../images/ChessEmblems/chess.png`
              );

              const ranks = rankString.split(", ");

              // Check if any rank includes a FIDE rating of 2500 or more
              const gmFIDE = ranks.some((rank) => {
                if (rank.startsWith("FIDE: ")) {
                  const rating = parseInt(rank.replace("FIDE: ", ""), 10);
                  return rating >= 2500;
                }
                return false;
              });

              if (gmFIDE) {
                chessIconURL = chrome.runtime.getURL(
                  `../images/ChessEmblems/goldChess.png`
                );
              }

              imgElement.src = chessIconURL;
            }

            imgElement.width = "21";
            imgElement.height = "21.2";
            imgElement.style.margin = "0px 3px 1.5px 0px";
            imgElement.alt = matchedUser.rank;

            const bannerElement = document.createElement("div");
            bannerElement.classList.add("banner");
            bannerElement.style.display = "none";

            const rankSpan = document.createElement("span");
            rankSpan.setAttribute("data-rank", matchedUser.rank); // Store rank
            bannerElement.appendChild(rankSpan);

            const ignSpan = document.createElement("span");
            ignSpan.setAttribute("data-ign", matchedUser.ign); // Store IGN
            ignSpan.style.display = "block"; // Ensure IGN appears below the rank
            bannerElement.appendChild(ignSpan);

            imgElement.addEventListener("mouseover", () => {
              showBanner(bannerElement);
            });

            imgElement.addEventListener("mouseout", () => {
              hideBanner(bannerElement);
            });

            if (authorNameElement.parentNode) {
              authorNameElement.parentNode.insertBefore(
                bannerElement,
                authorNameElement
              );
              authorNameElement.parentNode.insertBefore(
                imgElement,
                authorNameElement
              );
            }
          }
        }
      }
    }
  }
}

function showBanner(element) {
  // Identify dynamically added rank lines and remove them
  const existingRankLines = element.querySelectorAll(".rank-line");
  existingRankLines.forEach((line) => line.remove());

  // Access rank and IGN from the child spans
  const rankSpan = element.querySelector("span[data-rank]");
  const ignSpan = element.querySelector("span[data-ign]");
  const rankText = rankSpan.getAttribute("data-rank");

  if (rankText.includes("DOTA 2")) {
    // Dota 2 rank might include both the tier and leaderboard rank
    const [dotaRank, leaderboardRank] = rankText.split(", ");
    const dotaRankLine = document.createElement("div");
    dotaRankLine.classList.add("rank-line");
    dotaRankLine.textContent = dotaRank;
    element.insertBefore(dotaRankLine, ignSpan);

    // If there's a leaderboard rank, display it on a new line
    if (leaderboardRank && leaderboardRank.includes("LEADERBOARD RANK")) {
      const leaderboardRankLine = document.createElement("div");
      leaderboardRankLine.classList.add("rank-line");
      leaderboardRankLine.textContent = leaderboardRank;
      element.insertBefore(leaderboardRankLine, ignSpan);
    }
  } else if (rankText.includes("CHESS") || rankText.includes("FIDE")) {
    const ranks = rankText.split(", ");
    ranks.forEach((rank) => {
      const rankLine = document.createElement("div");
      rankLine.classList.add("rank-line"); // Add a class for easy identification
      rankLine.textContent = rank;
      element.insertBefore(rankLine, ignSpan); // Insert before ignSpan to maintain order
    });
  } else {
    // Ensure rankSpan is correctly placed (if dynamic content adjustment is needed)
    if (!element.contains(rankSpan)) {
      element.insertBefore(rankSpan, ignSpan);
    }
    rankSpan.textContent = rankText;
  }

  // Always ensure ignSpan is correctly placed and updated
  if (!element.contains(ignSpan)) {
    element.appendChild(ignSpan);
  }
  ignSpan.textContent = ignSpan.getAttribute("data-ign");

  // Apply standard styling for the banner
  applyBannerStyling(element);

  // Additional function to set the banner styling
  function applyBannerStyling(bannerElement) {
    bannerElement.style.display = "block";
    bannerElement.style.position = "absolute";
    bannerElement.style.top = "-50px";
    bannerElement.style.left = "0px";
    bannerElement.style.backgroundColor = "white";
    bannerElement.style.color = "black";
    bannerElement.style.fontWeight = "600";
    bannerElement.style.borderRadius = "3px";
    bannerElement.style.padding = "4px";
    bannerElement.style.whiteSpace = "normal";
    bannerElement.style.zIndex = "9999";

    const bannerHeight = bannerElement.offsetHeight;
    bannerElement.style.top = `-${bannerHeight + 10}px`; // Adjust top position dynamically
  }
}

function hideBanner(element) {
  element.style.display = "none";
}
