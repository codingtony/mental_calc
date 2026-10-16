export interface QuestionConfig {
  maxAdd1: number;
  maxAdd2: number;
  maxSub1: number;
  maxSub2: number;
  maxMulDiv1: number;
  maxMulDiv2: number;
  mode: number;
}

export interface ModeFlags {
  includeAdd: boolean;
  includeSub: boolean;
  includeMult: boolean;
  includeDiv: boolean;
}

export interface Question {
  text: string;
  answer: number;
}

/** Default operand ranges and mode, ported from game.js Game constructor defaults. */
export const defaultQuestionConfig: QuestionConfig = {
  maxAdd1: 10,
  maxAdd2: 10,
  maxSub1: 20,
  maxSub2: 20,
  maxMulDiv1: 10,
  maxMulDiv2: 10,
  mode: 3,
};

/** Bitmask decode ported from game.js Game.initGame (mode & 1/2/4/8). */
export function parseMode(mode: number): ModeFlags {
  return {
    includeAdd: (mode & 1) === 1,
    includeSub: (mode & 2) === 2,
    includeMult: (mode & 4) === 4,
    includeDiv: (mode & 8) === 8,
  };
}

/**
 * Builds the full question bank for the given config.
 * Ported 1:1 from game.js Game.initGame's question-bank construction loops.
 */
export function generateQuestionBank(config: QuestionConfig): Question[] {
  const { includeAdd, includeSub, includeMult, includeDiv } = parseMode(config.mode);
  const bank: Question[] = [];

  if (includeAdd) {
    for (let i = 1; i <= config.maxAdd1; i++) {
      for (let j = i; j <= config.maxAdd2; j++) {
        const a = i + j;
        bank.push({ text: `${i} + ${j}`, answer: a });
        if (j !== i) {
          bank.push({ text: `${j} + ${i}`, answer: a });
        }
      }
    }
  }

  if (includeSub) {
    for (let i = 1; i <= config.maxSub1; i++) {
      for (let j = i + 1; j <= config.maxSub2; j++) {
        const a1 = j - i;
        bank.push({ text: `${j} - ${i}`, answer: a1 });
      }
    }
  }

  if (includeMult || includeDiv) {
    for (let i = 2; i <= config.maxMulDiv1; i++) {
      for (let j = i; j <= config.maxMulDiv2; j++) {
        const m = i * j;

        if (includeDiv) {
          bank.push({ text: `${m} / ${i}`, answer: m / i });
        }
        if (includeMult) {
          bank.push({ text: `${i} x ${j}`, answer: i * j });
        }

        if (i !== j) {
          if (includeDiv) {
            bank.push({ text: `${m} / ${j}`, answer: m / j });
          }
          if (includeMult) {
            bank.push({ text: `${j} x ${i}`, answer: j * i });
          }
        }
      }
    }
  }

  return bank;
}

/**
 * Picks numQuestions random questions from the bank, with replacement.
 * Ported from game.js Game.initGame's random-pick loop; `rng` (e.g. mulberry32(seed)) replaces
 * Math.random so every player of a multiplayer race gets the same sequence.
 */
export function pickQuestions(bank: Question[], numQuestions: number, rng: () => number): Question[] {
  const questions: Question[] = [];
  for (let i = 0; i < numQuestions; i++) {
    const randomIndex = Math.floor(rng() * bank.length);
    questions.push(bank[randomIndex]);
  }
  return questions;
}
