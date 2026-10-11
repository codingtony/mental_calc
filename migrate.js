// http -> https hand-off. localStorage is per-origin, so on the production http
// origin pack the game's keys into the URL fragment and redirect to https; on
// arrival, import any key the https origin doesn't already have.
(function () {
  var KEYS = ["highscore", "name", "numQuestions"];
  var PREFIX = "#migrate=";
  if (location.protocol === "http:" && location.hostname === "maths.codingtony.com") {
    var data = {};
    KEYS.forEach(function (k) {
      var v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    });
    var hash = Object.keys(data).length ? PREFIX + encodeURIComponent(JSON.stringify(data)) : "";
    location.replace("https://" + location.host + location.pathname + location.search + hash);
    return;
  }
  if (location.hash.indexOf(PREFIX) === 0) {
    try {
      var incoming = JSON.parse(decodeURIComponent(location.hash.slice(PREFIX.length)));
      KEYS.forEach(function (k) {
        if (typeof incoming[k] === "string" && localStorage.getItem(k) === null) {
          localStorage.setItem(k, incoming[k]);
        }
      });
    } catch (e) {
      console.error("localStorage migration failed", e);
    }
    history.replaceState(null, "", location.pathname + location.search);
  }
})();
