import { CUPS, DIFFICULTIES, type Category, type CupId, type Difficulty } from "./config";
import { fmtDate, fmtTime, getLang, ordinal, t } from "./i18n";
import type { PlayerStatus, RoomSettings, TopRow } from "./net/protocol";
import { bestFor, cupById, highScores, lastGames, type GameRecord, type Prefs } from "./storage";

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const OVERLAYS = [
  "screen-intro",
  "screen-menu",
  "screen-setup",
  "screen-cups",
  "screen-join",
  "screen-wait",
  "screen-host",
  "hud",
  "countdown",
  "banner",
  "screen-results",
];

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

export function renderMenu(prefs: Prefs): void {
  document.querySelectorAll<HTMLButtonElement>(".flag").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === getLang());
  });
  renderAudioToggles(prefs);
}

export function renderSetup(prefs: Prefs): void {
  document.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.category) === prefs.category);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach((b) => {
    const d = b.dataset.difficulty as Difficulty;
    b.querySelector("small")!.textContent = t("secondsPerQuestion", { s: DIFFICULTIES[d] });
    b.classList.toggle("selected", d === prefs.difficulty);
  });
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
  title: string;
  /** null = DNF */
  position: number | null;
  /** Number of racers: 8 in solo, the room size in multiplayer. */
  of: number;
  elapsedMs: number;
  goalMs: number;
  errors: number;
  answered: number;
  numQuestions: number;
  /** Shown only when given (multiplayer). */
  score: number | null;
}

export function renderResults(s: RaceSummary): void {
  el("result-title").textContent = s.title;
  const pos = el("result-position");
  pos.className = s.position === null ? "dnf" : (["", "gold", "silver", "bronze"][s.position] ?? "");
  pos.textContent = s.position === null ? t("dnf") : ordinal(s.position);
  const stats: [string, string][] = [
    ["statPosition", s.position === null ? t("dnf") : `${ordinal(s.position)} / ${s.of}`],
    ["statTime", fmtTime(s.elapsedMs)],
    ["statGoal", fmtTime(s.goalMs)],
    ["statErrors", String(s.errors)],
    ["statAnswered", `${s.answered}/${s.numQuestions}`],
  ];
  if (s.score !== null) stats.push(["statScore", String(s.score)]);
  el("result-stats").innerHTML = stats
    .map(([key, value]) => `<div><dt>${t(key)}</dt><dd>${value}</dd></div>`)
    .join("");
}

// ---------- Multiplayer ----------

const STATUS_ICON: Record<PlayerStatus, string> = { racing: "", finished: "🏁", crashed: "💥", disconnected: "📵" };

/** Finish time for finishers, otherwise answered/N with a status icon. */
function rowInfo(r: { done: number; status: PlayerStatus; ms: number }, n: number): string {
  return r.status === "finished" ? `🏁 ${fmtTime(r.ms)}` : `${STATUS_ICON[r.status]} ${r.done}/${n}`.trim();
}

/** Kahoot-style podium for ranks 1–3 (tallest in the middle) and a list for 4–5. */
export function renderPodium(container: HTMLElement, top: TopRow[], n: number, myRank: number | null): void {
  const step = (rank: number) => {
    const r = top[rank - 1];
    const cls = `step p${rank}${rank === myRank ? " me" : ""}`;
    return r
      ? `<div class="${cls}"><span class="pname">${escapeHtml(r.name)}</span><span class="pinfo">${rowInfo(r, n)}</span><div class="block">${rank}</div></div>`
      : `<div class="${cls} empty"><div class="block">${rank}</div></div>`;
  };
  const rest = top
    .slice(3)
    .map(
      (r, i) =>
        `<li class="${i + 4 === myRank ? "me" : ""}"><span class="rank">${ordinal(i + 4)}</span>` +
        `<span class="pname">${escapeHtml(r.name)}</span><span class="pinfo">${rowInfo(r, n)}</span></li>`,
    )
    .join("");
  container.innerHTML = `<div class="podium">${step(2)}${step(1)}${step(3)}</div><ol class="podium-rest">${rest}</ol>`;
}

