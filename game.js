class Game {
  constructor(name, numQuestions = 50) {
    this.name = name;
    this.numQuestions = numQuestions;
    this.initGame();
  }
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
    this.questionsIt=questions.entries()
  }

  next() {
    return this.questionsIt.next()
  }


  start() {
    this.startTime = Date.now();
  }
  end() {
    const millis = Date.now() - this.startTime;
    const minutes = Math.floor(millis / 60000);
    const seconds = ((millis % 60000) / 1000).toFixed(0);
    this.elapsedMs = millis;
    this.elapsedTime = minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }
}
