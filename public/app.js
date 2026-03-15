// ── Config ──────────────────────────────────────────────────────────────────
const WORKER_URL = "/api/analyze";
const SECRET_TOKEN = "animo*2026";

// ── Tab Navigation ───────────────────────────────────────────────────────────
function switchTab(tab) {
  document.getElementById("pageAnalyse").classList.toggle("active", tab === "analyse");
  document.getElementById("pageHistorique").classList.toggle("active", tab === "historique");
  document.getElementById("pageAgences").classList.toggle("active", tab === "agences");
  document.getElementById("tabAnalyse").classList.toggle("active", tab === "analyse");
  document.getElementById("tabHistorique").classList.toggle("active", tab === "historique");
  document.getElementById("tabAgences").classList.toggle("active", tab === "agences");
  if (tab === "historique") loadHistory();
}

// ── Mode de saisie (URL ou contenu colle) ────────────────────────────────────
let inputMode = "url";

function switchInputMode(mode) {
  inputMode = mode;
  const annonce = document.getElementById("annonce");
  const btnUrl = document.getElementById("btnModeUrl");
  const btnContent = document.getElementById("btnModeContent");
  const label = document.getElementById("inputLabel");

  if (mode === "content") {
    annonce.placeholder = "Collez ici le texte complet de l'annonce (copiez tout le contenu visible de la page)";
    annonce.style.minHeight = "150px";
    if (label) label.textContent = "Contenu de l'annonce (copier-coller)";
  } else {
    annonce.placeholder = "Collez ici le lien complet de l'annonce (ex: https://www.anibis.ch/fr/d/appartement-...)";
    annonce.style.minHeight = "";
    if (label) label.textContent = "Lien de l'annonce";
  }

  if (btnUrl) btnUrl.classList.toggle("active", mode === "url");
  if (btnContent) btnContent.classList.toggle("active", mode === "content");
}

// ── Analyse principale (onglet Analyse) ──────────────────────────────────────
async function analyser() {
  const annonceEl = document.getElementById("annonce");
  const input = annonceEl ? annonceEl.value.trim() : "";

  if (!input) {
    afficherErreur(inputMode === "url"
      ? "Veuillez coller le lien d'une annonce avant de lancer l'analyse."
      : "Veuillez coller le contenu de l'annonce avant de lancer l'analyse.");
    return;
  }

  let listingUrl = null;
  let listingContent = null;

  if (inputMode === "content") {
    listingContent = input;
  } else {
    try {
      listingUrl = new URL(input).href;
    } catch {
      afficherErreur("Le texte saisi ne ressemble pas a une URL valide. Collez le lien complet ou passez en mode Coller le contenu.");
      return;
    }
  }

  lancerAnalyse({ listingUrl, listingContent });
}

// ── Analyse agence (onglet Agences) ──────────────────────────────────────────
let agenceUrlEnCours = null;

async function analyserAgence() {
  const urlEl = document.getElementById("agenceUrl");
  const input = urlEl ? urlEl.value.trim() : "";

  if (!input) {
    afficherErreurAgence("Veuillez coller le lien d'une annonce d'agence.");
    return;
  }

  let listingUrl;
  try {
    listingUrl = new URL(input).href;
  } catch {
    afficherErreurAgence("Le texte saisi ne ressemble pas a une URL valide.");
    return;
  }

  agenceUrlEnCours = listingUrl;

  // Masquer l'erreur et le mode extraction
  const errBox = document.getElementById("agenceErrorBox");
  const extractZone = document.getElementById("extractZone");
  if (errBox) errBox.classList.remove("visible");
  if (extractZone) extractZone.classList.remove("visible");

  // Afficher le loading
  const btn = document.getElementById("btnAgence");
  const loading = document.getElementById("agenceLoading");
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  if (loading) loading.classList.add("visible");

  // Tenter le scraping serveur
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-token": SECRET_TOKEN,
      },
      body: JSON.stringify({ listingUrl }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error || `Erreur HTTP ${response.status}`);
    }

    const data = await response.json();

    // Si le scraping est bloque, passer en mode extraction manuelle
    if (data.error === "SCRAPE_BLOCKED") {
      if (loading) loading.classList.remove("visible");
      if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
      activerModeExtraction(listingUrl);
      return;
    }

    // Scraping OK, afficher les resultats
    const raw = data.content.map(b => b.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    saveToHistory(listingUrl, parsed);

    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }

    // Basculer sur l'onglet Analyse pour afficher les resultats
    switchTab("analyse");
    document.getElementById("annonce").value = listingUrl;
    afficherResultats(parsed);
    document.getElementById("divider").classList.add("visible");

  } catch (err) {
    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    // En cas d'erreur reseau, tenter le mode extraction
    activerModeExtraction(listingUrl);
  }
}

