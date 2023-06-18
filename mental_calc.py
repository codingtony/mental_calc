from datetime import datetime
import random, os, sys


# The function and the class taken from https://stackoverflow.com/a/73917459/576794
def color_text(text, rgb):
    r, g, b = rgb
    return f"\033[38;2;{r};{g};{b}m{text}\033[0m"


class rgb:
    RED = (255, 0, 0)
    GREEN = (0, 255, 0)
    YELLOW = (255, 255, 0)
    WHITE = (255, 255, 255)


os.system("cls" if os.name == "nt" else "echo -e \\\\033c")

number_questions = 25
if len(sys.argv) > 1:
    number_questions = int(sys.argv[1])

print(
    color_text("You will have to answer ", rgb.WHITE)
    + color_text(f"{number_questions} questions\n", rgb.YELLOW)
)
motivation_quotes = [
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
]

wrong_answer_messages = [
    "Oops, that's not quite right.",
    "Not quite, but keep trying!",
    "Almost there, but not quite.",
    "That's not the correct answer, but don't give up!",
    "Sorry, that's incorrect. Try again!",
]

question_bank = []
# Generate all the possibilities for addition and substractions during
# manual additions and substractions (excluding when answer is 0)
# or when one of the operand is zero
for i in range(0, 10):
    for j in range(1, 10):
        if i != 0:  # generate the addition
            o = f"{j} + {i}"
            question_bank.append((o, j + i))
        if i == j:  # zero
            continue
        if i > j and i != 0:
            o = f"{i} - {j}"
            question_bank.append((o, i - j))
        else:
            o = f"{i+10} - {j}"
            question_bank.append((o, i + 10 - j))

start = datetime.now()

mistakes = 0

for i in range(0, number_questions):
    q = random.choice(question_bank)
    new_question = True
    while True:
        a = input(color_text(f"{q[0]} = ", rgb.WHITE))
        success = True
        try:
            if q[1] == int(a):
                print(color_text(random.choice(motivation_quotes) + "\n", rgb.WHITE))
                break
            else:
                success = False
        except:
            success = False

        if not success:
            if new_question:
                mistakes += 1
            print(color_text(random.choice(wrong_answer_messages) + "\n", rgb.RED))
        new_question = False

duration = int(round((datetime.now() - start).total_seconds()))
print(
    color_text(f"You completed the game in ", rgb.WHITE)
    + color_text(f"{duration} seconds", rgb.YELLOW)
)
print(
    color_text(f"Number of mistakes: ", rgb.WHITE)
    + color_text(f"{mistakes}\n", rgb.YELLOW)
)

if mistakes / number_questions > 0.1 or duration / number_questions > 5:
    print(color_text("You should practice more!\n", rgb.RED))
else:
    print(color_text("You scored well! Congratulations!\n", rgb.GREEN))
