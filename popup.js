/**
 * popup.js — v5.1
 */
document.addEventListener("DOMContentLoaded", () => {
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
    if (chrome.runtime.lastError || !res) return;

    const setEl = (id, v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    setEl("req-count",   res.requestCount ?? "0");
    setEl("cache-count", res.cacheSize    ?? "0");

    const kv = document.getElementById("key-val");
    const ks = document.getElementById("key-status");
    const kt = document.getElementById("key-st-text");
    const gt = document.getElementById("gemini-tag");
    const gp = document.getElementById("p-gemini");

    if (res.hasKey) {
      if (kv) { kv.textContent = "✓"; kv.style.color = "#00e676"; }
      if (ks) ks.className = "ks ok";
      if (kt) kt.textContent = `Active · ${res.model || "Gemini 2.5 Flash"}`;
      if (gt) { gt.textContent = "Active"; gt.className = "pt free"; }
    } else {
      if (kv) { kv.textContent = "—"; kv.style.color = "#55556a"; }
      if (ks) ks.className = "ks na";
      if (kt) kt.textContent = "Using built-in DeepSeek + Groq";
    }

    // Highlight active provider
    const prov = (res.activeProvider || "").toLowerCase();
    ["p-gemini","p-deepseek","p-groq"].forEach(id => document.getElementById(id)?.classList.remove("live"));
    if (prov.includes("gemini"))   gp?.classList.add("live");
    if (prov.includes("deepseek")) document.getElementById("p-deepseek")?.classList.add("live");
    if (prov.includes("groq"))     document.getElementById("p-groq")?.classList.add("live");
  });

  // Save key
  const inpGemini = document.getElementById("key-input-gemini");
  const inpDeepseek = document.getElementById("key-input-deepseek");
  const inpGroq = document.getElementById("key-input-groq");
  const btn = document.getElementById("key-save");
  
  if(btn) btn.addEventListener("click", save);
  [inpGemini, inpDeepseek, inpGroq].forEach(inp => {
    if(inp) inp.addEventListener("keydown", e => { if (e.key === "Enter") save(); });
  });

  chrome.runtime.sendMessage({ type: "GET_API_KEY" }, (res) => {
    if(!res) return;
    if(inpGemini && res.gemini) inpGemini.value = res.gemini;
    if(inpDeepseek && res.deepseek) inpDeepseek.value = res.deepseek;
    if(inpGroq && res.groq) inpGroq.value = res.groq;
  });

  function save() {
    const gemini = inpGemini?.value.trim() || "";
    const deepseek = inpDeepseek?.value.trim() || "";
    const groq = inpGroq?.value.trim() || "";
    
    // We send them regardless of whether they are empty or not so they can be overridden/cleared
    chrome.runtime.sendMessage({ type: "SAVE_API_KEY", gemini, deepseek, groq }, (res) => {
      if (!res?.success) return;
      const kv=document.getElementById("key-val"), ks=document.getElementById("key-status"),
            kt=document.getElementById("key-st-text"), gt=document.getElementById("gemini-tag"),
            gp=document.getElementById("p-gemini");
      if(gemini) {
         if (kv) { kv.textContent="✓"; kv.style.color="#00e676"; }
         if (gt) { gt.textContent="Active"; gt.className="pt free"; }
         gp?.classList.add("live");
      }
      if (ks) ks.className="ks ok";
      if (kt) kt.textContent="API keys saved!";
      btn.textContent="✓ Saved!"; btn.style.background="#00e676"; btn.style.color="#000";
      setTimeout(()=>{ btn.textContent="Save Keys"; btn.style.background=""; btn.style.color=""; }, 2000);
    });
  }
});
