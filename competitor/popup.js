async function requestAuthenticationStatus() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "getAuthenticationStatus" },
        (response) => {
          resolve(response);
        }
      );
    });
    return response;
  } catch (error) {
    console.error("Error sending message:", error);
    return { isAuthenticated: false };
  }
}

async function requestPremiumStatus() {
  try {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "checkPremiumStatus" }, (response) => {
        resolve(response);
      });
    });
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

async function getAllRanks() {
  try {
    const rankResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "gettingAllRanksForUser" },
        (rankResponse) => {
          resolve(rankResponse);
        }
      );
    });
    return rankResponse;
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

document.addEventListener("DOMContentLoaded", async function () {
  const loadingContainer = document.createElement("div");
  loadingContainer.style.display = "flex";
  loadingContainer.style.justifyContent = "center";
  loadingContainer.style.alignItems = "center";
  loadingContainer.style.position = "fixed";
  loadingContainer.style.top = "0";
  loadingContainer.style.left = "0";
  loadingContainer.style.width = "100vw";
  loadingContainer.style.height = "100vh";
  loadingContainer.style.zIndex = "1000"; // Ensure it's above other content
  loadingContainer.style.backgroundColor = "rgba(255, 255, 255, 0.7)"; // Optional: Adds a semi-transparent overlay

  const loadingSpinner = document.createElement("div");
  loadingSpinner.id = "loading";
  loadingSpinner.style.border = "4px solid #f3f3f3";
  loadingSpinner.style.borderRadius = "50%";
  loadingSpinner.style.borderTop = "4px solid #3498db";
  loadingSpinner.style.width = "40px";
  loadingSpinner.style.height = "40px";
  loadingSpinner.style.animation = "spin 2s linear infinite";

  loadingContainer.appendChild(loadingSpinner);
  document.body.appendChild(loadingContainer);

  try {
    const response = await requestAuthenticationStatus();
    if (response && response.isAuthenticated) {
      const header = document.querySelector(".header");
      const optionsContainer = document.getElementById("options-container");

      //check if premium user
      const premiumStatus = await requestPremiumStatus();
      loadingContainer.remove();

      let selectedDefaultRank = premiumStatus.DefaultRank;

      async function loadRankOptionsList() {
        const optionsContainer = document.getElementById("options-container");
        const optionsTitle = document.getElementById("options-title");
        // Find existing rank options container, remove if exists
        let rankDropdownContainer = document.getElementById(
          "rankDropdownContainer"
        );
        if (rankDropdownContainer) {
          optionsContainer.removeChild(rankDropdownContainer);
        }

        // Create a new container for rank options
        rankDropdownContainer = document.createElement("div");
        rankDropdownContainer.id = "rankDropdownContainer"; // Assign ID for easy access

        const option1 = document.createElement("h2");
        option1.classList.add("option-header");
        const option1Desc = document.createElement("p");
        option1.textContent = "Set Rank";
        option1Desc.textContent =
          "Choose a default rank that will show up on streams that are not linkable (eg. Just Chatting)";

        rankDropdownContainer.append(option1);
        rankDropdownContainer.append(option1Desc);

        // Check if premium user
        const premiumStatus = await requestPremiumStatus();
        // Grab ranks
        const rankResponse = await getAllRanks();
        const rankDropdown = document.createElement("div");
        rankDropdown.classList.add("rank-dropdown");

        const allRanks = [];
        // Populate allRanks based on rankResponse
        if (rankResponse) {
          allRanks.push(""); // Adding an empty option as a default
          if (rankResponse.leagueInfo) {
            const leagueInfo = rankResponse.leagueInfo;
            if (leagueInfo.solo) {
              allRanks.push(leagueInfo.solo);
            }
            if (leagueInfo.flex) {
              allRanks.push(leagueInfo.flex);
            }
            if (leagueInfo.tft) {
              allRanks.push(leagueInfo.tft);
            }
          }

          if (rankResponse.chessInfo) {
            allRanks.push(...rankResponse.chessInfo.rank);
          }

          if (rankResponse.dotaInfo) {
            const dotaInfo = rankResponse.dotaInfo;
            const dotaRankString = `${dotaInfo.rank}`;
            allRanks.push(dotaRankString);
          }
        }

        const defaultRankValue = premiumStatus.DefaultRank;

        // Rank dropdown menu
        const rankSelection = document.createElement("select");

        allRanks.forEach((rank) => {
          const option = document.createElement("option");
          option.textContent = rank;

          if (rank === defaultRankValue) {
            option.selected = true;
          }

          rankSelection.appendChild(option);
        });

        rankSelection.addEventListener("change", function () {
          selectedDefaultRank = rankSelection.value;
        });

        rankDropdown.appendChild(rankSelection);
        rankDropdownContainer.appendChild(rankDropdown);
        optionsContainer.insertBefore(
          rankDropdownContainer,
          optionsTitle.nextSibling
        );
      }

      function showToast(message) {
        const toast = document.createElement("div");
        toast.textContent = message;
        toast.style.position = "fixed";
        toast.style.left = "50%";
        toast.style.top = "8%";
        toast.style.transform = "translate(-50%, -50%)";
        toast.style.backgroundColor = "#333";
        toast.style.color = "#fff";
        toast.style.padding = "10px 20px";
        toast.style.borderRadius = "5px";
        toast.style.zIndex = "10000"; // Make sure it's above other content
        toast.style.fontSize = "16px";
        toast.style.boxShadow = "0 2px 4px rgba(0,0,0,0.5)";

        document.body.appendChild(toast);

        // Automatically remove the toast after 2 seconds
        setTimeout(() => {
          toast.remove();
        }, 2000);
      }

      if (premiumStatus.success) {
        const premiumBanner = document.createElement("div");
        premiumBanner.classList.add("premium-banner");
        premiumBanner.id = "premium";
        premiumBanner.textContent = "PREMIUM";
        const challIcon = document.createElement("img");
        challIcon.classList.add("premium-icon");
        challIcon.src = chrome.runtime.getURL(
          `../images/legacyLOLEmblems/diamond.png`
        );
        premiumBanner.appendChild(challIcon);
        header.appendChild(premiumBanner);

        loadRankOptionsList();

        const option2 = document.createElement("h2");
        option2.classList.add("option-header");
        option2.textContent = "Legacy / Relic Emblems";
        const option2Desc = document.createElement("p");
        option2Desc.textContent =
          "Use Legacy or Relic Emblems instead of the current Rank Emblems for your League of Legends and TeamFight Tactics Ranks. (Note: There are no Relic Emblems for Iron, Emerald, and Grandmaster. There are no Legacy Emblems for Emerald.)";
        const defaultLegacyIconsValue = premiumStatus.LegacyIcons;
        const option2RadioContainer = document.createElement("div");
        option2RadioContainer.classList.add("radio-container");

        const option2LabelCurrent = document.createElement("label");
        option2LabelCurrent.textContent = "Current";
        const option2RadioCurrent = document.createElement("input");
        option2RadioCurrent.setAttribute("type", "radio");
        option2RadioCurrent.setAttribute("name", "rank-icons");
        option2RadioCurrent.setAttribute("value", "current");
        if (defaultLegacyIconsValue === "current") {
          option2RadioCurrent.checked = true;
        }
        option2LabelCurrent.appendChild(option2RadioCurrent);

        const option2LabelRelic = document.createElement("label");
        option2LabelRelic.textContent = "Relic";
        const option2RadioRelic = document.createElement("input");
        option2RadioRelic.setAttribute("type", "radio");
        option2RadioRelic.setAttribute("name", "rank-icons");
        option2RadioRelic.setAttribute("value", "relic");
        if (defaultLegacyIconsValue === "relic") {
          option2RadioRelic.checked = true;
        }
        option2LabelRelic.appendChild(option2RadioRelic);

        const option2LabelLegacy = document.createElement("label");
        option2LabelLegacy.textContent = "Legacy";
        const option2RadioLegacy = document.createElement("input");
        option2RadioLegacy.setAttribute("type", "radio");
        option2RadioLegacy.setAttribute("name", "rank-icons");
        option2RadioLegacy.setAttribute("value", "legacy");
        if (defaultLegacyIconsValue === "legacy") {
          option2RadioLegacy.checked = true;
        }
        option2LabelLegacy.appendChild(option2RadioLegacy);

        option2RadioContainer.appendChild(option2LabelCurrent);
        option2RadioContainer.appendChild(document.createTextNode("   "));
        option2RadioContainer.appendChild(option2LabelRelic);
        option2RadioContainer.appendChild(document.createTextNode("   "));
        option2RadioContainer.appendChild(option2LabelLegacy);

        optionsContainer.append(option2);
        optionsContainer.append(option2Desc);
        optionsContainer.appendChild(option2RadioContainer);
        let selectedLegacyIcons = premiumStatus.LegacyIcons;

        option2RadioContainer.addEventListener("change", (event) => {
          selectedLegacyIcons = event.target.value;
        });

        const saveButton = document.createElement("button");
        saveButton.classList.add("save-button");
        saveButton.textContent = "SAVE";

        const saveButtonContainer = document.createElement("div");
        saveButtonContainer.classList.add("save-button-container");
        saveButtonContainer.appendChild(saveButton);

        optionsContainer.appendChild(saveButtonContainer);

        saveButton.addEventListener("click", async function () {
          try {
            chrome.runtime.sendMessage(
              {
                type: "saveOptions",
                defaultRank: selectedDefaultRank,
                legacyIcons: selectedLegacyIcons,
              },
              function (response) {
                if (response && response.success) {
                  // Assuming the sendMessage callback receives a response indicating success
                  showToast("Settings saved successfully!");
                } else {
                  showToast("Failed to save settings.");
                }
              }
            );
          } catch (error) {
            console.log(error);
            showToast("An error occurred.");
          }
          optionsContainer.style.display = "none";
        });
      } else {
        const subButton = document.createElement("button");
        subButton.classList.add("sub-button");
        subButton.id = "sub";
        subButton.textContent = "Go Premium ";
        const subIcon = document.createElement("img");
        subIcon.classList.add("sub-icon");
        subIcon.src = `../images/relicLOLEmblems/diamond.png`;
        subButton.appendChild(subIcon);
        header.appendChild(subButton);

        const checkoutContainer = document.getElementById("checkout-container");
        const checkoutButton = document.getElementById("checkout-button");
        const licenseKeyInput = document.getElementById("license-key");
        const alertMessage = document.getElementById("alert-message");
        const gumroadMessage = document.getElementById("gumroad-prompt");
        const gumroadLink = document.getElementById("gumroad-link");

        gumroadLink.addEventListener("click", function (event) {
          event.preventDefault();

          window.open(
            "https://showmyranks.gumroad.com/l/PremiumSubscription",
            "_blank"
          );
        });

        licenseKeyInput.addEventListener("input", function () {
          const licenseKey = licenseKeyInput.value.trim();
          const isValidLicenseKey =
            /^[0-9A-Z]{8}-[0-9A-Z]{8}-[0-9A-Z]{8}-[0-9A-Z]{8}$/i.test(
              licenseKey
            );

          checkoutButton.disabled = !isValidLicenseKey;
        });

        checkoutButton.addEventListener("click", async function () {
          const licenseKey = document
            .getElementById("license-key")
            .value.trim();

          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { type: "activateLicense", licenseKey },
              (response) => {
                resolve(response);
              }
            );
          });
          licenseKeyInput.value = "";
          if (response == "License has been activated!") {
            checkoutContainer.innerHTML = `
              <div class="thank-you-message">
                <h2>Thank You for Subscribing!</h2>
                <p>Re-open the popup to start using your premium features!</p>
              </div>
            `;
            gumroadMessage.innerHTML = "";
          } else {
            alertMessage.textContent = response;
            alertMessage.style.display = "block";
          }
        });

        //SUBSCRIBE
        subButton.addEventListener("click", function () {
          const popupContainer = document.getElementById("popup-container");
          const closeButton = document.getElementById("close-button");

          popupContainer.style.display = "block";

          closeButton.addEventListener("click", function () {
            popupContainer.style.display = "none";
          });
        });
      }

      const settingsButton = document.createElement("button");
      settingsButton.classList.add("settings-button");
      settingsButton.id = "settings";
      const settingsIcon = document.createElement("i");
      settingsIcon.classList.add("fa", "fa-gear");
      settingsIcon.setAttribute("aria-hidden", "true");
      settingsButton.appendChild(settingsIcon);

      const infoButton = document.createElement("button");
      infoButton.classList.add("info-button");
      infoButton.id = "info";
      const infoIcon = document.createElement("i");
      infoIcon.classList.add("fa-solid", "fa-circle-info");
      infoIcon.setAttribute("aria-hidden", "true");
      infoButton.appendChild(infoIcon);

      const signoutButton = document.createElement("button");
      signoutButton.classList.add("signout-button");
      signoutButton.id = "signout";
      const signoutIcon = document.createElement("i");
      signoutIcon.classList.add("fa", "fa-sign-out");
      signoutIcon.setAttribute("aria-hidden", "true");
      signoutButton.appendChild(signoutIcon);

      header.appendChild(settingsButton);
      header.appendChild(infoButton);
      header.appendChild(signoutButton);

      const option3 = document.createElement("h2");
      option3.classList.add("option-header");
      const option3CheckBoxContainer = document.createElement("div");
      option3CheckBoxContainer.classList.add("checkbox-container");
      const option3Desc = document.createElement("p");
      const option3Button = document.createElement("button");
      option3Button.classList.add("delete-button");
      option3.textContent = "Delete Account";
      option3Desc.textContent =
        "Delete your account and all associated rank information. (Deletion of account may require recent sign-in.)";
      option3Button.textContent = "Delete account";

      const option3CheckBox = document.createElement("input");
      option3CheckBox.setAttribute("type", "checkbox");

      const option3CheckText = document.createElement("p");
      option3CheckText.innerHTML = "Are you sure?&nbsp;";

      option3CheckBoxContainer.appendChild(option3CheckText);
      option3CheckBoxContainer.appendChild(option3CheckBox);

      const deleteContainer = document.createElement("div");
      deleteContainer.appendChild(option3);
      deleteContainer.appendChild(option3Desc);
      deleteContainer.appendChild(option3CheckBoxContainer);
      deleteContainer.appendChild(option3Button);

      optionsContainer.appendChild(deleteContainer);

      option3Button.addEventListener("click", function () {
        if (option3CheckBox.checked) {
          chrome.runtime.sendMessage(
            { type: "deleteAccountRequest" },
            (response) => {
              if (response.status === "success") {
                window.close();
              } else {
                console.error("Error deleting account:", response.message);
              }
            }
          );
        } else {
          alert("Please confirm the deletion of your account.");
        }
      });

      displayRanksToPopUp();

      async function displayRanksToPopUp() {
        //grab ranks
        const rankResponse = await getAllRanks();

        const rankAndPreviewContainer = document.getElementById(
          "rankAndPreviewContainer"
        );

        // Clear the rankContainer by removing all child nodes
        while (rankAndPreviewContainer.firstChild) {
          rankAndPreviewContainer.removeChild(
            rankAndPreviewContainer.firstChild
          );
        }
        //display ranks
        if (rankResponse) {
          const rankContainer = document.createElement("div");
          rankContainer.id = "rankContainer";
          rankContainer.className = "rankContainer";
          rankContainer.innerHTML = "<h2>My Ranks</h2>";

          const previewContainer = document.createElement("div");
          previewContainer.id = "previewContainer";
          previewContainer.className = "previewContainer";

          rankAndPreviewContainer.appendChild(rankContainer);
          rankAndPreviewContainer.appendChild(previewContainer);

          if (rankResponse.leagueInfo) {
            const leagueInfo = rankResponse.leagueInfo;

            if (leagueInfo.solo || leagueInfo.flex) {
              const leagueContainer = document.createElement("div");
              leagueContainer.classList.add("league-container");

              const lolPic = document.createElement("img");
              lolPic.id = "logoPic";
              lolPic.src = "/images/Logos/newlolpic.png";
              lolPic.alt = "League of Legends Logo";

              const leagueDropdown = document.createElement("select");
              leagueDropdown.id = "dropdown";

              if (leagueInfo.solo) {
                const soloOption = document.createElement("option");
                soloOption.textContent = leagueInfo.solo.slice(7);
                leagueDropdown.appendChild(soloOption);
              }

              if (leagueInfo.flex) {
                const flexOption = document.createElement("option");
                flexOption.textContent = leagueInfo.flex.slice(7);
                leagueDropdown.appendChild(flexOption);
              }

              const lolLabel = document.createElement("p");
              lolLabel.textContent = "League of Legends";
              lolLabel.style.width = "100px";
              const deleteButton = document.createElement("button");
              const deleteIcon = document.createElement("i");
              deleteIcon.classList.add("fa-solid", "fa-trash");
              deleteButton.append(deleteIcon);
              deleteButton.addEventListener("click", () => {
                chrome.runtime.sendMessage(
                  { type: "deleteLOLRank" },
                  (response) => {
                    if (response.status === "success") {
                      displayRanksToPopUp();
                      showToast("Rank Deleted!");
                      if (premiumStatus.success) {
                        loadRankOptionsList();
                      }
                    } else {
                      console.error("Error deleting rank:", response.message);
                    }
                  }
                );
              });

              // Define a debounce function with a delay parameter
              function debounce(func, delay) {
                let cooldown = false;
                return function () {
                  if (!cooldown) {
                    func.apply(this, arguments);
                    cooldown = true;
                    setTimeout(() => (cooldown = false), delay);
                  }
                };
              }

              const refreshButton = document.createElement("button");
              const refreshIcon = document.createElement("i");
              refreshIcon.classList.add("fa-solid", "fa-arrows-rotate");
              refreshButton.append(refreshIcon);

              // Wrap the event handler with the debounce function and set a delay of 5 seconds
              const debouncedLOLRefresh = debounce(() => {
                chrome.runtime.sendMessage(
                  { type: "refreshLOLRank" },
                  (response) => {
                    if (response.status === "success") {
                      displayRanksToPopUp();
                      showToast("LOL Rank Updated!");
                      if (premiumStatus.success) {
                        loadRankOptionsList();
                      }
                    } else {
                      console.error("Error signing in:", response.message);
                    }
                  }
                );
              }, 5000); // Wait for 5 seconds between refreshes

              refreshButton.addEventListener("click", debouncedLOLRefresh);

              leagueContainer.appendChild(lolPic);
              leagueContainer.appendChild(lolLabel);
              leagueContainer.appendChild(leagueDropdown);
              leagueContainer.appendChild(refreshButton);
              leagueContainer.appendChild(deleteButton);

              rankContainer.appendChild(leagueContainer);
            }

            if (leagueInfo.tft) {
              const tftRank = leagueInfo.tft;

              const tftContainer = document.createElement("div");
              tftContainer.classList.add("tft-container");

              const tftPic = document.createElement("img");
              tftPic.id = "logoPic";
              tftPic.src = "/images/Logos/tftpic.png";
              tftPic.alt = "TFT Logo";

              const tftElement = document.createElement("p");
              tftElement.classList.add("rankItem");
              tftElement.textContent = tftRank.slice(5);

              const tftLabel = document.createElement("p");
              tftLabel.textContent = "TeamFight Tactics";

              const deleteButton = document.createElement("button");
              const deleteIcon = document.createElement("i");
              deleteIcon.classList.add("fa-solid", "fa-trash");
              deleteButton.append(deleteIcon);
              deleteButton.addEventListener("click", () => {
                chrome.runtime.sendMessage(
                  { type: "deleteTFTRank" },
                  (response) => {
                    if (response.status === "success") {
                      displayRanksToPopUp();
                      showToast("Rank Deleted!");
                      if (premiumStatus.success) {
                        loadRankOptionsList();
                      }
                    } else {
                      console.error("Error deleting rank:", response.message);
                    }
                  }
                );
              });

              // Define a debounce function with a delay parameter
              function debounce(func, delay) {
                let cooldown = false;
                return function () {
                  if (!cooldown) {
                    func.apply(this, arguments);
                    cooldown = true;
                    setTimeout(() => (cooldown = false), delay);
                  }
                };
              }

              const refreshButton = document.createElement("button");
              const refreshIcon = document.createElement("i");
              refreshIcon.classList.add("fa-solid", "fa-arrows-rotate");
              refreshButton.append(refreshIcon);

              // Wrap the event handler with the debounce function and set a delay of 5 seconds
              const debouncedTFTRefresh = debounce(() => {
                chrome.runtime.sendMessage(
                  { type: "refreshTFTRank" },
                  (response) => {
                    if (response.status === "success") {
                      displayRanksToPopUp();
                      showToast("TFT Rank Updated!");
                      if (premiumStatus.success) {
                        loadRankOptionsList();
                      }
                    } else {
                      console.error("Error signing in:", response.message);
                    }
                  }
                );
              }, 5000); // Wait for 5 seconds between refreshes

              refreshButton.addEventListener("click", debouncedTFTRefresh);

              tftContainer.appendChild(tftPic);
              tftContainer.appendChild(tftLabel);
              tftContainer.appendChild(tftElement);
              tftContainer.appendChild(refreshButton);
              tftContainer.appendChild(deleteButton);

              rankContainer.appendChild(tftContainer);
            }
          }

          if (rankResponse.chessInfo) {
            const chessPic = document.createElement("img");
            chessPic.id = "logoPic";
            chessPic.src = "/images/Logos/chesspic.png";
            chessPic.alt = "Chess Logo";

            const chessInfo = rankResponse.chessInfo;
            const chessRanks = chessInfo.rank;

            const chessContainer = document.createElement("div");
            chessContainer.classList.add("chess-container");

            const chessLabel = document.createElement("p");
            chessLabel.textContent = "Chess";

            const chessDropdown = document.createElement("select");
            chessDropdown.id = "dropdown";

            chessRanks.forEach((chessRank) => {
              const option = document.createElement("option");
              option.textContent = processChessRank(chessRank);
              chessDropdown.appendChild(option);
            });

            function processChessRank(chessRank) {
              if (chessRank.startsWith("CHESS ")) {
                return chessRank.slice("CHESS ".length);
              } else if (chessRank.startsWith("FIDE ")) {
                return;
              }
              // Return the original rank if no known prefix is detected
              return chessRank;
            }
            const deleteButton = document.createElement("button");
            const deleteIcon = document.createElement("i");
            deleteIcon.classList.add("fa-solid", "fa-trash");
            deleteButton.append(deleteIcon);
            deleteButton.addEventListener("click", () => {
              chrome.runtime.sendMessage(
                { type: "deleteChessRank" },
                (response) => {
                  if (response.status === "success") {
                    displayRanksToPopUp();
                    showToast("Rank Deleted!");
                    if (premiumStatus.success) {
                      loadRankOptionsList();
                    }
                  } else {
                    console.error("Error deleting rank:", response.message);
                  }
                }
              );
            });

            // Define a debounce function with a delay parameter
            function debounce(func, delay) {
              let cooldown = false;
              return function () {
                if (!cooldown) {
                  func.apply(this, arguments);
                  cooldown = true;
                  setTimeout(() => (cooldown = false), delay);
                }
              };
            }

            const refreshButton = document.createElement("button");
            const refreshIcon = document.createElement("i");
            refreshIcon.classList.add("fa-solid", "fa-arrows-rotate");
            refreshButton.append(refreshIcon);

            // Wrap the event handler with the debounce function and set a delay of 5 seconds
            const debouncedChessRefresh = debounce(() => {
              chrome.runtime.sendMessage(
                { type: "refreshChessRank" },
                (response) => {
                  if (response.status === "success") {
                    displayRanksToPopUp();
                    showToast("Chess Rank Updated!");
                    if (premiumStatus.success) {
                      loadRankOptionsList();
                    }
                  } else {
                    console.error("Error signing in:", response.message);
                  }
                }
              );
            }, 5000); // Wait for 5 seconds between refreshes

            refreshButton.addEventListener("click", debouncedChessRefresh);

            chessContainer.appendChild(chessPic);
            chessContainer.appendChild(chessLabel);
            chessContainer.appendChild(chessDropdown);
            chessContainer.appendChild(refreshButton);
            chessContainer.appendChild(deleteButton);

            rankContainer.appendChild(chessContainer);
          }

          if (rankResponse.dotaInfo) {
            const dotaPic = document.createElement("img");
            dotaPic.id = "logoPic";
            dotaPic.src = "/images/Logos/dotapic.png";
            dotaPic.alt = "Dota 2 Logo";

            const dotaInfo = rankResponse.dotaInfo;
            const dotaRankString = dotaInfo.rank;

            const dotaContainer = document.createElement("div");
            dotaContainer.classList.add("dota-container");

            const dotaLabel = document.createElement("p");
            dotaLabel.textContent = "Dota 2";

            const dotaRankElement = document.createElement("p");
            dotaRankElement.classList.add("rankItem");
            dotaRankElement.textContent = dotaRankString.slice(8);

            const deleteButton = document.createElement("button");
            const deleteIcon = document.createElement("i");
            deleteIcon.classList.add("fa-solid", "fa-trash");
            deleteButton.append(deleteIcon);
            deleteButton.addEventListener("click", () => {
              chrome.runtime.sendMessage(
                { type: "deleteDotaRank" },
                (response) => {
                  if (response.status === "success") {
                    displayRanksToPopUp();
                    showToast("Rank Deleted!");
                    if (premiumStatus.success) {
                      loadRankOptionsList();
                    }
                  } else {
                    console.error("Error deleting rank:", response.message);
                  }
                }
              );
            });

            // Define a debounce function with a delay parameter
            function debounce(func, delay) {
              let cooldown = false;
              return function () {
                if (!cooldown) {
                  func.apply(this, arguments);
                  cooldown = true;
                  setTimeout(() => (cooldown = false), delay);
                }
              };
            }

            const refreshButton = document.createElement("button");
            const refreshIcon = document.createElement("i");
            refreshIcon.classList.add("fa-solid", "fa-arrows-rotate");
            refreshButton.append(refreshIcon);

            // Wrap the event handler with the debounce function and set a delay of 5 seconds
            const debouncedDotaRefresh = debounce(() => {
              chrome.runtime.sendMessage(
                { type: "refreshDotaRank" },
                (response) => {
                  if (response.status === "success") {
                    displayRanksToPopUp();
                    showToast("Dota Rank Updated!");
                    if (premiumStatus.success) {
                      loadRankOptionsList();
                    }
                  } else {
                    console.error("Error signing in:", response.message);
                  }
                }
              );
            }, 5000); // Wait for 5 seconds between refreshes

            refreshButton.addEventListener("click", debouncedDotaRefresh);

            dotaContainer.appendChild(dotaPic);
            dotaContainer.appendChild(dotaLabel);
            dotaContainer.appendChild(dotaRankElement);
            dotaContainer.appendChild(refreshButton);
            dotaContainer.appendChild(deleteButton);

            rankContainer.appendChild(dotaContainer);
          }

          const twitchIconUrl = "/images/Logos/twitch.png"; // Replace with the actual URL of the Twitch icon

          const twitchIconElement = document.createElement("img");
          twitchIconElement.src = twitchIconUrl;
          twitchIconElement.classList.add("twitchLogo");
          twitchIconElement.alt = "Twitch Icon";

          const twitchUsername = rankResponse.twitchUsername;
          const twitchUsernameElement = document.createElement("p");
          twitchUsernameElement.textContent = twitchUsername;

          const twitchUserContainer = document.createElement("div");
          twitchUserContainer.style.display = "flex";
          twitchUserContainer.style.alignItems = "center";

          twitchUserContainer.appendChild(twitchIconElement);
          twitchUserContainer.appendChild(twitchUsernameElement);

          previewContainer.appendChild(twitchUserContainer);
        }
      }
      attachEventListeners();

      function attachEventListeners() {
        //INFO PAGE
        infoButton.addEventListener("click", function () {
          chrome.tabs.create({
            url: "chrome-extension://dfnglmloeedjemiomnhigjancdnhnajj/info.html",
          });
        });

        //LOGOUT
        signoutButton.addEventListener("click", async function () {
          try {
            const response = await sendSignOutRequest();
            if (response.status === "success") {
              chrome.runtime.reload();
            } else {
              console.error("Error signing out:", response.message);
            }
          } catch (error) {
            console.error("Error while signing out:", error);
          }
        });

        //OPTIONS
        settingsButton.addEventListener("click", async function () {
          optionsContainer.style.display =
            optionsContainer.style.display === "block" ? "none" : "block";

          const closeButton = document.getElementById("close-button2");

          closeButton.addEventListener("click", function () {
            optionsContainer.style.display = "none";
          });
        });
      }

      async function sendSignOutRequest() {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "requestSignOut" }, (response) => {
            resolve(response);
          });
        });
      }
    } else {
      loadingContainer.remove();
      // request sign in
      const signInContainer = document.getElementById("signInContainer");
      const signUpContainer = document.getElementById("signUpContainer");

      const createAccountButton = document.createElement("button");
      createAccountButton.classList.add("authButton");
      createAccountButton.textContent = "Create an account";
      createAccountButton.addEventListener("click", () => {
        signUpContainer.style.display = "block";
      });

      const emailInput = document.createElement("input");
      emailInput.classList.add("loginInput");
      emailInput.type = "email";
      emailInput.placeholder = "Email";
      emailInput.id = "email";

      const passwordInput = document.createElement("input");
      passwordInput.classList.add("loginInput");
      passwordInput.type = "password";
      passwordInput.placeholder = "Password";
      passwordInput.id = "password";

      const loginErrorMessage = document.createElement("p");
      loginErrorMessage.classList.add("password-error");
      loginErrorMessage.textContent = "";

      const emailSentMessage = document.createElement("p");
      emailSentMessage.classList.add("verify-email");
      emailSentMessage.textContent = "";

      const resetPasswordButton = document.createElement("button");
      resetPasswordButton.classList.add("authButton");
      resetPasswordButton.textContent = "Forgot Password?";
      resetPasswordButton.addEventListener("click", () => {
        const email = emailInput.value;

        chrome.runtime.sendMessage(
          { type: "requestPasswordReset", email: email },
          (response) => {
            if (response.status === "success") {
              emailSentMessage.textContent = "Password reset link sent";
            } else {
              loginErrorMessage.textContent = response.error;
            }
          }
        );
      });

      const loginButton = document.createElement("button");
      loginButton.classList.add("authButton");
      loginButton.textContent = "Login";
      loginButton.addEventListener("click", () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        emailSentMessage.textContent = "";
        loginErrorMessage.textContent = "";

        if (email && password) {
          const credentials = {
            type: "requestSignIn",
            email: email,
            password: password,
          };

          chrome.runtime.sendMessage(credentials, (response) => {
            if (response.status === "success") {
              chrome.runtime.reload();
            } else if (response.error === "Email is not verified") {
              loginErrorMessage.textContent =
                "Please verify email before signing in.";
            } else if (
              response.error === "Firebase: Error (auth/user-not-found)."
            ) {
              loginErrorMessage.textContent =
                "There is no account associated with this email!";
            } else if (
              response.error === "Firebase: Error (auth/wrong-password)."
            ) {
              loginErrorMessage.textContent = "Incorrect Password";
            } else {
              loginErrorMessage.textContent = response.error;
            }
          });
        }
      });
      signInContainer.appendChild(emailInput);
      signInContainer.appendChild(passwordInput);
      signInContainer.appendChild(loginButton);
      signInContainer.appendChild(resetPasswordButton);
      signInContainer.appendChild(createAccountButton);
      signInContainer.appendChild(loginErrorMessage);
      signInContainer.appendChild(emailSentMessage);

      const emailInputSignUp = document.createElement("input");
      emailInputSignUp.classList.add("signupInput");
      emailInputSignUp.type = "email";
      emailInputSignUp.placeholder = "Email";
      emailInputSignUp.id = "emailSignUp";

      const signupHead = document.createElement("h2");
      signupHead.textContent = "Sign Up";

      const passwordInputSignUp = document.createElement("input");
      passwordInputSignUp.classList.add("signupInput");
      passwordInputSignUp.type = "password";
      passwordInputSignUp.placeholder = "Password";
      passwordInputSignUp.id = "passwordSignUp";

      const confirmPasswordInputSignUp = document.createElement("input");
      confirmPasswordInputSignUp.classList.add("signupInput");
      confirmPasswordInputSignUp.type = "password";
      confirmPasswordInputSignUp.placeholder = "Confirm Password";
      confirmPasswordInputSignUp.id = "confirmPasswordSignUp";

      const signUpCloseBtn = document.getElementById("close-button3");

      signUpCloseBtn.addEventListener("click", function () {
        signUpContainer.style.display = "none";
      });

      const passwordRequirements = document.createElement("p");
      passwordRequirements.textContent =
        "Password must be between 8 and 16 characters and contain at least one uppercase letter, one lowercase letter, and one number.";

      const passwordError = document.createElement("p");
      passwordError.classList.add("password-error");
      passwordError.textContent = "";

      const createAccountButtonSignUp = document.createElement("button");
      createAccountButtonSignUp.classList.add("authButton");
      createAccountButtonSignUp.textContent = "Create Account";
      createAccountButtonSignUp.addEventListener("click", async () => {
        const email = emailInputSignUp.value;
        const password = passwordInputSignUp.value;
        const confirmPassword = confirmPasswordInputSignUp.value;

        if (!email.includes("@")) {
          passwordError.textContent = "Invalid email address.";
          return;
        }

        if (email && password && confirmPassword) {
          if (password !== confirmPassword) {
            passwordError.textContent = "Passwords do not match.";
            return;
          }

          if (password.length <= 8 || password.length >= 16) {
            passwordError.textContent =
              "Password must be between 8 and 16 characters.";
            return;
          }

          if (
            !/[a-z]/.test(password) ||
            !/[A-Z]/.test(password) ||
            !/[0-9]/.test(password)
          ) {
            passwordError.textContent =
              "Password must contain at least one uppercase letter, one lowercase letter, and one number.";

            return;
          }

          const credentials = {
            type: "requestSignUp",
            email: email,
            password: password,
          };

          try {
            chrome.runtime.sendMessage(credentials, (response) => {
              if (response.status === "success") {
                signUpContainer.style.display = "none";
                passwordError.textContent = "";
                emailSentMessage.textContent = "Verification email sent!";
              } else {
                passwordError.textContent =
                  "Error creating account: " + response.error;
              }
            });
          } catch (error) {
            console.error("Error creating account: ", error);
          }
        } else {
          passwordError.textContent =
            "Email, password, and confirmation are required.";
        }
      });

      signUpContainer.appendChild(signupHead);
      signUpContainer.appendChild(emailInputSignUp);
      signUpContainer.appendChild(passwordInputSignUp);
      signUpContainer.appendChild(confirmPasswordInputSignUp);
      signUpContainer.appendChild(passwordRequirements);
      signUpContainer.appendChild(passwordError);
      signUpContainer.appendChild(createAccountButtonSignUp);
      signUpContainer.appendChild(signUpCloseBtn);
    }
  } catch (error) {
    console.error("Error retrieving authentication status:", error);
  }
});
