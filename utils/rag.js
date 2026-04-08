/**
 * utils/rag.js — YouTube AI Assistant v4.5
 * Transcript chunking + TF-IDF retrieval engine.
 *
 * Exposes: window.RAGEngine
 *   .buildIndex(segments)                    → chunkCount (number)
 *   .retrieve(query, k)                      → Chunk[]
 *   .retrieveAll(maxChars)                   → Chunk[] (evenly-spaced for summaries)
 *   .buildUserPrompt(title, query, chunks, opts) → string
 */

const RAGEngine = (() => {
  "use strict";

  // ── Config ───────────────────────────────────────────────────────────────────
  const CHUNK_WORDS   = 120;
  const CHUNK_OVERLAP = 20;
  const MAX_CTX_CHARS = 3000;

  // ── State ────────────────────────────────────────────────────────────────────
  let chunks = [];
  let idf    = {};

  // ── Build Index ──────────────────────────────────────────────────────────────

  /**
   * @param {Array<{text:string, start:number, duration:number}>} segments
   * @returns {number} Number of chunks created
   */
  function buildIndex(segments) {
    chunks = [];
    idf    = {};

    if (!segments?.length) return 0;

    // ── Step 1: flatten segments into a word array with per-word timestamps ──
    const words  = [];
    const stamps = []; // start time (seconds) for each word

    for (const seg of segments) {
      const ws = seg.text.split(/\s+/).filter(Boolean);
      for (const w of ws) {
        words.push(w);
        stamps.push(seg.start ?? 0);
      }
    }

    if (words.length < 5) return 0;

    // ── Step 2: slide a window to create overlapping chunks ──────────────────
    const step = Math.max(1, CHUNK_WORDS - CHUNK_OVERLAP);
    for (let i = 0; i < words.length; i += step) {
      const sliceWords  = words.slice(i, i + CHUNK_WORDS);
      if (sliceWords.length < 8) break; // discard tiny trailing chunk

      const sliceStamps = stamps.slice(i, i + CHUNK_WORDS);
      const startTime   = sliceStamps[0] ?? 0;
      const endTime     = sliceStamps[sliceStamps.length - 1] ?? startTime;

      chunks.push({
        text:  sliceWords.join(" "),
        start: startTime,
        end:   endTime,
        index: chunks.length,
        vec:   null, // filled below
      });
    }

    // ── Step 3: compute IDF across all chunks ─────────────────────────────────
    const df = {};
    for (const chunk of chunks) {
      const terms = tokenize(chunk.text);
      const seen  = new Set(terms);
      for (const t of seen) df[t] = (df[t] || 0) + 1;
    }
    const N = chunks.length;
    for (const t in df) idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;

    // ── Step 4: pre-compute TF-IDF vectors for fast retrieval ────────────────
    for (const chunk of chunks) chunk.vec = tfidfVector(chunk.text);

    return chunks.length;
  }

  // ── Retrieve ─────────────────────────────────────────────────────────────────

  /**
   * Returns top-k chunks ranked by cosine similarity to query.
   * @param {string} query
   * @param {number} k
   * @returns {Chunk[]}
   */
  function retrieve(query, k = 4) {
    if (!chunks.length) return [];
    const qVec   = tfidfVector(query);
    const scored = chunks.map(c => ({ chunk: c, score: cosineSim(qVec, c.vec) }));
    scored.sort((a, b) => b.score - a.score);
    // Re-sort selected chunks by timestamp so context reads in order
    return scored.slice(0, k).map(s => s.chunk).sort((a, b) => a.start - b.start);
  }

  /**
   * For summary queries: return evenly-spaced chunks across the whole transcript,
   * up to maxChars total.
   * @param {number} maxChars
   * @returns {Chunk[]}
   */
  function retrieveAll(maxChars = MAX_CTX_CHARS) {
    if (!chunks.length) return [];
    const result = [];
    let   chars  = 0;
    const step   = Math.max(1, Math.ceil(chunks.length / 10));
    for (let i = 0; i < chunks.length; i += step) {
      const c = chunks[i];
      if (chars + c.text.length > maxChars) break;
      result.push(c);
      chars += c.text.length + 1;
    }
    return result;
  }

  // ── Prompt Builder ────────────────────────────────────────────────────────────

  /**
   * Assembles the user-turn prompt sent to Gemini.
   * @param {string}   videoTitle
   * @param {string}   query
   * @param {Chunk[]}  selectedChunks
   * @param {object}   opts  { isCode, detectedLang, description, channel }
   * @returns {string}
   */
  function buildUserPrompt(videoTitle, query, selectedChunks, opts = {}) {
    const { isCode, detectedLang, description, channel } = opts;
    const lines = [];

    lines.push(`VIDEO TITLE: "${videoTitle}"`);
    if (channel)     lines.push(`Channel: ${channel}`);
    if (description) lines.push(`Description: ${description.slice(0, 200)}`);
    lines.push("");

    if (selectedChunks?.length) {
      lines.push("RELEVANT TRANSCRIPT SEGMENTS:");
      for (const chunk of selectedChunks) {
        lines.push(`[${formatTime(chunk.start)} – ${formatTime(chunk.end)}]`);
        lines.push(chunk.text);
        lines.push("");
      }
    }

    if (detectedLang && detectedLang !== "en") {
      lines.push(`(Transcript language: ${detectedLang})`);
      lines.push("");
    }

    if (isCode) {
      lines.push("INSTRUCTION: Extract or reconstruct the complete, runnable code shown in this transcript. Include all imports, class definitions, and helper functions. Do NOT truncate.");
      lines.push("");
    }

    lines.push(`USER QUESTION: ${query}`);
    return lines.join("\n");
  }

  // ── TF-IDF Helpers ────────────────────────────────────────────────────────────

  function tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097f\s]/g, " ") // keep Latin, Devanagari, digits
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  function tfidfVector(text) {
    const terms = tokenize(text);
    if (!terms.length) return {};
    const tf  = {};
    for (const t of terms) tf[t] = (tf[t] || 0) + 1;
    const vec = {};
    const len = terms.length;
    for (const t in tf) vec[t] = (tf[t] / len) * (idf[t] || 1.0);
    return vec;
  }

  function cosineSim(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (const k in a) {
      magA += a[k] * a[k];
      if (b[k]) dot += a[k] * b[k];
    }
    for (const k in b) magB += b[k] * b[k];
    if (!magA || !magB) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  function formatTime(seconds) {
    const s = Math.floor(seconds ?? 0);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${pad(m % 60)}:${pad(s % 60)}`;
    return `${m}:${pad(s % 60)}`;
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  // ── Stop Words ────────────────────────────────────────────────────────────────
  // English + common Hindi/Hinglish stop words
  const STOP_WORDS = new Set([
    // English
    "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
    "is","was","are","were","be","been","being","have","has","had","do","does","did",
    "will","would","could","should","may","might","shall","can","not","no","nor",
    "that","this","these","those","it","its","we","us","our","you","your","they",
    "their","he","she","him","her","his","what","which","who","when","where","how",
    "all","any","some","about","into","than","then","there","here","so","if","as",
    "up","out","my","i","me","also","just","like","more","very","too","well","get",
    "got","let","now","one","two","three","use","used","using","make","made","need",
    "go","going","say","said","know","think","see","right","okay","going","yeah",
    "yes","actually","basically","really","kind","thing","things","just","want",
    "something","everything","nothing","look","looking","come","back","first","last",
    "new","old","good","great","little","big","same","different","way","time","year",
    // Hindi / Hinglish
    "hai","hain","ka","ke","ki","ko","se","mein","par","aur","ya","jo","kya","yeh",
    "woh","ek","do","nahi","bhi","toh","ab","kuch","iss","unka","uska","uske","iska",
    "hoga","tha","thi","the","karo","karna","karein","karte","karke","raha","rahi",
    "hum","aap","tum","main","mujhe","unhe","inhe","jab","tab","phir","sab","apna",
    "apne","lekin","agar","toh","matlab","samajh","batao","dono","sirf","bilkul",
  ]);

  return { buildIndex, retrieve, retrieveAll, buildUserPrompt };
})();
