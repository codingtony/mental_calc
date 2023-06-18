from datetime import datetime
import random,os
os.system('cls' if os.name == 'nt' else 'echo -e \\\\033c')

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
    "You've got this!"
]

wrong_answer_messages = [
    "Oops, that's not quite right.",
    "Not quite, but keep trying!",
    "Almost there, but not quite.",
    "That's not the correct answer, but don't give up!",
    "Sorry, that's incorrect. Try again!"
]

question_bank=[]
# Generate all the possibilities for addition and substractions during 
# manual additions and substractions (excluding when answer is 0)
# or when one of the operand is zero
for i in range(0,10):
    for j in range(1,10):
        if (i != 0): # generate the addition
            o=f"{j} + {i}"
            question_bank.append((o,j+i))
        if i == j: # zero
            continue
        if i > j and i != 0:
            o=f"{i} - {j}"
            question_bank.append((o,i-j))
        else:
            o=f"{i+10} - {j}"
            question_bank.append((o,i+10-j))

start = datetime.now()
number_questions=25

for i in range(0,number_questions):
    q=random.choice(question_bank)
    while True:
        a=input(f"{q[0]} = ")
        try:
            if (q[1] == int(a)):
                print(random.choice(motivation_quotes)+'\n')
                break
            else:
                print(random.choice(wrong_answer_messages)+'\n')
        except:
            print(random.choice(wrong_answer_messages)+'\n')
         
duration=int(round((datetime.now() - start).total_seconds()))
print(f"\nCongratulations!\nYou completed the test in {duration} seconds")
