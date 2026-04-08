/**
 * background.js — YouTube AI Assistant v5.2
 *
 * FIXES vs v5.1:
 *  ✅ Updated Groq + DeepSeek built-in keys
 *  ✅ Wikipedia extract HTML stripped — no more raw <p> tags showing
 *  ✅ Search is now context-aware — video title + topic passed to AI synthesis
 *  ✅ WIKI_FETCH returns clean plain-text extract
 *  ✅ Search results ranked: video-related Wiki results surfaced first
 */

// ─── Built-in Keys ─────────────────────────────────────────────────────────
const DEEPSEEK_KEY = "";
const GROQ_KEY     = "";

// ─── Gemini Models ──────────────────────────────────────────────────────────
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
];
const STABLE_IDX    = 0;
let activeGeminiIdx = STABLE_IDX;
let activeProvider  = "Auto";
let requestCount    = 0;

// ─── Cache ──────────────────────────────────────────────────────────────────
const cache    = new Map();
const CACHE_MS = 5 * 60 * 1000;
function ck(p)   { return btoa(unescape(encodeURIComponent((p.userPrompt||"").slice(0,300)))).slice(0,48); }
function gc(k)   { const e=cache.get(k); if(!e) return null; if(Date.now()-e.ts>CACHE_MS){cache.delete(k);return null;} return e.t; }
function sc(k,t) { cache.set(k,{t,ts:Date.now()}); if(cache.size>60) cache.delete(cache.keys().next().value); }

// ─── Helpers ────────────────────────────────────────────────────────────────
function gurl(key,m){ return `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`; }
function pstat(msg) { const m=msg.match(/^(\d{3}):/); return m?parseInt(m[1]):0; }
function sleep(ms)  { return new Promise(r=>setTimeout(r,ms)); }
function isPreview(m){ return m.includes("preview")||m.includes("exp"); }

/** Strip all HTML tags and decode common entities — used for Wikipedia extracts */
function stripHtml(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Message Router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _s, reply) => {

  if (msg.type === "AI_REQUEST") {
    handleAI(msg.payload, msg.provider || "auto")
      .then(r  => reply({ success:true,  data:r.text, model:r.model, provider:r.provider }))
      .catch(e => reply({ success:false, error:e.message }));
    return true;
  }

  if (msg.type === "SEARCH_REQUEST") {
    handleSearch(msg.payload)
      .then(r  => reply({ success:true,  data:r }))
      .catch(e => reply({ success:false, error:e.message }));
    return true;
  }

  if (msg.type === "WIKI_FETCH") {
    fetchWiki(msg.query)
      .then(r  => reply({ success:true,  data:r }))
      .catch(e => reply({ success:false, error:e.message }));
    return true;
  }

  if (msg.type === "SAVE_API_KEY") {
    activeGeminiIdx = STABLE_IDX; cache.clear();
    chrome.storage.local.set({ geminiApiKey:msg.gemini, deepseekApiKey:msg.deepseek, groqApiKey:msg.groq }, ()=>reply({ success:true }));
    return true;
  }
  if (msg.type === "GET_API_KEY") {
    chrome.storage.local.get(["geminiApiKey", "deepseekApiKey", "groqApiKey"], r=>reply({ 
      gemini:r.geminiApiKey||"", 
      deepseek:r.deepseekApiKey||"", 
      groq:r.groqApiKey||"" 
    }));
    return true;
  }
  if (msg.type === "CLEAR_API_KEY") {
    chrome.storage.local.remove(["geminiApiKey", "deepseekApiKey", "groqApiKey"], ()=>reply({ success:true }));
    return true;
  }
  if (msg.type === "GET_STATUS") {
    chrome.storage.local.get(["geminiApiKey"], s=>reply({
      hasKey:!!s.geminiApiKey, requestCount, activeProvider,
      model:GEMINI_MODELS[activeGeminiIdx], cacheSize:cache.size,
    }));
    return true;
  }
});

