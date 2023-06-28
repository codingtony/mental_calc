var term = new Terminal();
term.open(document.getElementById("terminal"));

function colorText(r, g, b) {
  return (text,reset=true) => {
    str=`\x1B[38;2;${r};${g};${b}m${text}`;
    if (reset) {
        str+='\x1B[0m'
    }
    return str
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

const controller = {
    initPrompt: () => {
        return WHITE("What's your name ? ")+YELLOW("",false)
    },
    prompt: () => {
       return GREEN("1 + 1 =") + " ";
    },
    data: (data) => {
      console.log(data.join(""));
    },
  }

term.onData(handleTerminal(controller));
term.write(controller.initPrompt())