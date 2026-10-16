import type { Question } from "./questions";
import { CREEP_CAP, MAX_ERRORS } from "./config";

export type RaceStatus = "countdown" | "running" | "finished" | "crashed";
export type SubmitResult = "ignored" | "correct" | "wrong" | "finished" | "crashed";

export interface RivalSpec {
  name: string;
  color: readonly number[];
  paceFactor: number;
}

/**
 * Race rules, independent of rendering. Progress is measured in questions:
 * rivals drive at a constant pace (paceFactor × timePerQuestion seconds per question),
 * the player advances one unit per correct answer and creeps forward at goal pace in between.
 * All times are caller-supplied milliseconds (performance.now()).
 */
export class RaceSession {
  readonly numQuestions: number;
  readonly timePerQuestion: number;
  readonly goalMs: number;
  status: RaceStatus = "countdown";
  answered = 0;
  errors = 0;

  private readonly questions: Question[];
  private readonly rivals: readonly RivalSpec[];
  private startMs = 0;
  private lastAnswerElapsed = 0;
  private endElapsed = 0;
  private crashProgress = 0;

  constructor(questions: Question[], timePerQuestion: number, rivals: readonly RivalSpec[]) {
    this.questions = questions;
    this.rivals = rivals;
    this.numQuestions = questions.length;
    this.timePerQuestion = timePerQuestion;
    this.goalMs = this.numQuestions * timePerQuestion * 1000;
  }

  start(nowMs: number): void {
    this.status = "running";
    this.startMs = nowMs;
    this.lastAnswerElapsed = 0;
  }

  currentQuestion(): Question | undefined {
    return this.questions[this.answered];
  }

  submit(raw: string, nowMs: number): SubmitResult {
    if (this.status !== "running") return "ignored";
    const digits = raw.replace(/\D/g, "");
    if (digits === "") return "ignored";
    const elapsed = this.elapsedMs(nowMs);
    if (parseInt(digits, 10) === this.currentQuestion()!.answer) {
      this.answered++;
      this.lastAnswerElapsed = elapsed;
      if (this.answered === this.numQuestions) {
        this.status = "finished";
        this.endElapsed = elapsed;
        return "finished";
      }
      return "correct";
    }
    this.errors++;
    if (this.errors > MAX_ERRORS) {
      this.crashProgress = this.playerProgress(nowMs);
      this.status = "crashed";
      this.endElapsed = elapsed;
      return "crashed";
    }
    return "wrong";
  }

  elapsedMs(nowMs: number): number {
    switch (this.status) {
      case "countdown":
        return 0;
      case "running":
        return nowMs - this.startMs;
      default:
        return this.endElapsed;
    }
  }

  playerProgress(nowMs: number): number {
    switch (this.status) {
      case "countdown":
        return 0;
      case "running": {
        const thinking = (this.elapsedMs(nowMs) - this.lastAnswerElapsed) / (this.timePerQuestion * 1000);
        return this.answered + Math.min(thinking, CREEP_CAP);
      }
      case "finished":
        return this.numQuestions;
      case "crashed":
        return this.crashProgress;
    }
  }

  /** Raw clock, never frozen or clamped: rivals keep driving after the player finishes or crashes. */
  rivalProgress(i: number, nowMs: number): number {
    if (this.status === "countdown") return 0;
    return (nowMs - this.startMs) / (this.timePerQuestion * 1000 * this.rivals[i].paceFactor);
  }

  /** 1-based; ties go to the player. */
  livePosition(nowMs: number): number {
    const player = this.playerProgress(nowMs);
    let ahead = 0;
    for (let i = 0; i < this.rivals.length; i++) {
      if (this.rivalProgress(i, nowMs) > player) ahead++;
    }
    return 1 + ahead;
  }

  finalPosition(): number | null {
    if (this.status !== "finished") return null;
    const ahead = this.rivals.filter((r) => this.goalMs * r.paceFactor < this.endElapsed).length;
    return 1 + ahead;
  }

  won(): boolean {
    return this.status === "finished" && this.endElapsed <= this.goalMs;
  }
}
