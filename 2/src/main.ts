import "./style.css";
import { Engine } from "@babylonjs/core";
import { GameAudio } from "./audio";
import {
  CUPS,
  DIFFICULTIES,
  PLAYER_COLOR,
  RIVALS,
  TARGET_SPEED,
  type Category,
  type Cup,
  type Difficulty,
} from "./config";
import { fmtTime, ordinal, pick, setLang, t, type Lang } from "./i18n";
import { defaultQuestionConfig, generateQuestionBank, pickQuestions } from "./questions";
import { RaceSession } from "./race";
import { addGame, computeScore, loadPrefs, savePrefs } from "./storage";
import {
  el,
  formatQuestion,
  renderAudioToggles,
  renderBoard,
  renderCups,
  renderIntroTitle,
  renderResults,
  renderSetup,
  renderStandings,
  restartAnimation,
  showOnly,
  type BoardKind,
  type StandingEntry,
} from "./ui";
import { World } from "./world";

declare global {
  interface Window {
    /** Dev-only console/automation hook (see bottom of file). */
    __mc?: unknown;
  }
}

type Screen = "intro" | "setup" | "cups" | "race" | "results";

const INTRO_MS = 4500;
const COUNTDOWN_STEP_MS = 1000;
const FINISH_TO_RESULTS_MS = 3000;
const CRASH_TO_RESULTS_MS = 2500;

const canvas = el<HTMLCanvasElement>("renderCanvas");
const engine = new Engine(canvas, true, { stencil: false });
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
const world = new World(engine);
const audio = new GameAudio();

const prefs = loadPrefs();
audio.setMusic(prefs.music);
audio.setSound(prefs.sound);

const answerEl = el<HTMLInputElement>("answer");
const nameEl = el<HTMLInputElement>("name");

let screen: Screen = "intro";
let session: RaceSession | null = null;
let cup: Cup = CUPS[0];
// Config of the current race; prefs may change afterwards but results/high scores refer to this.
let raceConfig: { category: Category; difficulty: Difficulty } = { category: prefs.category, difficulty: prefs.difficulty };
let perQuestion = 0;
let laps = 1;
let timers: number[] = [];
let board: BoardKind = "last";
let freshTimestamp = 0;
// HUD values last written, so the DOM is only touched on change.
let hudPosition = 0;
let hudText = "";
let standingsKey = "";
let lastPlayerDistance = 0;

function later(ms: number, fn: () => void): void {
  timers.push(window.setTimeout(fn, ms));
}

function clearTimers(): void {
  timers.forEach((id) => window.clearTimeout(id));
  timers = [];
}

// ---------- Audio unlock (browsers only allow audio after a user gesture) ----------

const unlockAudio = () => audio.unlock();
document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("keydown", unlockAudio, { once: true });

// ---------- Intro ----------

function showIntro(): void {
  screen = "intro";
  renderIntroTitle();
  showOnly("screen-intro");
  world.setMode("intro", performance.now());
  later(INTRO_MS, showSetup);
  const skip = () => {
    if (screen === "intro") showSetup();
  };
  document.addEventListener("pointerdown", skip, { once: true });
  document.addEventListener("keydown", skip, { once: true });
}

// ---------- Setup ----------

function showSetup(): void {
  clearTimers();
  screen = "setup";
  showOnly("screen-setup");
  world.setMode("menu", performance.now());
  nameEl.value = prefs.name;
  el("name-error").textContent = "";
  renderSetup(prefs);
}

document.querySelectorAll<HTMLButtonElement>(".flag").forEach((b) =>
  b.addEventListener("click", () => {
    prefs.lang = b.dataset.lang as Lang;
    savePrefs(prefs);
    setLang(prefs.lang);
    renderSetup(prefs);
    if (el("name-error").textContent) el("name-error").textContent = t("nameRequired");
  }),
);

document.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((b) =>
  b.addEventListener("click", () => {
    prefs.category = Number(b.dataset.category) as Category;
    savePrefs(prefs);
    renderSetup(prefs);
  }),
);

document.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach((b) =>
  b.addEventListener("click", () => {
    prefs.difficulty = b.dataset.difficulty as Difficulty;
    savePrefs(prefs);
    renderSetup(prefs);
  }),
);

function toggleMusic(): void {
  prefs.music = !prefs.music;
  savePrefs(prefs);
  audio.setMusic(prefs.music);
  renderAudioToggles(prefs);
}

function toggleSound(): void {
  prefs.sound = !prefs.sound;
  savePrefs(prefs);
  audio.setSound(prefs.sound);
  renderAudioToggles(prefs);
}

el("toggle-music").addEventListener("click", toggleMusic);
el("toggle-sound").addEventListener("click", toggleSound);
el("hud-music").addEventListener("click", () => {
  toggleMusic();
  answerEl.focus();
});
el("hud-sound").addEventListener("click", () => {
  toggleSound();
  answerEl.focus();
});

