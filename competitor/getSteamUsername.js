const observer = new MutationObserver((mutations, obs) => {
  // Assuming the Steam ID can be found in the URL of the profile page
  // and you're on a page like https://steamcommunity.com/profiles/[SteamID]/home
  if (
    window.location.pathname.includes("/profiles/") &&
    window.location.pathname.includes("/home")
  ) {
    const steamIdSegments = window.location.pathname.split("/");
    const steamIdIndex = steamIdSegments.findIndex(
      (segment) => segment === "profiles"
    );
    if (steamIdIndex !== -1 && steamIdSegments.length > steamIdIndex + 1) {
      const steamId = steamIdSegments[steamIdIndex + 1];
      chrome.runtime.sendMessage({ type: "sendingSteamID", steamId });
      obs.disconnect(); // Stop observing once we have the Steam ID
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
