import "./style.css";
import { Engine } from "@babylonjs/core";
import QRCode from "qrcode";
import { GameAudio } from "./audio";
import {
  afterRace,
  championshipRace,
  newRun,
  runComplete,
  toRecord,
  WIN_PACE,
  type ChampionshipRun,
} from "./championship";
import {
  CUPS,
  DIFFICULTIES,
  LIVES,
  RIVALS,
  TARGET_SPEED,
  type Category,
  type Cup,
  type CupId,
  type Difficulty,
} from "./config";
import { fmtTime, mpErrorText, ordinal, pick, setLang, t, type Lang } from "./i18n";
import { DEFAULT_PLAYER_LOOK, parseLook, randomBikeLook, rgbCss, type RiderLook } from "./look";
import type { RankInfo, TopRow } from "./net/protocol";
import { COUNTDOWN_MS, HostRoom, PlayerRoom, type HostListener, type PlayerListener, type RaceStart } from "./net/room";
import { displayStatus, TOP_N } from "./net/standings";
import { defaultQuestionConfig, generateQuestionBank, pickQuestions } from "./questions";
import { RaceSession } from "./race";
import { mulberry32, randomSeed } from "./rng";
import { DEFAULT_SCENERY, PREVIEW_SCENERIES, SCENERIES, sceneryById } from "./sceneries";
import type { Scenery } from "./sceneries/types";
import { MENU_SONG } from "./songs";
import {
  addGame,
  computeScore,
  cupById,
  loadPrefs,
  parseAudioParam,
  saveChampionshipRecord,
  savePrefs,
  type AudioPrefs,
  type SoloMode,
} from "./storage";
import {
  attachScrollHint,
  el,
  formatQuestion,
  moveTrackMapDot,
  renderAudioToggles,
  renderBoard,
  renderChampionshipBoard,
  renderCups,
  renderHostPlayers,
  renderHostSettings,
  renderSceneryOptions,
  renderIntroTitle,
  renderLanes,
  renderMenu,
  renderMpStandings,
  renderNames,
  renderPodium,
  renderResults,
  renderSetup,
  renderStandings,
  renderTrackMap,
  restartAnimation,
  sceneryName,
  showOnly,
  type BoardKind,
  type MpStandingRow,
  type StandingEntry,
} from "./ui";
import { probeFps, qualityDrop } from "./quality";
import { QUALITY, World, type RaceFrame } from "./world";

declare global {
  interface Window {
    /** Dev-only console/automation hook (see bottom of file). */
    __mc?: unknown;
  }
}

type Screen = "intro" | "menu" | "setup" | "cups" | "race" | "results" | "join" | "wait" | "host" | "preview" | "champion";

const INTRO_MS = 4500;
const COUNTDOWN_STEP_MS = 1000;
const FINISH_TO_RESULTS_MS = 3000;
const CRASH_TO_RESULTS_MS = 2500;
/** Championship won: trophy and fanfare before the results (a click or key skips). */
const TROPHY_MS = 6000;
const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const PROD_JOIN_URL = "https://maths.codingtony.com/";
/** Rival motos in multiplayer: the other players of the top 5. */
const MP_MOTO_SLOTS = TOP_N;

const prefs = loadPrefs();
const audioOverride = parseAudioParam(new URLSearchParams(location.search).get("audio"));
/** Live audio switches; `?audio=` applies to this page load only and is never saved. */
const audioState: AudioPrefs = audioOverride ?? { music: prefs.music, sound: prefs.sound };
setLang(prefs.lang);
const playerLook = prefs.look ?? DEFAULT_PLAYER_LOOK;

const canvas = el<HTMLCanvasElement>("renderCanvas");
const engine = new Engine(canvas, true, { stencil: false });
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
// `?preview=<id>`: one lap of that circuit from the player's view (see startPreview), to review circuits.
const previewParam = new URLSearchParams(location.search).get("preview");
const previewScenery = PREVIEW_SCENERIES.find((s) => s.id === previewParam) ?? null;
const world = await World.create(engine, playerLook, previewScenery ?? DEFAULT_SCENERY).catch((err: unknown) => {
  el("boot").textContent = t("loadFailed");
  throw err;
});
el("boot").remove();
const audio = new GameAudio();

