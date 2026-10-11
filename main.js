async function getVersion() {
  try {
      const response = await fetch('/version.json', { cache: 'no-store' });
      const data = await response.json();
      const version = data.version;
      return version;
  } catch (error) {
      console.error('Error fetching version:', error);
      return null;
  }
}

const DEFAULT_SETTINGS = {
  numQuestions: 50,
  mode: 15,
  timePerQuestion: 3,
  maxAdd1: 10,
  maxAdd2: 10,
  maxSub1: 20,
  maxSub2: 20,
  maxMulDiv1: 10,
  maxMulDiv2: 10,
};
const MAX_QUESTIONS = 500;

// Returns the integer if raw is a plain decimal integer string within [min, max], else null.
function parseIntInRange(raw, min, max) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

const SETTING_SPECS = {
  numQuestions: { urlKey: "n", storageKey: "numQuestions", min: 1, max: MAX_QUESTIONS },
  mode: { urlKey: "m", storageKey: "mode", min: 1, max: 15 },
  timePerQuestion: { urlKey: "t", storageKey: "timePerQuestion", min: 1, max: 10 },
  maxAdd1: { urlKey: "maxAdd1", storageKey: "maxAdd1", min: 1, max: 20 },
  maxAdd2: { urlKey: "maxAdd2", storageKey: "maxAdd2", min: 1, max: 20 },
  maxSub1: { urlKey: "maxSub1", storageKey: "maxSub1", min: 1, max: 20 },
  maxSub2: { urlKey: "maxSub2", storageKey: "maxSub2", min: 2, max: 20 },
  maxMulDiv1: { urlKey: "maxMulDiv1", storageKey: "maxMulDiv1", min: 2, max: 20 },
  maxMulDiv2: { urlKey: "maxMulDiv2", storageKey: "maxMulDiv2", min: 2, max: 20 },
};

// Per field: URL param > localStorage > default. Invalid or out-of-range values are ignored (fall through).
function loadSettings() {
  const params = new URL(window.location.href).searchParams;
  const settings = {};
  for (const [field, spec] of Object.entries(SETTING_SPECS)) {
    settings[field] =
      parseIntInRange(params.get(spec.urlKey), spec.min, spec.max) ??
      parseIntInRange(localStorage.getItem(spec.storageKey), spec.min, spec.max) ??
      DEFAULT_SETTINGS[field];
  }
  return settings;
}

function saveSettings(settings) {
  for (const [field, spec] of Object.entries(SETTING_SPECS)) {
    localStorage.setItem(spec.storageKey, String(settings[field]));
  }
}