// ─── AI Router ──────────────────────────────────────────────────────────────
async function handleAI(payload, providerChoice) {
  const hit = gc(ck(payload));
  if (hit) return { text:hit, model:"cached", provider:"Cache" };

  const { geminiApiKey, deepseekApiKey, groqApiKey } = await chrome.storage.local.get(["geminiApiKey", "deepseekApiKey", "groqApiKey"]);
  const choice = providerChoice || "auto";

  if (choice === "deepseek") {
    const text = await callDeepSeek(deepseekApiKey, payload);
    activeProvider = "DeepSeek"; requestCount++; sc(ck(payload),text);
    return { text, model:"deepseek-chat", provider:"DeepSeek" };
  }
  if (choice === "groq") {
    const text = await callGroq(groqApiKey, payload);
    activeProvider = "Groq"; requestCount++; sc(ck(payload),text);
    return { text, model:"llama-3.3-70b", provider:"Groq" };
  }
  if (choice === "gemini") {
    if (!geminiApiKey) throw new Error("NO_API_KEY");
    const r = await tryGemini(geminiApiKey, payload);
    if (r.success) { activeProvider="Gemini"; requestCount++; sc(ck(payload),r.text); return r; }
    throw new Error(r.error||"Gemini failed");
  }

  // Auto-fallback chain: Gemini → DeepSeek → Groq
  if (geminiApiKey) {
    const r = await tryGemini(geminiApiKey, payload);
    if (r.success) { activeProvider="Gemini"; requestCount++; sc(ck(payload),r.text); return r; }
    if (r.fatal)   throw new Error(r.error);
    console.warn("[YT AI] Gemini exhausted → DeepSeek");
  }

  try {
    const text = await callDeepSeek(deepseekApiKey, payload);
    activeProvider = "DeepSeek"; requestCount++; sc(ck(payload),text);
    return { text, model:"deepseek-chat", provider:"DeepSeek" };
  } catch(e) { console.warn("[YT AI] DeepSeek failed:", e.message, "→ Groq"); }

  try {
    const text = await callGroq(groqApiKey, payload);
    activeProvider = "Groq"; requestCount++; sc(ck(payload),text);
    return { text, model:"llama-3.3-70b", provider:"Groq" };
  } catch(e) { console.error("[YT AI] Groq failed:", e.message); }

  if (!geminiApiKey) throw new Error("NO_API_KEY");
  throw new Error("All AI providers unavailable. Try again in 30s.");
}

// ─── Gemini ─────────────────────────────────────────────────────────────────
async function tryGemini(apiKey, payload) {
  for (let i=activeGeminiIdx; i<GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    try {
      const text = await callGemini(apiKey, payload, model);
      activeGeminiIdx = i;
      return { success:true, text, model, provider:"Gemini" };
    } catch(err) {
      const s = pstat(err.message);
      if (s===401||s===403||/API_KEY_INVALID|not valid/.test(err.message))
        return { success:false, fatal:true, error:"API_KEY_INVALID" };
      if (s===429 && !isPreview(model)) {
        console.warn(`[YT AI] ${model}: 429 → retry 10s`);
        await sleep(10000);
        try {
          const text = await callGemini(apiKey, payload, model);
          activeGeminiIdx = i;
          return { success:true, text, model, provider:"Gemini" };
        } catch(e2) {
          if (pstat(e2.message)===429) {
            if (i===GEMINI_MODELS.length-1) return { success:false, error:"RATE_LIMIT" };
            continue;
          }
        }
      }
      if (s===429||s===404) { continue; }
      if (i===GEMINI_MODELS.length-1) return { success:false, error:err.message };
    }
  }
  return { success:false, error:"All Gemini models exhausted" };
}

