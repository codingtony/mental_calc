function msToString(millis) {
  const minutes = Math.floor(millis / 60000);
  const seconds = ((millis % 60000) / 1000).toFixed(0);
  return minutes + " min " + (seconds < 10 ? "0" : "") + seconds + " sec";
}

class Game {
  constructor(name, numQuestions = 50) {
    this.name = name;
    this.numQuestions = numQuestions;
    this.initGame();
    this.levelHighscore = [];
  }
  #firstTime = true;

  #motivation_quotes = [
    "Great work!",
    "Excellent!",
    "Amazing!",
    "Impressive!",
    "You're a superstar!",
    "Keep up the good work!",
    "Well done!",
    "Fantastic!",
    "Brilliant!",
    "Outstanding!",
    "Incredible!",
    "Terrific!",
    "Superb!",
    "Awesome!",
    "Way to go!",
    "Good job!",
    "You're a rockstar!",
    "You've got this!",
  ];

  #wrong_answer_messages = [
    "Oops, that's not quite right.",
    "Not quite, but keep trying!",
    "Almost there, but not quite.",
    "That's not the correct answer, but don't give up!",
    "Sorry, that's incorrect. Try again!",
  ];

  #question_bank = [];

  initGame() {
    this.elapsedMs = 0;
    this.score = 0;
    this.finish = false;
    this.mistakes = 0;
    for (let i = 0; i < 10; i++) {
      for (let j = 1; j < 10; j++) {
        if (i !== 0) {
          let o = j + " + " + i;
          this.#question_bank.push([o, j + i]);
        }
        if (i === j) {
          continue;
        }
        if (i > j && i !== 0) {
          let o = i + " - " + j;
          this.#question_bank.push([o, i - j]);
        } else {
          let o = i + 10 + " - " + j;
          this.#question_bank.push([o, i + 10 - j]);
        }
      }
    }
    let questions = [];
    for (let i = 0; i < this.numQuestions; i++) {
      let randomIndex = Math.floor(Math.random() * this.#question_bank.length);
      questions.push(this.#question_bank[randomIndex]);
    }
    this.questionsIt = questions.entries();
  }

  next() {
    this.currentQuestion = this.questionsIt.next().value;
    this.#firstTime = true;
    return this.currentQuestion;
  }
  getWrongAnswerMessage() {
    let randomIndex = Math.floor(
      Math.random() * this.#wrong_answer_messages.length
    );
    return this.#wrong_answer_messages[randomIndex];
  }
  getRightAnswerMessage() {
    let randomIndex = Math.floor(
      Math.random() * this.#motivation_quotes.length
    );
    return this.#motivation_quotes[randomIndex];
  }

  checkAnswer(answer) {
    const check = parseInt(answer, 10) === parseInt(this.currentQuestion[1][1]);
    if (!check) {
      if (this.#firstTime) {
        this.mistakes++;
      }
      this.#firstTime = false;
    }
    return check;
  }

  start() {
    this.startTime = Date.now();
  }

  #msToString(millis) {
    return msToString(millis);
  }
  secsToString(secs) {
    return this.#msToString(1000 * secs);
  }

  expectedTimeToCompletion() {
    return this.numQuestions * 5;
  }

  getHighscore() {
    return this.levelHighscore;
  }

  hasWon() {
    return (
      this.elapsedMs < this.expectedTimeToCompletion() * 1000 &&
      1 - this.mistakes / this.numQuestions > 0.9
    );
  }

  end() {
    const millis = Date.now() - this.startTime;
    this.elapsedMs = millis;
    this.elapsedTime = this.#msToString(millis);
    let highscore = localStorage.getItem("highscore");
    if (highscore == null) {
      highscore = {};
    } else {
      highscore = JSON.parse(highscore);
    }
    let levelHighscore = [];
    let jsonLevelHighscore = highscore[this.numQuestions];
    if (jsonLevelHighscore != null) {
      jsonLevelHighscore.forEach((element) => {
        levelHighscore.push(Object.assign(new Score(), element));
      });
    }
    levelHighscore.push(
      new Score(this.name, this.elapsedMs, this.numQuestions, this.mistakes)
    );
    highscore[this.numQuestions] = levelHighscore;
    localStorage.setItem("highscore", JSON.stringify(highscore));
    this.levelHighscore = levelHighscore;
  }
}

class Score {
  constructor(name, elapsedMs, numQuestions, mistakes) {
    this.name = name;
    this.elapsedMs = elapsedMs;
    this.numQuestions = numQuestions;
    this.mistakes = mistakes;

    this.timestamp = Date.now();
    this.valueOf = this.#valueOf;
    this.elapsed = msToString(this.elapsedMs);
  }

  #valueOf() {
    const spq = this.elapsedMs / 1000 / this.numQuestions;
    const success = 1 - this.mistakes / this.numQuestions;
    return ((this.numQuestions * 100) / spq) * success;
  }

  when() {
    const date = new Date(this.timestamp)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    
    return formattedDate;
  }
}
