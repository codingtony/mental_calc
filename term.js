function colorText(r, g, b) {
  return (text, reset = true) => {
    str = `\x1B[38;2;${r};${g};${b}m${text}`;
    if (reset) {
      str += "\x1B[0m";
    }
    return str;
  };
}

WHITE = colorText(255, 255, 255);
GREEN = colorText(0, 255, 0);
YELLOW = colorText(255, 255, 0);
RED = colorText(255, 0, 0);
RETURN = "\r\n";

function initTerm(controller) {
  var term = new Terminal();
  const termDiv = document.getElementById("terminal-div");
  termDiv.innerHTML = "";

  term.open(termDiv);
  term.focus();

  function handleTerminal(controller) {
    var buffer = [];
    return (data) => {
      for (let i = 0; i < data.length; ++i) {
        const c = data[i];
        if (c === "\r") {
          term.write(RETURN);
          let answer = buffer.join("");
          answer = answer.replace(/\D/g, "");
          if (answer.length != 0) {
            controller.data(answer);
          }
          buffer = [];
          term.write(controller.prompt());
        } else if (c === "\x7F") {
          if (buffer.length > 0) {
            term.write("\b \b");
            buffer.pop();
          }
        } else {
          term.write(c);
          buffer.push(c);
        }
      }
    };
  }

  term.onData(handleTerminal(controller));
  term.write(controller.initPrompt());
}

class Controller {
  constructor(game, completionCallback) {
    this.#game = game;
    this.#started = false;
    this.#completionCallback = completionCallback;
    this.#nextQuestion = this.#game.next();
    this.#nextPrompt = WHITE(this.#nextQuestion[1][0] + " = ");
  }
  #quetions = [];
  #game = null;
  #started = false;
  #nextQuestion = null;
  #nextPrompt = null;
  #completionCallback = null;

  initPrompt() {
    return (
      WHITE("You will have to answer ") +
      YELLOW(this.#game.numQuestions) +
      WHITE(" questions.") +
      RETURN +
      WHITE("To win you will have to answer all questions under ") +
      YELLOW(this.#game.secsToString(this.#game.expectedTimeToCompletion())) +
      WHITE(".") +
      RETURN +
      WHITE("Press RETURN to start.")
    );
  }
  prompt() {
    return this.#nextPrompt;
  }

  data(answer) {
    
    if (!this.#started) {
      this.#started = true;
      this.#game.start();
    } else {
      if (!this.#game.checkAnswer(answer)) {
        this.#nextPrompt =
          RED(this.#game.getWrongAnswerMessage()) +
          RETURN +
          WHITE(this.#nextQuestion[1][0] + " = ");
      } else {
        this.#nextQuestion = this.#game.next();
        if (this.#nextQuestion === undefined) {
          this.#game.end();
          this.#completionCallback();
        } else {
          this.#nextPrompt =
            WHITE(this.#game.getRightAnswerMessage()) +
            RETURN +
            WHITE(this.#nextQuestion[1][0] + " = ");
        }
      }
    }
  }
}
