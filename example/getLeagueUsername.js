const observer = new MutationObserver((mutations, obs) => {
  const nameElement = document.querySelector(".ds-field__form-input");
  const tagElement = document.querySelector(
    '.ds-field__form-input[data-testid="riot-id__tagline"]'
  );
  const regionElement = document.querySelector(
    "p._1vuV6TcOudwCpQvfuH3Esy.riotbar-account-dropdown-region"
  );

  if (nameElement && tagElement && regionElement) {
    const username = nameElement.value.trim();
    const tag = tagElement.value.trim();
    const region = regionElement.textContent.trim();

    if (username && tag && region) {
      chrome.runtime.sendMessage({
        type: "sendingLeagueInfo",
        username,
        tag,
        region,
      });
      obs.disconnect(); // Stop observing once we have all the necessary info
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