export interface MpStandingRow {
  rank: number;
  name: string;
  color: string;
  status: PlayerStatus;
  me: boolean;
}

/** HUD list for multiplayer, already in rank order. Returns a key so callers can skip identical re-renders. */
export function renderMpStandings(rows: MpStandingRow[], previousKey: string): string {
  const key = getLang() + rows.map((r) => `${r.rank}${r.name}${r.color}${r.status}`).join("|");
  if (key === previousKey) return key;
  el("standings").innerHTML = rows
    .map(
      (r) =>
        `<li class="${r.me ? "me" : ""}"><span class="rank">${ordinal(r.rank)}</span>` +
        `<span class="dot" style="background:${r.color}"></span>${escapeHtml(r.name)} ${STATUS_ICON[r.status]}</li>`,
    )
    .join("");
  return key;
}

export interface LaneRow {
  id: string;
  rank: number;
  name: string;
  done: number;
  status: PlayerStatus;
  ms: number;
  color: string;
}

/** Teacher's 2D lane board. Keyed by player id so karts glide (CSS transition) instead of re-rendering. */
export function renderLanes(list: HTMLElement, rows: LaneRow[], n: number): void {
  const existing = new Map<string, HTMLElement>();
  for (const li of Array.from(list.children) as HTMLElement[]) existing.set(li.dataset.id!, li);
  rows.forEach((r, i) => {
    let li = existing.get(r.id);
    if (li) existing.delete(r.id);
    else {
      li = document.createElement("li");
      li.dataset.id = r.id;
      li.innerHTML = `<span class="rank"></span><span class="lname"></span><div class="track"><span class="kart"></span></div><span class="ldone"></span>`;
    }
    li.className = `lane ${r.status}`;
    li.querySelector(".rank")!.textContent = String(r.rank);
    li.querySelector(".lname")!.textContent = r.name;
    const kart = li.querySelector<HTMLElement>(".kart")!;
    kart.style.left = `${(100 * Math.min(r.done, n)) / n}%`;
    kart.style.background = r.color;
    li.querySelector(".ldone")!.textContent = rowInfo(r, n);
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] ?? null);
  });
  for (const li of existing.values()) li.remove();
}

export function renderNames(list: HTMLElement, names: string[], highlight: string | null): void {
  list.innerHTML = names.map((name) => `<li class="${name === highlight ? "me" : ""}">${escapeHtml(name)}</li>`).join("");
}

export function renderHostPlayers(players: { id: string; name: string; connected: boolean }[]): void {
  el("host-count").textContent = players.length ? t("mpPlayers", { n: players.length }) : t("mpWaitingPlayers");
  el("host-players").innerHTML = players
    .map(
      (p) =>
        `<li class="${p.connected ? "" : "offline"}">${escapeHtml(p.name)}` +
        `<button class="kick" data-kick="${escapeHtml(p.id)}" title="${t("mpKick")}" aria-label="${t("mpKick")}">✕</button></li>`,
    )
    .join("");
}

export function renderHostSettings(settings: RoomSettings): void {
  for (const cup of CUPS) {
    const b = document.querySelector<HTMLElement>(`[data-host-cup="${cup.id}"]`)!;
    b.textContent = `${cup.icon} ${t(`cup.${cup.id}`)}`;
    b.classList.toggle("selected", cup.id === settings.cup);
  }
  document.querySelectorAll<HTMLElement>("[data-host-n]").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.hostN) === settings.n);
  });
  document.querySelectorAll<HTMLElement>("[data-host-difficulty]").forEach((b) => {
    const d = b.dataset.hostDifficulty as Difficulty;
    b.querySelector("small")!.textContent = t("secondsPerQuestion", { s: DIFFICULTIES[d] });
    b.classList.toggle("selected", d === settings.difficulty);
  });
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
