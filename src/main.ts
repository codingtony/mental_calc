import "./style.css";
import { Engine } from "@babylonjs/core";
import QRCode from "qrcode";
import { GameAudio } from "./audio";
import {
  CUPS,
  DIFFICULTIES,
  PLAYER_COLOR,
  RIVALS,
  TARGET_SPEED,
  type Category,
  type Cup,
  type CupId,
  type Difficulty,
} from "./config";
import { fmtTime, mpErrorText, ordinal, pick, setLang, t, type Lang } from "./i18n";
import type { RankInfo, TopRow } from "./net/protocol";
import { COUNTDOWN_MS, HostRoom, PlayerRoom, type HostListener, type PlayerListener, type RaceStart } from "./net/room";
import { displayStatus, TOP_N } from "./net/standings";
import { defaultQuestionConfig, generateQuestionBank, pickQuestions } from "./questions";
import { RaceSession } from "./race";
import { mulberry32, randomSeed } from "./rng";
import { addGame, computeScore, cupById, loadPrefs, savePrefs } from "./storage";
import {
  attachScrollHint,
  el,
  formatQuestion,
  renderAudioToggles,
  renderBoard,
  renderCups,
  renderHostPlayers,
  renderHostSettings,
  renderIntroTitle,
  renderLanes,
  renderMenu,
  renderMpStandings,
  renderNames,
  renderPodium,
  renderResults,
  renderSetup,
  renderStandings,
  restartAnimation,
  showOnly,
  type BoardKind,
  type MpStandingRow,
  type StandingEntry,
} from "./ui";
import { World } from "./world";

declare global {
  interface Window {
    /** Dev-only console/automation hook (see bottom of file). */
    __mc?: unknown;
  }
}

type Screen = "intro" | "menu" | "setup" | "cups" | "race" | "results" | "join" | "wait" | "host";

const INTRO_MS = 4500;
const COUNTDOWN_STEP_MS = 1000;
const FINISH_TO_RESULTS_MS = 3000;
const CRASH_TO_RESULTS_MS = 2500;
const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const PROD_JOIN_URL = "https://maths.codingtony.com/";
/** Rival karts in multiplayer: the other players of the top 5. */
const MP_KART_SLOTS = TOP_N;

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
const joinCodeEl = el<HTMLInputElement>("join-code");
const joinNameEl = el<HTMLInputElement>("join-name");
const showAllEl = el<HTMLInputElement>("host-showall");
attachScrollHint(el("host-players"), el("host-players-less"), el("host-players-more"));
attachScrollHint(el("lanes"), el("lanes-less"), el("lanes-more"));

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

// Multiplayer: at most one of host/player is set.
let host: HostRoom | null = null;
let player: PlayerRoom | null = null;
let showAll = false;
let hostQrCode = "";
let hostTimerText = "";
/** This kid's own result, frozen when the race ended for them. */
let mpResult: { elapsedMs: number; errors: number; answered: number; numQuestions: number; goalMs: number; finished: boolean } | null = null;
/** Kart i+1 shows the player named kartSlots[i].name, eased from `shown` towards `target` (answers). */
let kartSlots: { name: string | null; target: number; shown: number }[] = [];

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
  later(INTRO_MS, showMenu);
  const skip = () => {
    if (screen === "intro") showMenu();
  };
  document.addEventListener("pointerdown", skip, { once: true });
  document.addEventListener("keydown", skip, { once: true });
}

// ---------- Menu ----------

function showMenu(): void {
  clearTimers();
  screen = "menu";
  showOnly("screen-menu");
  world.setMode("menu", performance.now());
  el("menu-error").textContent = "";
  renderMenu(prefs);
  el("mp-offline").classList.add("hidden");
}

el("solo-btn").addEventListener("click", showSetup);

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

el("setup-back").addEventListener("click", showMenu);