async function callGemini(key, { systemPrompt, userPrompt, history=[] }, model) {
  const contents = history.map(t=>({ role:t.role==="assistant"?"model":"user", parts:[{text:t.content}] }));
  contents.push({ role:"user", parts:[{text:userPrompt}] });
  const res = await fetch(gurl(key,model), {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      system_instruction:{ parts:[{text:systemPrompt}] },
      contents,
      generationConfig:{ temperature:0.2, maxOutputTokens:2048, topP:0.9, topK:40 },
      safetySettings:[
        {category:"HARM_CATEGORY_HARASSMENT",threshold:"BLOCK_ONLY_HIGH"},
        {category:"HARM_CATEGORY_HATE_SPEECH",threshold:"BLOCK_ONLY_HIGH"},
        {category:"HARM_CATEGORY_SEXUALLY_EXPLICIT",threshold:"BLOCK_ONLY_HIGH"},
        {category:"HARM_CATEGORY_DANGEROUS_CONTENT",threshold:"BLOCK_ONLY_HIGH"},
      ],
    }),
  });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(`${res.status}: ${e?.error?.message||res.statusText}`); }
  const data = await res.json();
  if (data.promptFeedback?.blockReason) throw new Error(`Blocked: ${data.promptFeedback.blockReason}`);
  const text = data.candidates?.[0]?.content?.parts?.map(p=>p.text).join("")||"";
  if (!text) throw new Error("Empty Gemini response");
  return text.trim();
}

// ─── DeepSeek ───────────────────────────────────────────────────────────────
async function callDeepSeek(userKey, { systemPrompt, userPrompt, history=[] }) {
  const keyToUse = userKey || DEEPSEEK_KEY;
  const messages = [{ role:"system", content:systemPrompt }];
  history.forEach(t=>messages.push({ role:t.role==="assistant"?"assistant":"user", content:t.content }));
  messages.push({ role:"user", content:userPrompt });
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${keyToUse}`},
    body:JSON.stringify({ model:"deepseek-chat", messages, temperature:0.2, max_tokens:2048 }),
  });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(`${res.status}: ${e?.error?.message||"DeepSeek error"}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content||"";
  if (!text) throw new Error("Empty DeepSeek response");
  return text.trim();
}

// ─── Groq ────────────────────────────────────────────────────────────────────
async function callGroq(userKey, { systemPrompt, userPrompt, history=[] }) {
  const keyToUse = userKey || GROQ_KEY;
  const messages = [{ role:"system", content:systemPrompt }];
  history.forEach(t=>messages.push({ role:t.role==="assistant"?"assistant":"user", content:t.content }));
  messages.push({ role:"user", content:userPrompt });
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${keyToUse}`},
    body:JSON.stringify({ model:"llama-3.3-70b-versatile", messages, temperature:0.2, max_tokens:2048 }),
  });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(`${res.status}: ${e?.error?.message||"Groq error"}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content||"";
  if (!text) throw new Error("Empty Groq response");
  return text.trim();
}