audio.setMusic(audioState.music);
audio.setSound(audioState.sound);

const answerEl = el<HTMLInputElement>("answer");
const nameEl = el<HTMLInputElement>("name");
const hostSceneryEl = el<HTMLSelectElement>("host-scenery");
const joinCodeEl = el<HTMLInputElement>("join-code");
const joinNameEl = el<HTMLInputElement>("join-name");
const showAllEl = el<HTMLInputElement>("host-showall");
attachScrollHint(el("host-players"), el("host-players-less"), el("host-players-more"));
attachScrollHint(el("lanes"), el("lanes-less"), el("lanes-more"));
attachScrollHint(el("board").parentElement!, el("board-less"), el("board-more"));

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
/** What the current/last race was; picks the results screen. */
let raceKind: "single" | "championship" | "mp" = "single";
/** Championship in progress; in memory only (a reload starts over at race 1). */
let champRun: ChampionshipRun | null = null;
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
/** Moto i+1 shows the player named motoSlots[i].name, eased from `shown` towards `target` (answers). */
let motoSlots: { name: string | null; look: RiderLook; target: number; shown: number }[] = [];

function later(ms: number, fn: () => void): void {
  timers.push(window.setTimeout(fn, ms));
}

/** Runs once the player's moto crosses the finish line (render loop); dropped with the timers. */
let onFinishLine: (() => void) | null = null;

function clearTimers(): void {
  timers.forEach((id) => window.clearTimeout(id));
  timers = [];
  onFinishLine = null;
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
  audio.setSong(MENU_SONG);
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
  audio.setSong(MENU_SONG);
  el("menu-error").textContent = "";
  renderMenu();
  el("mp-offline").classList.add("hidden");
}

el("solo-btn").addEventListener("click", showSetup);

// ---------- Setup ----------

function showSetup(): void {
  clearTimers();
  screen = "setup";
  showOnly("screen-setup");
  world.setMode("menu", performance.now());
  audio.setSong(MENU_SONG);
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
    renderMenu();
  }),
);

const aboutEl = el<HTMLDialogElement>("about");
el("about-btn").addEventListener("click", () => aboutEl.showModal());
// Esc and the Close button (form method="dialog") close it natively; a click on the backdrop
// targets the dialog itself, outside its panel.
aboutEl.addEventListener("click", (e) => {
  if (e.target === aboutEl) aboutEl.close();
});

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

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    prefs.soloMode = b.dataset.mode as SoloMode;
    savePrefs(prefs);
    renderSetup(prefs);
  }),
);

function toggleMusic(): void {
  audioState.music = !audioState.music;
  audio.setMusic(audioState.music);
  renderAudioToggles(audioState);
  if (audioOverride === null) {
    prefs.music = audioState.music;
    savePrefs(prefs);
  }
}

function toggleSound(): void {
  audioState.sound = !audioState.sound;
  audio.setSound(audioState.sound);
  renderAudioToggles(audioState);
  if (audioOverride === null) {
    prefs.sound = audioState.sound;
    savePrefs(prefs);
  }
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
  audio.setSong(MENU_SONG);
  renderCups(prefs, champRun);
}

/** Championship: the same cup continues an unfinished run; another cup or a finished run starts a new one. */
function pickCup(selected: Cup): void {
  if (prefs.soloMode === "championship" && (!champRun || champRun.cup !== selected.id || runComplete(champRun))) {
    champRun = newRun(selected.id, Date.now());
  }
  startRace(selected);
}

document.querySelectorAll<HTMLButtonElement>("[data-cup]").forEach((b) =>
  b.addEventListener("click", () => pickCup(CUPS.find((c) => c.id === b.dataset.cup)!)),
);
el("cups-back").addEventListener("click", showSetup);

// ---------- Race ----------

