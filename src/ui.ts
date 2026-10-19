import { runComplete, type ChampionshipRecord, type ChampionshipRun } from "./championship";
import { CUPS, DIFFICULTIES, type Category, type CupId, type Difficulty } from "./config";
import { fmtDate, fmtTime, getLang, ordinal, t } from "./i18n";
import type { PlayerStatus, RoomSettings, TopRow } from "./net/protocol";
import { SCENERIES } from "./sceneries";
import type { Scenery } from "./sceneries/types";
import {
  bestChampionship,
  bestFor,
  championshipRecords,
  cupById,
  highScores,
  lastGames,
  type AudioPrefs,
  type GameRecord,
  type Prefs,
} from "./storage";
import type { Track } from "./track";

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
  "trophy-title",
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

export function renderMenu(): void {
  document.querySelectorAll<HTMLButtonElement>(".flag").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === getLang());
  });
}

export function sceneryName(s: Scenery): string {
  return s.name[getLang()];
}

export function renderSetup(prefs: Prefs): void {
  const champ = prefs.soloMode === "championship";
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.mode === prefs.soloMode);
  });
  el("setup-race-options").classList.toggle("hidden", champ);
  const info = el("setup-champ-info");
  info.classList.toggle("hidden", !champ);
  info.textContent = t("champIntro", { n: SCENERIES.length });
  document.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.category) === prefs.category);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach((b) => {
    const d = b.dataset.difficulty as Difficulty;
    b.querySelector("small")!.textContent = t("secondsPerQuestion", { s: DIFFICULTIES[d] });
    b.classList.toggle("selected", d === prefs.difficulty);
  });
}

export function renderAudioToggles(state: AudioPrefs): void {
  const buttons: [string, boolean, boolean][] = [
    ["toggle-music", state.music, true],
    ["hud-music", state.music, false],
    ["toggle-sound", state.sound, true],
    ["hud-sound", state.sound, false],
  ];
  for (const [id, on, menu] of buttons) {
    const button = el(id);
    button.querySelector(".audio-icon")!.textContent = on ? "🔊" : "🔇";
    button.setAttribute("aria-pressed", String(on));
    if (menu) button.classList.toggle("selected", on);
  }
}

export function configLine(category: Category, difficulty: Difficulty): string {
  return [
    t("questionsN", { n: category }),
    t(difficulty),
    t("secondsPerQuestion", { s: DIFFICULTIES[difficulty] }),
  ].join(" · ");
}

