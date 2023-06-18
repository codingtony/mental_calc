import pickle,datetime

class Score:
    def __init__(self,name,seconds, number_questions,mistakes):
        self.name = name
        self.seconds=seconds
        self.number_questions=number_questions
        self.mistakes=mistakes
        self.time = datetime.datetime.now()
        

    def __lt__(self, other):
        return self.score()<other.score()

    def score(self):
        spq = self.seconds/self.number_questions
        success = 1 - (self.mistakes/self.number_questions)
        score = ((self.number_questions*100)/spq)*success
        return int(round(score,0))

class Highscore:
    def __init__(self):
        self.highscores = []  
    
    def add(self,score):
        self.highscores.append(score)
        self.highscores.sort(reverse=True)
    
    def save(self):
        with open('highscore.data', 'wb') as f:
            pickle.dump(self.highscores, f)
    def load(self):
        try:
            with open('highscore.data', 'rb') as f:
                self.highscores = pickle.load(f)
        except FileNotFoundError:
            pass
    def get(self):
        return self.highscores