/** Lights 3-2-1 over `totalMs`, then GO; `hint` shows under the lights (null = none). */
function runCountdown(totalMs: number, hint: string | null, onGo: () => void): void {
  const step = totalMs / 3;
  const lights = el("countdown").querySelectorAll("span");
  lights.forEach((l) => (l.className = ""));
  el("countdown-hint").textContent = hint ?? "";
  el("countdown-hint").classList.toggle("hidden", hint === null);
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
  raceKind = mp ? "mp" : prefs.soloMode;
  const champ = raceKind === "championship" ? championshipRace(champRun!.won) : null;
  if (!champ) {
    raceConfig = mp
      ? { category: mp.settings.n, difficulty: mp.settings.difficulty }
      : { category: prefs.category, difficulty: prefs.difficulty };
  }
  const timePerQuestion = champ ? champ.secondsPerQuestion : DIFFICULTIES[raceConfig.difficulty];
  const bank = generateQuestionBank({ ...defaultQuestionConfig, mode: cup.mode });
  const questions = pickQuestions(bank, champ ? champ.questions : raceConfig.category, mulberry32(mp ? mp.seed : randomSeed()));
  session = new RaceSession(questions, timePerQuestion, mp ? [] : RIVALS);
  const scenery = mp ? sceneryById(mp.settings.scenery) : champ ? champ.scenery : DEFAULT_SCENERY;
  world.setScenery(scenery);
  // Multiplayer motos appear once the first standings tell who is in the top 5.
  world.setRivalSlots(mp ? [] : null);
  // Class races show the bike colour this kid got at joining; solo races the saved look.
  world.setPlayerLook(mp && player ? player.look : playerLook);
  motoSlots = [];
  mpResult = null;

  const goalSeconds = session.goalMs / 1000;
  laps = Math.max(1, Math.round((goalSeconds * TARGET_SPEED) / world.track.length));
  const totalDistance = laps * world.track.length;
  perQuestion = totalDistance / session.numQuestions;
  world.setupRace(totalDistance);
  world.setMode("race", performance.now());
  audio.setSong(null); // silent grid; race music starts on GO
  audio.engine(true, 0); // idle

  screen = "race";
  hudPosition = 0;
  hudText = "";
  standingsKey = "";
  lastPlayerDistance = 0;
  showOnly("hud", "countdown");
  // One heart per life (config LIVES), all full at the start.
  el("lives").replaceChildren(
    ...Array.from({ length: LIVES }, () => Object.assign(document.createElement("span"), { textContent: "❤️" })),
  );
  el("question-text").textContent = "";
  el("question").classList.remove("hidden");
  el("toast").className = "";
  el("position").textContent = "";
  el("standings").innerHTML = "";
  el("mp-me").classList.toggle("hidden", !mp);
  el("hud").classList.toggle("mp", mp !== null);
  answerEl.value = "";
  answerEl.disabled = true;
  el("race-name").textContent = champ
    ? `${t("champRaceOf", { k: champRun!.won + 1, n: SCENERIES.length })} · ${sceneryName(scenery)}`
    : sceneryName(scenery);
  // Championship: the goal is the time that beats the fastest rival (1st place).
  el("goal-time").textContent = t("goal", { t: fmtTime(champ ? session.goalMs * WIN_PACE : session.goalMs) });
  updateHud(performance.now());

  runCountdown(mp ? mp.countdownMs : 3 * COUNTDOWN_STEP_MS, mp ? null : t(champ ? "champHint" : "targetHint"), () => {
    session!.start(performance.now());
    answerEl.disabled = false;
    answerEl.focus();
    showQuestion();
    audio.setSong(scenery.raceSong);
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
  audio.setSong(null);
  answerEl.disabled = true;
  answerEl.blur();
  el("question").classList.add("hidden");
  updateHud(now);
  world.setMode(kind, now);
  const banner = el("banner");
  const showBanner = () => {
    banner.textContent = t(kind);
    banner.className = kind;
  };

  const elapsedMs = s.elapsedMs(now);
  const crashed = s.status === "crashed";
  if (player) mpResult = mpResultOf(s, elapsedMs);
  else if (raceKind === "championship") {
    // Championship races stay off the single-race boards; a win saves (or updates) the run's record.
    const first = s.finalPosition() === 1;
    champRun = afterRace(champRun!, first, elapsedMs);
    if (first) saveChampionshipRecord(toRecord(champRun, prefs.name, Date.now()));
  } else {
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
  // The last championship race won: trophy and fanfare first.
  const champion = !player && raceKind === "championship" && runComplete(champRun!);
  const results = () => (champion ? celebrateChampion(() => showResults(s, elapsedMs)) : showResults(s, elapsedMs));
  if (kind === "crash") {
    showBanner();
    later(resultsDelayMs, results);
    return;
  }
  // The race (and its time) ended with the last answer, but the moto is still riding up to the line:
  // the banner, the finish sound and the results wait until it actually crosses it.
  onFinishLine = () => {
    showBanner();
    audio.finish();
    later(resultsDelayMs, results);
  };
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

const RIVAL_COLORS = RIVALS.map((r) => rgbCss(r.look.bike));
const PLAYER_CSS = rgbCss(playerLook.bike);

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
  const meColor = rgbCss(player!.look.bike);
  const rows: MpStandingRow[] = top.map((r, i) => {
    const slot = motoSlots.find((k) => k.name === r.name);
    return {
      rank: i + 1,
      name: r.name,
      status: r.status,
      me: i + 1 === me.rank,
      color: i + 1 === me.rank ? meColor : slot ? rgbCss(slot.look.bike) : "#999",
    };
  });
  if (me.rank > top.length) rows.push({ rank: me.rank, name: player!.name, status: me.status, me: true, color: meColor });
  standingsKey = renderMpStandings(rows, standingsKey);
}

/**
 * Gives each other top-5 player a rival moto, keeping the same moto (and look) for the same
 * player across updates. A player pushed out of the top 5 keeps its moto at its last known
 * progress until the slot is needed for someone else.
 */
function assignMotoSlots(top: TopRow[], me: RankInfo): void {
  const want = Math.max(0, Math.min(MP_MOTO_SLOTS, me.of - 1));
  if (want !== motoSlots.length) {
    motoSlots = Array.from({ length: want }, (_, i) => motoSlots[i] ?? { name: null, look: RIVALS[i].look, target: 0, shown: 0 });
  }
  const others = top.filter((_, i) => i + 1 !== me.rank);
  const names = new Set(others.map((r) => r.name));
  for (const r of others) {
    let slot = motoSlots.find((k) => k.name === r.name);
    if (!slot) {
      const free = motoSlots.findIndex((k) => k.name === null || !names.has(k.name));
      if (free < 0) continue;
      slot = motoSlots[free];
      slot.name = r.name;
      slot.look = parseLook(r.look) ?? RIVALS[free].look;
      slot.shown = r.done;
    }
    slot.target = r.done;
  }
  world.setRivalSlots(motoSlots.map((s) => s.look));
}

// ---------- Results ----------

/** Championship won: the gold trophy drops in and spins over the circuit to the victory fanfare, then `then`. */
function celebrateChampion(then: () => void): void {
  clearTimers();
  screen = "champion";
  el("trophy-title").textContent = t("champChampion");
  showOnly("trophy-title");
  world.setRivalSlots(null);
  world.setMode("trophy", performance.now());
  // Plays on into the results, then the menu song.
  audio.playJingle("victoryFanfare", MENU_SONG);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    document.removeEventListener("click", finish);
    document.removeEventListener("keydown", finish);
    then();
  };
  later(TROPHY_MS, finish);
  // "click", not "pointerdown": the results must not appear under a press and catch its release.
  document.addEventListener("click", finish);
  document.addEventListener("keydown", finish);
}

function showResults(s: RaceSession | null, elapsedMs: number): void {
  clearTimers();
  screen = "results";
  showOnly("screen-results");
  world.setMode("menu", performance.now());
  const mp = player !== null;
  const champ = s !== null && !mp && raceKind === "championship";
  const first = champ && s.finalPosition() === 1;
  const complete = champ && runComplete(champRun!);
  // Kids who drove get a jingle: solo = goal met (championship: 1st place), class race = reached the finish line.
  // A won championship keeps the victory fanfare from celebrateChampion.
  if (s && !(first && complete)) {
    audio.playJingle((mp ? s.status === "finished" : champ ? first : s.won()) ? "jingleWin" : "jingleLose", MENU_SONG);
  } else if (!s) audio.setSong(MENU_SONG);
  world.setRivalSlots(null);
  // Multiplayer games never touch the local high scores: no board, no solo buttons.
  document.querySelector(".tabs")!.classList.toggle("hidden", mp || champ);
  el("champ-board-title").classList.toggle("hidden", !champ);
  el("board-box").classList.toggle("hidden", mp);
  for (const id of ["cups-btn", "menu-btn"]) el(id).classList.toggle("hidden", mp);
  el("again-btn").classList.toggle("hidden", mp || first);
  el("champ-next-btn").classList.toggle("hidden", !first || complete);
  el("mp-leave-btn").classList.toggle("hidden", !mp);
  el("mp-podium").classList.toggle("hidden", !mp);
  el("result-stats").classList.remove("hidden");
  if (s && champ) {
    const n = SCENERIES.length;
    const title = first
      ? complete
        ? t("champChampion")
        : t("champWon", { k: champRun!.won, n })
      : t(s.status === "crashed" ? "resultCrashed" : "champLost");
    renderResults({
      title,
      position: s.finalPosition(),
      of: 8,
      elapsedMs,
      goalMs: s.goalMs * WIN_PACE,
      errors: s.errors,
      answered: s.answered,
      numQuestions: s.numQuestions,
      score: null,
    });
    renderChampionshipBoard(cup.id, champRun!.startedAt);
  } else if (s && !mp) {
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
// champRun.won already points at the next race.
el("champ-next-btn").addEventListener("click", () => startRace(cup));
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
        if (screen === "race") assignMotoSlots(p.standings!.top, p.standings!.me);
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
  audio.setSong(MENU_SONG);
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
  // Every join gets a random bike colour from BIKE_PALETTE (choosing one comes later).
  player = new PlayerRoom(code, name, randomBikeLook(playerLook), playerListener);
  showWait();
}

function showWait(): void {
  clearTimers();
  screen = "wait";
  showOnly("screen-wait");
  world.setMode("menu", performance.now());
  audio.setSong(MENU_SONG);
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
  host = new HostRoom(
    { cup: cup.id, n: prefs.category, difficulty: prefs.difficulty, scenery: DEFAULT_SCENERY.id },
    hostListener,
  );
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
  audio.setSong(MENU_SONG);
  // Once per visit, not per renderHost: a joining kid must not close an open dropdown.
  renderSceneryOptions(hostSceneryEl);
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
      // Opens a local test player; muted so it doesn't double the host tab's audio.
      el<HTMLAnchorElement>("host-url").href = `${url}&audio=0`;
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
      color: p.look ? rgbCss(p.look.bike) : `hsl(${(p.order * 137) % 360} 75% 50%)`,
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
  runCountdown(COUNTDOWN_MS, null, () => {});
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
hostSceneryEl.addEventListener("change", () => {
  host?.setSettings({ ...host.settings, scenery: sceneryById(hostSceneryEl.value).id });
});

// ---------- Render loop ----------

/** Eases each multiplayer rival moto towards its player's last reported answer count. */
function mpRivalProgress(dt: number): number[] {
  const k = 1 - Math.exp(-dt * 3);
  for (const slot of motoSlots) slot.shown += (slot.target - slot.shown) * k;
  return motoSlots.map((slot) => slot.shown);
}

// ---------- Dev preview (?preview=<id>) ----------

/** `document.body.dataset.preview` tells automation where it is: ready → running → done (or unknown). */
let preview: { phase: "ready" | "lap" | "finish"; startMs: number } | null = null;

/** The player rides one lap alone at TARGET_SPEED after the first click or key; a minimap shows where. */
function startPreview(scenery: Scenery): void {
  screen = "preview";
  showOnly();
  world.setRivalSlots([]);
  world.setupRace(world.track.length);
  world.setMode("race", performance.now());
  renderTrackMap(el("track-map"), world.track);
  preview = { phase: "ready", startMs: 0 };
  document.body.dataset.preview = "ready";
  const go = () => {
    if (preview?.phase !== "ready") return;
    preview = { phase: "lap", startMs: performance.now() };
    document.body.dataset.preview = "running";
    audio.setSong(scenery.raceSong);
  };
  document.addEventListener("pointerdown", go, { once: true });
  document.addEventListener("keydown", go, { once: true });
}

/**
 * Preview frame: the lap's distance as race progress (perQuestion = 1 m). Past the line the rider
 * keeps going in the chase view (no finish orbit: the video stays the player's view).
 */
function previewFrame(now: number): RaceFrame {
  const p = preview!;
  const d = p.phase === "ready" ? 0 : ((now - p.startMs) / 1000) * TARGET_SPEED;
  if (p.phase === "lap" && d >= world.track.length) {
    p.phase = "finish";
    later(FINISH_TO_RESULTS_MS, () => (document.body.dataset.preview = "done"));
  }
  return { player: d, rivals: [], perQuestion: 1 };
}

engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = engine.getDeltaTime() / 1000;
  const racing = screen === "race" && session !== null;
  let frame: RaceFrame | null = null;
  if (racing) {
    frame = {
      player: session!.playerProgress(now),
      rivals: player ? mpRivalProgress(dt) : RIVALS.map((_, i) => session!.rivalProgress(i, now)),
      perQuestion,
    };
  } else if (screen === "preview" && preview) frame = previewFrame(now);
  world.update(dt, now, frame);
  if (onFinishLine && world.crossedFinish()) {
    const crossed = onFinishLine;
    onFinishLine = null;
    crossed();
  }
  if (screen === "preview") moveTrackMapDot(el("track-map"), world.track.positionAt(world.playerDistance(), 0).pos);
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

// ---------- Quality ----------

/**
 * Lowers rendering quality on slow devices (school Chromebooks can't be tested beforehand):
 * one 2 s probe at load, and one more after a drop. `?quality=0..3` forces a level instead.
 */
async function autoQuality(): Promise<void> {
  await world.scene.whenReadyAsync();
  const first = await probeFps(world.scene);
  let level = Math.min(QUALITY.length - 1, qualityDrop(first));
  let fps = first;
  if (level > 0) {
    world.setQuality(level);
    fps = await probeFps(world.scene);
    if (qualityDrop(fps) > 0 && level < QUALITY.length - 1) world.setQuality(++level);
  }
  console.info(`[quality] ${first.toFixed(0)} fps → level ${level} (${fps.toFixed(0)} fps after)`);
}

const forcedQuality = Number(new URLSearchParams(location.search).get("quality") ?? NaN);
if (Number.isInteger(forcedQuality) && forcedQuality >= 0 && forcedQuality < QUALITY.length) world.setQuality(forcedQuality);
else void autoQuality();

if (import.meta.env.DEV) {
  // Dev-only hook for console/automated verification; routes through the real submit path.
  window.__mc = {
    audio,
    session: () => session,
    solve: () => submitAnswer(String(session!.currentQuestion()!.answer)),
    fail: () => submitAnswer("99999"),
    host: () => host,
    player: () => player,
    world,
  };
}

// Fills every audio button (menu + HUD); afterwards only the toggles re-render them.
renderAudioToggles(audioState);
// A reload resumes this tab's room (host or player); `?room=CODE` (QR code) opens the join screen.
const roomParam = new URLSearchParams(location.search).get("room")?.trim().toUpperCase() || null;
if (previewParam !== null) {
  if (previewScenery) startPreview(previewScenery);
  else {
    document.body.dataset.preview = "unknown";
    console.error(`[preview] unknown scenery "${previewParam}"`);
    showIntro();
  }
} else {
  host = HostRoom.resume(hostListener);
  if (host) showHost();
  else {
    player = PlayerRoom.resume(playerListener, roomParam, randomBikeLook(playerLook));
    if (player) showWait();
    else if (roomParam) showJoin(roomParam);
    else showIntro();
  }
}
