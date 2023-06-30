window.onload = function () {
  let username = localStorage.getItem("name");
  let nameEl = document.getElementById("name");
  if (username != null) {
    nameEl.value = username;
  }

  let numQuestions = document.getElementById("numQuestions").value;

  let terminalDiv = document.getElementById("terminal-div");
  let questionForm = document.getElementById("questions");
  questionForm.addEventListener("submit", function (evt) {
    evt.preventDefault();
    let username = nameEl.value;
    localStorage.setItem("name", nameEl.value);
    const game = new Game(username, numQuestions);
    questionForm.classList.add("hidden");
    terminalDiv.classList.remove("hidden");

    initTerm(new Controller(game));
  });
};
