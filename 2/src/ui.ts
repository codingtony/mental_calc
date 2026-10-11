import { CUPS, DIFFICULTIES, type Category, type CupId, type Difficulty } from "./config";
import { fmtDate, fmtTime, getLang, ordinal, t } from "./i18n";
import { bestFor, cupById, highScores, lastGames, type GameRecord, type Prefs } from "./storage";

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const OVERLAYS = ["screen-intro", "screen-setup", "screen-cups", "hud", "countdown", "banner", "screen-results"];

/** Shows exactly the given overlays; hides every other one. */
export function showOnly(...ids: string[]): void {
  for (const id of OVERLAYS) el(id).classList.toggle("hidden", !ids.includes(id));
}

/** Re-triggers a one-shot CSS animation class. */
export function restartAnimation(target: HTMLElement, cls: string): void {
  target.classList.remove(cls);
  void target.offsetWidth;
  target.classList.add(cls);
}

export function renderIntroTitle(): void {
  const title = el("intro-title");
  const text = title.textContent ?? "";
  title.textContent = "";
  [...text].forEach((ch, i) => {
    const span = document.createElement("span");
    span.textContent = ch;
    span.style.animationDelay = `${0.6 + i * 0.08}s`;
    title.appendChild(span);
  });
}

export function formatQuestion(text: string): string {
  return text.replace(" x ", " × ").replace(" / ", " ÷ ").replace(" - ", " − ") + " = ?";
}

export function renderSetup(prefs: Prefs): void {
  document.querySelectorAll<HTMLButtonElement>(".flag").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === getLang());
  });
  document.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.category) === prefs.category);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach((b) => {
    const d = b.dataset.difficulty as Difficulty;
    b.querySelector("small")!.textContent = t("secondsPerQuestion", { s: DIFFICULTIES[d] });
    b.classList.toggle("selected", d === prefs.difficulty);
  });
  renderAudioToggles(prefs);
}

export function renderAudioToggles(prefs: Prefs): void {
  const music = el("toggle-music");
  const sound = el("toggle-sound");
  music.querySelector("b")!.textContent = t(prefs.music ? "on" : "off");
  sound.querySelector("b")!.textContent = t(prefs.sound ? "on" : "off");
  music.classList.toggle("selected", prefs.music);
  sound.classList.toggle("selected", prefs.sound);
  el("hud-music").textContent = prefs.music ? "🎵" : "🔇";
  el("hud-sound").textContent = prefs.sound ? "🔊" : "🔈";
}

export function configLine(category: Category, difficulty: Difficulty): string {
  return [
    t("questionsN", { n: category }),
    t(difficulty),
    t("secondsPerQuestion", { s: DIFFICULTIES[difficulty] }),
  ].join(" · ");
}

export function renderCups(prefs: Prefs): void {
  el("cups-config").textContent = configLine(prefs.category, prefs.difficulty);
  for (const cup of CUPS) {
    const card = document.querySelector<HTMLElement>(`[data-cup="${cup.id}"]`)!;
    card.style.setProperty(
      "--cup-color",
      cup.color === "rainbow"
        ? "linear-gradient(135deg, #e4000f, #ff9d00, #ffd200, #43b047, #0094ff, #8a3ffc)"
        : cup.color,
    );
    card.querySelector(".cup-icon")!.textContent = cup.icon;
    card.querySelector(".cup-name")!.textContent = t(`cup.${cup.id}`);
    const best = bestFor(prefs.category, cup.id, prefs.difficulty);
    card.querySelector(".cup-best")!.textContent = best
      ? t("best", { pos: ordinal(best.position!), time: fmtTime(best.elapsedMs) })
      : t("noRecord");
  }
}

export interface StandingEntry {
  name: string;
  color: string;
  progress: number;
  me: boolean;
}

/** Sorted by progress (ties: player first). Returns a key so callers can skip identical re-renders. */
export function renderStandings(entries: StandingEntry[], previousKey: string): string {
  const sorted = [...entries].sort((a, b) => b.progress - a.progress || Number(b.me) - Number(a.me));
  const key = getLang() + sorted.map((e) => e.name).join("|");
  if (key === previousKey) return key;
  el("standings").innerHTML = sorted
    .map(
      (e, i) =>
        `<li class="${e.me ? "me" : ""}"><span class="rank">${ordinal(i + 1)}</span>` +
        `<span class="dot" style="background:${e.color}"></span>${escapeHtml(e.name)}</li>`,
    )
    .join("");
  return key;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface RaceSummary {
  won: boolean;
  crashed: boolean;
  position: number | null;
  elapsedMs: number;
  goalMs: number;
  errors: number;
  answered: number;
  numQuestions: number;
}

export function renderResults(s: RaceSummary): void {
  el("result-title").textContent = t(s.won ? "resultWon" : s.crashed ? "resultCrashed" : "resultLost");
  const pos = el("result-position");
  pos.className = s.position === null ? "dnf" : (["", "gold", "silver", "bronze"][s.position] ?? "");
  pos.textContent = s.position === null ? t("dnf") : ordinal(s.position);
  const stats: [string, string][] = [
    ["statPosition", s.position === null ? t("dnf") : `${ordinal(s.position)} / 8`],
    ["statTime", fmtTime(s.elapsedMs)],
    ["statGoal", fmtTime(s.goalMs)],
    ["statErrors", String(s.errors)],
    ["statAnswered", `${s.answered}/${s.numQuestions}`],
  ];
  el("result-stats").innerHTML = stats
    .map(([key, value]) => `<div><dt>${t(key)}</dt><dd>${value}</dd></div>`)
    .join("");
}

export type BoardKind = "last" | "high";

export function renderBoard(
  kind: BoardKind,
  config: { category: Category; cup: CupId; difficulty: Difficulty },
  freshTimestamp: number,
): void {
  document.querySelectorAll<HTMLElement>(".tab").forEach((b) => b.classList.toggle("selected", b.dataset.board === kind));
  const games = kind === "last" ? lastGames(10) : highScores(config.category, config.cup, config.difficulty, 10);
  const table = el("board");
  if (games.length === 0) {
    table.innerHTML = `<tr><td>${t("noGames")}</td></tr>`;
    return;
  }
  const pos = (g: GameRecord) => (g.position === null ? t("dnf") : ordinal(g.position));
  const columns: [string, (g: GameRecord) => string][] =
    kind === "last"
      ? [
          ["colDate", (g) => fmtDate(g.timestamp)],
          ["colName", (g) => escapeHtml(g.name)],
          ["colRace", (g) => `${cupById(g.cup).icon} · ${g.category} · ${t(g.difficulty)}`],
          ["colPos", pos],
          ["colTime", (g) => fmtTime(g.elapsedMs)],
          ["colErrors", (g) => String(g.errors)],
        ]
      : [
          ["colPos", pos],
          ["colName", (g) => escapeHtml(g.name)],
          ["colTime", (g) => fmtTime(g.elapsedMs)],
          ["colErrors", (g) => String(g.errors)],
          ["colDate", (g) => fmtDate(g.timestamp)],
        ];
  table.innerHTML =
    `<tr>${columns.map(([key]) => `<th>${t(key)}</th>`).join("")}</tr>` +
    games
      .map(
        (g) =>
          `<tr class="${g.timestamp === freshTimestamp ? "fresh" : ""}">` +
          columns.map(([, cell]) => `<td>${cell(g)}</td>`).join("") +
          "</tr>",
      )
      .join("");
}