document.querySelectorAll<HTMLButtonElement>(".flag").forEach((b) =>
  b.addEventListener("click", () => {
    prefs.lang = b.dataset.lang as Lang;
    savePrefs(prefs);
    setLang(prefs.lang);
    renderMenu(prefs);
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

/** Lights 3-2-1 over `totalMs`, then GO. */
function runCountdown(totalMs: number, hint: boolean, onGo: () => void): void {
  const step = totalMs / 3;
  const lights = el("countdown").querySelectorAll("span");
  lights.forEach((l) => (l.className = ""));
  el("countdown-hint").classList.toggle("hidden", !hint);
  const countdownText = el("countdown-text");
  countdownText.textContent = "";
  ["3", "2", "1"].forEach((label, i) =>
    later(i * step, () => {
      lights[i].className = "red";
      countdownText.textContent = label;
      restartAnimation(countdownText, "pop");
      audio.beep(false);
    }),
  );
  later(3 * step, () => {
    lights.forEach((l) => (l.className = "green"));
    countdownText.textContent = t("go");
    restartAnimation(countdownText, "pop");
    el("countdown-hint").classList.add("hidden");
    audio.beep(true);
    onGo();
  });
  later(3 * step + 800, () => el("countdown").classList.add("hidden"));
}

/** Solo race against the AI rivals, or (`mp`) a multiplayer race on the room's seed and settings. */
function startRace(selected: Cup, mp: RaceStart | null = null): void {
  clearTimers();
  cup = selected;
  raceConfig = mp
    ? { category: mp.settings.n, difficulty: mp.settings.difficulty }
    : { category: prefs.category, difficulty: prefs.difficulty };
  const timePerQuestion = DIFFICULTIES[raceConfig.difficulty];
  const bank = generateQuestionBank({ ...defaultQuestionConfig, mode: cup.mode });
  const questions = pickQuestions(bank, raceConfig.category, mulberry32(mp ? mp.seed : randomSeed()));
  session = new RaceSession(questions, timePerQuestion, mp ? [] : RIVALS);
  // Multiplayer karts appear once the first standings tell who is in the top 5.
  world.setRivalSlots(mp ? [] : null);
  kartSlots = [];
  mpResult = null;

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
  el("position").textContent = "";
  el("standings").innerHTML = "";
  el("mp-me").classList.toggle("hidden", !mp);
  el("hud").classList.toggle("mp", mp !== null);
  answerEl.value = "";
  answerEl.disabled = true;
  el("goal-time").textContent = t("goal", { t: fmtTime(session.goalMs) });
  updateHud(performance.now());

  runCountdown(mp ? mp.countdownMs : 3 * COUNTDOWN_STEP_MS, !mp, () => {
    session!.start(performance.now());
    answerEl.disabled = false;
    answerEl.focus();
    showQuestion();
    audio.engine(true, 1);
  });
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
  if (player && result !== "wrong") {
    const s = session!;
    player.sendProgress(s.answered, s.status === "finished" || s.status === "crashed" ? s.status : "racing", s.elapsedMs(now));
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
  if (player) mpResult = mpResultOf(s, elapsedMs);
  else {
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
  }
  later(resultsDelayMs, () => showResults(s, elapsedMs));
}

/** Multiplayer games never touch the local high scores: the kid's result lives only here. */
function mpResultOf(s: RaceSession, elapsedMs: number): NonNullable<typeof mpResult> {
  return {
    elapsedMs,
    errors: s.errors,
    answered: s.answered,
    numQuestions: s.numQuestions,
    goalMs: s.goalMs,
    finished: s.status === "finished",
  };
}

/** The teacher ended the race before this kid finished: freeze the run and show the results. */
function stopMpRace(): void {
  const s = session!;
  audio.engine(false);
  answerEl.disabled = true;
  answerEl.blur();
  mpResult = mpResultOf(s, s.elapsedMs(performance.now()));
  showResults(s, mpResult.elapsedMs);
}

/** Drops any running race without results (rematch, kick, leaving the room). */
function abortRace(): void {
  clearTimers();
  audio.engine(false);
  answerEl.disabled = true;
  session = null;
  world.setRivalSlots(null);
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
el("quit-btn").addEventListener("click", () => (player ? leavePlayerRoom() : quitRace()));
document.addEventListener("keydown", (e) => {
  // Escape would silently drop a kid out of a multiplayer race: only the Quit button does that.
  if (e.key === "Escape" && screen === "race" && !player) quitRace();
});

const RIVAL_COLORS = RIVALS.map((r) => rgbCss(r.color));
const PLAYER_CSS = rgbCss(PLAYER_COLOR);

function rgbCss(c: readonly number[]): string {
  return `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
}

function updateHud(now: number): void {
  const s = session!;

  if (player) updateMpStandings(s);
  else if (s.status === "running" || s.status === "countdown") {
    const playerProgress = s.playerProgress(now);
    const rivals = RIVALS.map((_, i) => s.rivalProgress(i, now));
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
  const me = player?.standings?.me;
  const text = [
    fmtTime(s.elapsedMs(now)),
    t("lap", { x: Math.max(1, lap), y: laps }),
    t("question", { x: Math.min(s.answered + 1, s.numQuestions), y: s.numQuestions }),
    player
      ? t("mpYou", { done: s.answered, n: s.numQuestions, rank: me ? ordinal(me.rank) : "–", of: me ? me.of : "–" })
      : "",
  ];
  const joined = text.join("\n");
  if (joined !== hudText) {
    el("timer").textContent = text[0];
    el("lap").textContent = text[1];
    el("qcount").textContent = text[2];
    el("mp-me").textContent = text[3];
    hudText = joined;
  }
}

/** Multiplayer HUD: rank of N from the host's standings and the top 5 (plus this kid when outside it). */
function updateMpStandings(s: RaceSession): void {
  const standings = player!.standings;
  if (!standings) return;
  const { top, me } = standings;
  if (me.rank !== hudPosition) {
    const positionEl = el("position");
    positionEl.innerHTML = `${ordinal(me.rank)}<small>/${me.of}</small>`;
    if (hudPosition !== 0 && s.status === "running") {
      restartAnimation(positionEl, me.rank < hudPosition ? "up" : "down");
      if (me.rank < hudPosition) audio.overtake();
      else audio.overtaken();
    }
    hudPosition = me.rank;
  }
  const rows: MpStandingRow[] = top.map((r, i) => {
    const slot = kartSlots.findIndex((k) => k.name === r.name);
    return {
      rank: i + 1,
      name: r.name,
      status: r.status,
      me: i + 1 === me.rank,
      color: i + 1 === me.rank ? PLAYER_CSS : slot >= 0 ? RIVAL_COLORS[slot] : "#999",
    };
  });
  if (me.rank > top.length) rows.push({ rank: me.rank, name: player!.name, status: me.status, me: true, color: PLAYER_CSS });
  standingsKey = renderMpStandings(rows, standingsKey);
}

/**
 * Gives each other top-5 player a rival kart, keeping the same kart (and colour) for the same
 * player across updates. A player pushed out of the top 5 keeps its kart at its last known
 * progress until the slot is needed for someone else.
 */
function assignKartSlots(top: TopRow[], me: RankInfo): void {
  const want = Math.max(0, Math.min(MP_KART_SLOTS, me.of - 1));
  if (want !== kartSlots.length) {
    kartSlots = Array.from({ length: want }, (_, i) => kartSlots[i] ?? { name: null, target: 0, shown: 0 });
    world.setRivalSlots(RIVALS.slice(0, want).map((r) => r.color));
  }
  const others = top.filter((_, i) => i + 1 !== me.rank);
  const names = new Set(others.map((r) => r.name));
  for (const r of others) {
    let slot = kartSlots.find((k) => k.name === r.name);
    if (!slot) {
      slot = kartSlots.find((k) => k.name === null || !names.has(k.name));
      if (!slot) continue;
      slot.name = r.name;
      slot.shown = r.done;
    }
    slot.target = r.done;
  }
}

// ---------- Results ----------

function showResults(s: RaceSession | null, elapsedMs: number): void {
  clearTimers();
  screen = "results";
  showOnly("screen-results");
  world.setMode("menu", performance.now());
  world.setRivalSlots(null);
  const mp = player !== null;
  // Multiplayer games never touch the local high scores: no board, no solo buttons.
  document.querySelector(".tabs")!.classList.toggle("hidden", mp);
  el("board").parentElement!.classList.toggle("hidden", mp);
  for (const id of ["again-btn", "cups-btn", "menu-btn"]) el(id).classList.toggle("hidden", mp);
  el("mp-leave-btn").classList.toggle("hidden", !mp);
  el("mp-podium").classList.toggle("hidden", !mp);
  el("result-stats").classList.remove("hidden");
  if (s && !mp) {
    renderResults({
      title: t(s.won() ? "resultWon" : s.status === "crashed" ? "resultCrashed" : "resultLost"),
      position: s.finalPosition(),
      of: 8,
      elapsedMs,
      goalMs: s.goalMs,
      errors: s.errors,
      answered: s.answered,
      numQuestions: s.numQuestions,
      score: null,
    });
    board = "last";
    renderBoard(board, { ...raceConfig, cup: cup.id }, freshTimestamp);
  } else renderMpResults();
  session = null;
}

/**
 * Kid's results: podium from the final standings, or from the latest standings while the race
 * is still on ("Race in progress…", re-rendered on each update). `mpResult` is null for a kid
 * who reloaded mid-race and only spectates.
 */
function renderMpResults(): void {
  const p = player!;
  const data = p.final ?? p.standings;
  const title = t(p.final ? "mpFinalResults" : "mpRaceInProgress");
  renderPodium(el("mp-podium"), data?.top ?? [], p.start?.settings.n ?? p.settings?.n ?? raceConfig.category, data?.me.rank ?? null);
  if (mpResult) {
    const r = mpResult;
    renderResults({
      title,
      position: data ? data.me.rank : null,
      of: data ? data.me.of : 0,
      elapsedMs: r.elapsedMs,
      goalMs: r.goalMs,
      errors: r.errors,
      answered: r.answered,
      numQuestions: r.numQuestions,
      score: r.finished ? computeScore(r.numQuestions, r.elapsedMs, r.errors) : 0,
    });
  } else el("result-title").textContent = title;
  el("result-position").classList.toggle("hidden", !mpResult);
  el("result-stats").classList.toggle("hidden", !mpResult);
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    board = b.dataset.board as BoardKind;
    renderBoard(board, { ...raceConfig, cup: cup.id }, freshTimestamp);
  }),
);
el("again-btn").addEventListener("click", () => startRace(cup));
el("cups-btn").addEventListener("click", showCups);
el("menu-btn").addEventListener("click", showMenu);
el("mp-leave-btn").addEventListener("click", leavePlayerRoom);

// ---------- Multiplayer: join (kid) ----------

const offline = (online: boolean) => el("mp-offline").classList.toggle("hidden", online);

const playerListener: PlayerListener = {
  onMessage(msg) {
    const p = player;
    if (!p) return;
    switch (msg.t) {
      case "joined":
        if (screen !== "wait") break;
        // A reload mid-race rejoins as a spectator.
        if (p.phase === "lobby") renderWait();
        else showResults(null, 0);
        break;
      case "lobby":
        if (screen === "wait") renderWait();
        break;
      case "started":
        startRace(cupById(msg.settings.cup), p.start);
        break;
      case "standings":
        if (screen === "race") assignKartSlots(p.standings!.top, p.standings!.me);
        else if (screen === "results") renderMpResults();
        else if (screen === "wait") showResults(null, 0);
        break;
      case "ended":
        if (screen === "race" && session && (session.status === "running" || session.status === "countdown")) stopMpRace();
        else if (screen === "results") renderMpResults();
        else if (screen === "wait") showResults(null, 0);
        break;
      case "rematch":
        abortRace();
        showWait();
        break;
      case "kicked":
        player = null;
        abortRace();
        showJoin(p.code, t("mpKicked"));
        break;
    }
  },
  onError(reason, fatal) {
    if (!fatal) {
      console.warn("relay error", reason);
      return;
    }
    const code = player?.code ?? "";
    player = null;
    abortRace();
    showJoin(code, mpErrorText(reason));
  },
  onConnection: offline,
};

function showJoin(code: string, error = ""): void {
  clearTimers();
  screen = "join";
  showOnly("screen-join");
  world.setMode("menu", performance.now());
  el("mp-offline").classList.add("hidden");
  joinCodeEl.value = code;
  joinNameEl.value = prefs.name;
  el("join-error").textContent = error;
  (code ? joinNameEl : joinCodeEl).focus();
}

function submitJoin(): void {
  const code = joinCodeEl.value.trim().toUpperCase();
  const name = joinNameEl.value.trim();
  if (!ROOM_CODE.test(code)) {
    el("join-error").textContent = t("mpCodeInvalid");
    joinCodeEl.focus();
    return;
  }
  if (name === "") {
    el("join-error").textContent = t("nameRequired");
    joinNameEl.focus();
    return;
  }
  prefs.name = name;
  savePrefs(prefs);
  player = new PlayerRoom(code, name, playerListener);
  showWait();
}

function showWait(): void {
  clearTimers();
  screen = "wait";
  showOnly("screen-wait");
  world.setMode("menu", performance.now());
  renderWait();
}

function renderWait(): void {
  const p = player!;
  el("wait-code").textContent = p.code;
  el("wait-caption").textContent = t(p.phase === "joining" ? "mpConnecting" : "mpWaitingStart");
  renderNames(el("wait-names"), p.names, p.name);
}

function leavePlayerRoom(): void {
  player?.leave();
  player = null;
  abortRace();
  showMenu();
}

el("join-btn").addEventListener("click", () => showJoin(""));
el("join-go").addEventListener("click", submitJoin);
el("join-back").addEventListener("click", showMenu);
el("wait-leave").addEventListener("click", leavePlayerRoom);
joinCodeEl.addEventListener("input", () => {
  joinCodeEl.value = joinCodeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
for (const input of [joinCodeEl, joinNameEl]) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitJoin();
  });
}

// ---------- Multiplayer: host (teacher) ----------

const hostListener: HostListener = {
  onChange() {
    if (screen === "host") renderHost();
  },
  onError(reason, fatal) {
    if (!fatal) {
      console.warn("relay error", reason);
      return;
    }
    closeHostRoom();
    el("menu-error").textContent = mpErrorText(reason);
  },
  onConnection: offline,
};

function openHostRoom(): void {
  host = new HostRoom({ cup: cup.id, n: prefs.category, difficulty: prefs.difficulty }, hostListener);
  showHost();
}

function showHost(): void {
  clearTimers();
  screen = "host";
  showAll = false;
  showAllEl.checked = false;
  hostTimerText = "";
  showOnly("screen-host");
  world.setMode("menu", performance.now());
  renderHost();
}

function closeHostRoom(): void {
  host?.close();
  host = null;
  hostQrCode = "";
  showMenu();
}

function renderHost(): void {
  const h = host!;
  const lobby = h.phase === "lobby";
  el("host-lobby").classList.toggle("hidden", !lobby);
  el("host-board").classList.toggle("hidden", lobby);
  if (lobby) {
    el("host-code").textContent = h.code || "…";
    if (h.code && h.code !== hostQrCode) {
      const code = h.code;
      hostQrCode = code;
      const relay = new URLSearchParams(location.search).get("relay");
      // Dev: join this dev server (and its relay) from another device on the LAN.
      const url = import.meta.env.DEV
        ? `${location.origin}${location.pathname}?room=${code}${relay ? `&relay=${encodeURIComponent(relay)}` : ""}`
        : `${PROD_JOIN_URL}?room=${code}`;
      el("host-url").textContent = url;
      QRCode.toDataURL(url, { margin: 1, width: 440 }).then((src) => {
        if (hostQrCode === code) el<HTMLImageElement>("host-qr").src = src;
      });
    }
    renderHostSettings(h.settings);
    renderHostPlayers([...h.players.values()].sort((a, b) => a.order - b.order));
    el<HTMLButtonElement>("host-start").disabled = !h.joinable;
    return;
  }
  const { ranked, top } = h.standings;
  const ended = h.phase === "ended";
  el("host-room").textContent = h.code;
  el("host-counter").textContent = t("mpCounter", {
    f: ranked.filter((p) => p.status === "finished").length,
    c: ranked.filter((p) => p.status === "crashed").length,
    n: ranked.length,
  });
  el("host-podium").classList.toggle("hidden", !ended);
  if (ended) renderPodium(el("host-podium"), top, h.settings.n, null);
  renderLanes(
    el("lanes"),
    (showAll ? ranked : ranked.slice(0, TOP_N)).map((p, i) => ({
      id: p.id,
      rank: i + 1,
      name: p.name,
      done: p.done,
      status: displayStatus(p),
      ms: p.ms,
      color: `hsl(${(p.order * 137) % 360} 75% 50%)`,
    })),
    h.settings.n,
  );
  el("host-end").classList.toggle("hidden", ended);
  el("host-rematch").classList.toggle("hidden", !ended);
  el("host-close2").classList.toggle("hidden", !ended);
}

function updateHostTimer(): void {
  const h = host!;
  const text = h.phase === "lobby" ? "" : fmtTime(Math.max(0, (h.endAt || Date.now()) - h.goAt));
  if (text !== hostTimerText) el("host-timer").textContent = hostTimerText = text;
}

el("host-btn").addEventListener("click", openHostRoom);
el("host-close").addEventListener("click", closeHostRoom);
el("host-close2").addEventListener("click", closeHostRoom);
el("host-start").addEventListener("click", () => {
  if (!host?.joinable) return;
  host.start();
  showOnly("screen-host", "countdown");
  runCountdown(COUNTDOWN_MS, false, () => {});
});
el("host-end").addEventListener("click", () => host?.end());
el("host-rematch").addEventListener("click", () => host?.rematch());
showAllEl.addEventListener("change", () => {
  showAll = showAllEl.checked;
  renderHost();
});
el("host-players").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-kick]")?.dataset.kick;
  if (id) host?.kick(id);
});
document.querySelectorAll<HTMLButtonElement>("[data-host-cup]").forEach((b) =>
  b.addEventListener("click", () => host?.setSettings({ ...host.settings, cup: b.dataset.hostCup as CupId })),
);
document.querySelectorAll<HTMLButtonElement>("[data-host-n]").forEach((b) =>
  b.addEventListener("click", () => host?.setSettings({ ...host.settings, n: Number(b.dataset.hostN) as Category })),
);
document.querySelectorAll<HTMLButtonElement>("[data-host-difficulty]").forEach((b) =>
  b.addEventListener("click", () =>
    host?.setSettings({ ...host.settings, difficulty: b.dataset.hostDifficulty as Difficulty }),
  ),
);

// ---------- Render loop ----------

/** Eases each multiplayer rival kart towards its player's last reported answer count. */
function mpRivalProgress(dt: number): number[] {
  const k = 1 - Math.exp(-dt * 3);
  for (const slot of kartSlots) slot.shown += (slot.target - slot.shown) * k;
  return kartSlots.map((slot) => slot.shown);
}

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
          rivals: player ? mpRivalProgress(dt) : RIVALS.map((_, i) => session!.rivalProgress(i, now)),
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
  if (screen === "host" && host) updateHostTimer();
  world.render();
});
window.addEventListener("resize", () => engine.resize());

if (import.meta.env.DEV) {
  // Dev-only hook for console/automated verification; routes through the real submit path.
  window.__mc = {
    session: () => session,
    solve: () => submitAnswer(String(session!.currentQuestion()!.answer)),
    fail: () => submitAnswer("99999"),
    host: () => host,
    player: () => player,
  };
}

setLang(prefs.lang);
// The QR-code and reload paths skip the menu, which normally fills the HUD audio buttons.
renderAudioToggles(prefs);
// A reload resumes this tab's room (host or player); `?room=CODE` (QR code) opens the join screen.
const roomParam = new URLSearchParams(location.search).get("room")?.trim().toUpperCase() || null;
host = HostRoom.resume(hostListener);
if (host) showHost();
else {
  player = PlayerRoom.resume(playerListener, roomParam);
  if (player) showWait();
  else if (roomParam) showJoin(roomParam);
  else showIntro();
}