/** `run`: the championship run in progress (in memory), shown on its cup's card. */
export function renderCups(prefs: Prefs, run: ChampionshipRun | null): void {
  const champ = prefs.soloMode === "championship";
  const n = SCENERIES.length;
  el("cups-config").textContent = champ ? t("champIntro", { n }) : configLine(prefs.category, prefs.difficulty);
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
    let text: string;
    if (champ) {
      const best = bestChampionship(cup.id);
      if (run?.cup === cup.id && !runComplete(run)) text = t("champProgress", { k: run.won + 1, n });
      else if (best) text = t("champBest", { won: best.won, n: best.races, time: fmtTime(best.elapsedMs) });
      else text = t("noRecord");
    } else {
      const best = bestFor(prefs.category, cup.id, prefs.difficulty);
      text = best ? t("best", { pos: ordinal(best.position!), time: fmtTime(best.elapsedMs) }) : t("noRecord");
    }
    card.querySelector(".cup-best")!.textContent = text;
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

/** Teacher's 2D lane board. Keyed by player id so motos glide (CSS transition) instead of re-rendering. */
export function renderLanes(list: HTMLElement, rows: LaneRow[], n: number): void {
  const existing = new Map<string, HTMLElement>();
  for (const li of Array.from(list.children) as HTMLElement[]) existing.set(li.dataset.id!, li);
  rows.forEach((r, i) => {
    let li = existing.get(r.id);
    if (li) existing.delete(r.id);
    else {
      li = document.createElement("li");
      li.dataset.id = r.id;
      li.innerHTML = `<span class="rank"></span><span class="lname"></span><div class="track"><span class="moto"></span></div><span class="ldone"></span>`;
    }
    li.className = `lane ${r.status}`;
    li.querySelector(".rank")!.textContent = String(r.rank);
    li.querySelector(".lname")!.textContent = r.name;
    const moto = li.querySelector<HTMLElement>(".moto")!;
    moto.style.left = `${(100 * Math.min(r.done, n)) / n}%`;
    moto.style.background = r.color;
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
  const list = el("host-players");
  // Hidden from JS: Safari 26 never re-checks a `:has(> #host-players:empty)` rule when the first
  // player's chip is inserted, so the box stayed hidden for the whole first lobby.
  list.parentElement!.classList.toggle("hidden", players.length === 0);
  list.innerHTML = players
    .map(
      (p) =>
        `<li class="${p.connected ? "" : "offline"}">${escapeHtml(p.name)}` +
        `<button class="kick" data-kick="${escapeHtml(p.id)}" title="${t("mpKick")}" aria-label="${t("mpKick")}">✕</button></li>`,
    )
    .join("");
}

/** Shows `up`/`down` while `list` has content hidden above/below (overlay scrollbars hide that). */
export function attachScrollHint(list: HTMLElement, up: HTMLElement, down: HTMLElement): void {
  const update = (): void => {
    up.classList.toggle("hidden", list.scrollTop <= 4);
    down.classList.toggle("hidden", list.scrollTop + list.clientHeight >= list.scrollHeight - 4);
  };
  list.addEventListener("scroll", update, { passive: true });
  new ResizeObserver(update).observe(list);
  // subtree: the score board replaces its table's rows, not the list's children.
  new MutationObserver(update).observe(list, { childList: true, subtree: true });
  const page = (dir: number) => () => list.scrollBy({ top: dir * list.clientHeight * 0.8, behavior: "smooth" });
  up.addEventListener("click", page(-1));
  down.addEventListener("click", page(1));
  update();
}

export function renderHostSettings(settings: RoomSettings): void {
  el<HTMLSelectElement>("host-scenery").value = settings.scenery;
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

/** Fills the host's circuit dropdown (in the current language). */
export function renderSceneryOptions(select: HTMLSelectElement): void {
  select.replaceChildren(...SCENERIES.map((s) => new Option(sceneryName(s), s.id)));
}

/**
 * Dev preview minimap: the circuit from above (+z up). Ground white, tunnels dashed, bridges yellow
 * on top; start dot red, player dot yellow (moveTrackMapDot).
 */
export function renderTrackMap(box: HTMLElement, track: Track): void {
  const pts = track.points;
  const n = pts.length;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => -p.z);
  const minX = Math.min(...xs) - 20;
  const minY = Math.min(...ys) - 20;
  const w = Math.max(...xs) + 20 - minX;
  const h = Math.max(...ys) + 20 - minY;
  const r = Math.max(w, h) / 45;
  const stroke = 'fill="none" vector-effect="non-scaling-stroke" stroke-linejoin="round"';
  // One polyline per run of equal support, each joined to the next run's first point (the last closes the loop).
  const ground: string[] = [];
  const bridges: string[] = [];
  for (let start = 0; start < n; ) {
    let end = start;
    while (end + 1 < n && track.support[end + 1] === track.support[start]) end++;
    const run = [...pts.slice(start, end + 1), pts[(end + 1) % n]];
    const line = run.map((p) => `${p.x.toFixed(1)},${(-p.z).toFixed(1)}`).join(" ");
    switch (track.support[start]) {
      case "ground":
        ground.push(`<polyline points="${line}" ${stroke} stroke="#fff" stroke-width="4" />`);
        break;
      case "tunnel":
        ground.push(`<polyline points="${line}" ${stroke} stroke="#fff" stroke-width="4" stroke-dasharray="6 5" />`);
        break;
      case "bridge":
        bridges.push(
          `<polyline points="${line}" ${stroke} stroke="#000" stroke-width="9" />` +
            `<polyline points="${line}" ${stroke} stroke="#ffd200" stroke-width="4" />`,
        );
        break;
    }
    start = end + 1;
  }
  box.innerHTML =
    `<svg viewBox="${minX} ${minY} ${w} ${h}" preserveAspectRatio="xMidYMid meet">` +
    ground.join("") +
    bridges.join("") +
    `<circle cx="${pts[0].x}" cy="${-pts[0].z}" r="${r * 0.7}" fill="#e4000f" />` +
    `<circle class="dot" cx="${pts[0].x}" cy="${-pts[0].z}" r="${r}" fill="#ffd200" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke" />` +
    "</svg>";
  box.classList.remove("hidden");
}

export function moveTrackMapDot(box: HTMLElement, pos: { x: number; z: number }): void {
  const dot = box.querySelector(".dot")!;
  dot.setAttribute("cx", String(pos.x));
  dot.setAttribute("cy", String(-pos.z));
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

/** Championship records of `cup`, best first; the row of the run that began at `freshStartedAt` is highlighted. */
export function renderChampionshipBoard(cup: CupId, freshStartedAt: number): void {
  const records = championshipRecords(cup, 10);
  const table = el("board");
  if (records.length === 0) {
    table.innerHTML = `<tr><td>${t("noGames")}</td></tr>`;
    return;
  }
  const columns: [string, (r: ChampionshipRecord, rank: number) => string][] = [
    ["colPos", (_, rank) => ordinal(rank)],
    ["colName", (r) => escapeHtml(r.name)],
    ["colRaces", (r) => `${r.won}/${r.races}`],
    ["colTime", (r) => fmtTime(r.elapsedMs)],
    ["colRetries", (r) => String(r.retries)],
    ["colDate", (r) => fmtDate(r.timestamp)],
  ];
  table.innerHTML =
    `<tr>${columns.map(([key]) => `<th>${t(key)}</th>`).join("")}</tr>` +
    records
      .map(
        (r, i) =>
          `<tr class="${r.startedAt === freshStartedAt ? "fresh" : ""}">` +
          columns.map(([, cell]) => `<td>${cell(r, i + 1)}</td>`).join("") +
          "</tr>",
      )
      .join("");
}
