document.addEventListener("DOMContentLoaded", function () {
  tosButton = document.getElementById("tosBtn");

  tosButton.addEventListener("click", function () {
    window.open("https://www.showmyranks.com/tos", "_blank");
  });

  privacyButton = document.getElementById("privacyBtn");

  privacyButton.addEventListener("click", function () {
    window.open("https://www.showmyranks.com/privacypolicy", "_blank");
  });
});
