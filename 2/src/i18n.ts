export type Lang = "sv" | "en" | "fr";
export const LANGS: readonly Lang[] = ["sv", "en", "fr"];

type Entry = Record<Lang, string | string[]>;

const STRINGS: Record<string, Entry> = {
  tagline: { sv: "Tävla med matte!", en: "Race with maths!", fr: "Fais la course avec les maths !" },
  skip: { sv: "Tryck för att hoppa över", en: "Tap or press a key to skip", fr: "Touche pour passer" },
  nameLabel: { sv: "Ditt namn", en: "Your name", fr: "Ton nom" },
  namePlaceholder: { sv: "Förarnamn", en: "Driver name", fr: "Nom du pilote" },
  nameRequired: { sv: "Skriv ditt namn för att tävla", en: "Enter your name to race", fr: "Entre ton nom pour courir" },
  categoryLabel: { sv: "Antal frågor", en: "Number of questions", fr: "Nombre de questions" },
  questionsN: { sv: "{n} frågor", en: "{n} questions", fr: "{n} questions" },
  questionsWord: { sv: "frågor", en: "questions", fr: "questions" },
  difficultyLabel: { sv: "Svårighetsgrad", en: "Difficulty", fr: "Difficulté" },
  easy: { sv: "Lätt", en: "Easy", fr: "Facile" },
  medium: { sv: "Medel", en: "Medium", fr: "Moyen" },
  hard: { sv: "Svår", en: "Hard", fr: "Difficile" },
  secondsPerQuestion: { sv: "{s} s per fråga", en: "{s} s per question", fr: "{s} s par question" },
  music: { sv: "Musik", en: "Music", fr: "Musique" },
  sound: { sv: "Ljud", en: "Sound", fr: "Son" },
  on: { sv: "På", en: "On", fr: "Activé" },
  off: { sv: "Av", en: "Off", fr: "Désactivé" },
  next: { sv: "Nästa", en: "Next", fr: "Suivant" },
  chooseCup: { sv: "Välj cup", en: "Choose your cup", fr: "Choisis ta coupe" },
  back: { sv: "Tillbaka", en: "Back", fr: "Retour" },
  "cup.add": { sv: "Pluscupen", en: "Plus Cup", fr: "Coupe Plus" },
  "cup.addsub": { sv: "Plus-minus-cupen", en: "Plus-Minus Cup", fr: "Coupe Plus-Moins" },
  "cup.mul": { sv: "Gångercupen", en: "Times Cup", fr: "Coupe Fois" },
  "cup.muldiv": { sv: "Gånger-delat-cupen", en: "Times-Divide Cup", fr: "Coupe Fois-Divisé" },
  "cup.all": { sv: "Stjärncupen (allt)", en: "Star Cup (all)", fr: "Coupe Étoile (tout)" },
  best: { sv: "Rekord: {pos} · {time}", en: "Best: {pos} · {time}", fr: "Record : {pos} · {time}" },
  noRecord: { sv: "Inget rekord än", en: "No record yet", fr: "Pas encore de record" },
  targetHint: {
    sv: "Kom topp 3 för att klara målet!",
    en: "Finish in the top 3 to reach the goal!",
    fr: "Termine dans le top 3 pour réussir !",
  },
  go: { sv: "KÖR!", en: "GO!", fr: "PARTEZ !" },
  lap: { sv: "Varv {x}/{y}", en: "Lap {x}/{y}", fr: "Tour {x}/{y}" },
  question: { sv: "Fråga {x}/{y}", en: "Question {x}/{y}", fr: "Question {x}/{y}" },
  goal: { sv: "Mål {t}", en: "Goal {t}", fr: "Objectif {t}" },
  right: {
    sv: ["Bra!", "Boost!", "Grymt!", "Super!", "Snyggt!", "Kör på!"],
    en: ["Great!", "Boost!", "Awesome!", "Super!", "Nice!", "Keep going!"],
    fr: ["Génial !", "Turbo !", "Super !", "Bravo !", "Bien joué !", "Continue !"],
  },
  wrong: {
    sv: ["Hoppsan! Försök igen", "Inte riktigt!", "Akta!"],
    en: ["Oops! Try again", "Not quite!", "Careful!"],
    fr: ["Oups ! Réessaie", "Pas tout à fait !", "Attention !"],
  },
  crash: { sv: "KRASCH!", en: "CRASH!", fr: "CRASH !" },
  finish: { sv: "MÅLGÅNG!", en: "FINISH!", fr: "ARRIVÉE !" },
  resultWon: { sv: "Målet klarat! 🏆", en: "Goal reached! 🏆", fr: "Objectif atteint ! 🏆" },
  resultLost: {
    sv: "Nära! Försök komma topp 3.",
    en: "So close! Try to finish in the top 3.",
    fr: "Presque ! Essaie de finir dans le top 3.",
  },
  resultCrashed: {
    sv: "För många fel – bilen kraschade!",
    en: "Too many mistakes — your kart crashed!",
    fr: "Trop d'erreurs, ton kart s'est écrasé !",
  },
  statPosition: { sv: "Placering", en: "Position", fr: "Position" },
  statTime: { sv: "Tid", en: "Time", fr: "Temps" },
  statGoal: { sv: "Mål", en: "Goal", fr: "Objectif" },
  statErrors: { sv: "Fel", en: "Errors", fr: "Erreurs" },
  statAnswered: { sv: "Besvarade", en: "Answered", fr: "Réponses" },
  lastGames: { sv: "Senaste loppen", en: "Last races", fr: "Dernières courses" },
  highScores: { sv: "Rekord", en: "High scores", fr: "Meilleurs scores" },
  noGames: { sv: "Inga lopp än", en: "No races yet", fr: "Aucune course" },
  colDate: { sv: "Datum", en: "Date", fr: "Date" },
  colName: { sv: "Namn", en: "Name", fr: "Nom" },
  colRace: { sv: "Lopp", en: "Race", fr: "Course" },
  colPos: { sv: "Plac.", en: "Pos", fr: "Pos" },
  colTime: { sv: "Tid", en: "Time", fr: "Temps" },
  colErrors: { sv: "Fel", en: "Errors", fr: "Erreurs" },
  dnf: { sv: "Bröt", en: "DNF", fr: "Abandon" },
  raceAgain: { sv: "Kör igen", en: "Race again", fr: "Rejouer" },
  changeCup: { sv: "Byt cup", en: "Change cup", fr: "Changer de coupe" },
  menu: { sv: "Meny", en: "Menu", fr: "Menu" },
  quit: { sv: "Avsluta", en: "Quit", fr: "Quitter" },
};

let lang: Lang = "sv";

export function getLang(): Lang {
  return lang;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const value = STRINGS[key]?.[lang];
  if (value === undefined) throw new Error(`Missing translation: ${key}`);
  const text = Array.isArray(value) ? value[0] : value;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** Random entry of an array-valued key (feedback messages). */
export function pick(key: string): string {
  const value = STRINGS[key][lang];
  return Array.isArray(value) ? value[Math.floor(Math.random() * value.length)] : value;
}

/** Sets the active language and re-translates every [data-i18n] / [data-i18n-placeholder] element. */
export function setLang(next: Lang): void {
  lang = next;
  document.documentElement.lang = next;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder!);
  });
}

export function ordinal(n: number): string {
  switch (lang) {
    case "sv":
      return `${n}:${n % 10 === 1 || n % 10 === 2 ? "a" : "e"}`;
    case "fr":
      return n === 1 ? "1er" : `${n}e`;
    case "en": {
      const mod100 = n % 100;
      if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
      return n + (["th", "st", "nd", "rd"][n % 10] ?? "th");
    }
  }
}

/** m:ss.t, e.g. 1:05.3 */
export function fmtTime(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}

/** YYYY-MM-DD HH:MM */
export function fmtDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
