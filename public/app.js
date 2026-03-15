// ── Config ──────────────────────────────────────────────────────────────────
const WORKER_URL = "/api/analyze";
const SECRET_TOKEN = "animo*2026";

// ── Tab Navigation ───────────────────────────────────────────────────────────
function switchTab(tab) {
  const tabs = ["analyse", "agences", "scraper", "matching", "historique"];
  const pageIds = { analyse: "pageAnalyse", agences: "pageAgences", scraper: "pageScraper", matching: "pageMatching", historique: "pageHistorique" };
  const tabIds = { analyse: "tabAnalyse", agences: "tabAgences", scraper: "tabScraper", matching: "tabMatching", historique: "tabHistorique" };
  for (const t of tabs) {
    const page = document.getElementById(pageIds[t]);
    const btn = document.getElementById(tabIds[t]);
    if (page) page.classList.toggle("active", t === tab);
    if (btn) btn.classList.toggle("active", t === tab);
  }
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

// ── Scraper Petites Annonces ─────────────────────────────────────────────────
let scrapedAnnonces = [];

async function lancerScraping() {
  const urlEl = document.getElementById("scraperUrl");
  const input = urlEl ? urlEl.value.trim() : "";
  const maxPages = parseInt(document.getElementById("scraperPages")?.value || "3", 10);

  if (!input) {
    afficherErreurScraper("Veuillez coller l'URL d'une rubrique petitesannonces.ch.");
    return;
  }

  let baseUrl;
  try {
    baseUrl = new URL(input).href;
  } catch {
    afficherErreurScraper("URL invalide.");
    return;
  }

  const btn = document.getElementById("btnScraper");
  const loading = document.getElementById("scraperLoading");
  const loadingText = document.getElementById("scraperLoadingText");
  const errBox = document.getElementById("scraperErrorBox");
  const resultsDiv = document.getElementById("scraperResults");

  if (errBox) errBox.classList.remove("visible");
  if (resultsDiv) resultsDiv.classList.remove("visible");
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  if (loading) loading.classList.add("visible");

  scrapedAnnonces = [];

  try {
    for (let page = 1; page <= maxPages; page++) {
      if (loadingText) loadingText.textContent = `Scan page ${page}/${maxPages}...`;

      const pageUrl = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;

      const response = await fetch("/api/scrape-listings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-secret-token": SECRET_TOKEN,
        },
        body: JSON.stringify({ url: pageUrl }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || `Erreur HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.annonces && data.annonces.length > 0) {
        scrapedAnnonces.push(...data.annonces);
      }

      // Pas d'annonces = derniere page atteinte
      if (!data.annonces || data.annonces.length === 0 || !data.hasMore) {
        break;
      }

      // Pause entre les pages
      if (page < maxPages) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }

    if (scrapedAnnonces.length === 0) {
      afficherErreurScraper("Aucune annonce trouvee. Le site bloque peut-etre l'acces automatique.");
      return;
    }

    afficherScrapedAnnonces(scrapedAnnonces);

  } catch (err) {
    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    afficherErreurScraper("Erreur : " + err.message);
  }
}

function afficherScrapedAnnonces(annonces) {
  const resultsDiv = document.getElementById("scraperResults");
  const grid = document.getElementById("scraperGrid");
  const countEl = document.getElementById("scraperCount");

  if (countEl) countEl.textContent = annonces.length;

  grid.innerHTML = annonces.map((a, i) => `
    <div class="scraper-card" onclick="analyserDepuisScraper(${i})">
      ${a.image_url ? `<div class="scraper-card-img" style="background-image:url('${escapeHTML(a.image_url)}')"></div>` : '<div class="scraper-card-img scraper-card-noimg">Pas de photo</div>'}
      <div class="scraper-card-body">
        <div class="scraper-card-price">${a.prix ? formatPrix(a.prix) : 'Prix non indique'}</div>
        <div class="scraper-card-details">
          ${a.pieces ? `<span>${a.pieces} pcs</span>` : ''}
          ${a.surface_m2 ? `<span>${a.surface_m2} m²</span>` : ''}
        </div>
        <div class="scraper-card-location">${escapeHTML(a.localisation || 'Localisation inconnue')}</div>
        <div class="scraper-card-title">${escapeHTML(a.titre || '')}</div>
      </div>
    </div>
  `).join("");

  if (resultsDiv) resultsDiv.classList.add("visible");
}

function analyserDepuisScraper(index) {
  const annonce = scrapedAnnonces[index];
  if (!annonce || !annonce.url) return;

  switchTab("analyse");
  document.getElementById("annonce").value = annonce.url;
  switchInputMode("url");
  analyser();
}

function formatPrix(prix) {
  if (!prix) return "";
  return "CHF " + prix.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'") + ".–";
}

function exporterJSON() {
  if (scrapedAnnonces.length === 0) return;

  const blob = new Blob(
    [JSON.stringify(scrapedAnnonces, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "petitesannonces.json";
  a.click();
  URL.revokeObjectURL(url);
}

function afficherErreurScraper(msg) {
  const box = document.getElementById("scraperErrorBox");
  if (box) {
    box.textContent = msg;
    box.classList.add("visible");
  }
}

// ── Matching Acheteur / Bien ─────────────────────────────────────────────────
let matchBuyers = [];
let matchBiens = [];
let matchResults = [];

// Configuration des agences avec leurs URLs de listings
const AGENCIES = {
  naef: {
    name: "Naef",
    listingsUrl: "https://www.naef.ch/acheter/appartements-maisons/",
  },
  bernardnicod: {
    name: "Bernard Nicod",
    listingsUrl: "https://www.bernard-nicod.ch/acheter?action=acheter&transaction=buy",
  },
  cogestim: {
    name: "Cogestim",
    listingsUrl: "https://www.cogestim.ch/fr/acheter/",
  },
  maillard: {
    name: "Maillard Immo",
    listingsUrl: "https://www.maillard-immo.ch/acheter/",
  },
  barnes: {
    name: "Barnes Suisse",
    listingsUrl: "https://www.barnes-suisse.ch/p2777-acheter.html",
  },
  domicim: {
    name: "Domicim",
    listingsUrl: "https://immobilier.domicim.ch/suisse/vaud/acheter/",
  },
  gerofinance: {
    name: "Gerofinance",
    listingsUrl: "https://www.gerofinance-dunand.ch/a-vendre",
  },
  comptoirimmo: {
    name: "Comptoir Immo",
    listingsUrl: "https://comptoir-immo.ch/vente/all/Vaud/all/",
  },
  neho: {
    name: "Neho",
    listingsUrl: "https://neho.ch/fr/a-vendre/proprietes/canton/vaud",
  },
  spg: {
    name: "SPG Rytz",
    listingsUrl: "https://www.spg-rytz.ch/vente",
  },
  galland: {
    name: "Galland & Cie",
    listingsUrl: "https://www.galland.ch/a-vendre/",
  },
  burnier: {
    name: "Burnier",
    listingsUrl: "https://www.burnier.ch/vente",
  },
};

function toggleAllAgencies(checked) {
  const checkboxes = document.querySelectorAll("#agencyChecklist input[type=checkbox]");
  checkboxes.forEach(cb => cb.checked = checked);
}

async function scannerAcheteurs() {
  const urlEl = document.getElementById("matchBuyersUrl");
  const input = urlEl ? urlEl.value.trim() : "";
  const maxPages = parseInt(document.getElementById("matchBuyersPages")?.value || "2", 10);

  if (!input) {
    showMatchError("matchBuyersError", "Veuillez coller l'URL d'une rubrique.");
    return;
  }

  let baseUrl;
  try { baseUrl = new URL(input).href; } catch {
    showMatchError("matchBuyersError", "URL invalide.");
    return;
  }

  const btn = document.getElementById("btnScanBuyers");
  const loading = document.getElementById("matchBuyersLoading");
  const loadingText = document.getElementById("matchBuyersLoadingText");
  const errBox = document.getElementById("matchBuyersError");

  if (errBox) errBox.classList.remove("visible");
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  if (loading) loading.classList.add("visible");

  matchBuyers = [];

  try {
    for (let page = 1; page <= maxPages; page++) {
      if (loadingText) loadingText.textContent = `Scan acheteurs page ${page}/${maxPages}...`;
      const pageUrl = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;

      const response = await fetch("/api/scrape-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-secret-token": SECRET_TOKEN },
        body: JSON.stringify({ url: pageUrl }),
      });

      if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
      const data = await response.json();

      if (data.annonces && data.annonces.length > 0) {
        matchBuyers.push(...data.annonces);
      }

      if (!data.annonces || data.annonces.length === 0 || !data.hasMore) break;
      if (page < maxPages) await new Promise(r => setTimeout(r, 1500));
    }

    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }

    const badge = document.getElementById("buyersCountBadge");
    if (badge) {
      badge.textContent = `${matchBuyers.length} acheteur(s) trouve(s)`;
      badge.classList.add("visible");
    }

    if (matchBuyers.length === 0) {
      showMatchError("matchBuyersError", "Aucun acheteur trouve.");
    }

  } catch (err) {
    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    showMatchError("matchBuyersError", "Erreur : " + err.message);
  }
}

async function scannerAgences() {
  const checkboxes = document.querySelectorAll("#agencyChecklist input[type=checkbox]:checked");
  const selectedAgencies = [...checkboxes].map(cb => cb.value);

  if (selectedAgencies.length === 0) {
    showMatchError("matchBienError", "Selectionnez au moins une agence.");
    return;
  }

  const btn = document.getElementById("btnScanAgencies");
  const loading = document.getElementById("matchBienLoading");
  const loadingText = document.getElementById("matchBienLoadingText");
  const errBox = document.getElementById("matchBienError");

  if (errBox) errBox.classList.remove("visible");
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  if (loading) loading.classList.add("visible");

  matchBiens = [];
  let scannedCount = 0;

  for (const agencyKey of selectedAgencies) {
    const agency = AGENCIES[agencyKey];
    if (!agency) continue;

    scannedCount++;
    if (loadingText) {
      loadingText.textContent = `Scan ${agency.name} (${scannedCount}/${selectedAgencies.length})...`;
    }

    try {
      const response = await fetch("/api/scrape-agency", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-secret-token": SECRET_TOKEN },
        body: JSON.stringify({ url: agency.listingsUrl, agencyName: agency.name }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.annonces && data.annonces.length > 0) {
          matchBiens.push(...data.annonces.map(a => ({ ...a, source: agency.name })));
        }
      }
    } catch (e) {
      // Agence inaccessible, on continue
    }

    // Pause entre les agences
    if (scannedCount < selectedAgencies.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (loading) loading.classList.remove("visible");
  if (btn) { btn.disabled = false; btn.classList.remove("loading"); }

  const badge = document.getElementById("biensCountBadge");
  if (badge) {
    badge.textContent = `${matchBiens.length} bien(s) trouves sur ${scannedCount} agence(s)`;
    badge.classList.add("visible");
  }

  if (matchBiens.length === 0) {
    showMatchError("matchBienError", "Aucun bien extrait. Les sites bloquent peut-etre l'acces automatique.");
  }
}

function lancerMatching() {
  if (matchBuyers.length === 0) {
    showMatchError("matchBuyersError", "Scannez d'abord les acheteurs (etape 1).");
    return;
  }
  if (matchBiens.length === 0) {
    showMatchError("matchBienError", "Chargez d'abord les biens (etape 2).");
    return;
  }

  matchResults = [];

  for (const buyer of matchBuyers) {
    for (const bien of matchBiens) {
      const score = calculerMatchScore(buyer, bien);
      if (score > 0) {
        matchResults.push({ buyer, bien, score });
      }
    }
  }

  // Trier par score decroissant
  matchResults.sort((a, b) => b.score - a.score);

  afficherMatchResults(matchResults);
}

function calculerMatchScore(buyer, bien) {
  let score = 0;
  let factors = 0;

  // Correspondance localisation (NPA)
  if (buyer.localisation && bien.localisation) {
    const buyerNPA = buyer.localisation.match(/\d{4}/);
    const bienNPA = bien.localisation.match(/\d{4}/);
    if (buyerNPA && bienNPA) {
      factors++;
      if (buyerNPA[0] === bienNPA[0]) {
        score += 40; // meme NPA = fort match
      } else if (Math.abs(parseInt(buyerNPA[0]) - parseInt(bienNPA[0])) <= 10) {
        score += 20; // NPA proche = match moyen
      }
    }
  }

  // Correspondance prix (tolerance +/- 20%)
  if (buyer.prix && bien.prix) {
    factors++;
    const ratio = bien.prix / buyer.prix;
    if (ratio >= 0.8 && ratio <= 1.2) {
      score += 30;
    } else if (ratio >= 0.6 && ratio <= 1.4) {
      score += 15;
    }
  }

  // Correspondance pieces
  if (buyer.pieces && bien.pieces) {
    factors++;
    const diff = Math.abs(buyer.pieces - bien.pieces);
    if (diff === 0) score += 20;
    else if (diff <= 0.5) score += 15;
    else if (diff <= 1) score += 8;
  }

  // Correspondance surface (tolerance +/- 25%)
  if (buyer.surface_m2 && bien.surface_m2) {
    factors++;
    const ratio = bien.surface_m2 / buyer.surface_m2;
    if (ratio >= 0.75 && ratio <= 1.25) {
      score += 10;
    }
  }

  // Si aucun facteur commun, pas de match
  if (factors === 0) return 0;

  return Math.round(score);
}

function afficherMatchResults(results) {
  const resultsDiv = document.getElementById("matchResults");
  const grid = document.getElementById("matchGrid");
  const countEl = document.getElementById("matchCount");

  if (countEl) countEl.textContent = results.length;

  if (results.length === 0) {
    grid.innerHTML = '<div class="history-empty">Aucune correspondance trouvee avec les criteres actuels.</div>';
    if (resultsDiv) resultsDiv.classList.add("visible");
    return;
  }

  grid.innerHTML = results.map((m, i) => {
    const scoreClass = m.score >= 60 ? "match-high" : m.score >= 30 ? "match-medium" : "match-low";
    return `
    <div class="match-card ${scoreClass}">
      <div class="match-score-badge">${m.score}%</div>
      <div class="match-pair">
        <div class="match-side match-buyer">
          <div class="match-side-label">Acheteur recherche</div>
          <div class="match-side-price">${m.buyer.prix ? formatPrix(m.buyer.prix) : '—'}</div>
          <div class="match-side-details">
            ${m.buyer.pieces ? `${m.buyer.pieces} pcs` : ''}
            ${m.buyer.surface_m2 ? ` · ${m.buyer.surface_m2} m²` : ''}
          </div>
          <div class="match-side-loc">${escapeHTML(m.buyer.localisation || '—')}</div>
          <div class="match-side-title">${escapeHTML(m.buyer.titre || '')}</div>
        </div>
        <div class="match-arrow">&#8596;</div>
        <div class="match-side match-bien">
          <div class="match-side-label">Bien disponible</div>
          <div class="match-side-price">${m.bien.prix ? formatPrix(m.bien.prix) : '—'}</div>
          <div class="match-side-details">
            ${m.bien.pieces ? `${m.bien.pieces} pcs` : ''}
            ${m.bien.surface_m2 ? ` · ${m.bien.surface_m2} m²` : ''}
          </div>
          <div class="match-side-loc">${escapeHTML(m.bien.localisation || '—')}</div>
          <div class="match-side-title">${escapeHTML(m.bien.titre || '')}</div>
        </div>
      </div>
      <div class="match-actions">
        <a href="${escapeHTML(m.buyer.url || '#')}" target="_blank" class="match-link">Voir acheteur</a>
        <a href="${escapeHTML(m.bien.url || '#')}" target="_blank" class="match-link">Voir bien</a>
      </div>
    </div>`;
  }).join("");

  if (resultsDiv) resultsDiv.classList.add("visible");
}

function exporterMatches() {
  if (matchResults.length === 0) return;
  const blob = new Blob(
    [JSON.stringify(matchResults, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "matching-results.json";
  a.click();
  URL.revokeObjectURL(url);
}

function showMatchError(id, msg) {
  const box = document.getElementById(id);
  if (box) {
    box.textContent = msg;
    box.classList.add("visible");
  }
}

window.onload = () => loadHistory();
