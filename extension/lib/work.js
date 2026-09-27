// lib/work.js - small shared helpers for bounded extension work.
(function (root) {
  "use strict";

  async function mapLimit(items, concurrency, worker) {
    const input = Array.from(items || []);
    const results = new Array(input.length);
    let cursor = 0;
    const limit = Math.max(1, Math.min(input.length || 1, Number(concurrency) || 1));

    async function run() {
      while (true) {
        const index = cursor++;
        if (index >= input.length) return;
        results[index] = await worker(input[index], index);
      }
    }

    await Promise.all(Array.from({ length: limit }, run));
    return results;
  }

  function createSemaphore(concurrency) {
    const limit = Math.max(1, Number(concurrency) || 1);
    let active = 0;
    const waiters = [];
    return async function withSlot(work) {
      if (active >= limit) await new Promise((resolve) => waiters.push(resolve));
      else active += 1;
      try {
        return await work();
      } finally {
        const next = waiters.shift();
        if (next) next();
        else active -= 1;
      }
    };
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const QUERY_STOP_WORDS = new Set(["about", "after", "before", "does", "explain", "from", "give", "into", "that", "them", "there", "this", "what", "when", "where", "which", "with", "would", "your"]);

  function queryRelevance(query, candidate) {
    const terms = [...new Set(normalize(query).split(" ").filter((term) => term.length > 2 && !QUERY_STOP_WORDS.has(term)))];
    if (!terms.length) return 0;
    const text = normalize(candidate);
    const textTerms = new Set(text.split(" "));
    const overlap = terms.reduce((score, term) => score + (textTerms.has(term) ? 1 : 0), 0);
    const phrase = normalize(query);
    return overlap + (phrase.length > 5 && text.includes(phrase) ? terms.length : 0);
  }

  function matchCourse(record, courses) {
    const code = normalize(record?.courseCode);
    const title = normalize(record?.displayName);
    const term = normalize(record?.termName);
    const list = Array.from(courses || []);
    const termMatches = (course) => !term || !normalize(course?.term) || term === normalize(course.term);

    let matches = code
      ? list.filter((course) => normalize(course?.code) === code && termMatches(course))
      : [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;

    matches = title
      ? list.filter((course) => normalize(course?.title) === title && termMatches(course))
      : [];
    return matches.length === 1 ? matches[0] : null;
  }

  // One queue owns course preparation. Repeated UI/discovery notifications
  // share the same task; a changed revision schedules exactly one follow-up.
  function createCourseQueue(run, { concurrency = 2, onError = () => {} } = {}) {
    const entries = new Map();
    let active = 0, preferred = "", scheduled = false;
    const idleWaiters = [];
    function pump() {
      scheduled = false;
      const pending = [...entries.values()].filter(e => e.pending && !e.running);
      pending.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
      while (active < concurrency && pending.length) {
        const entry = pending.shift();
        entry.pending = false;
        entry.running = true;
        active++;
        const revision = entry.revision;
        Promise.resolve().then(() => run(entry.record, revision))
          .catch(error => onError(entry.record, error))
          .finally(() => {
            entry.running = false;
            active--;
            schedule();
          });
      }
      if (!active && ![...entries.values()].some(e => e.pending)) {
        for (const resolve of idleWaiters.splice(0)) resolve();
      }
    }
    function schedule() {
      if (!scheduled) { scheduled = true; queueMicrotask(pump); }
    }
    return {
      enqueue(record, revision = "initial", { retry = false } = {}) {
        const id = String(record.id || "");
        if (!id) return;
        let entry = entries.get(id);
        if (!entry) {
          entry = { id, record, revision, pending: true, running: false };
          entries.set(id, entry);
        } else {
          entry.record = record;
          if (entry.revision !== revision || (retry && !entry.running)) entry.pending = true;
          entry.revision = revision;
        }
        schedule();
      },
      prioritize(id) { preferred = String(id || ""); schedule(); },
      idle() {
        return new Promise(resolve => { idleWaiters.push(resolve); schedule(); });
      }
    };
  }

  function probeIsComplete(probe) {
    return Boolean(probe && !probe.partial && !probe.requestCapReached &&
      !probe.unresolvedContentIds?.length &&
      probe.attempts?.some(a => a.ok && Array.isArray(a.body?.results) && /\/contents(?:\?|$)/.test(a.url)) &&
      !probe.attempts.some(a => !a.ok && /\/contents(?:\?|$|\/[^/?]+(?:\/children)?(?:\?|$))/.test(a.url)));
  }

  function materialRevision(item) {
    return JSON.stringify([item.itemId, item.kind, item.url || "", item.title || "", item.markup || "", item.version || ""]);
  }

  const api = { mapLimit, createSemaphore, normalize, queryRelevance, matchCourse, createCourseQueue, probeIsComplete, materialRevision };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BBCourseWork = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
