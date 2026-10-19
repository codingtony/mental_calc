export type Lang = "sv" | "en" | "fr";
export const LANGS: readonly Lang[] = ["sv", "en", "fr"];

type Entry = Record<Lang, string | string[]>;

const STRINGS: Record<string, Entry> = {
  tagline: { sv: "Tävla med matte!", en: "Race with maths!", fr: "Fais la course avec les maths !" },
  skip: { sv: "Tryck för att hoppa över", en: "Tap or press a key to skip", fr: "Touche pour passer" },
  nameLabel: { sv: "Ditt namn", en: "Your name", fr: "Ton nom" },
  namePlaceholder: { sv: "Förarnamn", en: "Driver name", fr: "Nom du pilote" },
  nameRequired: { sv: "Skriv ditt namn för att tävla", en: "Enter your name to race", fr: "Entre ton nom pour courir" },
  cupLabel: { sv: "Cup", en: "Cup", fr: "Coupe" },
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
  next: { sv: "Nästa", en: "Next", fr: "Suivant" },
  solo: { sv: "Kör solo", en: "Solo race", fr: "Course en solo" },
  chooseCup: { sv: "Välj cup", en: "Choose your cup", fr: "Choisis ta coupe" },
  back: { sv: "Tillbaka", en: "Back", fr: "Retour" },
  close: { sv: "Stäng", en: "Close", fr: "Fermer" },
  about: { sv: "Om spelet", en: "About", fr: "À propos" },
  aboutLicense: { sv: "Distribueras under", en: "Distributed under the", fr: "Distribué sous" },
  mitLicense: { sv: "MIT-licensen", en: "MIT License", fr: "licence MIT" },
  models3d: { sv: "3D-modeller", en: "3D models", fr: "Modèles 3D" },
  creditsQuaternius: {
    sv: "Förare, träd, buskar, stenar",
    en: "Riders, trees, bushes, rocks",
    fr: "Pilotes, arbres, buissons, rochers",
  },
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
    sv: "För många fel – motorcykeln kraschade!",
    en: "Too many mistakes — your bike crashed!",
    fr: "Trop d'erreurs, ta moto s'est écrasée !",
  },
  loading: { sv: "Laddar…", en: "Loading…", fr: "Chargement…" },
  loadFailed: {
    sv: "Kunde inte ladda spelet. Ladda om sidan.",
    en: "Could not load the game. Please reload the page.",
    fr: "Impossible de charger le jeu. Recharge la page.",
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
  // ---------- Championship ----------
  modeLabel: { sv: "Spelläge", en: "Mode", fr: "Mode" },
  modeSingle: { sv: "Enskilt lopp", en: "Single race", fr: "Course simple" },
  modeChampionship: { sv: "Mästerskap", en: "Championship", fr: "Championnat" },
  champIntro: {
    sv: "{n} lopp, allt svårare: fler frågor, mindre tid. Kom först för att låsa upp nästa!",
    en: "{n} races, each harder: more questions, less time. Finish 1st to unlock the next!",
    fr: "{n} courses, de plus en plus dures : plus de questions, moins de temps. Termine 1er pour débloquer la suivante !",
  },
  champRaceOf: { sv: "Lopp {k}/{n}", en: "Race {k}/{n}", fr: "Course {k}/{n}" },
  champHint: { sv: "Kom först för att gå vidare!", en: "Finish 1st to move on!", fr: "Termine 1er pour continuer !" },
  champWon: { sv: "Lopp {k}/{n} vunnet! 🏆", en: "Race {k}/{n} won! 🏆", fr: "Course {k}/{n} gagnée ! 🏆" },
  champChampion: { sv: "Du är mästare! 🏆", en: "You are the champion! 🏆", fr: "Tu es champion ! 🏆" },
  champLost: {
    sv: "Kom först för att låsa upp nästa lopp.",
    en: "Finish 1st to unlock the next race.",
    fr: "Termine 1er pour débloquer la course suivante.",
  },
  champNext: { sv: "Nästa lopp", en: "Next race", fr: "Course suivante" },
  champRecords: { sv: "Mästerskapsrekord", en: "Championship records", fr: "Records du championnat" },
  champProgress: { sv: "Nästa: lopp {k}/{n}", en: "Next: race {k}/{n}", fr: "Prochaine : course {k}/{n}" },
  champBest: {
    sv: "Rekord: {won}/{n} lopp · {time}",
    en: "Best: {won}/{n} races · {time}",
    fr: "Record : {won}/{n} courses · {time}",
  },
  colRaces: { sv: "Lopp", en: "Races", fr: "Courses" },
  colRetries: { sv: "Omstarter", en: "Retries", fr: "Reprises" },
  sceneryLabel: { sv: "Bana", en: "Circuit", fr: "Circuit" },
  // ---------- Multiplayer ----------
  mpHost: { sv: "Arrangera ett lopp", en: "Host a race", fr: "Organiser une course" },
  mpJoin: { sv: "Gå med i ett lopp", en: "Join a race", fr: "Rejoindre une course" },
  mpCodeLabel: { sv: "Loppkod", en: "Race code", fr: "Code de la course" },
  mpJoinGo: { sv: "Gå med", en: "Join", fr: "Rejoindre" },
  mpCodeInvalid: { sv: "Skriv koden med 5 tecken", en: "Enter the 5-character code", fr: "Entre le code à 5 caractères" },
  mpConnecting: { sv: "Ansluter…", en: "Connecting…", fr: "Connexion…" },
  mpReconnecting: { sv: "Återansluter…", en: "Reconnecting…", fr: "Reconnexion…" },
  mpWaitingStart: { sv: "Väntar på att loppet ska starta…", en: "Waiting for the race to start…", fr: "En attente du départ de la course…" },
  mpWaitingPlayers: { sv: "Väntar på spelare…", en: "Waiting for players…", fr: "En attente de joueurs…" },
  mpPlayers: { sv: "{n} spelare", en: "{n} players", fr: "{n} joueurs" },
  mpScanToJoin: { sv: "Skanna koden eller gå till", en: "Scan the code or go to", fr: "Scanne le code ou va sur" },
  mpRace: { sv: "Lopp", en: "Race", fr: "Course" },
  mpKick: { sv: "Ta bort", en: "Remove", fr: "Retirer" },
  mpStart: { sv: "Starta loppet", en: "Start the race", fr: "Lancer la course" },
  mpEnd: { sv: "Avsluta loppet", en: "End the race", fr: "Terminer la course" },
  mpRematch: { sv: "Kör igen", en: "Rematch", fr: "Revanche" },
  mpCloseRoom: { sv: "Stäng rummet", en: "Close the room", fr: "Fermer la salle" },
  mpLeave: { sv: "Lämna loppet", en: "Leave the race", fr: "Quitter la course" },
  mpShowAll: { sv: "Visa alla spelare", en: "Show all players", fr: "Afficher tous les joueurs" },
  mpCounter: {
    sv: "🏁 {f} i mål · 💥 {c} kraschade · {n} spelare",
    en: "🏁 {f} finished · 💥 {c} crashed · {n} players",
    fr: "🏁 {f} arrivés · 💥 {c} crashés · {n} joueurs",
  },
  mpYou: { sv: "Du: {done}/{n} · {rank} av {of}", en: "You: {done}/{n} · {rank} of {of}", fr: "Toi : {done}/{n} · {rank} sur {of}" },
  mpRaceInProgress: { sv: "Loppet pågår…", en: "Race in progress…", fr: "Course en cours…" },
  mpFinalResults: { sv: "Slutresultat", en: "Final results", fr: "Résultats finaux" },
  statScore: { sv: "Poäng", en: "Score", fr: "Score" },
  mpKicked: { sv: "Du togs bort från loppet", en: "You were removed from the race", fr: "Tu as été retiré de la course" },
  "mpErr.not_found": { sv: "Hittade inget lopp med den koden", en: "No race found with that code", fr: "Aucune course avec ce code" },
  "mpErr.full": { sv: "Loppet är fullt", en: "The race is full", fr: "La course est complète" },
  "mpErr.started": { sv: "Loppet har redan startat", en: "The race has already started", fr: "La course a déjà commencé" },
  "mpErr.bad_name": { sv: "Ogiltigt namn", en: "Invalid name", fr: "Nom invalide" },
  "mpErr.name_taken": {
    sv: "Någon har redan det namnet: lägg till din initial, t.ex. Ebba S",
    en: "Someone already has this name: add your initial, e.g. Ebba S",
    fr: "Quelqu'un a déjà ce nom : ajoute ton initiale, par ex. Ebba S",
  },
  "mpErr.closed": { sv: "Loppet är stängt", en: "The race was closed", fr: "La course est fermée" },
  "mpErr.replaced": {
    sv: "Loppet öppnades i en annan flik",
    en: "The race was opened in another tab",
    fr: "La course a été ouverte dans un autre onglet",
  },
  mpErrGeneric: { sv: "Kunde inte ansluta ({reason})", en: "Could not connect ({reason})", fr: "Connexion impossible ({reason})" },
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

/** Translated relay `error.reason` (or client-side close reason), with a generic fallback. */
export function mpErrorText(reason: string): string {
  return STRINGS[`mpErr.${reason}`] ? t(`mpErr.${reason}`) : t("mpErrGeneric", { reason });
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
