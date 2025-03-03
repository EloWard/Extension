const observer = new MutationObserver((mutations, obs) => {
  const currentURL = window.location.href;
  if (currentURL.includes("valorant")) {
    const usernameElement = document.querySelector(
      "a.profile-selector__container.router-link-active"
    );
    if (usernameElement) {
      const href = usernameElement.getAttribute("href");
      const usersName = decodeURIComponent(href.split("/").pop());

      const profileNameElement = document.querySelector(
        "span.trn-ign__username"
      );
      const profileTagElement = document.querySelector(
        "span.trn-ign__discriminator"
      );

      if (profileNameElement && profileTagElement) {
        const profileName = profileNameElement.textContent.trim();
        const profileTag = profileTagElement.textContent.trim();
        const profile = profileName + profileTag;

        if (usersName === profile) {
          const rankElement = document.querySelector(
            "div.rating-entry__rank-info > div.value"
          );
          if (rankElement) {
            const rankText = rankElement.textContent.trim();
            if (rankText && rankText !== "Unranked") {
              chrome.runtime.sendMessage({
                type: "sendingValInfo",
                rankText,
                username: profileName,
                tag: profileTag,
              });
              obs.disconnect(); // Stop observing once the information is sent
            }
          }
        }
      }
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
