window.onload = function () {
  let nameEl = document.getElementById("name");
  let terminalDiv = document.getElementById("terminal-div");
  let questionForm = document.getElementById("questions");
  let leaderboard = document.getElementById("leaderboard");
  let againBtn = document.getElementById("again-btn");

  function initQuestions() {
    let username = localStorage.getItem("name");
    if (username != null) {
      nameEl.value = username;
    }
  }

  initQuestions();

  againBtn.addEventListener("click", function () {
    leaderboard.classList.add("hidden");
    questionForm.classList.remove("hidden");
    initQuestions();
  });
  questionForm.addEventListener("submit", function (evt) {
    evt.preventDefault();
    let username = nameEl.value;
    let numQuestions = document.getElementById("numQuestions").value;
    localStorage.setItem("name", nameEl.value);
    const game = new Game(username, numQuestions);
    questionForm.classList.add("hidden");
    terminalDiv.classList.remove("hidden");
    terminalDiv.focus();
    function completionCallback() {
      terminalDiv.classList.add("hidden");
      leaderboard.classList.remove("hidden");
    }
    initTerm(new Controller(game, completionCallback));
  });
};
