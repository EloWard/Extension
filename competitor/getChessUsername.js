const observer = new MutationObserver((mutations, obs) => {
  const usernameElement = document.querySelector("a.home-username-link");
  if (usernameElement) {
    const username = usernameElement.textContent.trim();
    chrome.runtime.sendMessage({ type: "sendingChessInfo", username });
    obs.disconnect(); // Stop observing once we have what we need
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
