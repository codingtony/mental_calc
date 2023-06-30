function initTerm(controller) {
  var term = new Terminal();
  term.open(document.getElementById("terminal-div"));

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

  function handleTerminal(controller) {
    var buffer = [];
    return (data) => {
      for (let i = 0; i < data.length; ++i) {
        const c = data[i];
        if (c === "\r") {
          term.write("\r\n");
          controller.data(buffer);
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
  constructor(game) {
    this.#game = game
    console.log(game)
    this.started=false
    this.nextQuestion=null
  }
  #quetions = []
  #game = null

  initPrompt() {
    return WHITE(
      `You will have to answer ${this.#game.numQuestions} questions press enter to start`
    );
  }
  prompt() {
    return GREEN() + this.nextQuestion;
  }
  data(data) {
    if (!this.started) {

      this.started=true
      this.nextQuestion=this.#game.next()
      console.log("here "+this.nextQuestion)
    }
    console.log(data.join(""));
  }
}