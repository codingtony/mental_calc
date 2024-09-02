async function getVersion() {
  try {
      const response = await fetch('/version.json', { cache: 'no-store' });
      const data = await response.json();
      const version = data.version;
      return version;
  } catch (error) {
      console.error('Error fetching version:', error);
      return null;
  }
}

window.onload = function () {
  let nameEl = document.getElementById("name");
  let numQuestionEl = document.getElementById("numQuestions");
  let terminalDiv = document.getElementById("terminal-div");
  let questionForm = document.getElementById("questions");
  let finish = document.getElementById("finish");
  let againBtn = document.getElementById("again-btn");
  let versionInDiv = document.getElementById("version").textContent
  getVersion().then(version => {
    if (version) {
        console.log('Version on server:', version);
        console.log('Version in index.html:', versionInDiv);
        if (versionInDiv != "__VERSION__" && versionInDiv != version) {
          window.location.reload()
        }
    }
  });

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
      const leaderboardTitle = document.getElementById("leaderboard-title");

      const sortByScore = (a, b) => {
        return a.valueOf() - b.valueOf();
      };
      const sortByTime = (a, b) => {
        return a.timestamp - b.timestamp;
      };

      let sortFunction=sortByTime

      const leaderboardDisplay = (sortFunction) => {
        let top = 3
        if (sortFunction === sortByScore) {
          top = 10
        }
        leaderboardList.innerHTML = ''
        leaderboardData
        .sort(sortFunction)
        .reverse().filter(s=>s.mode === game.mode)
        .forEach((entry, index) => {
          if (index < top) {
            const listItem = document.createElement("li");
            listItem.textContent = `${entry.name} - Mistake(s): ${
              entry.mistakes
            } - Time: ${entry.elapsed} - ${entry.when()}`;
            leaderboardList.appendChild(listItem);
          }
        });}


      leaderboardTitle.addEventListener('click',()=>{
        if (sortFunction === sortByTime) {
          leaderboardTitle.textContent="High scores"
          sortFunction=sortByScore
        } else {
          leaderboardTitle.textContent="Last games"
          sortFunction=sortByTime
        }
        leaderboardDisplay(sortFunction);
      })

      leaderboardDisplay(sortFunction);



      const resultDiv = document.getElementById("result");
      resultDiv.innerHTML = "";

      const resultMessage = document.createElement("p");
      const statsMessage = document.createElement("p");

      statsMessage.textContent = `${game.numQuestions} questions, ${game.mistakes} mistake(s), ${game.elapsedTime}`;

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