function activerModeExtraction(url) {
  // Ouvrir la page dans un nouvel onglet
  window.open(url, "_blank");

  // Afficher la zone d'extraction
  const extractZone = document.getElementById("extractZone");
  if (extractZone) extractZone.classList.add("visible");
}

async function analyserDepuisClipboard() {
  const btn = document.getElementById("btnClipboard");

  try {
    // Tenter de lire le presse-papier
    const text = await navigator.clipboard.readText();

    if (!text || text.trim().length < 50) {
      afficherErreurAgence("Le presse-papier semble vide ou ne contient pas assez de texte. Retournez sur la page, faites Ctrl+A puis Ctrl+C.");
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "Analyse en cours..."; }

    // Lancer l'analyse avec le contenu du presse-papier
    await lancerAnalyse({
      listingUrl: agenceUrlEnCours,
      listingContent: text.trim(),
    });

    if (btn) { btn.disabled = false; btn.textContent = "J'ai copie le contenu — Analyser"; }

  } catch (err) {
    // Si l'acces au presse-papier echoue, proposer le collage manuel
    afficherErreurAgence("Impossible de lire le presse-papier automatiquement. Utilisez l'onglet Analyse en mode « Coller le contenu » pour coller manuellement le texte.");
  }
}

function afficherErreurAgence(msg) {
  const box = document.getElementById("agenceErrorBox");
  if (box) {
    box.textContent = msg;
    box.classList.add("visible");
  }
}

// ── Lancer l'analyse (commun a tous les modes) ──────────────────────────────
async function lancerAnalyse({ listingUrl, listingContent, listingImages }) {
  const btn = document.getElementById("btnAnalyse");
  const errorBox = document.getElementById("errorBox");
  const loading = document.getElementById("loadingState");
  const results = document.getElementById("results");
  const divider = document.getElementById("divider");

  // S'assurer qu'on est sur l'onglet analyse
  switchTab("analyse");

  if (errorBox) errorBox.classList.remove("visible");
  if (results) results.classList.remove("visible");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("loading");
  }

  const timeoutId = setTimeout(() => {
    if (loading) loading.classList.add("visible");
    if (divider) divider.classList.add("visible");
  }, 200);

  try {
    const payload = {};
    if (listingContent) payload.listingContent = listingContent;
    if (listingUrl) payload.listingUrl = listingUrl;
    if (listingImages && listingImages.length > 0) payload.listingImages = listingImages;

    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-token": SECRET_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error || `Erreur HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error === "SCRAPE_BLOCKED") {
      clearTimeout(timeoutId);
      if (loading) loading.classList.remove("visible");
      if (divider) divider.classList.remove("visible");
      if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
      afficherErreur("Le site bloque l'acces automatique. Utilisez l'onglet « Agences » pour analyser ce site.");
      return;
    }

    const raw = data.content.map(b => b.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    saveToHistory(listingUrl || "contenu-colle", parsed);
    clearTimeout(timeoutId);

    // Mettre l'URL dans le champ
    const annonce = document.getElementById("annonce");
    if (annonce && listingUrl) annonce.value = listingUrl;

    afficherResultats(parsed);

  } catch (err) {
    clearTimeout(timeoutId);
    if (loading) loading.classList.remove("visible");
    if (divider) divider.classList.remove("visible");
    afficherErreur("Erreur lors de l'analyse : " + err.message);
  }

  if (btn) {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
}

