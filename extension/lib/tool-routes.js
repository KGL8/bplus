// Allowlisted local API surface exposed to the Blackboard content script.
// Kept pure so route boundaries can be regression tested in Node.
(function (root) {
  "use strict";
  function isAllowedCourseToolPath(value) {
    let route;
    try {
      const url = new URL(String(value || ""), "http://127.0.0.1:8471");
      if (url.origin !== "http://127.0.0.1:8471") return false;
      route = url.pathname;
    }
    catch (_) { return false; }
    return /^\/api\/(calendar(?:\/.*)?|progress-report|practice\/(?:problems|help|attempt|test(?:\/grade)?|study(?:\/grade)?)|consent|voice\/(?:voices|preferences|transcribe|synthesize))$/.test(route) ||
      /^\/api\/courses\/[A-Za-z0-9_.:-]+\/(?:grades(?:\/(?:rules|calculate|[A-Za-z0-9_.:-]+))?|syllabus(?:\/analyze)?)$/.test(route) ||
      /^\/api\/courses\/[A-Za-z0-9_.:-]+\/schedule\/extract$/.test(route) ||
      /^\/api\/courses\/[A-Za-z0-9_.:-]+\/study-plan\/ensure$/.test(route) ||
      /^\/api\/courses\/[A-Za-z0-9_.:-]+\/study-plan\/approve$/.test(route) ||
      /^\/api\/calendar\/events\/[A-Za-z0-9_.:-]+$/.test(route);
  }
  const api = { isAllowedCourseToolPath };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BBCourseToolRoutes = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
