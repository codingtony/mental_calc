window.onload = function () {
  let nameEl = document.getElementById("name");
  let numQuestionEl = document.getElementById("numQuestions");
  let terminalDiv = document.getElementById("terminal-div");
  let questionForm = document.getElementById("questions");
  let finish = document.getElementById("finish");
  let againBtn = document.getElementById("again-btn");

  function initQuestions() {
    let username = localStorage.getItem("name");
    let numQuestions = localStorage.getItem("numQuestions");
    if (username != null) {
      nameEl.value = username;
    }
    if (numQuestions != null) {
      numQuestionEl.value = numQuestions;
    }
  }

  initQuestions();

  againBtn.addEventListener("click", function () {
    finish.classList.add("hidden");
    finish.classList.remove("resultdiv");
    questionForm.classList.remove("hidden");
    initQuestions();
  });
  questionForm.addEventListener("submit", function (evt) {
    evt.preventDefault();
    let username = nameEl.value;
    let numQuestions = numQuestionEl.value;
    localStorage.setItem("name", username);
    localStorage.setItem("numQuestions", numQuestions);
    const game = new Game(username, numQuestions);
    questionForm.classList.add("hidden");
    terminalDiv.classList.remove("hidden");
    terminalDiv.focus();
    function completionCallback() {
      terminalDiv.classList.add("hidden");
      finish.classList.remove("hidden");
      finish.classList.add("resultdiv");

      const leaderboardData = game.getHighscore();
      const leaderboardList = document.getElementById("leaderboard-list");
      const options = {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour12: false,
      };
      leaderboardData
        .sort((a, b) => {
          return a.valueOf() - b.valueOf();
        })
        .reverse()
        .forEach((entry, index) => {
          if (index < 10) {
            const listItem = document.createElement("li");
            listItem.textContent = `${entry.name} - Mistakes: ${
              entry.mistakes
            } - Time: ${entry.elapsed} - ${entry.when()}`;
            leaderboardList.appendChild(listItem);
          }
        });
      const resultDiv = document.getElementById("result");
      resultDiv.innerHTML = "";

      const resultMessage = document.createElement("p");
      const statsMessage = document.createElement("p");

      statsMessage.textContent = `${game.numQuestions} questions, ${game.mistakes} mistakes, ${game.elapsedTime}`;

      if (game.hasWon()) {
        resultMessage.textContent = "Congratulations! You did great!";
        resultMessage.classList.add("good");
      } else {
        resultMessage.textContent = "Oops! Better luck next time.";
        resultMessage.classList.add("bad");
      }
      resultDiv.appendChild(statsMessage);
      resultDiv.appendChild(resultMessage);
    }
    initTerm(new Controller(game, completionCallback));
  });
};