// ── Affichage des resultats ──────────────────────────────────────────────────
function afficherResultats(parsed) {
  const loading = document.getElementById("loadingState");
  const results = document.getElementById("results");

  if (parsed.score_annonce) {
    const s = parsed.score_annonce;
    document.getElementById("scoreAnnonceVal").textContent = s.valeur + "/100";
    document.getElementById("scoreAnnonceInterp").textContent = s.interpretation || "";
    document.getElementById("scoreAnnonceExpl").textContent = s.explication || "";
  }

  if (parsed.radar_vendeur) {
    const r = parsed.radar_vendeur;
    document.getElementById("radarVal").textContent = r.opportunite_score + "/100";
    document.getElementById("radarNiveau").textContent = r.niveau ? r.niveau.replace("_", " ") : "";
    document.getElementById("radarExpl").textContent = r.explication || "";
  }

  const grid = document.getElementById("diagGrid");
  grid.innerHTML = "";
  if (parsed.diagnostic && Array.isArray(parsed.diagnostic)) {
    parsed.diagnostic.forEach((d, i) => {
      grid.innerHTML += `
        <div class="diag-card">
          <div class="diag-num">${i + 1}</div>
          <div class="diag-content">
            <h3>${escapeHTML(d.titre)}</h3>
            <p>${escapeHTML(d.texte)}</p>
          </div>
        </div>`;
    });
  }

  document.getElementById("comparaisonBody").textContent = parsed.comparaison_marche || parsed.comparaison || "";

  const recList = document.getElementById("recommandationsList");
  recList.innerHTML = "";
  if (parsed.recommandations && Array.isArray(parsed.recommandations)) {
    parsed.recommandations.forEach((r, i) => {
      const li = document.createElement("li");
      li.setAttribute("data-num", String(i + 1).padStart(2, "0"));
      li.textContent = r;
      recList.appendChild(li);
    });
  }

  document.getElementById("message1Body").textContent = parsed.message1 || "";
  document.getElementById("message2Body").textContent = parsed.message2 || "";

  if (loading) loading.classList.remove("visible");
  if (results) results.classList.add("visible");
}

// ── Copier le message ────────────────────────────────────────────────────────
function copierMessage(elementId, btnElement) {
  const msg = document.getElementById(elementId).textContent;
  navigator.clipboard.writeText(msg).then(() => {
    btnElement.textContent = "Copie !";
    setTimeout(() => (btnElement.textContent = "Copier"), 2000);
  });
}

// ── Utilitaires ──────────────────────────────────────────────────────────────
function afficherErreur(msg) {
  const box = document.getElementById("errorBox");
  if (box) {
    box.textContent = msg;
    box.classList.add("visible");
  } else {
    console.error(msg);
    alert(msg);
  }
}

function escapeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Historique (localStorage) ────────────────────────────────────────────────
function saveToHistory(url, data) {
  const history = JSON.parse(localStorage.getItem("animo_history") || "[]");

  const title = extractTitle(data, url);

  const newItem = {
    id: Date.now(),
    url: url,
    title: title,
    date: new Date().toLocaleString("fr-CH"),
    data: data
  };

  history.unshift(newItem);
  localStorage.setItem("animo_history", JSON.stringify(history));
}

function extractTitle(data, url) {
  if (data.diagnostic && data.diagnostic.length > 0) {
    try {
      const urlObj = new URL(url);
      const parts = urlObj.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        const slug = parts[parts.length - 1];
        const titleFromSlug = slug.replace(/-/g, " ").replace(/\d+$/, "").trim();
        if (titleFromSlug.length > 5) return titleFromSlug;
      }
    } catch (e) { }
  }
  return url;
}

function loadHistory(query = "") {
  const container = document.getElementById("historyList");
  if (!container) return;

  const history = JSON.parse(localStorage.getItem("animo_history") || "[]");
  const q = query.toLowerCase().trim();
  const filtered = q ? history.filter(i =>
    (i.url && i.url.toLowerCase().includes(q)) ||
    (i.title && i.title.toLowerCase().includes(q))
  ) : history;

  const badge = document.getElementById("historyCount");
  if (badge) badge.textContent = `${filtered.length} / ${history.length}`;

  if (filtered.length === 0) {
    container.innerHTML = q
      ? '<div class="history-empty">Aucun resultat pour cette recherche</div>'
      : '<div class="history-empty">Aucune analyse recente</div>';
    return;
  }

  container.innerHTML = filtered.map(item => `
    <div class="history-item" onclick="restaurerAnalyse(${item.id})">
      <div class="history-item-date">${item.date}</div>
      <div class="history-item-title">${escapeHTML(item.title || item.url)}</div>
      <div class="history-item-url">${escapeHTML(item.url)}</div>
    </div>
  `).join("");
}

function filterHistory() {
  const q = document.getElementById("historySearch")?.value || "";
  loadHistory(q);
}

function restaurerAnalyse(id) {
  const history = JSON.parse(localStorage.getItem("animo_history") || "[]");
  const item = history.find(i => i.id === id);
  if (item) {
    switchTab("analyse");
    document.getElementById("annonce").value = item.url;
    afficherResultats(item.data);
    setTimeout(() => {
      document.getElementById("divider").classList.add("visible");
      document.getElementById("divider").scrollIntoView({ behavior: "smooth" });
    }, 100);
  }
}

// ── Generation PDF ───────────────────────────────────────────────────────────
function genererPDF() {
  const element = document.getElementById("pdf-report");
  const opt = {
    margin: 10,
    filename: 'Analyse-Immobilier.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(element).save();
}

window.onload = () => loadHistory();
