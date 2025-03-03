import { initializeApp } from "./firebaseSDK/firebase-app.js";
import {
  getDatabase,
  ref,
  child,
  get,
  set,
  push,
  query,
  remove,
  limitToLast,
  onValue,
  update,
  orderByChild,
} from "./firebaseSDK/firebase-database.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
} from "./firebaseSDK/firebase-auth.js";

try {
  const firebaseConfig = {
    apiKey: "AIzaSyDsfcQ_6IiJ4ptFo_HboMe8W1oO_TkFQtA",
    authDomain: "show-my-rank.firebaseapp.com",
    projectId: "show-my-rank",
    storageBucket: "show-my-rank.appspot.com",
    messagingSenderId: "543722549565",
    appId: "1:543722549565:web:65288ea6570a4212b1d554",
    measurementId: "G-G3QY8CF641",
    databaseURL: "https://show-my-rank-default-rtdb.firebaseio.com/",
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);
  const auth = getAuth(app);

  let tabTwitchURL = "";

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    try {
      if (
        changeInfo.status === "complete" &&
        tab.url.includes("twitch.tv") &&
        tab.url !== tabTwitchURL
      ) {
        tabTwitchURL = tab.url;

        chrome.tabs.sendMessage(tabId, {
          message: "stream changed",
        });
      }
    } catch (error) {
      console.log(error);
    }
    return true;
  });

  chrome.runtime.onInstalled.addListener(() => {
    // Ensure the alarm is created when the extension is installed/updated
    chrome.alarms.create("checkPremiumStatusDaily", {
      periodInMinutes: 1440, // 1440 minutes in a day
    });

    // Create an alarm for refreshing League ranks daily
    chrome.alarms.create("refreshLeagueRankDaily", {
      periodInMinutes: 1440,
    });

    // Create an alarm for refreshing TFT ranks daily
    chrome.alarms.create("refreshTFTRankDaily", {
      periodInMinutes: 1440,
    });
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    switch (alarm.name) {
      case "checkPremiumStatusDaily":
        checkAndUpdatePremiumStatus(); // Function to check and update premium status
        break;
      case "refreshLeagueRankDaily":
        refreshLeagueRankDaily(); // Function to refresh League rank
        break;
      case "refreshTFTRankDaily":
        refreshTFTRankDaily(); // Function to refresh TFT rank
        break;
      default:
        console.log("Unknown alarm triggered:", alarm.name);
    }
  });

  async function checkAndUpdatePremiumStatus() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        const premiumRef = ref(db, "users/" + user.uid + "/Premium");
        const licenseKeyRef = ref(
          db,
          "users/" + user.uid + "/Premium/LicenseKey"
        );

        try {
          const snapshot = await get(premiumRef);
          const premiumExists = snapshot.exists();
          if (!premiumExists) {
            //not a premium user
            return;
          } else {
            const snapshot = await get(licenseKeyRef);
            const licenseKey = snapshot.val();
            if (licenseKey) {
              const response = await fetch(
                `https://us-central1-show-my-rank.cloudfunctions.net/app/api/proxy/activatelicense`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ licenseKey }),
                }
              );
              const data = await response.json();
              if (data.success) {
                if (
                  data.purchase.subscription_ended_at == null &&
                  data.purchase.subscription_cancelled_at == null &&
                  data.purchase.subscription_failed_at == null
                ) {
                  update(premiumRef, {
                    Status: true,
                  })
                    .then(() => {
                      console.log("Premium status updated in the database!");
                    })
                    .catch((error) => {
                      console.error("Error updating premium status:", error);
                    });
                } else {
                  update(premiumRef, {
                    Status: false,
                  })
                    .then(() => {
                      console.log("Premium status updated in the database!");
                    })
                    .catch((error) => {
                      console.error("Error updating premium status:", error);
                    });
                }
              } else {
                console.log("Error veryifying License");
              }
            } else {
              console.log("No license key found!");
            }
          }
        } catch (error) {
          console.log(error);
        }
      } else {
        //not signed in
      }
    });

    return true;
  }

  async function refreshLeagueRankDaily() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        const leagueRef = ref(db, "users/" + user.uid + "/leagueInfo");
        const premiumRef = ref(db, "users/" + user.uid + "/Premium");

        try {
          const leagueSnapshot = await get(leagueRef);
          if (leagueSnapshot.exists()) {
            const leagueData = leagueSnapshot.val();
            const username = leagueData.username;
            const tag = leagueData.tag;
            const region = leagueData.region;

            if (username && tag && region) {
              const response = await fetch(
                `https://us-central1-show-my-rank.cloudfunctions.net/app/api/proxy/refreshLOL/${username}/${tag}/${region}`
              );
              const data = await response.json();
              if (data && Array.isArray(data.ranks) && data.ranks.length > 0) {
                const leagueRanks = {};
                const leagueRanksArr = [];

                data.ranks.forEach((rank) => {
                  leagueRanksArr.push(rank);

                  if (rank.includes("SOLO")) {
                    leagueRanks.solo = rank;
                  } else if (rank.includes("FLEX")) {
                    leagueRanks.flex = rank;
                  }
                });

                // Check if we have any rank data before updating
                if (Object.keys(leagueRanks).length > 0) {
                  await update(leagueRef, leagueRanks);
                  console.log("League ranks updated in the database!");

                  const premiumSnapshot = await get(premiumRef);
                  const premiumData = premiumSnapshot.val();
                  if (premiumData && premiumData.Status === true) {
                    const premiumDefaultRank = premiumData.DefaultRank;

                    if (
                      leagueRanks.flex &&
                      premiumDefaultRank.includes("FLEX")
                    ) {
                      await update(premiumRef, {
                        DefaultRank: leagueRanks.flex,
                      });
                    }

                    if (
                      leagueRanks.solo &&
                      premiumDefaultRank.includes("SOLO")
                    ) {
                      await update(premiumRef, {
                        DefaultRank: leagueRanks.solo,
                      });
                    }
                  }
                  //success
                } else {
                  console.log(
                    "League ranks are empty or undefined after refresh."
                  );
                }
              } else {
                console.log("No data found for the user.");
              }
            } else {
              console.log("Username not found in the database.");
            }
          } else {
            console.log("User has no league data.");
          }
        } catch (error) {
          console.error(error);
        }
      } else {
        // User not signed in
      }
    });
    return true;
  }

  async function refreshTFTRankDaily() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        const leagueRef = ref(db, "users/" + user.uid + "/leagueInfo");
        const premiumRef = ref(db, "users/" + user.uid + "/Premium");

        try {
          const leagueSnapshot = await get(leagueRef);
          if (leagueSnapshot.exists()) {
            const leagueData = leagueSnapshot.val();
            const username = leagueData.username;
            const tag = leagueData.tag;
            const region = leagueData.region;

            if (username && tag && region) {
              const response = await fetch(
                `https://us-central1-show-my-rank.cloudfunctions.net/app/api/proxy/refreshTFT/${username}/${tag}/${region}`
              );
              const data = await response.json();

              if (data && typeof data.tftRanks[0] !== "undefined") {
                try {
                  await update(leagueRef, { tft: data.tftRanks[0] });
                  console.log("TFT rank updated in the database!");

                  const premiumSnapshot = await get(premiumRef);
                  const premiumData = premiumSnapshot.val();

                  if (premiumData && premiumData.Status === true) {
                    const premiumDefaultRank = premiumData.DefaultRank;

                    if (
                      premiumDefaultRank &&
                      premiumDefaultRank.includes("TFT")
                    ) {
                      await update(premiumRef, {
                        DefaultRank: data.tftRanks[0],
                      });
                      console.log("DefaultRank updated in the database!");
                    }
                  }
                } catch (error) {
                  console.error("Error updating TFT rank:", error);
                }
              } else {
                console.log(
                  "No TFT rank data found for the user or rank is undefined."
                );
              }
            } else {
              console.log("Username not found in the database.");
            }
          } else {
            console.log("User has no league data.");
          }
        } catch (error) {
          console.error(error);
        }
      } else {
        // User not signed in
      }
    });
    return true;
  }

  //const analytics = getAnalytics(app);
  chrome.runtime.onMessage.addListener(function (
    message,
    sender,
    sendResponse
  ) {
    if (message.type === "requestSignOut") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          await signOut(auth)
            .then(() => {
              sendResponse({ status: "success" });
            })
            .catch((error) => {
              sendResponse({ status: "error" }, error);
            });
        }
      });

      return true;
    }

    if (message.type === "requestSignIn") {
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          const { email, password } = message;

          if (email && password) {
            try {
              await signInWithEmailAndPassword(auth, email, password)
                .then(async (userCredential) => {
                  const user = userCredential.user;

                  if (user.emailVerified) {
                    const userRef = ref(db, "users/" + user.uid);

                    await update(userRef, {
                      email: user.email,
                    });

                    sendResponse({ status: "success" });
                  } else {
                    auth.signOut();
                    sendResponse({
                      status: "failed",
                      error: "Email is not verified",
                    });
                  }
                })
                .catch((error) => {
                  sendResponse({ status: "failed", error: error.message });
                });
            } catch (error) {
              sendResponse({ status: "failed", error: error.message });
            }
          } else {
            sendResponse({
              status: "failed",
              error: "Email and password required",
            });
          }
        }
      });
      return true;
    }

    if (message.type === "requestSignUp") {
      onAuthStateChanged(auth, async (user) => {
        const { email, password } = message;
        const usersRef = ref(db, "users");

        if (!user) {
          if (email && password) {
            try {
              const snapshot = await get(usersRef);

              if (snapshot.exists()) {
                const usersData = snapshot.val();
                let emailExists = false;

                for (const uid in usersData) {
                  if (usersData[uid].email === email) {
                    emailExists = true;
                    break;
                  }
                }

                if (emailExists) {
                  sendResponse({
                    status: "failed",
                    error: "An account already exists with this email address.",
                  });
                } else {
                  const userCredential = await createUserWithEmailAndPassword(
                    auth,
                    email,
                    password
                  );

                  await sendEmailVerification(userCredential.user);
                  await signOut(auth)
                    .then(() => {
                      sendResponse({ status: "success" });
                    })
                    .catch((error) => {
                      sendResponse({ status: "error" }, error);
                    });
                }
              }
            } catch (error) {
              sendResponse({ status: "failed", error: error.message });
            }
          } else {
            sendResponse({
              status: "failed",
              error: "Email and password required",
            });
          }
        }
      });

      return true;
    }

    if (message.type === "requestPasswordReset") {
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          const { email } = message;
          const usersRef = ref(db, "users");

          if (email) {
            try {
              const snapshot = await get(usersRef);

              if (snapshot.exists()) {
                const usersData = snapshot.val();
                let emailExists = false;

                for (const uid in usersData) {
                  if (usersData[uid].email === email) {
                    emailExists = true;
                    break;
                  }
                }

                if (emailExists) {
                  await sendPasswordResetEmail(auth, email)
                    .then(() => {
                      sendResponse({ status: "success" });
                    })
                    .catch((error) => {
                      sendResponse({ status: "failed", error: error.message });
                    });
                } else {
                  // Email not found in the database
                  sendResponse({
                    status: "failed",
                    error: "No account found with this email address.",
                  });
                }
              } else {
                // No users found in the database at all
                sendResponse({
                  status: "failed",
                  error: "No account found with this email address.",
                });
              }
            } catch (error) {
              // Handle potential errors from fetching the database or other unexpected errors
              sendResponse({ status: "failed", error: error.message });
            }
          } else {
            // No email provided in the request
            sendResponse({
              status: "failed",
              error: "Email required",
            });
          }
        }
      });
      return true;
    }

    if (message.type === "checkPremiumStatus") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");
          const licenseKeyRef = ref(
            db,
            "users/" + user.uid + "/Premium/LicenseKey"
          );
          const legacyIconsRef = ref(
            db,
            "users/" + user.uid + "/Premium/LegacyIcons"
          );
          const defaultRankRef = ref(
            db,
            "users/" + user.uid + "/Premium/DefaultRank"
          );

          try {
            const snapshot = await get(premiumRef);
            const premiumExists = snapshot.exists();
            if (!premiumExists) {
              sendResponse({ success: false });
            } else {
              const snapshot = await get(licenseKeyRef);
              const licenseKey = snapshot.val();
              if (licenseKey) {
                const response = await fetch(
                  `https://us-central1-show-my-rank.cloudfunctions.net/app/api/proxy/activatelicense`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ licenseKey }),
                  }
                );
                const data = await response.json();
                if (data.success) {
                  if (
                    data.purchase.subscription_ended_at == null &&
                    data.purchase.subscription_cancelled_at == null &&
                    data.purchase.subscription_failed_at == null
                  ) {
                    const legacyIconsSnapshot = await get(legacyIconsRef);
                    const defaultRankSnapshot = await get(defaultRankRef);

                    const legacyIcons = legacyIconsSnapshot.val();
                    const defaultRank = defaultRankSnapshot.val();

                    update(premiumRef, {
                      Status: true,
                    })
                      .then(() => {
                        console.log("Premium status updated in the database!");
                      })
                      .catch((error) => {
                        console.error("Error updating premium status:", error);
                      });
                    sendResponse({
                      success: true,
                      LegacyIcons: legacyIcons,
                      DefaultRank: defaultRank,
                    });
                  } else {
                    update(premiumRef, {
                      Status: false,
                    })
                      .then(() => {
                        console.log("Premium status updated in the database!");
                      })
                      .catch((error) => {
                        console.error("Error updating premium status:", error);
                      });
                    sendResponse({ success: false });
                    console.log("Subscription has ended or was cancelled");
                  }
                } else {
                  console.log("Error veryifying License");
                  sendResponse({ success: false });
                }
              } else {
                console.log("No license key found!");
                sendResponse({ success: false });
              }
            }
          } catch (error) {
            console.log(error);
          }
        } else {
          //not signed in
        }
      });

      return true;
    }

    if (message.type === "activateLicense") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const licenseKey = message.licenseKey;
          try {
            const response = await fetch(
              `https://us-central1-show-my-rank.cloudfunctions.net/app/api/proxy/activatelicense`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ licenseKey }),
              }
            );
            const data = await response.json();
            if (data.success) {
              if (
                (data.uses == 1 || data.uses == 0) &&
                data.purchase.subscription_ended_at == null &&
                data.purchase.subscription_cancelled_at == null &&
                data.purchase.subscription_failed_at == null
              ) {
                sendResponse("License has been activated!");
                const premiumRef = ref(db, "users/" + user.uid + "/Premium");

                set(premiumRef, {
                  Status: true,
                  LicenseKey: licenseKey,
                  DefaultRank: "",
                  LegacyIcons: "current",
                })
                  .then(() => {
                    console.log("Premium status updated in the database!");
                  })
                  .catch((error) => {
                    console.error("Error updating premium status:", error);
                  });
              } else if (data.uses > 1) {
                sendResponse("License Key has already been activated!");
              }
            } else {
              sendResponse("Not a valid license key!");
            }
          } catch (error) {
            console.log(error);
          }
        } else {
          // Not signed in
        }
      });

      return true;
    }

    if (message.type === "saveOptions") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const defaultRank = message.defaultRank;
          const legacyIcons = message.legacyIcons;
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");
          try {
            await update(premiumRef, {
              DefaultRank: defaultRank,
              LegacyIcons: legacyIcons,
            });

            console.log("Options saved successfully!");
            sendResponse({
              success: true,
              message: "Options saved successfully!",
            });
          } catch (error) {
            console.error("Error updating options:", error);
            sendResponse({
              success: false,
              message: "Error updating options.",
            });
          }
        } else {
          // User not signed in
          sendResponse({ success: false, message: "User not signed in." });
        }
      });
      return true; // Indicates you will respond asynchronously
    }

    if (message.type === "deleteAccountRequest") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          try {
            await deleteUser(user);

            console.log("User account deleted successfully!");

            const userRef = ref(db, "users/" + user.uid);
            await remove(userRef);

            sendResponse({ status: "success" });
          } catch (error) {
            console.error("Error deleting user account or data:", error);
            sendResponse({ status: "error", message: error.message });
          }
        } else {
          // User not signed in
        }
      });

      return true;
    }

    if (message.type === "deleteChessRank") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const chessRef = ref(db, "users/" + user.uid + "/chessInfo");
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");
          try {
            const premiumSnapshot = await get(premiumRef);
            const premiumData = premiumSnapshot.val();
            if (premiumData) {
              const premiumDefaultRank = premiumData.DefaultRank;

              if (premiumDefaultRank.includes("CHESS")) {
                await update(premiumRef, {
                  DefaultRank: "",
                });
              }
            }

            await remove(chessRef);
            sendResponse({ status: "success" });
            console.log("Rank deleted successfully!");
          } catch (error) {
            console.error("Error deleting rank:", error);
            sendResponse({ status: false });
          }
        } else {
          //user not signed in
        }
      });
      return true;
    }

    if (message.type === "deleteTFTRank") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const leagueRef = ref(db, "users/" + user.uid + "/leagueInfo");
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");
          try {
            const premiumSnapshot = await get(premiumRef);
            const premiumData = premiumSnapshot.val();
            if (premiumData) {
              const premiumDefaultRank = premiumData.DefaultRank;

              if (premiumDefaultRank.includes("TFT")) {
                await update(premiumRef, {
                  DefaultRank: "",
                });
              }
            }
            await remove(leagueRef);
            sendResponse({ status: "success" });
            console.log("Rank deleted successfully!");
          } catch (error) {
            console.error("Error deleting rank:", error);
            sendResponse({ status: false });
          }
        } else {
          //user not signed in
        }
      });
      return true;
    }

    if (message.type === "deleteLOLRank") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const leagueRef = ref(db, "users/" + user.uid + "/leagueInfo");
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");
          try {
            const premiumSnapshot = await get(premiumRef);
            const premiumData = premiumSnapshot.val();

            if (premiumData) {
              const premiumDefaultRank = premiumData.DefaultRank;

              if (premiumDefaultRank.includes("LEAGUE")) {
                await update(premiumRef, {
                  DefaultRank: "",
                });
              }
            }

            await remove(leagueRef);
            sendResponse({ status: "success" });
            console.log("Rank deleted successfully!");
          } catch (error) {
            console.error("Error deleting rank:", error);
            sendResponse({ status: false });
          }
        } else {
          //user not signed in
        }
      });
      return true;
    }

    if (message.type === "deleteDotaRank") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const dotaRef = ref(db, "users/" + user.uid + "/dotaInfo");
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");
          try {
            const premiumSnapshot = await get(premiumRef);
            const premiumData = premiumSnapshot.val();

            if (premiumData) {
              const premiumDefaultRank = premiumData.DefaultRank;

              if (premiumDefaultRank.includes("DOTA")) {
                await update(premiumRef, {
                  DefaultRank: "",
                });
              }
            }

            await remove(dotaRef);
            sendResponse({ status: "success" });
            console.log("Rank deleted successfully!");
          } catch (error) {
            console.error("Error deleting rank:", error);
            sendResponse({ status: false });
          }
        } else {
          //user not signed in
        }
      });
      return true;
    }

    if (message.type === "refreshDotaRank") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const dotaRef = ref(db, "users/" + user.uid + "/dotaInfo");

          try {
            const dotaSnapshot = await get(dotaRef);
            const dotaData = dotaSnapshot.val();
            const steamId64 = dotaData.steamId64;

            if (steamId64) {
              const steamId32 = BigInt(steamId64) - BigInt(76561197960265728n);

              const response = await fetch(
                `https://api.opendota.com/api/players/${steamId32.toString()}`
              );
              const data = await response.json();

              if (data.rank_tier) {
                const tier = Math.floor(data.rank_tier / 10);
                const subTier = data.rank_tier % 10;
                const rankNames = [
                  "HERALD",
                  "GUARDIAN",
                  "CRUSADER",
                  "ARCHON",
                  "LEGEND",
                  "ANCIENT",
                  "DIVINE",
                  "IMMORTAL",
                ];
                let dotaRank = `DOTA 2: ${rankNames[tier - 1]} ${subTier}`;
                if (tier === 8) {
                  dotaRank = "DOTA 2: IMMORTAL"; // Immortal rank does not have a sub-tier
                }

                const leaderboardRank = data.leaderboard_rank || "N/A";
                const personaName = data.profile.personaname || "Unknown";

                // Update the database with the new rank and additional details
                await update(dotaRef, {
                  rank: dotaRank,
                  leaderboardRank: leaderboardRank,
                  steamId64: steamId64,
                  personaName: personaName,
                });

                console.log("Dota 2 rank and details updated successfully!");
                sendResponse({
                  status: "success",
                  message: "Dota 2 rank and details updated successfully!",
                });
              } else {
                console.log("No rank data found for the user.");
                sendResponse({
                  status: "error",
                  message: "No rank data found for the user.",
                });
              }
            } else {
              console.log("Steam ID64 not found in the database.");
              sendResponse({
                status: "error",
                message: "Steam ID64 not found in the database.",
              });
            }
          } catch (error) {
            console.error("Error refreshing Dota 2 rank:", error);
            sendResponse({
              status: "error",
              message: "Error refreshing Dota 2 rank.",
            });
          }
        } else {
          // User not signed in
          sendResponse({ status: "error", message: "User not signed in." });
        }
      });
      return true;
    }

    if (message.type === "refreshChessRank") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const chessRef = ref(db, "users/" + user.uid + "/chessInfo");
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");

          try {
            const chessSnapshot = await get(chessRef);
            const chessData = chessSnapshot.val();
            const username = chessData.username;

            if (username) {
              const response = await fetch(
                `https://api.chess.com/pub/player/${username}/stats`
              );

              const data = await response.json();

              if (data) {
                const {
                  chess_daily,
                  chess960_daily,
                  chess_rapid,
                  chess_bullet,
                  chess_blitz,
                  fide,
                } = data;

                const chessRanks = [];

                if (chess_daily?.last?.rating) {
                  chessRanks.push("CHESS DAILY: " + chess_daily.last.rating);
                }

                if (chess960_daily?.last?.rating) {
                  chessRanks.push(
                    "CHESS 960 DAILY: " + chess960_daily.last.rating
                  );
                }

                if (chess_rapid?.last?.rating) {
                  chessRanks.push("CHESS RAPID: " + chess_rapid.last.rating);
                }

                if (chess_bullet?.last?.rating) {
                  chessRanks.push("CHESS BULLET: " + chess_bullet.last.rating);
                }

                if (chess_blitz?.last?.rating) {
                  chessRanks.push("CHESS BLITZ: " + chess_blitz.last.rating);
                }

                // Check if the FIDE rating exists and is greater than zero
                if (fide && fide > 0) {
                  chessRanks.push("FIDE: " + fide);
                }

                try {
                  await update(chessRef, { rank: chessRanks });
                  console.log("Chess ranks updated in the database!");

                  const premiumSnapshot = await get(premiumRef);
                  const premiumData = premiumSnapshot.val();

                  if (premiumData && premiumData.Status === true) {
                    const premiumDefaultRank = premiumData.DefaultRank;

                    const matchingRank = chessRanks.find((rank) =>
                      premiumDefaultRank.includes(rank.slice(0, 10))
                    );

                    if (matchingRank) {
                      await update(premiumRef, {
                        DefaultRank: matchingRank,
                      });
                      console.log("Default rank updated in the database!");
                    }
                  }

                  sendResponse({ status: "success", ChessRanks: chessRanks });
                } catch (error) {
                  console.error("Error updating chess ranks:", error);
                  return {
                    status: "error",
                    message: "Failed to update chess ranks",
                  };
                }
              } else {
                console.log("No data found for the user.");
                return false;
              }
            } else {
              console.log("Username not found in the database.");
              return false;
            }
          } catch (error) {
            console.error(error);
            return false;
          }
        } else {
          //user not signed in
          return false;
        }
      });
      return true;
    }

    if (message.type === "refreshTFTRank") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const leagueRef = ref(db, "users/" + user.uid + "/leagueInfo");
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");

          try {
            const leagueSnapshot = await get(leagueRef);
            const leagueData = leagueSnapshot.val();
            const username = leagueData.username;
            const tag = leagueData.tag;
            const region = leagueData.region;

            if (username && tag && region) {
              const response = await fetch(
                `https://us-central1-show-my-rank.cloudfunctions.net/app/api/proxy/refreshTFT/${username}/${tag}/${region}`
              );
              const data = await response.json();

              if (data && typeof data.tftRanks[0] !== "undefined") {
                try {
                  await update(leagueRef, { tft: data.tftRanks[0] });
                  console.log("TFT rank updated in the database!");

                  const premiumSnapshot = await get(premiumRef);
                  const premiumData = premiumSnapshot.val();

                  if (premiumData && premiumData.Status === true) {
                    const premiumDefaultRank = premiumData.DefaultRank;

                    if (
                      premiumDefaultRank &&
                      premiumDefaultRank.includes("TFT")
                    ) {
                      await update(premiumRef, {
                        DefaultRank: data.tftRanks[0],
                      });
                      console.log("DefaultRank updated in the database!");
                    }
                  }
                  sendResponse({
                    status: "success",
                    TFTRank: data.tftRanks[0],
                  });
                } catch (error) {
                  console.error("Error updating TFT rank:", error);
                  sendResponse({
                    status: "error",
                    message: "Failed to update TFT rank",
                  });
                }
              } else {
                console.log(
                  "No TFT rank data found for the user or rank is undefined."
                );
              }
            } else {
              console.log("Username not found in the database.");
              sendResponse({
                status: "error",
                message: "Username not found.",
              });
            }
          } catch (error) {
            console.error(error);
            sendResponse({
              status: "error",
              message: "An error occurred while fetching TFT rank.",
            });
          }
        } else {
          // User not signed in
          sendResponse({ status: "error", message: "User not signed in." });
        }
      });
      return true;
    }

    if (message.type === "refreshLOLRank") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const leagueRef = ref(db, "users/" + user.uid + "/leagueInfo");
          const premiumRef = ref(db, "users/" + user.uid + "/Premium");

          try {
            const leagueSnapshot = await get(leagueRef);
            const leagueData = leagueSnapshot.val();
            const username = leagueData.username;
            const tag = leagueData.tag;
            const region = leagueData.region;

            if (username && tag && region) {
              const response = await fetch(
                `https://us-central1-show-my-rank.cloudfunctions.net/app/api/proxy/refreshLOL/${username}/${tag}/${region}`
              );
              const data = await response.json();
              if (data && Array.isArray(data.ranks) && data.ranks.length > 0) {
                const leagueRanks = {};
                const leagueRanksArr = [];

                data.ranks.forEach((rank) => {
                  leagueRanksArr.push(rank);

                  if (rank.includes("SOLO")) {
                    leagueRanks.solo = rank;
                  } else if (rank.includes("FLEX")) {
                    leagueRanks.flex = rank;
                  }
                });

                // Check if we have any rank data before updating
                if (Object.keys(leagueRanks).length > 0) {
                  await update(leagueRef, leagueRanks);
                  console.log("League ranks updated in the database!");

                  const premiumSnapshot = await get(premiumRef);
                  const premiumData = premiumSnapshot.val();
                  if (premiumData && premiumData.Status === true) {
                    const premiumDefaultRank = premiumData.DefaultRank;

                    if (
                      leagueRanks.flex &&
                      premiumDefaultRank.includes("FLEX")
                    ) {
                      await update(premiumRef, {
                        DefaultRank: leagueRanks.flex,
                      });
                    }

                    if (
                      leagueRanks.solo &&
                      premiumDefaultRank.includes("SOLO")
                    ) {
                      await update(premiumRef, {
                        DefaultRank: leagueRanks.solo,
                      });
                    }
                  }
                  sendResponse({
                    status: "success",
                    LOLRanks: leagueRanksArr,
                  });
                } else {
                  console.log(
                    "League ranks are empty or undefined after refresh."
                  );
                }
              } else {
                console.log("No data found for the user.");
              }
            } else {
              console.log("Username not found in the database.");
              sendResponse({
                status: "error",
                message: "Username not found.",
              });
            }
          } catch (error) {
            console.error(error);
            sendResponse({
              status: "error",
              message: "An error occurred while fetching league ranks.",
            });
          }
        } else {
          // User not signed in
          sendResponse({ status: "error", message: "User not signed in." });
        }
      });
      return true;
    }

    if (message.type === "sendingSteamID") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const steamId64BigInt = BigInt(message.steamId);
          // Perform subtraction using BigInt for both operands
          const steamId32 = steamId64BigInt - BigInt(76561197960265728n);

          try {
            //Fetch player data from OpenDota API
            const response = await fetch(
              `https://api.opendota.com/api/players/${steamId32}`
            );

            const data = await response.json();

            if (data.rank_tier) {
              // Translate rank_tier to human-readable format
              const tier = Math.floor(data.rank_tier / 10);
              const subTier = data.rank_tier % 10;
              const rankNames = [
                "HERALD",
                "GUARDIAN",
                "CRUSADER",
                "ARCHON",
                "LEGEND",
                "ANCIENT",
                "DIVINE",
                "IMMORTAL",
              ];
              let dotaRank = `DOTA 2: ${rankNames[tier - 1]} ${subTier}`;
              if (tier === 8) {
                // Immortal rank does not have a sub-tier
                dotaRank = "DOTA 2: IMMORTAL";
              }

              const leaderboardRank = data.leaderboard_rank || "N/A"; // Use 'N/A' if leaderboard rank is not available
              const personaName = data.profile.personaname || "Unknown";

              // Adjusted to store descriptive rank and leaderboard rank separately
              const dotaInfoRef = ref(db, "users/" + user.uid + "/dotaInfo");

              // Save Dota 2 rank and additional details in the database
              set(dotaInfoRef, {
                rank: dotaRank,
                leaderboardRank: leaderboardRank,
                steamId64: message.steamId,
                personaName,
              })
                .then(() => {
                  console.log(
                    "Dota 2 ranks and additional details stored in the database!"
                  );
                })
                .catch((error) => {
                  console.error(
                    "Error storing Dota 2 ranks and details:",
                    error
                  );
                });
            } else {
              console.log("Player does not have a Dota 2 rank.");
            }

            return true;
          } catch (error) {
            console.error(error);
            return false;
          }
        } else {
          // User not signed in
          return false;
        }
      });
    }

    if (message.type === "sendingLeagueInfo") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const { username, tag, region } = message;
          try {
            const response = await fetch(
              `https://us-central1-show-my-rank.cloudfunctions.net/app/api/proxy/${username}/${tag}/${region}`
            );
            const data = await response.json();
            const leagueInfoRef = ref(db, "users/" + user.uid + "/leagueInfo");
            const { ranks } = data || {};

            if (ranks && ranks.length > 0) {
              // Check if ranks exist and are not empty
              const ranksMap = {};
              ranks.forEach((rankString) => {
                if (rankString.includes("SOLO")) {
                  ranksMap["solo"] = rankString;
                }
                if (rankString.includes("FLEX")) {
                  ranksMap["flex"] = rankString;
                }
                if (rankString.includes("TFT")) {
                  ranksMap["tft"] = rankString;
                }
              });

              // Proceed only if ranksMap is not empty
              if (Object.keys(ranksMap).length > 0) {
                const leagueInfo = {
                  username,
                  tag,
                  region,
                  ...ranksMap,
                };
                set(leagueInfoRef, leagueInfo)
                  .then(() => {
                    console.log(
                      "League ranks stored in the database!",
                      JSON.stringify(leagueInfo)
                    );
                  })
                  .catch((error) => {
                    console.error("Error storing league ranks:", error);
                  });
              } else {
                console.log("No valid ranks to store.");
              }
            } else {
              console.log("No ranks found for the user.");
            }
          } catch (error) {
            console.error(error);
          }
        } else {
          // User not signed in
          console.log("User not signed in.");
        }
      });
    }

    if (message.type === "sendingTwitchUsername") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const twitchUser = message.twitchUser;
          const twitchInfoRef = ref(
            db,
            "users/" + user.uid + "/twitchUsername"
          );

          try {
            await update(twitchInfoRef, { twitchUser });
            console.log("Twitch Username stored in the database!");
          } catch (error) {
            console.error("Error storing/getting twitch info:", error);
          }
        } else {
          //user not signed in
        }
      });
      return true;
    }

    if (message.type === "sendingChessInfo") {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const { username } = message;

          try {
            const response = await fetch(
              `https://api.chess.com/pub/player/${username}/stats`
            );
            const data = await response.json();

            const {
              chess_daily,
              chess960_daily,
              chess_rapid,
              chess_bullet,
              chess_blitz,
              fide,
            } = data;

            const chessRanks = [];

            if (chess_daily?.last?.rating) {
              chessRanks.push("CHESS DAILY: " + chess_daily.last.rating);
            }

            if (chess960_daily?.last?.rating) {
              chessRanks.push("CHESS 960 DAILY: " + chess960_daily.last.rating);
            }

            if (chess_rapid?.last?.rating) {
              chessRanks.push("CHESS RAPID: " + chess_rapid.last.rating);
            }

            if (chess_bullet?.last?.rating) {
              chessRanks.push("CHESS BULLET: " + chess_bullet.last.rating);
            }

            if (chess_blitz?.last?.rating) {
              chessRanks.push("CHESS BLITZ: " + chess_blitz.last.rating);
            }

            if (fide && fide > 0) {
              chessRanks.push("FIDE: " + fide);
            }

            // Only save the chess ranks if there is at least one rank
            if (chessRanks.length > 0) {
              const chessInfoRef = ref(db, "users/" + user.uid + "/chessInfo");
              set(chessInfoRef, { rank: chessRanks, username })
                .then(() => {
                  console.log("Chess ranks stored in the database!");
                })
                .catch((error) => {
                  console.error("Error storing chess ranks:", error);
                });
            } else {
              console.log("User does not have any chess ranks.");
              // Optionally, handle users without chess ranks here
            }

            return true;
          } catch (error) {
            console.error(error);
            return false;
          }
        } else {
          //user not signed in
          return false;
        }
      });
    }

    if (message.type === "getAuthenticationStatus") {
      onAuthStateChanged(auth, (user) => {
        if (user) {
          sendResponse({ isAuthenticated: true });
        } else {
          sendResponse({ isAuthenticated: false });
        }
      });

      return true;
    }

    if (message.type === "gettingAllRanksForUser") {
      onAuthStateChanged(auth, (user) => {
        if (user) {
          const twitchInfoRef = ref(
            db,
            "users/" + user.uid + "/twitchUsername"
          );

          const chessInfoRef = ref(db, "users/" + user.uid + "/chessInfo");
          const leagueInfoRef = ref(db, "users/" + user.uid + "/leagueInfo");
          const dotaInfoRef = ref(db, "users/" + user.uid + "/dotaInfo");

          Promise.all([
            get(chessInfoRef),
            get(leagueInfoRef),
            get(dotaInfoRef),
            get(twitchInfoRef),
          ])
            .then(
              ([
                chessSnapshot,
                leagueSnapshot,
                dotaSnapshot,
                twitchSnapshot,
              ]) => {
                const chessInfo = chessSnapshot.val();
                const leagueInfo = leagueSnapshot.val();
                const dotaInfo = dotaSnapshot.val();
                const twitchUsername = twitchSnapshot.val()?.twitchUser || null;

                const userData = {
                  chessInfo,
                  leagueInfo,
                  dotaInfo,
                  twitchUsername,
                };

                sendResponse(userData);
              }
            )
            .catch((error) => {
              console.error("Error retrieving data:", error);
              sendResponse({});
            });

          return true;
        } else {
          // User not signed in
          sendResponse({});
        }
      });

      return true;
    }

    if (message.type === "gettingAllRanksByCategory") {
      onAuthStateChanged(auth, (user) => {
        if (user) {
          let streamCategory = message.category;

          const usersRef = ref(db, "users");

          get(usersRef)
            .then((snapshot) => {
              const usersData = snapshot.val();

              const userRanks = [];

              Object.keys(usersData).forEach((userId) => {
                const userData = usersData[userId];

                if (streamCategory.includes("Teamfight Tactics")) {
                  if (
                    userData.leagueInfo &&
                    userData.leagueInfo.tft &&
                    userData.leagueInfo.tft.length > 0
                  ) {
                    const rank = userData.leagueInfo.tft;
                    const twitchUsername = userData.twitchUsername.twitchUser;
                    const username = userData.leagueInfo.username;
                    const region = userData.leagueInfo.region;
                    const tag = userData.leagueInfo.tag;
                    let ign = `IGN: ${username}#${tag} ${region}`;
                    let legacyIcon = "current";

                    if (userData.Premium && userData.Premium.Status === true) {
                      legacyIcon = userData.Premium.LegacyIcons || "current";
                    }
                    userRanks.push({
                      twitchUsername,
                      rank,
                      legacyIcon,
                      ign,
                    });
                  }
                } else if (streamCategory.includes("League of Legends")) {
                  if (
                    (userData.leagueInfo &&
                      userData.leagueInfo.solo &&
                      userData.leagueInfo.solo.length > 0) ||
                    (userData.leagueInfo &&
                      userData.leagueInfo.flex &&
                      userData.leagueInfo.flex.length)
                  ) {
                    let rank = "";

                    if (
                      userData.leagueInfo.solo &&
                      userData.leagueInfo.solo.length > 0
                    ) {
                      rank = userData.leagueInfo.solo;
                    } else if (
                      userData.leagueInfo.flex &&
                      userData.leagueInfo.flex.length > 0
                    ) {
                      rank = userData.leagueInfo.flex;
                    }
                    const twitchUsername = userData.twitchUsername.twitchUser;
                    let legacyIcon = "current";
                    const username = userData.leagueInfo.username;
                    const region = userData.leagueInfo.region;
                    const tag = userData.leagueInfo.tag;
                    let ign = `IGN: ${username}#${tag} ${region}`;

                    if (userData.Premium && userData.Premium.Status === true) {
                      legacyIcon = userData.Premium.LegacyIcons || "current";
                    }
                    userRanks.push({
                      twitchUsername,
                      rank,
                      legacyIcon,
                      ign,
                    });
                  }
                } else if (streamCategory.includes("Chess")) {
                  if (
                    userData.chessInfo &&
                    userData.chessInfo.rank &&
                    userData.chessInfo.rank.length > 0
                  ) {
                    const ranks = userData.chessInfo.rank;
                    const twitchUsername = userData.twitchUsername.twitchUser;
                    const username = userData.chessInfo.username;
                    let ign = `Username: ${username}`;

                    const allRanks = ranks.join(", "); // Use ", "

                    if (allRanks) {
                      userRanks.push({
                        twitchUsername,
                        rank: allRanks,
                        ign,
                      });
                    }
                  }
                } else if (streamCategory.includes("Dota 2")) {
                  if (
                    userData.dotaInfo &&
                    userData.dotaInfo.rank // Adjusted to directly use the saved rank
                  ) {
                    const twitchUsername = userData.twitchUsername.twitchUser;
                    const personaName = userData.dotaInfo.personaName;
                    let ign = `Persona Name: ${personaName}`;

                    // Directly using the saved descriptive rank and leaderboard rank
                    let rankString = `${userData.dotaInfo.rank}`;
                    if (
                      userData.dotaInfo.leaderboardRank &&
                      userData.dotaInfo.leaderboardRank !== "N/A"
                    ) {
                      rankString += `, LEADERBOARD RANK: ${userData.dotaInfo.leaderboardRank}`;
                    }

                    if (rankString) {
                      userRanks.push({
                        twitchUsername,
                        rank: rankString,
                        ign,
                      });
                    }
                  }
                } else if (streamCategory) {
                  if (userData.Premium && userData.Premium.Status === true) {
                    const twitchUsername = userData.twitchUsername.twitchUser;
                    const rank = userData.Premium.DefaultRank;
                    const legacyIcon = userData.Premium.LegacyIcons;

                    let ign = "";
                    let additionalRankInfo = "";
                    if (rank.includes("LEAGUE") || rank.includes("TFT")) {
                      const username = userData.leagueInfo.username;
                      const region = userData.leagueInfo.region;
                      const tag = userData.leagueInfo.tag;
                      ign = `IGN: ${username}#${tag} ${region}`;
                    } else if (rank.includes("DOTA")) {
                      const { personaName, leaderboardRank } =
                        userData.dotaInfo;
                      ign = `Persona Name: ${personaName}`;
                      // Include leaderboard rank if available
                      if (leaderboardRank && leaderboardRank !== "N/A") {
                        additionalRankInfo = `, LEADERBOARD RANK: ${leaderboardRank}`;
                      }
                    } else {
                      const username = userData.chessInfo.username;
                      ign = `Username: ${username}`;
                    }

                    const fullRankInfo = `${rank}${additionalRankInfo}`;

                    if (fullRankInfo.trim() !== "") {
                      userRanks.push({
                        twitchUsername,
                        rank: fullRankInfo,
                        legacyIcon,
                        ign,
                      });
                    }
                  }
                }
              });

              console.log(userRanks);
              sendResponse(userRanks);
            })
            .catch((error) => {
              console.error("Error getting user data:", error);
              sendResponse({});
            });
        } else {
          //user not signed in
          sendResponse({});
        }
      });
      return true;
    }
  });
} catch (e) {
  console.log(e);
}