window.onload = function () {
  let nameEl = document.getElementById("name");
  let numQuestionEl = document.getElementById("numQuestions");
  let terminalDiv = document.getElementById("terminal-div");
  let questionForm = document.getElementById("questions");
  let finish = document.getElementById("finish");
  let againBtn = document.getElementById("again-btn");
  let opCheckboxes = questionForm.querySelectorAll('input[name="op"]');
  let timeSliderEl = document.getElementById("timePerQuestion");
  let rangesFieldset = document.getElementById("ranges");
  // Each range slider drives the two settings fields named in its data-fields.
  let rangeSliderEls = rangesFieldset.querySelectorAll('input[type="range"]');
  // The six bound fields as last applied from settings or set by a slider. They may be
  // asymmetric when loaded from URL/localStorage; moving a slider sets both of its fields to its value.
  let rangeBounds = {};
  let rangeRows = rangesFieldset.querySelectorAll("[data-ops]");
  let settingsDetails = document.getElementById("settings");
  let settingsSummaryEl = document.getElementById("settings-summary");
  let numErrorEl = document.getElementById("numQuestions-error");
  let opsErrorEl = document.getElementById("ops-error");
  let startBtn = document.getElementById("start-btn");
  let versionInDiv = document.getElementById("version").textContent
  getVersion().then(version => {
    if (version) {
        console.log('Version on server:', version);
        console.log('Version in index.html:', versionInDiv);
        if (versionInDiv != "__VERSION__" && versionInDiv != version) {
          window.location.reload()
        }
    }
  });

  function renderConfig(div, config) {
    let operandsHtml = '';

    if (config.add) {
        operandsHtml += `
           <li><strong>Addition Range:</strong> Adding numbers from 1 to ${config.maxAddOp1} with numbers from 1 to ${config.maxAddOp2}</li>
        `;
    }

    if (config.sub) {
        operandsHtml += `
            <li><strong>Subtraction Range:</strong> Subtracting numbers from 1 to ${config.maxSubOp1} from numbers that are 1 more up to ${config.maxSubOp2}</li>
        `;
    }

      if (config.mul || config.div) {
        if (config.mul) {
           operandsHtml += `
            <li><strong>Multiplication Range:</strong> Multiplying numbers from 2 to ${config.maxMulDivOp1} with numbers from 2 to ${config.maxMulDivOp2}</li>
           `;
        }
        if (config.div) {
          operandsHtml += `
            <li><strong>Division Range:</strong> Dividing products of numbers from 2 to ${config.maxMulDivOp1} by numbers from 2 to ${config.maxMulDivOp2}</li>
          `;
       }
   }
    const html = `
        <div class="config-section">
            <h2>Configuration</h2>
            <ul>
                <li><strong>Questions:</strong> ${config.n}</li>
                <li><strong>Additions:</strong> ${config.add}</li>
                <li><strong>Subtractions:</strong> ${config.sub}</li>
                <li><strong>Multiplications:</strong> ${config.mul}</li>
                <li><strong>Divisions:</strong> ${config.div}</li>
                <li><strong>Expected Time:</strong> ${config.expectedTimeStr}</li>
                ${operandsHtml}
        </div>
    `;

    div.innerHTML = html

  }

  function updateTimeLabel() {
    document.getElementById("timePerQuestion-value").textContent =
      timeSliderEl.value + timeSliderEl.dataset.unit;
  }

  // Thumb at the larger bound; output shows "a" or "a/b" (boundsText) so asymmetric URL bounds stay visible.
  function syncRangeSlider(sliderEl) {
    const [f1, f2] = sliderEl.dataset.fields.split(" ");
    sliderEl.value = String(Math.max(rangeBounds[f1], rangeBounds[f2]));
    document.getElementById(sliderEl.id + "-value").textContent =
      boundsText(rangeBounds[f1], rangeBounds[f2]);
  }

  // Show only the sliders used by a checked operation; hide the fieldset when none is checked.
  function updateRangeVisibility(mode) {
    rangeRows.forEach((row) => {
      row.classList.toggle("hidden", (mode & Number(row.dataset.ops)) === 0);
    });
    rangesFieldset.classList.toggle("hidden", mode === 0);
  }

  // "a" when both bounds match, else "a/b".
  function boundsText(a, b) {
    return a === b ? String(a) : `${a}/${b}`;
  }

  // One-line digest of the hidden settings, shown on the collapsed <summary>.
  function updateSettingsSummary(settings) {
    const mode = settings.mode;
    const parts = [];
    if (mode & 1) parts.push(`+ up to ${boundsText(settings.maxAdd1, settings.maxAdd2)}`);
    if (mode & 2) parts.push(`− up to ${boundsText(settings.maxSub1, settings.maxSub2)}`);
    const mulDivSymbols = (mode & 4 ? "×" : "") + (mode & 8 ? "÷" : "");
    if (mulDivSymbols) parts.push(`${mulDivSymbols} up to ${boundsText(settings.maxMulDiv1, settings.maxMulDiv2)}`);
    if (parts.length === 0) parts.push("no operation");
    parts.push(`${settings.timePerQuestion} s/question`);
    settingsSummaryEl.textContent = parts.join(" · ");
  }

  function readSettings() {
    let mode = 0;
    opCheckboxes.forEach((cb) => {
      if (cb.checked) {
        mode += Number(cb.value);
      }
    });
    const settings = {
      numQuestions: parseIntInRange(numQuestionEl.value, 1, MAX_QUESTIONS),
      mode: mode,
    };
    settings.timePerQuestion = Number(timeSliderEl.value);
    Object.assign(settings, rangeBounds);
    return settings;
  }

  function validateForm() {
    const settings = readSettings();
    updateRangeVisibility(settings.mode);
    updateSettingsSummary(settings);
    const numValid = settings.numQuestions !== null;
    const opsValid = settings.mode !== 0;
    numErrorEl.textContent = numValid ? "" : `Enter a whole number between 1 and ${MAX_QUESTIONS}.`;
    opsErrorEl.textContent = opsValid ? "" : "Select at least one operation.";
    if (!opsValid) settingsDetails.open = true;
    const valid = numValid && opsValid;
    startBtn.disabled = !valid;
    return valid;
  }

  function applySettings(settings) {
    numQuestionEl.value = String(settings.numQuestions);
    opCheckboxes.forEach((cb) => {
      cb.checked = (settings.mode & Number(cb.value)) !== 0;
    });
    timeSliderEl.value = String(settings.timePerQuestion);
    updateTimeLabel();
    rangeSliderEls.forEach((el) => {
      for (const field of el.dataset.fields.split(" ")) rangeBounds[field] = settings[field];
      syncRangeSlider(el);
    });
    validateForm();
  }

  function initForm() {
    let username = localStorage.getItem("name");
    if (username != null) {
      nameEl.value = username;
    }
    applySettings(loadSettings());
  }

  numQuestionEl.addEventListener("input", validateForm);
  opCheckboxes.forEach((cb) => cb.addEventListener("change", validateForm));
  timeSliderEl.addEventListener("input", () => {
    updateTimeLabel();
    updateSettingsSummary(readSettings());
  });
  rangeSliderEls.forEach((el) =>
    el.addEventListener("input", () => {
      for (const field of el.dataset.fields.split(" ")) rangeBounds[field] = Number(el.value);
      syncRangeSlider(el);
      updateSettingsSummary(readSettings());
    })
  );

  initForm();

  againBtn.addEventListener("click", function () {
    finish.classList.add("hidden");
    finish.classList.remove("resultdiv");
    questionForm.classList.remove("hidden");
  });
  questionForm.addEventListener("submit", function (evt) {
    evt.preventDefault();
    if (!validateForm()) {
      return;
    }
    const settings = readSettings();
    let username = nameEl.value;
    localStorage.setItem("name", username);
    saveSettings(settings);
    const game = new Game(username, settings);
    questionForm.classList.add("hidden");
    terminalDiv.classList.remove("hidden");
    terminalDiv.focus();
    function completionCallback() {
      const config = game.getConfig()
      const  configDiv = document.getElementById("config");
      renderConfig(configDiv,config)
  
      
      terminalDiv.classList.add("hidden");
      finish.classList.remove("hidden");
      finish.classList.add("resultdiv");

      const leaderboardData = game.getHighscore();
      const leaderboardList = document.getElementById("leaderboard-list");
     
      const options = {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour12: false,
      };
      const leaderboardTitle = document.getElementById("leaderboard-title");

      const sortByScore = (a, b) => {
        return a.valueOf() - b.valueOf();
      };
      const sortByTime = (a, b) => {
        return a.timestamp - b.timestamp;
      };

      let sortFunction=sortByTime

      const leaderboardDisplay = (sortFunction) => {
        let top = 3
        if (sortFunction === sortByScore) {
          top = 10
        }
        leaderboardList.innerHTML = ''
        leaderboardData
        .sort(sortFunction)
        .reverse().filter(s=>s.mode === game.mode)
        .forEach((entry, index) => {
          if (index < top) {
            const listItem = document.createElement("li");
            listItem.textContent = `${entry.name} - Mistake(s): ${
              entry.mistakes
            } - Time: ${entry.elapsed} - ${entry.when()}`;
            leaderboardList.appendChild(listItem);
          }
        });}


      leaderboardTitle.addEventListener('click',()=>{
        if (sortFunction === sortByTime) {
          leaderboardTitle.textContent="High scores"
          sortFunction=sortByScore
        } else {
          leaderboardTitle.textContent="Last games"
          sortFunction=sortByTime
        }
        leaderboardDisplay(sortFunction);
      })

      leaderboardDisplay(sortFunction);



      const resultDiv = document.getElementById("result");
      resultDiv.innerHTML = "";

      const resultMessage = document.createElement("p");
      const statsMessage = document.createElement("p");

      statsMessage.textContent = `${game.numQuestions} questions, ${game.mistakes} mistake(s), ${game.elapsedTime}`;

      if (game.hasWon()) {
        resultMessage.textContent = "Congratulations! You did great!";
        resultMessage.classList.add("good");
      } else {
        resultMessage.textContent = "Oops! Better luck next time.";
        resultMessage.classList.add("bad");
      }
      resultDiv.appendChild(statsMessage);
      resultDiv.appendChild(resultMessage);
    }
    initTerm(new Controller(game, completionCallback));
  });
};