function submitSetup(): void {
  const name = nameEl.value.trim();
  if (name === "") {
    el("name-error").textContent = t("nameRequired");
    nameEl.focus();
    return;
  }
  prefs.name = name;
  savePrefs(prefs);
  showCups();
}

el("next-btn").addEventListener("click", submitSetup);
nameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitSetup();
});

// ---------- Cups ----------

function showCups(): void {
  clearTimers();
  screen = "cups";
  showOnly("screen-cups");
  world.setMode("menu", performance.now());
  renderCups(prefs);
}

document.querySelectorAll<HTMLButtonElement>("[data-cup]").forEach((b) =>
  b.addEventListener("click", () => startRace(CUPS.find((c) => c.id === b.dataset.cup)!)),
);
el("cups-back").addEventListener("click", showSetup);

// ---------- Race ----------

function startRace(selected: Cup): void {
  clearTimers();
  cup = selected;
  raceConfig = { category: prefs.category, difficulty: prefs.difficulty };
  const timePerQuestion = DIFFICULTIES[raceConfig.difficulty];
  const bank = generateQuestionBank({ ...defaultQuestionConfig, mode: cup.mode });
  session = new RaceSession(pickQuestions(bank, raceConfig.category), timePerQuestion, RIVALS);

  const goalSeconds = session.goalMs / 1000;
  laps = Math.max(1, Math.round((goalSeconds * TARGET_SPEED) / world.track.length));
  const totalDistance = laps * world.track.length;
  perQuestion = totalDistance / session.numQuestions;
  world.setupRace(totalDistance);
  world.setMode("race", performance.now());

  screen = "race";
  hudPosition = 0;
  hudText = "";
  standingsKey = "";
  lastPlayerDistance = 0;
  showOnly("hud", "countdown");
  el("lives")
    .querySelectorAll("span")
    .forEach((s) => s.classList.remove("lost"));
  el("question-text").textContent = "";
  el("question").classList.remove("hidden");
  el("toast").className = "";
  answerEl.value = "";
  answerEl.disabled = true;
  el("goal-time").textContent = t("goal", { t: fmtTime(session.goalMs) });
  updateHud(performance.now());

  const lights = el("countdown").querySelectorAll("span");
  lights.forEach((l) => (l.className = ""));
  el("countdown-hint").classList.remove("hidden");
  const countdownText = el("countdown-text");
  countdownText.textContent = "";
  ["3", "2", "1"].forEach((label, i) =>
    later(i * COUNTDOWN_STEP_MS, () => {
      lights[i].className = "red";
      countdownText.textContent = label;
      restartAnimation(countdownText, "pop");
      audio.beep(false);
    }),
  );
  later(3 * COUNTDOWN_STEP_MS, () => {
    lights.forEach((l) => (l.className = "green"));
    countdownText.textContent = t("go");
    restartAnimation(countdownText, "pop");
    el("countdown-hint").classList.add("hidden");
    audio.beep(true);
    session!.start(performance.now());
    answerEl.disabled = false;
    answerEl.focus();
    showQuestion();
    audio.engine(true, 1);
  });
  later(3 * COUNTDOWN_STEP_MS + 800, () => el("countdown").classList.add("hidden"));
}

function showQuestion(): void {
  el("question-text").textContent = formatQuestion(session!.currentQuestion()!.text);
}

function toast(text: string, kind: "good" | "bad"): void {
  const toastEl = el("toast");
  toastEl.textContent = text;
  toastEl.className = "";
  restartAnimation(toastEl, kind);
}

function submitAnswer(value: string): void {
  if (!session) return;
  const now = performance.now();
  const result = session.submit(value, now);
  if (result === "ignored") return;
  answerEl.value = "";
  const hearts = el("lives").querySelectorAll("span");
  switch (result) {
    case "correct":
      world.boost();
      audio.correct();
      toast(pick("right"), "good");
      showQuestion();
      break;
    case "wrong":
      world.spin();
      audio.wrong();
      toast(pick("wrong"), "bad");
      restartAnimation(el("question"), "shake");
      hearts.forEach((h, i) => h.classList.toggle("lost", i >= hearts.length - session!.errors));
      break;
    case "finished":
      world.boost();
      audio.finish();
      endRace(now, "finish", FINISH_TO_RESULTS_MS);
      break;
    case "crashed":
      hearts.forEach((h) => h.classList.add("lost"));
      world.crash();
      audio.crash();
      endRace(now, "crash", CRASH_TO_RESULTS_MS);
      break;
  }
}

function endRace(now: number, kind: "finish" | "crash", resultsDelayMs: number): void {
  const s = session!;
  audio.engine(false);
  answerEl.disabled = true;
  answerEl.blur();
  el("question").classList.add("hidden");
  updateHud(now);
  const banner = el("banner");
  banner.textContent = t(kind);
  banner.className = kind;
  world.setMode(kind, now);

  const elapsedMs = s.elapsedMs(now);
  const crashed = s.status === "crashed";
  freshTimestamp = Date.now();
  addGame({
    name: prefs.name,
    category: raceConfig.category,
    cup: cup.id,
    difficulty: raceConfig.difficulty,
    timePerQuestion: s.timePerQuestion,
    elapsedMs,
    answered: s.answered,
    errors: s.errors,
    position: s.finalPosition(),
    crashed,
    won: s.won(),
    score: crashed ? 0 : computeScore(s.numQuestions, elapsedMs, s.errors),
    timestamp: freshTimestamp,
  });
  later(resultsDelayMs, () => showResults(s, elapsedMs));
}

