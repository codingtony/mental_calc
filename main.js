window.onload = function () {
  let nameEl = document.getElementById("name");
  let terminalDiv = document.getElementById("terminal-div");
  let questionForm = document.getElementById("questions");
  let finish = document.getElementById("finish");
  let againBtn = document.getElementById("again-btn");

  function initQuestions() {
    let username = localStorage.getItem("name");
    if (username != null) {
      nameEl.value = username;
    }
  }

  initQuestions();

  againBtn.addEventListener("click", function () {
    finish.classList.add("hidden");
    finish.classList.remove("maindiv");
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
      finish.classList.remove("hidden");
      finish.classList.add("maindiv");

      const leaderboardData = [
        { name: "Player 1", mistakes: 2, time: "00:12" },
        { name: "Player 2", mistakes: 1, time: "00:08" },
        { name: "Player 3", mistakes: 5, time: "00:18" },
        // ...
        // Add more leaderboard entries here
      ];
      const leaderboardList = document.getElementById("leaderboard-list");

      leaderboardData.forEach((entry, index) => {
        if (index < 10) {
          const listItem = document.createElement("li");
          listItem.textContent = `${entry.name} - Mistakes: ${entry.mistakes} - Time: ${entry.time}`;
          leaderboardList.appendChild(listItem);
        }
      });
      const resultDiv = document.getElementById("result");
      resultDiv.innerHTML = "";

      const resultMessage = document.createElement("p");
      const statsMessage = document.createElement("p");

      statsMessage.textContent = `${game.numQuestions} questions, ${game.mistakes} mistakes, ${game.elapsedTime}`

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