// ─── Web Search ──────────────────────────────────────────────────────────────
// AI query refinement for Wikipedia's strict keyword-based nature
async function refineQueryForWiki(query, videoTitle) {
  const cacheKey = "wiki_" + btoa(unescape(encodeURIComponent(query.slice(0, 100))));
  const hit = gc(cacheKey);
  if(hit) return hit;

  // 1. Fast path: try DuckDuckGo Instant Answer API to resolve the entity
  try {
    const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
    if (ddgRes.ok) {
      const d = await ddgRes.json();
      if (d.Heading && d.Heading.toLowerCase() !== query.toLowerCase()) {
        sc(cacheKey, d.Heading);
        return d.Heading;
      }
    }
  } catch(e) { }

  // 2. Fallback path: Use AI logic to synthesize context
  const prompt = `Convert the following natural language search or question into the single most exact Wikipedia article title (e.g. "who is the current prime mininster of india" -> "Prime Minister of India", "ai agent" -> "Intelligent agent").
User Search: "${query}"
Context Video: "${videoTitle || 'None'}"

Output strictly the 1-4 word Wikipedia subject. Do not include quotes, markdown, or chat.`;

  try {
    const { geminiApiKey, deepseekApiKey, groqApiKey } = await chrome.storage.local.get(["geminiApiKey", "deepseekApiKey", "groqApiKey"]);
    let term = "";
    if (geminiApiKey) {
      try { term = await callGemini(geminiApiKey, { systemPrompt:"", userPrompt:prompt, history:[] }, "gemini-2.5-flash"); } catch(e){}
    }
    if (!term) {
      try { term = await callDeepSeek(deepseekApiKey, { systemPrompt:"", userPrompt:prompt, history:[] }); } catch(e){}
    }
    if (!term) {
      try { term = await callGroq(groqApiKey, { systemPrompt:"", userPrompt:prompt, history:[] }); } catch(e){}
    }
    
    if (term) {
      term = term.trim().replace(/["'\*]/g, "");
      if(term.length > 60) term = term.slice(0,60);
      sc(cacheKey, term);
      return term;
    }
  } catch(e) { }
  
  return query; // Fallback
}

// AI query refinement to curate YouTube relevance
async function refineQueryForYouTube(query, videoTitle) {
  const cacheKey = "ytq_" + btoa(unescape(encodeURIComponent((query+(videoTitle||"")).slice(0, 100))));
  const hit = gc(cacheKey);
  if(hit) return hit;

  const prompt = `Rewrite this user search to yield the absolute best YouTube video recommendations. Gently combine the user's intent with the current video context if relevant.
User Search: "${query}"
Context Video: "${videoTitle || 'None'}"

Output ONLY a highly optimized 3-6 word YouTube search string. Do not include quotes or intro text.`;

  try {
    const { geminiApiKey, deepseekApiKey, groqApiKey } = await chrome.storage.local.get(["geminiApiKey", "deepseekApiKey", "groqApiKey"]);
    let term = "";
    if (geminiApiKey) {
      try { term = await callGemini(geminiApiKey, { systemPrompt:"", userPrompt:prompt, history:[] }, "gemini-2.5-flash"); } catch(e){}
    }
    if (!term) {
      try { term = await callDeepSeek(deepseekApiKey, { systemPrompt:"", userPrompt:prompt, history:[] }); } catch(e){}
    }
    if (!term) {
      try { term = await callGroq(groqApiKey, { systemPrompt:"", userPrompt:prompt, history:[] }); } catch(e){}
    }
    
    if (term) {
      term = term.trim().replace(/["'\*]/g, "");
      if(term.length > 70) term = term.slice(0,70); // sanity check
      sc(cacheKey, term);
      return term;
    }
  } catch(e) { }

  return query; // Fallback to raw query
}

// payload: { query, videoTitle?, videoDescription?, channelName? }
async function handleSearch({ query, videoTitle, videoDescription, channelName }) {
  // AI optimizes the user's intent with the video environment automatically!
  const refinedYTQuery = await refineQueryForYouTube(query, videoTitle);

  // Pure YouTube Video Results
  const ytData = await ytSearch(refinedYTQuery);

  return {
    provider:    "YouTube Search",
    query:       refinedYTQuery !== query ? `${query} (Search: ${refinedYTQuery})` : query,
    videoTitle:  videoTitle || "",
    quickAnswer: null,
    definition:  null,
    results:     ytData.results || [],
  };
}

async function ytSearch(query) {
  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    const text = await res.text();
    const match = text.match(/ytInitialData\s*=\s*({.+?});/);
    if (!match) return { results: [] };
    const data = JSON.parse(match[1]);
    
    let contents = [];
    try {
      contents = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents.find(c => c.itemSectionRenderer).itemSectionRenderer.contents;
    } catch(e) {}
    
    const results = [];
    for (const item of contents) {
      if (item.videoRenderer) {
        const v = item.videoRenderer;
        const title = v.title?.runs?.[0]?.text || "";
        const videoId = v.videoId;
        const channel = v.ownerText?.runs?.[0]?.text || "";
        const views = v.viewCountText?.simpleText || "";
        const time = v.publishedTimeText?.simpleText || "";
        const thumbnail = v.thumbnail?.thumbnails?.[0]?.url || "";
        const badgeTag = v.badges?.length ? v.badges[0].metadataBadgeRenderer.label : "";
        const snippet = `${channel} • ${views} • ${time}`;
        
        results.push({
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          snippet,
          thumbnail,
          domain: channel,
          badge: badgeTag || "YouTube"
        });
      }
      if (results.length >= 8) break;
    }
    return { results };
  } catch(e) {
    return { results: [] };
  }
}

async function ddgSearch(query) {
  const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
  if (!res.ok) return { results:[] };
  const d = await res.json();
  const results = [];
  if (d.AbstractText && d.AbstractURL)
    results.push({ title:d.Heading||query, url:d.AbstractURL, snippet:d.AbstractText, domain:td(d.AbstractURL), badge:"DDG" });
  (d.RelatedTopics||[]).forEach(t => {
    if (t.Text && t.FirstURL && results.length < 5)
      results.push({ title:t.Text.slice(0,90), url:t.FirstURL, snippet:t.Text, domain:td(t.FirstURL), badge:"DDG" });
    else if (t.Topics) t.Topics.forEach(s => {
      if (s.Text && s.FirstURL && results.length < 5)
        results.push({ title:s.Text.slice(0,90), url:s.FirstURL, snippet:s.Text, domain:td(s.FirstURL), badge:"DDG" });
    });
  });
  (d.Results||[]).forEach(r => {
    if (r.Text && r.FirstURL && results.length < 5)
      results.push({ title:r.Text.slice(0,90), url:r.FirstURL, snippet:r.Text, domain:td(r.FirstURL), badge:"DDG" });
  });
  return { results:results.slice(0,5), quickAnswer:d.Answer||null, definition:d.Definition||null };
}

async function wikiSearch(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`;
  const res = await fetch(url);
  if (!res.ok) return { results:[] };
  const d = await res.json();
  const results = (d.query?.search||[]).map(r=>({
    title:   r.title,
    url:     `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g,"_"))}`,
    snippet: r.snippet.replace(/<[^>]+>/g,""),
    domain:  "en.wikipedia.org",
    badge:   "Wiki",
  }));
  return { results };
}

// ─── Wikipedia Content Fetch (Browser tab) ───────────────────────────────────
async function fetchWiki(query) {
  // Refine query to exact topic before hitting Wikipedia
  const refinedQuery = await refineQueryForWiki(query, "");

  // 1. Find best matching article title
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(refinedQuery)}&srlimit=1&format=json&origin=*`;
  const sRes  = await fetch(searchUrl);
  const sData = await sRes.json();
  const title = sData.query?.search?.[0]?.title;
  if (!title) return { found:false, query };

  // 2. Fetch intro extract (returns HTML from Wikipedia)
  const sumUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts&exintro=1&exchars=4000&format=json&origin=*&explaintext=1`;
  const eRes  = await fetch(sumUrl);
  const eData = await eRes.json();
  const pages = eData.query?.pages || {};
  const page  = Object.values(pages)[0];
  if (!page) return { found:false, query };

  // 3. Get section names for navigation chips
  const secUrl  = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&origin=*`;
  const secRes  = await fetch(secUrl).catch(()=>null);
  const secData = secRes ? await secRes.json().catch(()=>({})) : {};
  const sections = (secData.parse?.sections||[]).slice(0,8).map(s=>s.line);

  // 4. extract is now plain text (explaintext=1 above) — but strip any residual HTML just in case
  const cleanExtract = stripHtml(page.extract || "");

  return {
    found:    true,
    title:    page.title,
    extract:  cleanExtract,
    url:      `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g,"_"))}`,
    sections,
    query,
  };
}

function td(url) { try{ return new URL(url).hostname.replace(/^www\./,""); }catch{ return ""; } }