function quitRace(): void {
  clearTimers();
  audio.engine(false);
  session = null;
  showCups();
}

answerEl.addEventListener("input", () => {
  answerEl.value = answerEl.value.replace(/\D/g, "");
});
answerEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAnswer(answerEl.value);
});
// Keep the (mobile) keyboard open: don't let the OK button steal focus.
el("answer-ok").addEventListener("pointerdown", (e) => e.preventDefault());
el("answer-ok").addEventListener("click", () => submitAnswer(answerEl.value));
el("quit-btn").addEventListener("click", quitRace);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && screen === "race") quitRace();
});

const RIVAL_COLORS = RIVALS.map((r) => rgbCss(r.color));
const PLAYER_CSS = rgbCss(PLAYER_COLOR);

function rgbCss(c: readonly number[]): string {
  return `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
}

function updateHud(now: number): void {
  const s = session!;
  const playerProgress = s.playerProgress(now);
  const rivals = RIVALS.map((_, i) => s.rivalProgress(i, now));

  if (s.status === "running" || s.status === "countdown") {
    const position = s.livePosition(now);
    if (position !== hudPosition) {
      const positionEl = el("position");
      positionEl.innerHTML = `${ordinal(position)}<small>/8</small>`;
      if (hudPosition !== 0 && s.status === "running") {
        restartAnimation(positionEl, position < hudPosition ? "up" : "down");
        if (position < hudPosition) audio.overtake();
        else audio.overtaken();
      }
      hudPosition = position;
    }
    const entries: StandingEntry[] = [
      { name: prefs.name, color: PLAYER_CSS, progress: playerProgress, me: true },
      ...RIVALS.map((r, i) => ({ name: r.name, color: RIVAL_COLORS[i], progress: rivals[i], me: false })),
    ];
    standingsKey = renderStandings(entries, standingsKey);
  }

  const lap = Math.min(laps, Math.floor(world.playerDistance() / world.track.length) + 1);
  const text = [
    fmtTime(s.elapsedMs(now)),
    t("lap", { x: Math.max(1, lap), y: laps }),
    t("question", { x: Math.min(s.answered + 1, s.numQuestions), y: s.numQuestions }),
  ];
  const joined = text.join("\n");
  if (joined !== hudText) {
    el("timer").textContent = text[0];
    el("lap").textContent = text[1];
    el("qcount").textContent = text[2];
    hudText = joined;
  }
}

// ---------- Results ----------

function showResults(s: RaceSession, elapsedMs: number): void {
  clearTimers();
  screen = "results";
  showOnly("screen-results");
  world.setMode("menu", performance.now());
  renderResults({
    won: s.won(),
    crashed: s.status === "crashed",
    position: s.finalPosition(),
    elapsedMs,
    goalMs: s.goalMs,
    errors: s.errors,
    answered: s.answered,
    numQuestions: s.numQuestions,
  });
  board = "last";
  renderBoard(board, { ...raceConfig, cup: cup.id }, freshTimestamp);
  session = null;
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    board = b.dataset.board as BoardKind;
    renderBoard(board, { ...raceConfig, cup: cup.id }, freshTimestamp);
  }),
);
el("again-btn").addEventListener("click", () => startRace(cup));
el("cups-btn").addEventListener("click", showCups);
el("menu-btn").addEventListener("click", showSetup);

// ---------- Render loop ----------

engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = engine.getDeltaTime() / 1000;
  const racing = screen === "race" && session !== null;
  world.update(
    dt,
    now,
    racing
      ? {
          player: session!.playerProgress(now),
          rivals: RIVALS.map((_, i) => session!.rivalProgress(i, now)),
          perQuestion,
        }
      : null,
  );
  if (racing) {
    updateHud(now);
    if (session!.status === "running" && dt > 0) {
      const distance = world.playerDistance();
      const goalSpeed = perQuestion / session!.timePerQuestion;
      audio.engine(true, Math.min(2, Math.max(0, (distance - lastPlayerDistance) / dt / goalSpeed)));
      lastPlayerDistance = distance;
    }
  }
  world.render();
});
window.addEventListener("resize", () => engine.resize());

if (import.meta.env.DEV) {
  // Dev-only hook for console/automated verification; routes through the real submit path.
  window.__mc = {
    session: () => session,
    solve: () => submitAnswer(String(session!.currentQuestion()!.answer)),
    fail: () => submitAnswer("99999"),
  };
}

setLang(prefs.lang);
showIntro();
