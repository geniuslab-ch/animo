// ── Config ──────────────────────────────────────────────────────────────────
const WORKER_URL = "/api/analyze";
const SECRET_TOKEN = "animo*2026";

// ── NPA Regions (Suisse romande) ─────────────────────────────────────────────
const NPA_REGIONS = {
  '10': 'Lausanne', '11': 'Morges-Cossonay', '12': 'Nyon-Rolle',
  '13': 'Yverdon', '14': 'Broye-Payerne', '15': 'Moudon-Oron',
  '16': 'Aigle-Bex', '17': 'Chateau-dOex', '18': 'Montreux-Vevey',
  '19': 'Sion-Valais', '20': 'Neuchatel', '21': 'Fribourg',
  '22': 'Fribourg-Sud', '23': 'Bienne', '24': 'Jura', '25': 'Bern',
};

const ADJACENT_REGIONS = {
  '10': ['11', '18', '15'],
  '11': ['10', '12'],
  '12': ['11', '13'],
  '13': ['14', '15', '12'],
  '14': ['13', '15'],
  '15': ['10', '14', '18'],
  '16': ['18'],
  '17': ['18'],
  '18': ['10', '15', '16', '17'],
  '20': ['21', '23', '13'],
  '21': ['20', '22', '14'],  // Fribourg ↔ Neuchatel, Fribourg-Sud, Broye
  '22': ['21', '17', '16'],  // Fribourg-Sud ↔ Fribourg, Chateau-dOex, Aigle
};

function getNPARegion(npa) {
  if (!npa || npa.length !== 4) return null;
  return npa.substring(0, 2);
}

function npaProximityScore(npa1, npa2) {
  if (npa1 === npa2) return 1.0;
  const n1 = parseInt(npa1, 10);
  const n2 = parseInt(npa2, 10);
  const diff = Math.abs(n1 - n2);

  // Distance numerique NPA (les NPA proches sont geographiquement proches)
  if (diff <= 30) return 0.85;   // Tres proche (meme district, ~5-10km)

  // Meme region (2 premiers chiffres identiques)
  const r1 = getNPARegion(npa1);
  const r2 = getNPARegion(npa2);
  if (!r1 || !r2) return 0;
  if (r1 === r2) return 0.7;

  // Regions adjacentes
  const adj = ADJACENT_REGIONS[r1];
  if (adj && adj.includes(r2)) return 0.3;
  return 0;
}

function extractPropertyType(annonce) {
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '') + ' ' + (annonce.localisation || '')).toLowerCase();
  if (/maison|villa|chalet/.test(text)) return 'house';
  if (/appartement|appart\b|apt\.?/.test(text)) return 'apartment';
  if (/terrain|parcelle/.test(text)) return 'land';
  if (/commercial|bureau|local\b|dépôt|depot|entrepôt|entrepot|hangar|atelier/.test(text)) return 'commercial';
  if (/parking|garage|box/.test(text)) return 'parking';
  if (/immeuble/.test(text)) return 'building';
  return 'unknown';
}

function extractBonus(annonce) {
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '')).toLowerCase();
  return {
    jardin: /jardin|garden|garten/.test(text),
    balcon: /balcon|terrasse|loggia|balkon/.test(text),
    vue: /vue\s+(lac|montagne|alpes|d[ée]gag[ée]e)|panoram|lake\s*view/.test(text),
  };
}

function getSearchMode() {
  return document.querySelector('input[name="searchMode"]:checked')?.value || 'restreinte';
}

function checkExclusions(buyer, bien, searchMode) {
  if (!searchMode) searchMode = getSearchMode();
  // Filtre 1 : Localisation hors zone
  const buyerNPA = extractNPAFromText(buyer);
  const bienNPA = extractNPAFromText(bien);

  if (buyerNPA && bienNPA) {
    const proximity = npaProximityScore(buyerNPA, bienNPA);
    if (searchMode === 'restreinte' && proximity < 0.7) {
      return { compatible: false, reason: 'Localisation hors zone restreinte' };
    }
    if (searchMode === 'elargie' && proximity === 0) {
      return { compatible: false, reason: 'Localisation hors zone elargie' };
    }
  }

  // Filtre 2 : Prix depasse budget de plus de 15%
  if (buyer.prix && bien.prix) {
    if (bien.prix > buyer.prix * 1.15) {
      return { compatible: false, reason: 'Prix depasse le budget de plus de 15%' };
    }
  }

  return { compatible: true, reason: null };
}

// ── Tab Navigation ───────────────────────────────────────────────────────────
function switchTab(tab) {
  const tabs = ["analyse", "agences", "scraper", "census", "matching", "reverse", "historique"];
  const pageIds = { analyse: "pageAnalyse", agences: "pageAgences", scraper: "pageScraper", census: "pageCensus", matching: "pageMatching", reverse: "pageReverse", historique: "pageHistorique" };
  const tabIds = { analyse: "tabAnalyse", agences: "tabAgences", scraper: "tabScraper", census: "tabCensus", matching: "tabMatching", reverse: "tabReverse", historique: "tabHistorique" };
  for (const t of tabs) {
    const page = document.getElementById(pageIds[t]);
    const btn = document.getElementById(tabIds[t]);
    if (page) page.classList.toggle("active", pageIds[t] === pageIds[tab]);
    if (btn) btn.classList.toggle("active", t === tab);
  }
  if (tab === "historique") loadHistory();
  // Canton switching
  if (tab === "matching") switchCanton(currentCanton);
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

// ── Filtres de qualite ───────────────────────────────────────────────────────
function isSellerAd(annonce) {
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '') + ' ' + (annonce.fullText || '')).toLowerCase();
  const sellerPatterns = /\b(a vendre|à vendre|vends|je vends|nous vendons|mise en vente|en vente|vente directe|prix de vente|vente de|nouveau prix|offre[s]? [àa] partir)\b/;
  const buyerPatterns = /\b(cherche|recherche|acheter|souhaite acqu[eé]rir|je cherche|nous cherchons|looking for|acqu[eé]rir|int[eé]ress[eé])\b/;
  // Si patterns acheteur détectés, ce n'est pas un vendeur
  if (buyerPatterns.test(text)) return false;
  // Si patterns vendeur détectés, c'est un vendeur
  if (sellerPatterns.test(text)) return true;
  // Heuristique : une annonce avec image et prix élevé dans la rubrique acheteurs est suspecte
  if (annonce.image_url && annonce.prix && annonce.prix > 100000 && !buyerPatterns.test(text)) {
    // Les vrais acheteurs ont rarement des photos de bien
    return false;
  }
  return false;
}

function isRentalListing(annonce) {
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '') + ' ' + (annonce.fullText || '')).toLowerCase();
  const rentalPatterns = /\b(à louer|a louer|location|louer|en location|bail|sous-location|sous location|mois de loyer|loyer mensuel|loyer|charges comprises|charges en sus|dès le|disponible dès|à remettre|zu vermieten|miete|affitto|per mese|to rent)\b/;
  const salePatterns = /\b(à vendre|a vendre|vente|acheter|achat|prix de vente|offre d'achat|rendement|immeuble de rapport|zu verkaufen|vendita)\b/;
  // Si patterns de location détectés et aucun pattern de vente => c'est une location
  if (rentalPatterns.test(text) && !salePatterns.test(text)) return true;
  // Prix mensuel détecté (pattern /mois, /m, par mois, mensuel)
  if (/\b\d[\d''.]*\s*(?:\/\s*mois|\/\s*m\b|p\.?\s*m\.?|par mois|mensuel)/i.test(text)) return true;
  return false;
}

function isSwissListing(annonce) {
  const loc = (annonce.localisation || '').trim();
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '') + ' ' + loc).toLowerCase();
  // Code postal 5 chiffres = France
  if (/\b\d{5}\b/.test(loc)) return false;
  // Villes françaises frontalières courantes
  if (/\b(evian|thonon|annemasse|divonne|ferney|gex|st[- ]julien|annecy|chamonix|megeve|morzine|cluses)\b/.test(text)) return false;
  // Indicateurs de France dans le texte
  if (/\b(france|fran[cç]ais[e]?|haute[- ]savoie|ain\b|is[eè]re|doubs)\b/.test(text)) return false;
  return true;
}

function deduplicateBiens(biens) {
  const seen = new Set();
  return biens.filter(b => {
    // Cle primaire : URL normalisee (sans query/hash/trailing slash)
    const urlKey = b.url ? b.url.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() : null;
    if (urlKey && seen.has(urlKey)) return false;

    // Cle secondaire : titre+prix+localisation (meme bien sur differentes pages)
    const contentKey = [
      (b.titre || '').toLowerCase().trim(),
      b.prix || '',
      (b.localisation || '').toLowerCase().trim()
    ].join('|');

    if (contentKey !== '||' && seen.has(contentKey)) return false;

    if (urlKey) seen.add(urlKey);
    if (contentKey !== '||') seen.add(contentKey);
    return true;
  });
}

// ── Matching Acheteur / Bien ─────────────────────────────────────────────────
let matchBuyers = [];
let matchBiens = [];
let matchResults = [];

// URLs sources en ligne pour le matching immobilier — par canton
const CANTON_CONFIG = {
  vaud: {
    label: 'Vaud',
    acheteurs_url: 'https://www.petitesannonces.ch/r/270724',
    anibis_url: 'https://www.anibis.ch/fr/q/immobilier-appartements-maisons-terrains-objets-commerciaux-acheter/Ak8CqcmVhbEVzdGF0ZZSTkqljb21wYW55QWSncHJpdmF0ZZKrbGlzdGluZ1R5cGWUqWFwYXJ0bWVudKVob3VzZa5idWlsZGluZ0dyb3VuZLJjb21tZXJjaWFsUHJvcGVydHmSqXByaWNlVHlwZaNCVVnAwMA?sorting=newest&page=1',
  },
  valais: {
    label: 'Valais',
    acheteurs_url: 'https://www.petitesannonces.ch/r/270723',
    anibis_url: null,
  },
  neuchatel: {
    label: 'Neuch\u00e2tel',
    acheteurs_url: null,
    anibis_url: null,
  },
  fribourg: {
    label: 'Fribourg',
    acheteurs_url: 'https://www.petitesannonces.ch/r/270707',
    anibis_url: null,
  },
  geneve: {
    label: 'Gen\u00e8ve',
    acheteurs_url: 'https://www.petitesannonces.ch/r/270708',
    anibis_url: null,
  },
};
let currentCanton = 'vaud';

function getCantonConfig() {
  return CANTON_CONFIG[currentCanton] || CANTON_CONFIG.vaud;
}

// Legacy alias
const PA_ACHETEURS_URL = 'https://www.petitesannonces.ch/r/270724';
const ANIBIS_IMMOBILIER_URL = 'https://www.anibis.ch/fr/q/immobilier-appartements-maisons-terrains-objets-commerciaux-acheter/Ak8CqcmVhbEVzdGF0ZZSTkqljb21wYW55QWSncHJpdmF0ZZKrbGlzdGluZ1R5cGWUqWFwYXJ0bWVudKVob3VzZa5idWlsZGluZ0dyb3VuZLJjb21tZXJjaWFsUHJvcGVydHmSqXByaWNlVHlwZaNCVVnAwMA?sorting=newest&page=1';

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
  homewell: {
    name: "Homewell",
    listingsUrl: "http://www.homewell.ch/",
  },
  bcImmo: {
    name: "BC Immo",
    listingsUrl: "https://www.bcimmo.ch/",
  },
  proximmo: {
    name: "Proximmo",
    listingsUrl: "http://www.proximmo.ch/",
  },
  atticaImmobilier: {
    name: "Attica Immobilier",
    listingsUrl: "http://www.atticaimmobilier.ch/",
  },
  courvoisier: {
    name: "Courvoisier Immo",
    listingsUrl: "https://www.courvoisier.immo/",
  },
  omnia: {
    name: "Omnia",
    listingsUrl: "http://www.omnia.ch/",
  },
  ethicImmobilier: {
    name: "Ethic Immobilier",
    listingsUrl: "https://ethic-immobilier.ch/",
  },
  regieDuboux: {
    name: "Regie Du Boux",
    listingsUrl: "http://www.regieduboux.ch/",
  },
  regimoLausanne: {
    name: "Regimo Lausanne",
    listingsUrl: "https://regimo-lausanne.ch/louer/acheter",
  },
  golayImmobilier: {
    name: "Golay Immobilier",
    listingsUrl: "http://www.golay-immobilier.ch/",
  },
  dezage: {
    name: "Dezage",
    listingsUrl: "http://www.dezage.ch/",
  },
  pbbg: {
    name: "PBBG",
    listingsUrl: "http://www.pbbg.ch/",
  },
  johnTaylor: {
    name: "John Taylor",
    listingsUrl: "https://www.john-taylor.com/luxury-real-estate-agency/montreux/",
  },
  esteHomes: {
    name: "Este Homes",
    listingsUrl: "https://www.este-homes.ch/fr/",
  },
  transaxia: {
    name: "Transaxia",
    listingsUrl: "http://www.transaxia.ch/",
  },
  cgsImmobilier: {
    name: "CGS Immobilier",
    listingsUrl: "https://cgs-immobilier.ch/",
  },
  julienVolet: {
    name: "Julien Volet",
    listingsUrl: "http://www.julienvolet.ch/",
  },
  cofimo: {
    name: "Cofimo",
    listingsUrl: "http://www.cofimo.ch/",
  },
  gendreEmonet: {
    name: "Gendre & Emonet",
    listingsUrl: "http://www.gendre-emonet.ch/",
  },
  rivieraProperties: {
    name: "Riviera Properties",
    listingsUrl: "http://www.rivieraproperties.ch/",
  },
  sothebys: {
    name: "Sotheby's Realty",
    listingsUrl: "https://www.switzerland-sothebysrealty.ch/",
  },
  blueImmobilier: {
    name: "Blue Immobilier",
    listingsUrl: "http://www.blueimmobilier.ch/",
  },
  verbel: {
    name: "Verbel",
    listingsUrl: "https://www.verbel.ch/",
  },
  suisseRiviera: {
    name: "Suisse Riviera Immobilier",
    listingsUrl: "https://www.suisse-riviera-immobilier.com/",
  },
  ernstBeier: {
    name: "Ernst Beier",
    listingsUrl: "http://www.ernstbeier.ch/",
  },
  lcImmobilier: {
    name: "LC Immobilier",
    listingsUrl: "http://www.lc-immobilier.ch/",
  },
  lagenceImmobiliere: {
    name: "L'Agence Immobiliere",
    listingsUrl: "https://lagence-immobiliere.ch/",
  },
  lcrImmo: {
    name: "LCR Immo",
    listingsUrl: "http://www.lcr-immo.ch/",
  },
  swixim: {
    name: "Swixim",
    listingsUrl: "https://www.swixim.ch/",
  },
  profilId: {
    name: "Profil ID",
    listingsUrl: "https://profil-id.ch/",
  },
  wRe: {
    name: "W Real Estate",
    listingsUrl: "http://www.w-re.ch/",
  },
  rilsa: {
    name: "Rilsa",
    listingsUrl: "http://www.rilsa.ch/",
  },
  helvetImmo: {
    name: "Helvet Immo",
    listingsUrl: "http://www.helvet-immo.ch/",
  },
  regicote: {
    name: "Regicote",
    listingsUrl: "https://www.regicote.ch/",
  },
  swissdomImmo: {
    name: "Swissdom Immo",
    listingsUrl: "https://www.swissdom-immo.ch/",
  },
  morgesImmo: {
    name: "Morges Immo",
    listingsUrl: "http://www.morgesimmo.ch/",
  },
  gaiaImmobilier: {
    name: "Gaia Immobilier",
    listingsUrl: "https://www.gaia-immobilier.ch/",
  },
  reyImmobilier: {
    name: "Rey Immobilier",
    listingsUrl: "https://reyimmobilier.ch/",
  },
  sherlockHomes: {
    name: "Sherlock Homes",
    listingsUrl: "https://sherlockhomes.ch/",
  },
  deLuze: {
    name: "De Luze",
    listingsUrl: "https://deluze.ch/",
  },
  lugrinImmobilier: {
    name: "Lugrin Immobilier",
    listingsUrl: "https://lugrinimmobilier.ch/",
  },
  laSuiteImmo: {
    name: "La Suite Immo",
    listingsUrl: "https://www.lasuiteimmo.ch/",
  },
  ril: {
    name: "RIL",
    listingsUrl: "http://ril.ch/",
  },
  geranceJotterand: {
    name: "Gerance Jotterand",
    listingsUrl: "http://www.gerancejotterand.ch/",
  },
  cedimmo: {
    name: "Cedimmo",
    listingsUrl: "https://www.cedimmo.ch/",
  },
  aImmobilier: {
    name: "A-Immobilier",
    listingsUrl: "http://a-immobilier.ch/",
  },
  curtetImmobilier: {
    name: "Curtet Immobilier",
    listingsUrl: "http://www.curtet-immobilier.ch/",
  },
  amma: {
    name: "Amma Immo",
    listingsUrl: "https://amma.immo/",
  },
  bobstImmobilier: {
    name: "Bobst Immobilier",
    listingsUrl: "http://www.bobst-immobilier.ch/",
  },
  castellaImmobilier: {
    name: "Castella Immobilier",
    listingsUrl: "http://www.castella-immobilier.ch/",
  },
  capitalFirst: {
    name: "Capital First",
    listingsUrl: "https://www.capitalfirst.ch/",
  },
  regieDecker: {
    name: "Regie Decker",
    listingsUrl: "http://www.regiedecker.ch/",
  },
  rockwell: {
    name: "Rockwell",
    listingsUrl: "http://www.rockwell.ch/",
  },
  christeImmo: {
    name: "Christe Immo",
    listingsUrl: "http://www.christe-immo.ch/",
  },
  krealImmo: {
    name: "Kreal Immo",
    listingsUrl: "https://krealimmo.ch/",
  },
  myHomeImmobilier: {
    name: "My Home Immobilier",
    listingsUrl: "https://www.myhomeimmobilier.ch/",
  },
  privera: {
    name: "Privera",
    listingsUrl: "https://www.privera.ch/fr/home",
  },
  phoenixImmobilier: {
    name: "Phoenix Immobilier",
    listingsUrl: "http://www.phoenix-immobilier.ch/",
  },
  votreCourtier: {
    name: "Votre Courtier",
    listingsUrl: "https://www.votrecourtier.ch/",
  },
  realtaImmo: {
    name: "Realta Immo",
    listingsUrl: "https://www.realtaimmo.ch/",
  },
  valhome: {
    name: "Valhome",
    listingsUrl: "http://valhome.ch/",
  },
  monnierImmo: {
    name: "Monnier Immo",
    listingsUrl: "https://monnier-immo.ch/",
  },
  regiePrivee: {
    name: "Regie Privee",
    listingsUrl: "https://www.regieprivee.ch/",
  },
  immoConsulting: {
    name: "Immo Consulting",
    listingsUrl: "http://www.immo-consulting.ch/",
  },
  acheterLouer: {
    name: "Acheter Louer",
    listingsUrl: "http://www.acheter-louer.ch/",
  },
  impulseProperties: {
    name: "Impulse Properties",
    listingsUrl: "https://www.impulseproperties.ch/",
  },
  scImmo: {
    name: "SC Immo",
    listingsUrl: "http://www.scimmo.ch/",
  },
  foncimo: {
    name: "Foncimo",
    listingsUrl: "https://foncimo.ch/",
  },
  intergerance: {
    name: "Intergerance",
    listingsUrl: "http://www.intergerance.ch/",
  },
  selectImmo: {
    name: "Select Immo",
    listingsUrl: "http://www.selectimmo.ch/",
  },
  ceriseImmobilier: {
    name: "Cerise Immobilier",
    listingsUrl: "http://www.cerise-immobilier.ch/",
  },
  valImmobilier: {
    name: "Val Immobilier",
    listingsUrl: "https://valimmobilier.ch/",
  },
  alturaCollection: {
    name: "Altura Collection",
    listingsUrl: "https://alturacollection.ch/",
  },
  drapelImmobilier: {
    name: "Drapel Immobilier",
    listingsUrl: "http://drapelimmobilier.ch/",
  },
  bertrandMorisod: {
    name: "Bertrand Morisod",
    listingsUrl: "http://www.bertrand-morisod.ch/",
  },
  schenkImmobilier: {
    name: "Schenk Immobilier",
    listingsUrl: "https://schenk-immobilier.ch/",
  },
  gemImmo: {
    name: "Gem Immo",
    listingsUrl: "http://www.gem-immo.ch/",
  },
  natimmo: {
    name: "Natimmo",
    listingsUrl: "http://www.natimmo.ch/",
  },
  faraoneImmobilier: {
    name: "Faraone Immobilier",
    listingsUrl: "http://www.faraone-immobilier.ch/",
  },
  gilliandImmobilier: {
    name: "Gilliand Immobilier",
    listingsUrl: "http://www.gilliand-immobilier.ch/",
  },
  immobilierBroye: {
    name: "Immobilier Broye",
    listingsUrl: "http://www.immobilier-broye.ch/",
  },
  regieChatelard: {
    name: "Regie Chatelard",
    listingsUrl: "http://www.regiechatelard.ch/",
  },
  nicolierImmobilier: {
    name: "Nicolier Immobilier",
    listingsUrl: "https://nicolier-immobilier.ch/",
  },
  regieBroye: {
    name: "Regie Broye",
    listingsUrl: "https://regie-broye.ch/",
  },
  lcpImmobilier: {
    name: "LCP Immobilier",
    listingsUrl: "https://www.lcp-immobilier.ch/",
  },
  symbioseImmobilier: {
    name: "Symbiose Immobilier",
    listingsUrl: "https://www.symbiose-immobilier.ch/",
  },
  groupeRichard: {
    name: "Groupe Richard",
    listingsUrl: "http://www.grouperichard.ch/",
  },
  caImmobilier: {
    name: "CA Immobilier",
    listingsUrl: "https://www.ca-immobilier.ch/",
  },
  gestival: {
    name: "Gestival",
    listingsUrl: "http://gestival.ch/",
  },
  concretise: {
    name: "Concretise",
    listingsUrl: "https://www.concretise.ch/",
  },
  nideal: {
    name: "Nideal",
    listingsUrl: "http://www.nideal.ch/",
  },
  remax: {
    name: "RE/MAX",
    listingsUrl: "https://www.remax.ch/epalinges",
  },
  homequest: {
    name: "Homequest",
    listingsUrl: "https://homequest.ch/",
    canton: "vaud",
  },
  // ── Agences VD supplementaires ────────────────────────────────────────
  denaliImmo: {
    name: "Denali Immobilier",
    listingsUrl: "https://www.denali-sa.ch/",
  },
  tissotImmo: {
    name: "TissoT Immobilier",
    listingsUrl: "https://www.tissot-immobilier.ch/",
  },
  swissPatrimoine: {
    name: "Swiss Patrimoine Immobilier",
    listingsUrl: "https://www.swiss-patrimoine-immobilier.ch/",
  },
  agenceLeman: {
    name: "Agence Immobilière du Léman",
    listingsUrl: "https://www.agence-leman.ch/",
  },
  vaudburo: {
    name: "Vaudburo",
    listingsUrl: "https://www.vaudburo.ch/",
  },
  cardisSothebys: {
    name: "Cardis Sotheby's",
    listingsUrl: "https://www.cardis.ch/",
  },
  // ── Agences Vaud supplémentaires (import CSV) ──────────────────
  abImmobilierRelocation: { name: "AB immobilier & Relocation", listingsUrl: "https://www.abimmobilier.ch/fr/" },
  adValoremRealEstate: { name: "AD VALOREM Real Estate Sàrl", listingsUrl: "https://ad-valorem.ch/" },
  adsImmoServices: { name: "ADS IMMO-SERVICES", listingsUrl: "https://ads-immo.ch/" },
  afinaImmobilier: { name: "AFINA SA Immobilier", listingsUrl: "https://afinasa.ch/" },
  agooddayRelocationRealEstate: { name: "AGOODDAY relocation & real estate Sàrl", listingsUrl: "https://www.agoodday.ch/" },
  ak2c: { name: "AK2C Sàrl", listingsUrl: "https://realisations.ak2c.ch/" },
  alephInvest: { name: "ALEPH Invest SA", listingsUrl: "https://www.alephinvest.ch/" },
  am3Office: { name: "AM3 Office SA", listingsUrl: "http://www.am3office.ch/" },
  artaArchitecturePromotionConstruction: { name: "ARTA SA - Architecture – Promotion - Construction", listingsUrl: "https://arta.ch/" },
  asImmobilier: { name: "AS Immobilier Sàrl", listingsUrl: "https://www.as-immobilier.ch/" },
  assei: { name: "ASSEI Sàrl", listingsUrl: "https://www.assei.ch/" },
  atHomeRegieImmobiliere: { name: "AT-HOME Régie Immobilière SA", listingsUrl: "https://regieathome.ch/" },
  atixImmobilier: { name: "ATIX Immobilier", listingsUrl: "https://atix-immobilier.ch/" },
  azRealEstate: { name: "AZ Real Estate Sàrl", listingsUrl: "https://arbez-realestate.ch/" },
  accordImmobilier: { name: "Accord Immobilier Sàrl", listingsUrl: "https://accord-immo.ch/" },
  accordiaImmo: { name: "Accordia-Immo", listingsUrl: "https://accordia-immo.ch/" },
  acheterImmo: { name: "Acheter.immo", listingsUrl: "https://acheter.immo/" },
  acheteurCh: { name: "Acheteur.ch SA", listingsUrl: "https://acheteur.ch/" },
  activeTradeManagement: { name: "Active Trade Management Sàrl", listingsUrl: "https://activetrademanagement.ch/" },
  actuaireImmobilier: { name: "Actuaire Immobilier SA", listingsUrl: "https://yellow.local.ch/d/Upv_UC96Jy9JnWbVw3AsZQ" },
  adminpro: { name: "AdminPro", listingsUrl: "https://adminpro.ch/" },
  agenceImmobiliereFSchneeberger: { name: "Agence Immobilière F. Schneeberger SA", listingsUrl: "https://schneeberger-immo.ch/" },
  agenceImmobilierePatricePisler: { name: "Agence Immobilière Patrice Pisler", listingsUrl: "https://patrice-pisler-immo.ch/" },
  agenceLpmImmobilierGerance2000: { name: "Agence LPM Immobilier – Gérance 2000", listingsUrl: "https://www.lpmimmo.ch/" },
  agenceScobi: { name: "Agence Scobi", listingsUrl: "http://www.scobi.ch/" },
  agenceImmobiliereDuChateau: { name: "Agence immobilière du Château", listingsUrl: "http://www.immochateau.ch/" },
  akysiaImmobilier: { name: "Akysia Immobilier", listingsUrl: "https://www.akysia.ch/" },
  allianceImmo: { name: "Alliance Immo", listingsUrl: "https://allianceimmo.ch/" },
  alterimo: { name: "Alterimo Sàrl", listingsUrl: "https://www.alterimo.ch/" },
  altissImmobilier: { name: "Altiss Immobilier", listingsUrl: "https://altiss-immobilier.ch/" },
  alvazziImmobilier: { name: "Alvazzi Immobilier SA", listingsUrl: "http://www.alvazzi.ch/" },
  andreHomes: { name: "André Homes Sàrl", listingsUrl: "https://andrehomes.ch/" },
  apleonaSuisse: { name: "Apleona Suisse SA", listingsUrl: "https://local.ch/en/d/geneva/1202/apleona-suisse-sa-uNVH6zVts-uRpg_2n_FMdg" },
  ariexDeveloppementsImmobiliers: { name: "Ariex Développements Immobiliers SA", listingsUrl: "https://ariex.ch/" },
  arimco: { name: "Arimco Sàrl", listingsUrl: "https://arimco.ch/" },
  artStoneDeveloppement: { name: "Art Stone développement SA", listingsUrl: "https://art-stone.ch/" },
  associesCourtiers: { name: "Associés Courtiers SA", listingsUrl: "https://associescourtiers.ch/" },
  assumob: { name: "Assumob SA", listingsUrl: "https://www.assumob.ch/" },
  atelier94Architecture: { name: "Atelier94 Architecture SA", listingsUrl: "http://www.atelier94.ch/" },
  aurlau: { name: "Aurlau SA", listingsUrl: "https://www.aurlau.ch/" },
  avantaImmobilier: { name: "Avanta Immobilier", listingsUrl: "https://www.avantaimmo.ch/" },
  axihome: { name: "Axihome SA", listingsUrl: "http://www.axihome.ch/" },
  bbwGestion: { name: "BBW Gestion Sàrl", listingsUrl: "http://www.bbwgestion.ch/" },
  berose: { name: "BEROSE SA", listingsUrl: "http://www.berose-sa.ch/" },
  bldImmobilier: { name: "BLD Immobilier SA", listingsUrl: "http://www.bldimmobilier.ch/" },
  baloccoImmobilier: { name: "Balocco Immobilier", listingsUrl: "https://www.balocco-immobilier.ch/" },
  barguetonImmobilier: { name: "Bargueton immobilier", listingsUrl: "https://bargueton.ch/" },
  batilogis: { name: "Batilogis SA", listingsUrl: "https://www.batilogis.ch/" },
  batimoV: { name: "Batimo\'V Sàrl", listingsUrl: "https://www.batimov.ch/" },
  beauSoleilConseils: { name: "Beau-Soleil Conseils", listingsUrl: "https://beausoleilconseils.ch/" },
  bellerivePropertiesLausanne: { name: "Bellerive Properties - Lausanne", listingsUrl: "https://bellerive-properties.ch/en" },
  bernardNicodLausanneBenjaminConstantGerance: { name: "Bernard Nicod Lausanne - Benjamin Constant - Gérance", listingsUrl: "https://www.bernard-nicod.ch/" },
  bestpartnerImmo: { name: "BestPartner Immo Sàrl", listingsUrl: "https://bestpartnerimmo.ch/" },
  bossiImmobilier: { name: "Bossi Immobilier", listingsUrl: "https://bossi-immo.ch/" },
  brumont: { name: "Brumont SA", listingsUrl: "https://brumont.ch/" },
  brymmo: { name: "Brymmo", listingsUrl: "https://brymmo.ch/" },
  bugnonImmobilier: { name: "Bugnon Immobilier Sàrl", listingsUrl: "https://immobilier-broye.ch/" },
  bureauImmobilierRomand: { name: "Bureau Immobilier Romand SA", listingsUrl: "https://www.bir.immo/" },
  bosigerImmobilier: { name: "Bösiger Immobilier", listingsUrl: "https://www.bosigerimmobilier.ch/" },
  calbCourtageALBourquin: { name: "CALB Courtage A-L Bourquin", listingsUrl: "https://calb-immo.ch/" },
  caractere: { name: "CARACTERE", listingsUrl: "https://caractere-immobilier.ch/" },
  cardisImmobilier: { name: "CARDIS Immobilier", listingsUrl: "https://cardis.ch/" },
  casanImmobilier: { name: "CASAN immobilier Sàrl", listingsUrl: "https://www.casan-immobilier.ch/fr" },
  cbTransimmo: { name: "CB Transimmo Sàrl", listingsUrl: "http://www.cbtransimmo.ch/" },
  cdfImmobilier: { name: "CDF immobilier SA", listingsUrl: "https://cdf-immobilier.ch/" },
  ceDi: { name: "CE & DI Sàrl", listingsUrl: "https://ce-di.ch/" },
  cfImmobilierCompagnieFonciereChateauDOex: { name: "CF Immobilier Compagnie Foncière SA - Château-d\'Oex", listingsUrl: "https://cfimmobilier.ch/" },
  cfpImmoConseils: { name: "CFP Immo + Conseils", listingsUrl: "http://www.cfp-immo.ch/" },
  cggiChristianGanderGestionImmobiliere: { name: "CGGI Sarl - Christian Gander Gestion Immobilière", listingsUrl: "https://cggi.ch/fr/" },
  clImmobilier: { name: "CL immobilier", listingsUrl: "https://cl-immo.ch/" },
  cmvImmobilier: { name: "CMV Immobilier", listingsUrl: "https://cmv-immo.ch/" },
  codimmo: { name: "CODIMMO SA", listingsUrl: "https://codimmo.ch/" },
  cygneImmobilierCourtage: { name: "CYGNE Immobilier & Courtage", listingsUrl: "https://cygne.immo/" },
  canobat: { name: "Canobat SA", listingsUrl: "https://canobat.ch/" },
  casAme: { name: "Cas\'Âme Sàrl", listingsUrl: "https://casame-immobilier.ch/" },
  cassiopeeImmobilier: { name: "Cassiopee Immobilier SA", listingsUrl: "https://cassiopee.immo/" },
  cedream: { name: "Cedream SA", listingsUrl: "https://cedream.ch/" },
  cercleImmoSuisse: { name: "Cercle Immo Suisse Sàrl", listingsUrl: "https://cercle-immo-suisse.ch/" },
  cervero: { name: "Cerveró Sàrl", listingsUrl: "https://cervero.ch/" },
  chamberonneImmobilier: { name: "Chamberonne Immobilier Sàrl", listingsUrl: "https://chamberonne.ch/" },
  chiffelleImmobilier: { name: "Chiffelle Immobilier", listingsUrl: "http://www.chiffelle-immobilier.ch/" },
  claudioPizzaImmobilier: { name: "Claudio Pizza immobilier", listingsUrl: "https://clpimmobilier.ch/" },
  clientPartenaireImmobilier: { name: "Client & Partenaire Immobilier", listingsUrl: "https://cp-immobilier.ch/" },
  clemo: { name: "Clémo Sàrl", listingsUrl: "https://clemo.immo/" },
  cofideco: { name: "Cofideco SA", listingsUrl: "https://cofideco.ch/" },
  cofingestImmobilier: { name: "Cofingest Immobilier SA", listingsUrl: "https://cofingest.ch/" },
  coldwellBankerSwissRiviera: { name: "Coldwell Banker Swiss Riviera", listingsUrl: "https://www.transaxia.ch/en/" },
  comptacart: { name: "Comptacart Sàrl", listingsUrl: "https://regie-immobiliere-comparatif.ch/d/regies-immobilieres/comptacart-sarl-d:YrhPSYKgX" },
  confidenceImmobilier: { name: "Confidence Immobilier Sàrl", listingsUrl: "https://confidence-immobilier.ch/" },
  cooperativeHelvetiqueFonciere: { name: "Coopérative Helvétique Foncière", listingsUrl: "https://www.chf.immo/" },
  copeco: { name: "Copeco SA", listingsUrl: "https://coppet-immobilier.ch/" },
  coralieAnkerImmobilier: { name: "Coralie Anker Immobilier", listingsUrl: "https://ca-immobilier.ch/" },
  corsiniImmobilier: { name: "Corsini Immobilier", listingsUrl: "https://corsini-immobilier.ch/" },
  courtacasa: { name: "Courtacasa", listingsUrl: "https://www.courtacasa.ch/" },
  cozyCo: { name: "Cozy Co. Sàrl", listingsUrl: "https://www.cozyco.ch/" },
  crazymmo: { name: "CrazYmmO Sàrl", listingsUrl: "https://crazymmo.ch/" },
  cronosImmo: { name: "Cronos Immo", listingsUrl: "https://www.cronosfinance.ch/en/" },
  coteHabitats: { name: "Côté Habitats", listingsUrl: "http://www.cotehabitats.ch/en/" },
  dHomesImmobilier: { name: "D HOMES IMMOBILIER SA", listingsUrl: "https://dhomes.ch/" },
  danieleEggenbergerImmobilier: { name: "DANIELE EGGENBERGER IMMOBILIER", listingsUrl: "https://daniele-eggenberger.ch/" },
  dfImmo: { name: "DF Immo", listingsUrl: "https://df.immo/" },
  dhrImmobilier: { name: "DHR Immobilier SA", listingsUrl: "https://www.dhr.ch/fr/main/index" },
  dmcImmobilier: { name: "DMC Immobilier", listingsUrl: "https://dmc-ls.ch/" },
  demaceImmobilier: { name: "Demace Immobilier", listingsUrl: "http://www.demace-immobilier.ch/" },
  destimmo: { name: "Destimmo SA", listingsUrl: "https://www.destimmo.ch/" },
  domusImmo: { name: "Domus Immo Sàrl", listingsUrl: "https://domusimmo.ch/" },
  dufourImmobilier: { name: "Dufour Immobilier", listingsUrl: "https://www.dufour.immo/" },
  dunimmo: { name: "Dunimmo Sàrl", listingsUrl: "https://dunimmo.ch/" },
  duoImmobilier: { name: "Duo immobilier", listingsUrl: "https://duoimmobilier.ch/" },
  durablementImmobilier: { name: "Durablement Immobilier SA", listingsUrl: "https://durablement.immo/" },
  dynastyImmobilier: { name: "Dynasty Immobilier", listingsUrl: "https://www.dynasty-immobilier.ch/" },
  ecofisc: { name: "ECOFISC", listingsUrl: "https://ecofisc.ch/" },
  easyGerance: { name: "Easy Gérance", listingsUrl: "https://easy-gerance.ch/" },
  easyImmobilier: { name: "Easy Immobilier", listingsUrl: "https://easy-immobilier.ch/" },
  estatevalue: { name: "EstateValue", listingsUrl: "https://estatevalue.ch/" },
  estoppeyImmobilier: { name: "Estoppey Immobilier Sàrl", listingsUrl: "https://www.estoppey-immobilier.ch/" },
  euroCourtage: { name: "Euro-Courtage", listingsUrl: "https://www.eurocourtage.ch/en" },
  everlakeImmobilier: { name: "Everlake Immobilier", listingsUrl: "https://everlake.ch/en/" },
  fidi: { name: "FIDI SA", listingsUrl: "http://www.fidisa.ch/" },
  fpGestion: { name: "FP Gestion", listingsUrl: "https://fpgestion.ch/" },
  familiaPlan: { name: "Familia Plan SA", listingsUrl: "https://www.familiaplan.ch/" },
  fehlmannImmobilier: { name: "Fehlmann Immobilier SA", listingsUrl: "https://f-immob.ch/" },
  fidalpAuditConsultancy: { name: "Fidalp Audit & Consultancy SA", listingsUrl: "https://fidalp.ch/" },
  fiduciaireJaques: { name: "Fiduciaire Jaques SA", listingsUrl: "https://fid-jaques.ch/" },
  fiduciairePrismaSolutions: { name: "Fiduciaire Prisma Solutions Sàrl", listingsUrl: "http://www.prismasolutions.ch/" },
  fiduciaireEtGerancePatrickRidoux: { name: "Fiduciaire et Gérance Patrick Ridoux SA", listingsUrl: "https://ridoux.ch/" },
  filemiProperties: { name: "Filemi Properties SA", listingsUrl: "http://www.filemi.ch/" },
  flat4expat: { name: "Flat4expat", listingsUrl: "https://flat4expat.ch/" },
  fleximmo: { name: "Fleximmo SA", listingsUrl: "https://www.fleximmo.ch/en" },
  freeConceptImmobilier: { name: "Free Concept Immobilier", listingsUrl: "https://freeconceptimmo.ch/" },
  froidevauxImmobilier: { name: "Froidevaux Immobilier SA", listingsUrl: "http://www.froidevaux-immobilier.ch/" },
  furerRegisseursEtCourtiersMontreux: { name: "Furer SA, Régisseurs et Courtiers - Montreux", listingsUrl: "https://furer.ch/" },
  gerofinanceRegieDuRhoneLocationPrestige: { name: "GEROFINANCE - RÉGIE DU RHÔNE | Location PRESTIGE", listingsUrl: "https://en.gerofinance.ch/" },
  globePlanCie: { name: "GLOBE PLAN & Cie SA", listingsUrl: "https://www.globeplan.ch/" },
  goahProperties: { name: "GOAH PROPERTIES", listingsUrl: "https://goah-properties.ch/" },
  grangeImmobilierNyon: { name: "GRANGE Immobilier SA - Nyon", listingsUrl: "https://grange.ch/" },
  gryonImmobilierHomeStory: { name: "GRYON IMMOBILIER & HOME STORY", listingsUrl: "https://gryon-immobilier.ch/" },
  gerHome: { name: "Ger-Home SA", listingsUrl: "http://www.ger-home.ch/" },
  gerim: { name: "Gerim SA", listingsUrl: "https://www.gerim.ch/" },
  gestImmo: { name: "Gest-Immo", listingsUrl: "https://gest.immo/" },
  glauserImmobilier: { name: "Glauser Immobilier SA", listingsUrl: "http://www.glauserimmo.ch/" },
  goumazCie: { name: "Goumaz & Cie Sàrl", listingsUrl: "https://goumaz.swiss/" },
  goumazImmobilier: { name: "Goumaz Immobilier SA", listingsUrl: "https://goumaz-immobilier.ch/" },
  groheImmobilier: { name: "Grohe Immobilier SA", listingsUrl: "https://grohedev.ch/" },
  guestlee: { name: "GuestLee", listingsUrl: "https://guestlee.ch/" },
  guedonGerance: { name: "Guédon Gérance SA", listingsUrl: "https://guedon.ch/" },
  geranceBorgeaud: { name: "Gérance Borgeaud", listingsUrl: "https://gerance-borgeaud.ch/" },
  geranceEmery: { name: "Gérance Emery SA", listingsUrl: "http://www.gerancemery.ch/" },
  geranceService: { name: "Gérance Service SA", listingsUrl: "https://gerance-service.ch/" },
  hlTheurillatImmobilierClarens: { name: "HL Theurillat Immobilier - Clarens", listingsUrl: "https://hlinteriors.ch/" },
  horecaCourtage: { name: "HORECA Courtage Sàrl", listingsUrl: "https://horeca-courtage.ch/" },
  hrsRealEstate: { name: "HRS Real Estate SA", listingsUrl: "https://hrs.ch/" },
  habeg: { name: "Habeg Sàrl", listingsUrl: "https://habeg.ch/" },
  hermesis: { name: "Hermesis Sàrl", listingsUrl: "https://hermesis.ch/" },
  hestiaImmobilier: { name: "Hestia Immobilier Sàrl", listingsUrl: "https://hestia-immobilier.ch/" },
  homePlusLaCote: { name: "Home Plus La Côte Sàrl", listingsUrl: "https://homeplus.ch/" },
  homePlus: { name: "Home Plus Sàrl", listingsUrl: "http://www.homeplus.ch/" },
  homeSmart: { name: "Home-Smart", listingsUrl: "https://home-smart.ch/" },
  homisRealEstate: { name: "Homis Real Estate Sàrl", listingsUrl: "https://homis.ch/" },
  horizonPromotionRegie: { name: "Horizon Promotion & Régie", listingsUrl: "https://www.horizon-immob.ch/" },
  iFacchinetti: { name: "I-Facchinetti Sàrl", listingsUrl: "http://www.i-facchinetti.ch/" },
  ibkPromotion: { name: "IBK Promotion Sàrl", listingsUrl: "https://ibk-promotion.ch/" },
  immoPerformance: { name: "IMMO PERFORMANCE Sàrl", listingsUrl: "https://immoperformance.ch/" },
  immoLausanne: { name: "IMMO-LAUSANNE SA", listingsUrl: "http://immo-lausanne.ch/" },
  immoPassion: { name: "IMMO-PASSION SA", listingsUrl: "https://www.immobilier-passion.ch/" },
  immo62: { name: "IMMO62 Sàrl", listingsUrl: "https://immo62.ch/" },
  immobilierRufenacht: { name: "IMMOBILIER RUFENACHT SA", listingsUrl: "https://immobilierrufenacht.ch/" },
  imosImmobilierEtConseils: { name: "IMOS Immobilier et Conseils", listingsUrl: "https://imos-immobilier.ch/" },
  ideeDAilleurs: { name: "Idée d\'ailleurs", listingsUrl: "https://idee-dailleurs.ch/" },
  immoExperience: { name: "Immo Experience", listingsUrl: "http://www.immo-experience.ch/" },
  immoHuguenin: { name: "Immo Huguenin", listingsUrl: "https://www.immo-huguenin.ch/" },
  immoPartners: { name: "Immo Partners SA", listingsUrl: "https://immopartners.ch/" },
  immoJuillerat: { name: "Immo-Juillerat Sàrl", listingsUrl: "https://immobilier-juillerat.ch/" },
  immoRama: { name: "Immo-Rama", listingsUrl: "https://immo-rama.ch/" },
  immoSoluce: { name: "Immo-Soluce Sàrl", listingsUrl: "https://immo-soluce.ch/" },
  immo2f: { name: "Immo2F", listingsUrl: "http://www.immo2f.ch/" },
  immo2z: { name: "Immo2Z Sàrl", listingsUrl: "https://www.immo2z.ch/" },
  immobiliereDeLausanne: { name: "Immobilière de Lausanne", listingsUrl: "https://immobiliere-de-lausanne.ch/" },
  immocloud: { name: "Immocloud Sàrl", listingsUrl: "https://immocloudsarl.ch/" },
  immoflorImmobilier: { name: "Immoflor Immobilier", listingsUrl: "https://www.immoflor.com/en" },
  immoregie: { name: "Immoregie Sàrl", listingsUrl: "https://www.immoregie.ch/" },
  infinimmo: { name: "Infinimmo Sàrl", listingsUrl: "http://www.infinimmo.ch/" },
  innoteck: { name: "InnoTeck Sàrl", listingsUrl: "https://innotechsarl.ch/" },
  investim: { name: "Investim Sàrl", listingsUrl: "http://www.investim.ch/" },
  jfrImmobilier: { name: "JFR Immobilier", listingsUrl: "https://jfr.ch/" },
  jespierreImmobilierNyon: { name: "Jespierre Immobilier - Nyon", listingsUrl: "https://jespierre.ch/" },
  joImmo: { name: "Jo immo Sàrl", listingsUrl: "https://joimmo.ch/" },
  kaymo: { name: "KAYMO Sàrl", listingsUrl: "https://kaymo.ch/" },
  kfCourtageImmobilier: { name: "KF Courtage Immobilier", listingsUrl: "https://www.kf-immobilier.ch/" },
  krLocations: { name: "KR Locations", listingsUrl: "https://krlocations.ch/" },
  karmaImmobilier: { name: "Karma Immobilier", listingsUrl: "https://karma-immobilier.ch/" },
  kasameaImmobilier: { name: "KasaMea Immobilier", listingsUrl: "http://www.kasamea.ch/" },
  kempterImmobilier: { name: "Kempter Immobilier Sàrl", listingsUrl: "https://kempter-immobilier.ch/" },
  keyRelocation: { name: "Key Relocation Sàrl", listingsUrl: "https://www.key-relocation.ch/" },
  key4uProperty: { name: "Key4U Property", listingsUrl: "http://www.key4u-property.ch/" },
  killiasImmobilier: { name: "Killias Immobilier Sàrl", listingsUrl: "https://www.killias-immobilier.ch/" },
  l3PropertiesInternationalRealty: { name: "L3 Properties | International Realty", listingsUrl: "https://l3-properties.ch/" },
  l3mPartners: { name: "L3M Partners SA", listingsUrl: "https://l3m-partners.ch/" },
  lavaImmo: { name: "LAVA-IMMO", listingsUrl: "http://www.lava-immo.ch/" },
  ldImmobilier: { name: "LD Immobilier", listingsUrl: "https://ldimmobilier.ch/" },
  lemanConseilImmobilier: { name: "LEMAN CONSEIL IMMOBILIER", listingsUrl: "http://lcimmo.ch/" },
  lialRealEstate: { name: "LIAL-REAL Estate", listingsUrl: "https://www.lial-realestate.ch/" },
  lismoreRelocation: { name: "LISMORE RELOCATION Sàrl", listingsUrl: "https://lismore-relocation.ch/" },
  lmlImmobilier: { name: "LML immobilier", listingsUrl: "https://www.lml-immo.ch/" },
  locatellimmo: { name: "LOCATELLIMMO", listingsUrl: "https://www.locatellimmo.ch/" },
  lscourtage: { name: "LSCourtage", listingsUrl: "https://lscourtage.ch/" },
  lsgImmo: { name: "LSG Immo Sàrl", listingsUrl: "https://lsg-immo.ch/" },
  lvtic: { name: "LVTiC", listingsUrl: "http://www.lvtic.ch/" },
  lyImmoMedSwiss: { name: "LY IMMO MED Swiss", listingsUrl: "https://www.ly-immomed.ch/" },
  leFirstImmo: { name: "Le First Immo SA", listingsUrl: "https://www.first-immo.ch/" },
  lecoultreImmobilier: { name: "Lecoultre Immobilier", listingsUrl: "https://www.lecoultre-immobilier.ch/" },
  levadimmo: { name: "LevadImmo SA", listingsUrl: "https://levadimmo.ch/" },
  lignariusImmobilier: { name: "Lignarius Immobilier", listingsUrl: "https://lignarius-immobilier.ch/" },
  lioImmo: { name: "Lio Immo", listingsUrl: "https://www.lio-immo.ch/en" },
  locom: { name: "Locom Sàrl", listingsUrl: "https://locom.ch/" },
  logibat: { name: "Logibat SA", listingsUrl: "https://logibat.ch/" },
  logistimmo: { name: "Logistimmo SA", listingsUrl: "https://logistimmo.ch/" },
  louisePicadus: { name: "Louise & Picadus Sàrl", listingsUrl: "https://louise-picadus.ch/" },
  mHomeImmobilier: { name: "M Home - Immobilier", listingsUrl: "https://mhome.immo/" },
  mBGeranceImmobiliere: { name: "M&B Gérance Immobilière SA", listingsUrl: "http://www.mbsa.ch/" },
  marmaxImmobilier: { name: "MARMAX immobilier SA", listingsUrl: "https://www.marmax.ch/" },
  mediapixelImmobilier: { name: "MEDIAPIXEL IMMOBILIER SA", listingsUrl: "https://mediapixelimmo.ch/" },
  mgmFiduciaire: { name: "MGM Fiduciaire SA", listingsUrl: "https://mgm.ch/" },
  misaImmobilier: { name: "MISA Immobilier SA", listingsUrl: "https://www.misa-gerance.ch/" },
  mmsHolding: { name: "MMS Holding SA", listingsUrl: "https://militarymegastore.ch/" },
  mmsPro: { name: "MMS Pro SA", listingsUrl: "http://www.mmspro.ch/" },
  mnmImmobilier: { name: "MNM Immobilier Sàrl", listingsUrl: "http://www.mnm-immobilier.ch/" },
  moversCourtageImmobilierPersonnaliseAgatheGumy: { name: "MOVERS Courtage immobilier personnalisé - Agathe Gumy", listingsUrl: "https://www.movers-courtage.ch/" },
  marilimmo: { name: "Marilimmo", listingsUrl: "https://marilimmo.ch/" },
  martelliImmobilier: { name: "Martelli Immobilier", listingsUrl: "https://www.martelli-immobilier.ch/" },
  martinelliImmobilier: { name: "Martinelli – Immobilier", listingsUrl: "https://martinelli-immobilier.ch/" },
  mavrix: { name: "Mavrix Sàrl", listingsUrl: "https://mavrix.ch/" },
  megImmo: { name: "Meg Immo Sàrl", listingsUrl: "https://www.meg-immo.ch/" },
  metafin: { name: "Metafin SA", listingsUrl: "https://metafin.ch/" },
  michoudiffusion: { name: "MichouDiffusion Sàrl", listingsUrl: "https://michoudiffusion.ch/" },
  midasProperties: { name: "Midas Properties SA", listingsUrl: "https://www.midas-properties.ch/en" },
  milestoneProperties: { name: "Milestone Properties", listingsUrl: "https://milestone.ch/" },
  miltonImmobilier: { name: "Milton Immobilier", listingsUrl: "https://miltonimmo.ch/" },
  morelImmo: { name: "Morel Immo", listingsUrl: "https://morel-immo.ch/" },
  multimmob: { name: "Multimmob", listingsUrl: "https://multimmob.ch/" },
  novaco: { name: "NOVACO SA", listingsUrl: "https://novaco.ch/" },
  naefCommercialKnightFrankVaud: { name: "Naef Commercial | Knight Frank - Vaud", listingsUrl: "https://www.naef-commercial.ch/en" },
  naefImmobilierLausanneBureauxAdministratifs: { name: "Naef Immobilier Lausanne - Bureaux administratifs", listingsUrl: "https://naef.ch/" },
  nathalieNicolierImmobilier: { name: "Nathalie Nicolier Immobilier", listingsUrl: "https://www.nnimmobilier.ch/" },
  nathome: { name: "Nathome Sàrl", listingsUrl: "http://www.nathome.ch/" },
  nestImmobilier: { name: "Nest Immobilier SA", listingsUrl: "https://ne-st.ch/" },
  newConceptImmo: { name: "New Concept Immo", listingsUrl: "https://mconceptimmo.ch/" },
  newhomeServices: { name: "NewHome Services SA", listingsUrl: "https://newhomeservices.ch/" },
  newlandProject: { name: "NewLand Project SA", listingsUrl: "https://newland-project.ch/" },
  nickGuisanRealty: { name: "Nick Guisan Realty", listingsUrl: "https://www.nickguisan.ch/" },
  nicoleCatherineMichelAgenceImmobiliere: { name: "Nicole & Catherine MICHEL Agence immobilière Sàrl", listingsUrl: "https://www.nicolemichel.ch/en" },
  norwood: { name: "Norwood SA", listingsUrl: "http://www.norwood.ch/" },
  noveoImmobilier: { name: "Novéo Immobilier SA", listingsUrl: "https://noveo-immobilier.ch/" },
  odeux: { name: "ODEUX SA", listingsUrl: "https://www.odeux.ch/" },
  ofD: { name: "OF-D Sàrl", listingsUrl: "https://www.of-d.ch/" },
  oikosImmo: { name: "OIKOS-Immo Sàrl", listingsUrl: "https://www.oikos-immo.ch/fr" },
  ommilos: { name: "Ommilos", listingsUrl: "https://ommilos.ch/" },
  opalliaHomes: { name: "Opallia Homes", listingsUrl: "https://www.opalliahomes.ch/en/" },
  opusConseils: { name: "Opus Conseils SA", listingsUrl: "https://opus-conseils.ch/" },
  ortegaImmobilier: { name: "Ortega Immobilier", listingsUrl: "https://www.ha.immo/" },
  pbbgGerancesEtGestionsImmobilieres: { name: "PBBG Gérances et Gestions Immobilières SA", listingsUrl: "https://pbbg.ch/" },
  privamob: { name: "PRIVAMOB S.A.", listingsUrl: "http://privamob.ch/" },
  publiazImmobilierLocationsMontreux: { name: "PUBLIAZ immobilier SA | Locations Montreux", listingsUrl: "https://publiaz.ch/" },
  publiazImmobilierLocationsRenens: { name: "PUBLIAZ immobilier SA | Locations Renens", listingsUrl: "https://publiaz.ch/louer/" },
  patriciaCantryn: { name: "Patricia Cantryn Sàrl", listingsUrl: "http://www.cantryn.ch/" },
  patrickDarboisImmobilier: { name: "Patrick Darbois immobilier", listingsUrl: "https://pdarboisimmobilier.ch/" },
  patrinov: { name: "Patrinov Sàrl", listingsUrl: "https://moneyhouse.ch/en/company/patrinov-sarl-3372715781" },
  petignatAmorImmobilier: { name: "Petignat & Amor immobilier SA", listingsUrl: "http://www.petignat-amor.ch/" },
  pfisterImmobilier: { name: "Pfister Immobilier SA", listingsUrl: "http://pfisterimmobilier.ch/" },
  platinumPromotion: { name: "Platinum Promotion SA", listingsUrl: "https://www.platinum-promotion.ch/en/" },
  pointDAncrageImmobilier: { name: "Point d\'Ancrage immobilier", listingsUrl: "https://www.pointdancrage.ch/" },
  poliRealEstate: { name: "Poli Real Estate SA", listingsUrl: "https://poli-real-estate.ch/" },
  posteImmobilierMS: { name: "Poste Immobilier M&S SA", listingsUrl: "https://immobilien.post.ch/fr" },
  poulyRenovationsEtServices: { name: "Pouly Rénovations et Services Sàrl", listingsUrl: "https://immoprs.ch/" },
  prestim: { name: "Prestim SA", listingsUrl: "http://prestim.ch/" },
  proLogementEchallens: { name: "Pro Logement SA | Echallens", listingsUrl: "https://prologement.ch/" },
  proconseilsImmobilier: { name: "ProConseils Immobilier Sàrl", listingsUrl: "https://proconseilssolutions.ch/" },
  proafcoImmobilier: { name: "Proafco immobilier", listingsUrl: "https://www.proafco.ch/" },
  procimmo: { name: "Procimmo SA", listingsUrl: "http://www.procimmo.ch/" },
  projectImmo: { name: "Project Immo Sàrl", listingsUrl: "http://www.projectimmo.ch/" },
  projesteam: { name: "Projesteam SA", listingsUrl: "https://projesteam.ch/" },
  promotionLaPoya: { name: "Promotion La Poya", listingsUrl: "https://www.promotionpoya.ch/" },
  protectimmo: { name: "Protectimmo SA", listingsUrl: "https://protectimmo.ch/" },
  puginImmobilier: { name: "Pugin immobilier", listingsUrl: "https://pugin-immobilier.ch/" },
  pulsarOpportunity: { name: "Pulsar Opportunity SA", listingsUrl: "https://pulsaropportunity.ch/" },
  qiLiving: { name: "QI LIVING", listingsUrl: "https://qiliving.ch/" },
  reMaxImmobilierAEpalinges: { name: "RE/MAX Immobilier à Epalinges", listingsUrl: "https://remax.ch/excellence" },
  richardImmobilier: { name: "RICHARD IMMOBILIER SA", listingsUrl: "https://grouperichard.ch/" },
  rpvYannCapt: { name: "RPV - Yann Capt", listingsUrl: "https://r-p-v.ch/" },
  rsServim: { name: "RS Servim Sàrl", listingsUrl: "https://servim.ch/" },
  ruchatImmobilier: { name: "RUCHAT Immobilier", listingsUrl: "https://ruchat-immobilier.ch/" },
  raizedRealEstate: { name: "Raized Real Estate SA", listingsUrl: "http://raized.ch/" },
  realEdenImmobilier: { name: "Real Eden Immobilier", listingsUrl: "https://www.realeden-immobilier.ch/" },
  realberg: { name: "Realberg", listingsUrl: "http://www.realberg.ch/" },
  realizeImmo: { name: "Realize Immo", listingsUrl: "https://letsfeelgood.ch/" },
  reference5Immobilier: { name: "Reference 5 immobilier SA", listingsUrl: "https://local.ch/fr/d/etagnieres/1037/agence-immobiliere/reference-5-immobilier-sa-YNdBlhK8pPErmHhLUgSrGA" },
  ressourcesImmobilieres: { name: "Ressources Immobilières", listingsUrl: "https://www.ressourcesimmobilieres.ch/" },
  rheaImmobilier: { name: "Rhéa Immobilier Sàrl", listingsUrl: "https://rhea-immobilier.ch/" },
  rissimGeneveVaudFribourg: { name: "Rissim Genève-Vaud-Fribourg", listingsUrl: "https://rissim.ch/fr" },
  rockwellProperties: { name: "Rockwell Properties SA", listingsUrl: "https://rockwell.ch/en/" },
  rolandSavaryImmobilierYverdon: { name: "Roland Savary Immobilier Yverdon SA", listingsUrl: "https://rsiy.ch/" },
  rolandSavaryImmobilier: { name: "Roland Savary immobilier SA", listingsUrl: "https://www.savaryimmobilier.ch/" },
  rossetLausanne: { name: "Rosset SA - Lausanne", listingsUrl: "https://www.rosset.ch/en/" },
  rudinImmobilier: { name: "Rudin Immobilier Sàrl", listingsUrl: "http://www.rudin-immobilier.ch/" },
  regieBally: { name: "Régie Bally SA", listingsUrl: "https://regiebally.ch/" },
  regieBraun: { name: "Régie Braun SA", listingsUrl: "http://www.regiebraun.ch/" },
  regieChamotCie: { name: "Régie CHAMOT & Cie SA", listingsUrl: "https://www.regiechamot.ch/en/" },
  regieDubouxLocations: { name: "Régie Duboux SA | Locations", listingsUrl: "https://regieduboux.ch/" },
  regieImmosphere: { name: "Régie IMMOSPHERE SA", listingsUrl: "https://regie-immosphere.ch/" },
  regieImmosol: { name: "Régie Immosol SA", listingsUrl: "https://immosol.ch/" },
  regieLuginbuhl: { name: "Régie Luginbühl", listingsUrl: "https://ril.ch/" },
  regieMarmillod: { name: "Régie Marmillod SA", listingsUrl: "https://regiemarmillod.ch/" },
  regieRomande: { name: "Régie Romande SA", listingsUrl: "http://www.regieromande.ch/" },
  regieTurrian: { name: "Régie Turrian SA", listingsUrl: "https://turrian.ch/" },
  regieDeLaCouronne: { name: "Régie de la Couronne SA", listingsUrl: "https://gerofinance-dunand.ch/" },
  regieDuCroset: { name: "Régie du Croset SA", listingsUrl: "https://regieducroset.ch/" },
  regieDuRhoneLausanne: { name: "Régie du Rhône SA - Lausanne", listingsUrl: "https://regierhone.ch/" },
  reveImmobGeranceCourtage: { name: "Rêve-Immob Gérance & Courtage SA", listingsUrl: "https://reve-immob.ch/" },
  scSotornikClerboutImmobilier: { name: "SC Sotornik & Clerbout Immobilier SA", listingsUrl: "https://www.scimmo.ch/" },
  siAlphaSwissInvest: { name: "SI ALPHA SWISS INVEST SA", listingsUrl: "https://alphaswissinvest.ch/" },
  sihSwissImmoHolding: { name: "SIH - Swiss Immo Holding", listingsUrl: "https://swissimmoholding.ch/" },
  slImmobilier: { name: "SL Immobilier Sàrl", listingsUrl: "https://slimmobilier.ch/" },
  spgLausanne: { name: "SPG - Lausanne", listingsUrl: "https://www.spg.ch/en/" },
  srImmob: { name: "SR-Immob SA", listingsUrl: "https://sr-immob.ch/" },
  stImmobilier: { name: "ST Immobilier SA", listingsUrl: "https://stimmobilier.ch/" },
  suggestim: { name: "SUGGESTIM SA", listingsUrl: "http://www.suggestim.ch/" },
  swissimmob: { name: "SWISSIMMOB Sàrl", listingsUrl: "https://swissimmob.ch/" },
  swpRegisseurs: { name: "SWP Régisseurs SA", listingsUrl: "https://swpregisseurs.ch/" },
  synergimmo: { name: "SYNERGIMMO SA", listingsUrl: "http://www.synergimmo.ch/" },
  saintHubertImmobilier: { name: "Saint-Hubert Immobilier Sàrl", listingsUrl: "http://www.st-hubert-immobilier.ch/" },
  sauvinSchmidt: { name: "Sauvin Schmidt SA", listingsUrl: "https://sauvin-schmidt.ch/" },
  schmidhauserBordierEtAssociesLausanne: { name: "Schmidhauser-Bordier et Associés - Lausanne", listingsUrl: "https://www.sbassocies.ch/" },
  sebastianiImmobilier: { name: "Sebastiani Immobilier", listingsUrl: "https://sebastiani-immobilier.ch/" },
  seci: { name: "Seci SA", listingsUrl: "https://seci.ch/" },
  servitisImmobilier: { name: "Servitis Immobilier", listingsUrl: "https://www.servitis.ch/" },
  sogimmo: { name: "Sogimmo SA", listingsUrl: "http://sogimmo.ch/" },
  solutionHabitat: { name: "Solution Habitat", listingsUrl: "https://solutionhabitat.ch/" },
  solutionImmo: { name: "Solution Immo", listingsUrl: "https://risag.ch/" },
  sother: { name: "Sother", listingsUrl: "https://sother.ch/" },
  stClercImmobilier: { name: "St-Clerc Immobilier SA", listingsUrl: "https://st-clerc.ch/" },
  stalderImmobilierLaVallee: { name: "Stalder Immobilier La Vallée Sàrl", listingsUrl: "https://stalder-immobilier.ch/" },
  steinwenderImmobilier: { name: "Steinwender Immobilier", listingsUrl: "https://steinwender.ch/" },
  stunkelImmobilier: { name: "Stünkel immobilier SA", listingsUrl: "https://stunkel-immo.ch/" },
  swissKeysManagement: { name: "Swiss Keys Management SA", listingsUrl: "http://www.swisskeysmanagement.com/" },
  swissOptimum: { name: "Swiss Optimum", listingsUrl: "http://www.optimum.swiss/en" },
  swissImmoDream: { name: "Swiss-Immo-Dream", listingsUrl: "https://swiss-immo-dream.ch/" },
  swissgradeConsulting: { name: "SwissGrade Consulting Sàrl", listingsUrl: "https://swissgrade.ch/" },
  swissnestImmobilier: { name: "Swissnest Immobilier SA", listingsUrl: "http://www.swissnest.ch/" },
  switzerlandSothebysEchallens: { name: "Switzerland Sothebys - Echallens", listingsUrl: "https://www.switzerland-sothebysrealty.ch/en" },
  immersia: { name: "Sàrl IMMERSIA", listingsUrl: "https://immersia.ch/" },
  tendAg: { name: "Tend AG", listingsUrl: "http://www.tend.ch/" },
  terraFoncier: { name: "Terra Foncier SA", listingsUrl: "http://www.terrafoncier.ch/" },
  thalesImmopartners: { name: "Thales ImmoPartners SA", listingsUrl: "http://www.thalesimmo.ch/" },
  thomasRegieFonciere: { name: "Thomas Régie Foncière SA", listingsUrl: "https://thomas-regiefonciere.ch/" },
  transcrea: { name: "TransCréa Sàrl", listingsUrl: "http://www.transcrea.ch/" },
  trinvestDeveloppement: { name: "Trinvest Développement Sàrl", listingsUrl: "https://trinvest.ch/" },
  valaurImmobilier: { name: "VALAUR Immobilier SA", listingsUrl: "https://valaur.ch/" },
  valsolImmo: { name: "ValSol-Immo", listingsUrl: "https://www.valsol-immo.ch/" },
  valoremInvest: { name: "Valorem Invest Sàrl", listingsUrl: "https://valorem-invest.ch/" },
  valoristone: { name: "Valoristone SA", listingsUrl: "http://www.valoristone.ch/" },
  verrazzano: { name: "Verrazzano SA", listingsUrl: "https://verrazzano.ch/" },
  vestaswissImmobilier: { name: "VestaSWISS Immobilier", listingsUrl: "https://vestaswiss.ch/" },
  vezGroupe: { name: "Vez Groupe", listingsUrl: "https://vez-groupe.ch/" },
  villarsChalets: { name: "Villars-Chalets SA", listingsUrl: "https://villars-chalets.ch/" },
  villvert: { name: "Villvert SA", listingsUrl: "http://www.villvert.ch/" },
  vimovaEchallens: { name: "Vimova - Echallens", listingsUrl: "https://vimova.ch/" },
  viwaImmo: { name: "Viwa.Immo SA", listingsUrl: "https://viwaimmo.ch/" },
  vueSurLac: { name: "Vue sur Lac", listingsUrl: "https://vuesurlac-immo.ch/en/" },
  walzi: { name: "WALZI SA", listingsUrl: "https://www.walzisa.ch/" },
  weckAebyCieLausanne: { name: "Weck Aeby & Cie SA - Lausanne", listingsUrl: "http://www.weck-aeby.ch/en/" },
  wilsonImmobilier: { name: "Wilson Immobilier SA", listingsUrl: "http://www.wilsonsa.ch/" },
  yourSwissHome: { name: "Your Swiss Home", listingsUrl: "https://www.yourswisshome.ch/en/" },
  zimmermannImmobilierLausanne: { name: "Zimmermann Immobilier - Lausanne", listingsUrl: "https://www.regiez.ch/" },
  zimmermannImmobilier: { name: "Zimmermann Immobilier SA", listingsUrl: "https://regiez.ch/" },
  zivagGerances: { name: "Zivag Gérances SA", listingsUrl: "https://regie-immobiliere-comparatif.ch/d/regies-immobilieres/zivag-gerances-sa-d:7ehxS70gP" },
  a2immoCh: { name: "a2immo.ch SA", listingsUrl: "http://a2immo.ch/" },
  deRham: { name: "de Rham SA", listingsUrl: "https://derham.ch/" },
  deRhamGerance: { name: "de Rham SA - Gérance", listingsUrl: "https://www.derham.ch/fr" },
  iGestion: { name: "i-gestion SA", listingsUrl: "https://i-gestion.ch/" },
  integraleImmobilierConseils: { name: "integrale immobilier conseils", listingsUrl: "https://iiconseils.ch/" },
  lachatImmobilierDl: { name: "lachat IMMOBILIER DL Sàrl", listingsUrl: "https://lachat-immobilier.ch/" },
  marcusRealEstateAgency: { name: "maRcus real estate agency sàrl", listingsUrl: "https://marcus.immo/" },
  moveIm: { name: "move im SA", listingsUrl: "https://moveim.ch/" },
  spgPartner: { name: "spg partner sa", listingsUrl: "https://spgpartner.ch/en/" },
  swisservicesEtRenovation: { name: "swisservices et rénovation sàrl", listingsUrl: "https://swiss-soudures.ch/" },
  votreimmobilierCh: { name: "votreimmobilier.ch", listingsUrl: "https://votreimmobilier.ch/" },
  // ── Agences Valais ───────────────────────────────────────────────────
  vsValimmobilier: {
    name: "Valimmobilier",
    listingsUrl: "https://www.valimmobilier.ch/",
    canton: "valais",
  },
  vsComptoirImmo: {
    name: "Comptoir Immo (VS)",
    listingsUrl: "https://comptoir-immo.ch/",
    canton: "valais",
  },
  vsTwixy: {
    name: "Twixy",
    listingsUrl: "https://twixy.ch/",
    canton: "valais",
  },
  vsHermes: {
    name: "Hermes Immobilier",
    listingsUrl: "https://hermes-immobilier.ch/",
    canton: "valais",
  },
  vsAllegro: {
    name: "Agence Allegro",
    listingsUrl: "https://www.agence-allegro.ch/",
    canton: "valais",
  },
  vsBarnes: {
    name: "Barnes Suisse (VS)",
    listingsUrl: "https://www.barnes-suisse.ch/",
    canton: "valais",
  },
  vsSzImmo: {
    name: "SZ Immo",
    listingsUrl: "https://www.sz-immo.ch/fr",
    canton: "valais",
  },
  vsEden: {
    name: "Eden Immobilier",
    listingsUrl: "https://eden-immobilier.ch/",
    canton: "valais",
  },
  vsBerra: {
    name: "Berra Immobilier",
    listingsUrl: "https://www.berra-immobilier.ch/",
    canton: "valais",
  },
  vsImvista: {
    name: "Imvista",
    listingsUrl: "https://www.imvista.ch/",
    canton: "valais",
  },
  vsSummum: {
    name: "Summum Immo",
    listingsUrl: "https://www.summum-immo.ch/",
    canton: "valais",
  },
  vsOmnia: {
    name: "Omnia (VS)",
    listingsUrl: "https://www.omnia.ch/",
    canton: "valais",
  },
  vsFontannaz: {
    name: "Fontannaz Immobilier",
    listingsUrl: "https://www.fontannaz-immobilier.ch/fr",
    canton: "valais",
  },
  vsProgestimmo: {
    name: "Progestimmo",
    listingsUrl: "https://www.progestimmo.ch/",
    canton: "valais",
  },
  vsImmoValais: {
    name: "Immo Valais",
    listingsUrl: "https://www.immo-valais.ch/",
    canton: "valais",
  },
  vsMuzimmo: {
    name: "Muzimmo",
    listingsUrl: "https://www.muzimmo.ch/",
    canton: "valais",
  },
  vsBfr: {
    name: "BFR Immobilier",
    listingsUrl: "https://www.bfr-immobilier.ch/",
    canton: "valais",
  },
  vsValcity: {
    name: "Valcity",
    listingsUrl: "https://valcity.ch/",
    canton: "valais",
  },
  vs123Immo: {
    name: "123 Immo",
    listingsUrl: "https://www.123immo.ch/",
    canton: "valais",
  },
  vsAcor: {
    name: "Acor Immo",
    listingsUrl: "https://www.acor-immo.ch/",
    canton: "valais",
  },
  vsResidence2b: {
    name: "Residence 2B",
    listingsUrl: "https://residence2b.ch/",
    canton: "valais",
  },
  vsFidaval: {
    name: "Fidaval",
    listingsUrl: "https://www.fidaval.ch/",
    canton: "valais",
  },
  vsSchmidt: {
    name: "Schmidt Immobilier",
    listingsUrl: "https://www.schmidt-immobilier.ch/",
    canton: "valais",
  },
  vsDmImmo: {
    name: "DM Immo",
    listingsUrl: "https://dm-immo.ch/",
    canton: "valais",
  },
  vsGefimmo: {
    name: "Gefimmo",
    listingsUrl: "https://www.gefimmo.ch/",
    canton: "valais",
  },
  vsKlimmo: {
    name: "Klimmo",
    listingsUrl: "https://www.klimmo.ch/",
    canton: "valais",
  },
  vsAmma: {
    name: "Amma Immo (VS)",
    listingsUrl: "https://www.amma.immo/",
    canton: "valais",
  },
  vsLogipro: {
    name: "Logipro Immo",
    listingsUrl: "https://logipro-immo.ch/",
    canton: "valais",
  },
  vsNaef: {
    name: "Naef (VS)",
    listingsUrl: "https://www.naef.ch/acheter/",
    canton: "valais",
  },
  vsBernardNicod: {
    name: "Bernard Nicod (VS)",
    listingsUrl: "https://www.bernard-nicod.ch/fr/acheter",
    canton: "valais",
  },
  vsAbimmo: {
    name: "Abimmo",
    listingsUrl: "https://www.abimmo.ch/",
    canton: "valais",
  },
  vsStehlin: {
    name: "Stehlin",
    listingsUrl: "https://www.stehlin.ch/",
    canton: "valais",
  },
  vsValgroup: {
    name: "Valgroup",
    listingsUrl: "https://valgroup.ch/",
    canton: "valais",
  },
  vsAltrium: {
    name: "Altrium",
    listingsUrl: "https://altrium.ch/",
    canton: "valais",
  },
  vsProviva: {
    name: "Proviva",
    listingsUrl: "https://www.proviva.ch/",
    canton: "valais",
  },
  vsHeinz: {
    name: "Heinz Immobilier",
    listingsUrl: "https://heinz-immobilier.ch/",
    canton: "valais",
  },
  vsAlpRealEstate: {
    name: "Alp Real Estate",
    listingsUrl: "https://www.alprealestate.ch/",
    canton: "valais",
  },
  vsNendazVente: {
    name: "Nendaz Vente",
    listingsUrl: "https://www.nendaz-vente.ch/fr",
    canton: "valais",
  },
  vsAltipik: {
    name: "Altipik",
    listingsUrl: "https://www.altipik.ch/",
    canton: "valais",
  },
  vsInterAgence: {
    name: "Inter Agence",
    listingsUrl: "https://www.inter-agence.ch/",
    canton: "valais",
  },
  vsLerezo: {
    name: "Le Rezo",
    listingsUrl: "https://www.lerezo.ch/",
    canton: "valais",
  },
  vsDomicilia: {
    name: "Domicilia",
    listingsUrl: "https://domicilia.ch/",
    canton: "valais",
  },
  vsVeya: {
    name: "Veya Immobilier",
    listingsUrl: "https://www.veya-immobilier.ch/",
    canton: "valais",
  },
  vsMithieux: {
    name: "Mithieux Immobilier",
    listingsUrl: "https://mithieux-immobilier.ch/",
    canton: "valais",
  },
  vsEren: {
    name: "Eren Immobilier",
    listingsUrl: "https://www.eren-immobilier.ch/",
    canton: "valais",
  },
  vsHomepartner: {
    name: "Home Partner",
    listingsUrl: "https://homepartner.ch/",
    canton: "valais",
  },
  vsLeValaisImmobilier: {
    name: "Le Valais Immobilier",
    listingsUrl: "https://www.levalaisimmobilier.ch/",
    canton: "valais",
  },
  vsBenoitDorsaz: {
    name: "Benoit Dorsaz Immobilier",
    listingsUrl: "https://www.benoitdorsaz-immobilier.ch/",
    canton: "valais",
  },
  vsAlberic: {
    name: "Alberic Immobilier",
    listingsUrl: "https://www.alberic-immobilier.ch/",
    canton: "valais",
  },
  vsSilver: {
    name: "Silver Immobilier",
    listingsUrl: "https://silverimmobilier.ch/",
    canton: "valais",
  },
  vsCbsImmo: {
    name: "CBS Immo",
    listingsUrl: "https://www.cbsimmo.ch/",
    canton: "valais",
  },
  vsChbImmo: {
    name: "CHB Immo",
    listingsUrl: "https://www.chbimmo.ch/",
    canton: "valais",
  },
  vsImmorare: {
    name: "Immorare",
    listingsUrl: "https://www.immorare.ch/",
    canton: "valais",
  },
  vsTrustImmobilier: {
    name: "Trust Immobilier",
    listingsUrl: "https://trustimmobilier.ch/",
    canton: "valais",
  },
  vsValorise: {
    name: "Valorise Home",
    listingsUrl: "https://www.valorise-home.ch/",
    canton: "valais",
  },
  // ── Agences Valais supplémentaires (import CSV) ──────────────────
  vsA123immoCh: { name: "123immo.ch", listingsUrl: "http://www.123immo.ch/", canton: "valais" },
  vsA2sBuilding: { name: "2S building Sàrl", listingsUrl: "https://www.2sbuilding.ch/", canton: "valais" },
  vsAbcRealEstateVerbier: { name: "ABC Real Estate Verbier", listingsUrl: "https://schraner-verbier.ch/", canton: "valais" },
  vsActia: { name: "ACTIA Sàrl", listingsUrl: "https://actia.ch/", canton: "valais" },
  vsAlpimmiaImmobilier: { name: "ALPIMMIA Immobilier Sàrl", listingsUrl: "https://www.alpimmia.ch/", canton: "valais" },
  vsAmImmogerance: { name: "AM IMMOGERANCE SARL", listingsUrl: "https://www.amimmogerance.ch/", canton: "valais" },
  vsAnnimmob: { name: "ANNIMMOB", listingsUrl: "https://www.annimmob.ch/en", canton: "valais" },
  vsAnzimob: { name: "ANZIMOB SA", listingsUrl: "https://anzimob.ch/", canton: "valais" },
  vsArgoImmobilier: { name: "ARGO Immobilier Sàrl", listingsUrl: "https://argo-immobilier.ch/", canton: "valais" },
  vsAse: { name: "ASE SA", listingsUrl: "https://asesa.ch/", canton: "valais" },
  vsAbitasion: { name: "Abitasion Sàrl", listingsUrl: "https://abitasion.ch/", canton: "valais" },
  vsAdagi: { name: "Adagi SA", listingsUrl: "https://adagi.ch/en/", canton: "valais" },
  vsAdonideImmobilier: { name: "Adonide Immobilier SA", listingsUrl: "https://adonide-immobilier.ch/", canton: "valais" },
  vsAgenceEugster: { name: "Agence Eugster SA", listingsUrl: "https://agence-eugster.ch/", canton: "valais" },
  vsAgenceImalpGerance: { name: "Agence IMALP Gérance Sàrl", listingsUrl: "http://www.imalp-gerance.ch/", canton: "valais" },
  vsAgenceImmobiliereAgival: { name: "Agence Immobilière AGIVAL", listingsUrl: "http://agence-agival.ch/", canton: "valais" },
  vsAgenceImmobiliereBarras: { name: "Agence Immobilière Barras", listingsUrl: "https://agencebarras.ch/", canton: "valais" },
  vsAgenceImmobiliereEtoileDeSaintLuc: { name: "Agence Immobilière Etoile de Saint-Luc Sàrl", listingsUrl: "https://etoile-immo.ch/", canton: "valais" },
  vsAgenceLExclusifDeLImmobilier: { name: "Agence L\'Exclusif de l\'Immobilier", listingsUrl: "https://exclusif.ch/", canton: "valais" },
  vsAgenceLesGrillons: { name: "Agence Les Grillons Sàrl", listingsUrl: "https://www.lesgrillons.ch/", canton: "valais" },
  vsAgencePhiSion: { name: "Agence PHI Sàrl - Sion", listingsUrl: "https://www.agence-phi.ch/fr/", canton: "valais" },
  vsAgenceTrachsel: { name: "Agence Trachsel SA", listingsUrl: "https://agence-trachsel.ch/", canton: "valais" },
  vsAgenceVivianeImmobilier: { name: "Agence Viviane Immobilier Sàrl", listingsUrl: "https://www.viviane-immobilier.ch/", canton: "valais" },
  vsAgenceImmobiliereDomus: { name: "Agence immobilière DOMUS", listingsUrl: "https://agencedomus.ch/", canton: "valais" },
  vsAgenceImmobiliereLeValaisCh: { name: "Agence immobilière le Valais.ch SA", listingsUrl: "https://levalaisimmobilier.ch/", canton: "valais" },
  vsAgenceLeCristal: { name: "Agence le Cristal", listingsUrl: "https://lecristal.ch/", canton: "valais" },
  vsAgenceImmoCh: { name: "Agence-immo.ch", listingsUrl: "https://agence-immo.ch/", canton: "valais" },
  vsAlainDeslarzesGerances: { name: "Alain Deslarzes Gérances SA", listingsUrl: "https://immo-adg.ch/", canton: "valais" },
  vsAlpArchitecture: { name: "Alp\'Architecture SA", listingsUrl: "http://www.alparchitecture.ch/", canton: "valais" },
  vsAlpeelocation: { name: "Alpeelocation SA", listingsUrl: "https://alpeelocation.ch/", canton: "valais" },
  vsAlpimmoImmobilier: { name: "Alpimmo Immobilier SA", listingsUrl: "http://www.alpimmo.ch/", canton: "valais" },
  vsAltitudeImmobilier: { name: "Altitude Immobilier", listingsUrl: "http://altitude-immobilier.ch/", canton: "valais" },
  vsAmandineVacances: { name: "Amandine Vacances", listingsUrl: "https://amandine-vacances.ch/", canton: "valais" },
  vsAngelaImmobilier: { name: "Angela Immobilier SA", listingsUrl: "https://angelaimmobilier.ch/", canton: "valais" },
  vsAnitaTissotGeobioImmo: { name: "Anita Tissot Géobio-Immo Sàrl", listingsUrl: "https://anitatissot-immobilier.ch/", canton: "valais" },
  vsAnniviersImmobilier: { name: "Anniviers Immobilier", listingsUrl: "https://anniviers-immobilier.ch/", canton: "valais" },
  vsAnzereVacances: { name: "Anzère Vacances Sàrl", listingsUrl: "https://anzere-vacances.ch/", canton: "valais" },
  vsArianeImmobilier: { name: "Ariane Immobilier", listingsUrl: "https://ariane-immobilier.ch/", canton: "valais" },
  vsAvDeLaGare46: { name: "Av.de la Gare 46", listingsUrl: "https://www.hotelvictoria.ch/en", canton: "valais" },
  vsBarrasScheuchzerImmobilier: { name: "BARRAS & SCHEUCHZER Immobilier SA", listingsUrl: "https://www.bs-immobilier.ch/en/buy", canton: "valais" },
  vsBagnesImmobilier: { name: "Bagnes Immobilier Sàrl", listingsUrl: "http://www.bagnesimmobilier.ch/", canton: "valais" },
  vsBellisImmo: { name: "Bellis Immo SA", listingsUrl: "https://bellis-immo.ch/", canton: "valais" },
  vsBessonImmobilier: { name: "Besson Immobilier SA", listingsUrl: "https://besson.ch/", canton: "valais" },
  vsBestaImmobilier: { name: "Besta Immobilier SA", listingsUrl: "https://bestazzoni.ch/", canton: "valais" },
  vsBonjourConseilsEtImmobilier: { name: "Bonjour Conseils et Immobilier", listingsUrl: "https://bonjour-ci.ch/", canton: "valais" },
  vsBosonImmo: { name: "Boson Immo", listingsUrl: "https://bosonimmo.ch/fr", canton: "valais" },
  vsBureauDArchitectureBernardRey: { name: "Bureau d\'Architecture Bernard Rey", listingsUrl: "https://bernardarchitecture.ch/", canton: "valais" },
  vsBureauDAffairesTouristiques: { name: "Bureau d\'affaires touristiques", listingsUrl: "https://batimmobilier.ch/", canton: "valais" },
  vsBureau21: { name: "Bureau21 SA", listingsUrl: "https://bureau21.ch/", canton: "valais" },
  vsCPConstantinImmobilier: { name: "C&P Constantin Immobilier Sàrl", listingsUrl: "https://cpcimmo.ch/", canton: "valais" },
  vsCasalpIAnzere: { name: "CASALP SA I Anzère", listingsUrl: "https://agencecasalp.ch/ch/", canton: "valais" },
  vsCdeConstruction: { name: "CDE Construction", listingsUrl: "https://cde-construction.ch/", canton: "valais" },
  vsCecimCentreDeCompetencesImmobilieres: { name: "CECIM - Centre de Compétences Immobilières", listingsUrl: "http://www.cecim.ch/", canton: "valais" },
  vsComInImmobilier: { name: "COM\'IN Immobilier SA", listingsUrl: "https://comin-immo.ch/", canton: "valais" },
  vsCarronImmobilier: { name: "Carron Immobilier SA", listingsUrl: "https://carron-immobilier.ch/", canton: "valais" },
  vsChDeLaBarmete18: { name: "Ch.de la Barmète 18", listingsUrl: "https://www.chaletsverbier.ch/en", canton: "valais" },
  vsChandolinJolival: { name: "Chandolin Jolival Sàrl", listingsUrl: "https://www.chandolinjolival.ch/en", canton: "valais" },
  vsChateausharesDevelopments: { name: "ChateauShares Developments", listingsUrl: "https://www.chateaushares.com/", canton: "valais" },
  vsConstantinPromotion: { name: "Constantin Promotion SA", listingsUrl: "https://constantin-promo.ch/", canton: "valais" },
  vsCoucouCo: { name: "Coucou&Co SA", listingsUrl: "https://coucounco.ch/en/", canton: "valais" },
  vsCecileImmobilierArchitecture: { name: "Cécile immobilier & architecture", listingsUrl: "https://www.cecile-immobilier.ch/", canton: "valais" },
  vsDbiDoloresBruttinImmobilier: { name: "DBI Dolorès Bruttin Immobilier Sàrl", listingsUrl: "https://dbimmo.ch/", canton: "valais" },
  vsDmImmoCh: { name: "DM-immo.ch", listingsUrl: "https://dm-immo.ch/en/", canton: "valais" },
  vsDpImmob: { name: "DP Immob Sàrl", listingsUrl: "https://dpimmob.ch/", canton: "valais" },
  vsDiniAssocies: { name: "Dini & Associés SA", listingsUrl: "https://www.dini-associes.ch/", canton: "valais" },
  vsDivinimmo: { name: "Divinimmo Sàrl", listingsUrl: "https://divinimmo.ch/", canton: "valais" },
  vsDrapelImmobilier: { name: "Drapel Immobilier Sàrl", listingsUrl: "https://drapelimmobilier.ch/", canton: "valais" },
  vsDreamchaletInternational: { name: "Dreamchalet International SA", listingsUrl: "https://www.dreamchalet.ch/en", canton: "valais" },
  vsEImmobilier: { name: "E-IMMOBILIER SA", listingsUrl: "https://eimmobilier.ch/", canton: "valais" },
  vsEvRealEstateServices: { name: "EV Real Estate Services SARL", listingsUrl: "https://www.evres.ch/", canton: "valais" },
  vsEdelweissSwissImmo: { name: "Edelweiss Swiss Immo Sàrl", listingsUrl: "https://edelweiss.immo/", canton: "valais" },
  vsEnotiko: { name: "Enotiko Sàrl", listingsUrl: "https://www.enotiko.ch/", canton: "valais" },
  vsEntremontImmobilier: { name: "Entremont Immobilier", listingsUrl: "https://entremontimmo.ch/", canton: "valais" },
  vsEurolocationEtImmobilier: { name: "Eurolocation et Immobilier SA", listingsUrl: "https://www.eurolocation.ch/", canton: "valais" },
  vsFollonierFm: { name: "Follonier FM SA", listingsUrl: "https://www.follonierfm.ch/", canton: "valais" },
  vsFotiImmobilier: { name: "Foti Immobilier Sàrl", listingsUrl: "https://www.foti-immo.ch/", canton: "valais" },
  vsGImmobilier: { name: "G-immobilier Sàrl", listingsUrl: "https://www.gimmobilier.ch/fr", canton: "valais" },
  vsGaiaRealEstate: { name: "GAIA Real Estate SA", listingsUrl: "https://gaiarealestate.ch/", canton: "valais" },
  vsGfImmobilier: { name: "GF Immobilier Sàrl", listingsUrl: "https://gfimmobilier.ch/", canton: "valais" },
  vsGepimmo: { name: "Gepimmo", listingsUrl: "https://gepimmo.ch/", canton: "valais" },
  vsGetisaImmobiliere: { name: "Getisa Immobilière SA", listingsUrl: "https://www.getisa.ch/", canton: "valais" },
  vsGiocom: { name: "Giocom Sàrl", listingsUrl: "https://giocom.ch/", canton: "valais" },
  vsHsiHomeServiceImmobilier: { name: "HSI Home Service Immobilier", listingsUrl: "http://hsi-immo.ch/", canton: "valais" },
  vsHome2c: { name: "Home2C", listingsUrl: "https://home2c.ch/", canton: "valais" },
  vsImmobiliaGrimentz: { name: "IMMOBILIA Grimentz", listingsUrl: "https://www.i-g.ch/en/", canton: "valais" },
  vsImmotino: { name: "IMMOTINO Sàrl", listingsUrl: "https://immotino.ch/", canton: "valais" },
  vsIdealLivingImmobilier: { name: "Ideal Living Immobilier SA", listingsUrl: "https://www.ili.immo/", canton: "valais" },
  vsImmoGlad: { name: "Immo Glad Sàrl", listingsUrl: "https://immoglad.ch/", canton: "valais" },
  vsImmoConsultant: { name: "Immo-Consultant SA", listingsUrl: "https://www.ic-groupe.ch/fr", canton: "valais" },
  vsImmoRhone: { name: "Immo-Rhône SA", listingsUrl: "https://immo-rhone.ch/", canton: "valais" },
  vsImmoTrading: { name: "Immo-Trading", listingsUrl: "https://www.immotrading.at/", canton: "valais" },
  vsImmocrans: { name: "ImmoCrans SA", listingsUrl: "https://immocrans.ch/fr/o/a-louer-appartement-de-vacances-crans-montana-5216812", canton: "valais" },
  vsImmob2000: { name: "Immob2000", listingsUrl: "https://www.immob2000.ch/", canton: "valais" },
  vsImmobilierVacances: { name: "Immobilier Vacances", listingsUrl: "http://www.immobilier-vacances.ch/", canton: "valais" },
  vsImmobilierDuPont: { name: "Immobilier du Pont", listingsUrl: "https://www.immobilierdupont.ch/fr", canton: "valais" },
  vsJmpImmo: { name: "JMP-IMMO Sàrl", listingsUrl: "https://jmp-immo.ch/", canton: "valais" },
  vsKenzelmannImmobilien: { name: "KENZELMANN IMMOBILIEN", listingsUrl: "https://kenzelmann.ch/", canton: "valais" },
  vsKlImmo: { name: "KL Immo Sàrl", listingsUrl: "https://klimmo.ch/", canton: "valais" },
  vsKvImmobilier: { name: "KV Immobilier Sàrl", listingsUrl: "https://kvimmobilier.ch/", canton: "valais" },
  vsKaza: { name: "Kaza SA", listingsUrl: "https://kaza.ch/en/", canton: "valais" },
  vsKoppelImmobilienAg: { name: "Köppel Immobilien AG", listingsUrl: "https://www.koeppel-immobilien.ch/", canton: "valais" },
  vsLAgenceImmoMaretBonvin: { name: "L\'Agence Immo Maret-Bonvin", listingsUrl: "https://www.lagenceimmo.ch/en", canton: "valais" },
  vsLAdresseImmobiliere: { name: "L\'adresse Immobilière", listingsUrl: "http://www.ladresse.ch/", canton: "valais" },
  vsLLBSLImmobiliere: { name: "L.L & B.S L\'immobilière Sàrl", listingsUrl: "https://llbs.ch/", canton: "valais" },
  vsLatico: { name: "LATICO", listingsUrl: "https://latico.ch/", canton: "valais" },
  vsLaurentGImmobilier: { name: "LAURENT G Immobilier Sàrl", listingsUrl: "https://laurent-g.ch/", canton: "valais" },
  vsLivinCrans: { name: "LIVIN\'CRANS", listingsUrl: "http://livincrans.ch/", canton: "valais" },
  vsLaBelleImmoEntremont: { name: "La Belle Immo Entremont", listingsUrl: "https://labelleimmoentremont.ch/", canton: "valais" },
  vsLaPoya2: { name: "La Poya 2", listingsUrl: "https://hotel-le-sapin.ch/", canton: "valais" },
  vsLanimmo: { name: "Lanimmo SARL", listingsUrl: "https://lanimmo.ch/", canton: "valais" },
  vsLoreto1Trading: { name: "Loreto1 Trading SA", listingsUrl: "https://loreto1-trading.ch/", canton: "valais" },
  vsMbaImmobilier: { name: "MBA Immobilier SA", listingsUrl: "http://www.mbaimmobilier.ch/", canton: "valais" },
  vsMcImmogerance: { name: "MC ImmoGérance Sàrl", listingsUrl: "https://www.mc-immogerance.ch/", canton: "valais" },
  vsMdkImmobilierChampery: { name: "MDK Immobilier - Champéry", listingsUrl: "https://mdk.ch/en/", canton: "valais" },
  vsMdkImmobilierMonthey: { name: "MDK Immobilier - Monthey", listingsUrl: "https://mdk.ch/fr/", canton: "valais" },
  vsMpImmo: { name: "MP Immo", listingsUrl: "https://mpimmo.ch/", canton: "valais" },
  vsMysaHome: { name: "MYSA Home Sàrl", listingsUrl: "https://mysa-home.ch/", canton: "valais" },
  vsMaventeCh: { name: "MaVente.ch", listingsUrl: "https://mavente.ch/", canton: "valais" },
  vsMaitreImmobilier: { name: "Maitre Immobilier", listingsUrl: "https://maitreimmo.ch/", canton: "valais" },
  vsMartignoniGerancesImmobilieres: { name: "Martignoni Gérances Immobilières SA", listingsUrl: "https://martignoni-gerances.ch/", canton: "valais" },
  vsMartinBagnoud: { name: "Martin Bagnoud", listingsUrl: "http://aimb.ch/", canton: "valais" },
  vsMawee: { name: "Mawee SA", listingsUrl: "https://mawee.ch/", canton: "valais" },
  vsMichelePierrozGerance: { name: "Michèle PIERROZ GERANCE", listingsUrl: "https://www.michelepierrozgerance.ch/", canton: "valais" },
  vsMickaelHofmannImmobilier: { name: "Mickael Hofmann Immobilier Sàrl", listingsUrl: "https://mhimmo.ch/", canton: "valais" },
  vsMisesEnValeurBySpeckinger: { name: "Mises en valeur by Speckinger", listingsUrl: "http://www.misesenvaleur.ch/", canton: "valais" },
  vsModulor: { name: "Modulor SA", listingsUrl: "http://www.modulorsa.ch/", canton: "valais" },
  vsMontanAgence: { name: "Montan\'Agence", listingsUrl: "https://montanagence.ch/", canton: "valais" },
  vsNdmh: { name: "NDMH Sàrl", listingsUrl: "https://www.ndmh.ch/fr", canton: "valais" },
  vsNanchenPralong: { name: "Nanchen & Pralong", listingsUrl: "https://nanchenpralong.ch/", canton: "valais" },
  vsNendazVenteImmobilier: { name: "Nendaz-Vente Immobilier Sàrl", listingsUrl: "https://nendaz-vente.ch/", canton: "valais" },
  vsNovagenceAnzere: { name: "Novagence Anzère", listingsUrl: "https://novagence-anzere.ch/", canton: "valais" },
  vsOneCransmontana: { name: "One CransMontana", listingsUrl: "https://www.saphirimmo.ch/en", canton: "valais" },
  vsPanaimmob: { name: "PANAIMMOB", listingsUrl: "https://www.panaimmob.ch/", canton: "valais" },
  vsPiPromotionsImmobilieres: { name: "PI Promotions Immobilières Sàrl", listingsUrl: "https://pi-promotions.ch/", canton: "valais" },
  vsParcImmobilier: { name: "Parc-Immobilier Sàrl", listingsUrl: "https://www.parc-immobilier.ch/", canton: "valais" },
  vsPreFleuri9: { name: "Pré-Fleuri 9", listingsUrl: "https://pre-fleuri.ch/", canton: "valais" },
  vsRTBCorvaglia: { name: "R.T.B. Corvaglia Sàrl", listingsUrl: "https://villartb.ch/", canton: "valais" },
  vsRciRouxCourtageImmobilier: { name: "RCI Roux Courtage Immobilier Sàrl", listingsUrl: "https://rci-immobilier.ch/", canton: "valais" },
  vsRfgImmobilier: { name: "RFG Immobilier", listingsUrl: "http://www.rfgimmobilier.ch/", canton: "valais" },
  vsRibordyImmobilierMartigny: { name: "RIBORDY IMMOBILIER - Martigny", listingsUrl: "https://ribordysa.ch/", canton: "valais" },
  vsRudyImmobilier: { name: "RUDY Immobilier Sàrl", listingsUrl: "https://www.rudy-immobilier.ch/", canton: "valais" },
  vsRvService: { name: "RV-Service SA", listingsUrl: "https://www.rv-service.ch/", canton: "valais" },
  vsRigolet: { name: "Rigolet SA", listingsUrl: "https://rigolet.ch/", canton: "valais" },
  vsRiveDroiteGroupeImmobilier: { name: "Rive Droite Groupe Immobilier SA", listingsUrl: "https://rivedroite.ch/en/", canton: "valais" },
  vsRoduitBourbanImmobilierGerances: { name: "Roduit-Bourban Immobilier & Gérances SA", listingsUrl: "https://www.roduit-bourban.ch/", canton: "valais" },
  vsRoquImmo: { name: "Roqu\'immo", listingsUrl: "https://roquimmo.ch/", canton: "valais" },
  vsRegieImmobiliereSolalp: { name: "Régie Immobilière SOLALP SA", listingsUrl: "https://bobst-immobilier.ch/", canton: "valais" },
  vsSunimmo: { name: "SUNIMMO", listingsUrl: "https://mysunimmo.ch/en", canton: "valais" },
  vsSaillonImmobilier: { name: "Saillon Immobilier", listingsUrl: "https://www.saillonimmobilier.ch/", canton: "valais" },
  vsSarbachRealEstateConsulting: { name: "Sarbach Real Estate & Consulting", listingsUrl: "https://immobilienleukerbad.ch/", canton: "valais" },
  vsSelPoivreAgenceImmobiliere: { name: "Sel & Poivre Agence Immobilière", listingsUrl: "https://www.selpoivre.ch/", canton: "valais" },
  vsSonnerimmobilier: { name: "SonnerImmobilier Sàrl", listingsUrl: "http://www.snimmo.ch/", canton: "valais" },
  vsSovalcoConstructionImmobilier: { name: "Sovalco SA construction & immobilier", listingsUrl: "https://www.sovalco.ch/fr", canton: "valais" },
  vsSteigerCieCransMontana: { name: "Steiger&Cie Crans-Montana SA", listingsUrl: "https://www.crans-montana.ch/en/?idcmt=Partenaire_Agenceimmobiliere_4e1686d22923e1bc736d56567fb02544", canton: "valais" },
  vsSummitImmobilier: { name: "Summit Immobilier", listingsUrl: "https://summitimmobilier.ch/", canton: "valais" },
  vsSwisstarget: { name: "Swisstarget", listingsUrl: "https://www.swisstargetprediction.ch/", canton: "valais" },
  vsTpImmobilier: { name: "TP Immobilier", listingsUrl: "https://orllati.ch/", canton: "valais" },
  vsTexierImmobilier: { name: "Texier Immobilier", listingsUrl: "https://texier.ch/", canton: "valais" },
  vsTheytazImmobilier: { name: "Theytaz immobilier", listingsUrl: "http://theytaz-immobilier.ch/", canton: "valais" },
  vsThyonImmobilier: { name: "Thyon immobilier", listingsUrl: "https://thyon-immo.ch/", canton: "valais" },
  vsTraditionChalet: { name: "Tradition Chalet SA", listingsUrl: "https://traditionchalet.ch/", canton: "valais" },
  vsUnanimmo: { name: "Unanimmo SA", listingsUrl: "https://unanimmo.ch/", canton: "valais" },
  vsValGroupZermatt: { name: "VAL Group - Zermatt", listingsUrl: "https://valgroup-zermatt.ch/", canton: "valais" },
  vsValGroupAgBrig: { name: "VAL Group AG - Brig", listingsUrl: "https://valgroup.ch/fr/", canton: "valais" },
  vsVfpImmobilier: { name: "VFP Immobilier SA", listingsUrl: "https://vfp.ch/", canton: "valais" },
  vsVhInvest: { name: "VH Invest Sàrl", listingsUrl: "https://vhinvest.ch/", canton: "valais" },
  vsValaisexclusifCh: { name: "ValaisExclusif.ch", listingsUrl: "https://valaisexclusif.ch/", canton: "valais" },
  vsVarianteBImmo: { name: "Variante B Immo", listingsUrl: "https://www.varianteb.ch/", canton: "valais" },
  vsVisionConsultingImmobilier: { name: "Vision Consulting immobilier Sàrl", listingsUrl: "https://consulting-immo.ch/", canton: "valais" },
  vsVisionImmedia: { name: "Vision Immedia Sàrl", listingsUrl: "https://visionimmedia.ch/", canton: "valais" },
  vsWarpelinImmobilier: { name: "WARPELIN immobilier Sàrl", listingsUrl: "https://w-immobilier.ch/", canton: "valais" },
  vsWpaConsulting: { name: "WPA Consulting Sàrl", listingsUrl: "https://www.wpaconsulting.ch/", canton: "valais" },
  vsXyzImmobilier: { name: "XYZ Immobilier Sàrl", listingsUrl: "https://www.xyz-immobilier.ch/", canton: "valais" },
  vsYolandeClaivazImmobilier: { name: "Yolande Claivaz Immobilier", listingsUrl: "https://yclaivaz.ch/", canton: "valais" },
  vsYourVerbierChalet: { name: "Your Verbier Chalet", listingsUrl: "https://yourverbierchalet.ch/", canton: "valais" },
  vsZhubiSauthierImmobilier: { name: "ZHUBI SAUTHIER IMMOBILIER Sàrl", listingsUrl: "https://www.zhubi-sauthier.ch/", canton: "valais" },
  vsZinalChalets: { name: "Zinal-Chalets", listingsUrl: "http://www.zinalchalets.ch/", canton: "valais" },
  vsZodiac: { name: "Zodiac Sàrl", listingsUrl: "https://zodiac-finances.ch/", canton: "valais" },
  vsComingHomeGmbh: { name: "coming home GmbH", listingsUrl: "https://coming-home.ch/", canton: "valais" },
  vsImmoValaisCh: { name: "immo-valais.ch SA", listingsUrl: "https://immo-valais.ch/", canton: "valais" },
  vsSaintMartimmo: { name: "saint-martimmo sàrl", listingsUrl: "https://saint-martimmo.ch/", canton: "valais" },
  vsVaroneImmoCh: { name: "varone-immo.ch sàrl", listingsUrl: "https://varone-immo.ch/", canton: "valais" },
  // ── Agences Neuchâtel ─────────────────────────────────────────────────
  neImmobilierNe: {
    name: "Immobilier Neuchâtel",
    listingsUrl: "https://www.immobilier-neuchatel.ch/",
    canton: "neuchatel",
  },
  neNaef: {
    name: "Naef",
    listingsUrl: "https://www.naef.ch/acheter/?canton=neuchatel",
    canton: "neuchatel",
  },
  neBarnes: {
    name: "Barnes",
    listingsUrl: "https://www.barnes-suisse.ch/acheter/neuchatel",
    canton: "neuchatel",
  },
  nePalombo: {
    name: "Palombo Immobilier",
    listingsUrl: "https://www.palombo-immobilier.ch/",
    canton: "neuchatel",
  },
  neWayne: {
    name: "Wayne",
    listingsUrl: "https://www.wayne.ch/",
    canton: "neuchatel",
  },
  neLittoral: {
    name: "Littoral Gérance",
    listingsUrl: "https://www.littoralgerance.ch/",
    canton: "neuchatel",
  },
  neRvk: {
    name: "RVK SA",
    listingsUrl: "https://www.rvksa.ch/",
    canton: "neuchatel",
  },
  neJouval: {
    name: "Jouval",
    listingsUrl: "https://www.jouval.ch/",
    canton: "neuchatel",
  },
  neOmnia: {
    name: "Omnia",
    listingsUrl: "https://www.omnia.ch/",
    canton: "neuchatel",
  },
  neCastoldi: {
    name: "Castoldi Immobilier",
    listingsUrl: "https://www.castoldi-immobilier.ch/",
    canton: "neuchatel",
  },
  neFidimmobil: {
    name: "Fidimmobil",
    listingsUrl: "https://www.fidimmobil.ch/",
    canton: "neuchatel",
  },
  neGpc: {
    name: "GPC",
    listingsUrl: "https://www.gpc.ch/",
    canton: "neuchatel",
  },
  neReysus: {
    name: "Reysus",
    listingsUrl: "https://www.reysus.ch/",
    canton: "neuchatel",
  },
  neProcite: {
    name: "Procité",
    listingsUrl: "https://www.procite.ch/",
    canton: "neuchatel",
  },
  neCirGroup: {
    name: "CIR Group",
    listingsUrl: "https://www.cirgroup.ch/",
    canton: "neuchatel",
  },
  neMichelWolf: {
    name: "Michel Wolf SA",
    listingsUrl: "https://www.michelwolfsa.ch/",
    canton: "neuchatel",
  },
  neMullerChriste: {
    name: "Muller & Christe",
    listingsUrl: "https://www.mulleretchriste.ch/",
    canton: "neuchatel",
  },
  neDiatimis: {
    name: "Diatimis",
    listingsUrl: "https://www.diatimis.ch/",
    canton: "neuchatel",
  },
  neRtImmo: {
    name: "RT Immo",
    listingsUrl: "https://www.rt-immo.ch/",
    canton: "neuchatel",
  },
  neLaFidu: {
    name: "La Fidu",
    listingsUrl: "https://www.lafidu.ch/",
    canton: "neuchatel",
  },
  neBolliger: {
    name: "Bolliger Immobilier",
    listingsUrl: "https://www.bolliger-immobilier.ch/",
    canton: "neuchatel",
  },
  neEllipsis: {
    name: "Ellipsis SA",
    listingsUrl: "https://www.ellipsis-sa.ch/",
    canton: "neuchatel",
  },
  neProimmob: {
    name: "Proimmob",
    listingsUrl: "https://www.proimmob.ch/",
    canton: "neuchatel",
  },
  neEspaceHabitat: {
    name: "Espace et Habitat",
    listingsUrl: "https://www.espace-et-habitat.ch/",
    canton: "neuchatel",
  },
  neGeranceMetropole: {
    name: "Gérance Métropole",
    listingsUrl: "https://www.gerance-metropole.ch/",
    canton: "neuchatel",
  },
  neRooslimmo: {
    name: "Rooslimmo",
    listingsUrl: "https://www.rooslimmo.ch/",
    canton: "neuchatel",
  },
  neHypoImmo: {
    name: "Hypo Immo",
    listingsUrl: "https://www.hypoimmo.ch/",
    canton: "neuchatel",
  },
  neMmImmobilier: {
    name: "MM Immobilier",
    listingsUrl: "https://www.mm-immobilier.ch/",
    canton: "neuchatel",
  },
  neApacheImmo: {
    name: "Apache Immobilier",
    listingsUrl: "https://www.apacheimmobilier.ch/",
    canton: "neuchatel",
  },
  nePerezImmo: {
    name: "Perez Immo",
    listingsUrl: "https://www.perezimmo.com/",
    canton: "neuchatel",
  },
  neImmoHestia: {
    name: "Immo Hestia",
    listingsUrl: "https://www.immo-hestia.ch/",
    canton: "neuchatel",
  },
  neSebImmo: {
    name: "Seb Immo",
    listingsUrl: "https://www.sebimmo.ch/",
    canton: "neuchatel",
  },
  neMerseImmo: {
    name: "Merse Immo",
    listingsUrl: "https://www.merseimmo.ch/",
    canton: "neuchatel",
  },
  neCgcImmo: {
    name: "CGC Immobilier",
    listingsUrl: "https://www.cgc-immobilier.ch/",
    canton: "neuchatel",
  },
  nePatrimoineGerance: {
    name: "Patrimoine Gérance",
    listingsUrl: "https://www.patrimoinegerance.ch/",
    canton: "neuchatel",
  },
  neAmmetis: {
    name: "Ammetis",
    listingsUrl: "https://www.ammetis.ch/",
    canton: "neuchatel",
  },
  neImmoglobe: {
    name: "Immoglobe",
    listingsUrl: "https://www.agence-immobiliere-immoglobe.ch/",
    canton: "neuchatel",
  },
  neTrImmo: {
    name: "TR Immobilier",
    listingsUrl: "https://www.tr-immobilier.ch/",
    canton: "neuchatel",
  },
  neViaterra: {
    name: "Viaterra",
    listingsUrl: "https://www.viaterra.ch/",
    canton: "neuchatel",
  },
  neLombard: {
    name: "Lombard SA",
    listingsUrl: "https://www.lombard-sa.ch/",
    canton: "neuchatel",
  },
  neCabanelImmo: {
    name: "Cabanel Immo",
    listingsUrl: "https://www.cabanelimmo.ch/",
    canton: "neuchatel",
  },
  neWardah: {
    name: "Wardah Immobilier",
    listingsUrl: "https://www.wardahimmobilier.com/",
    canton: "neuchatel",
  },
  neSothebys: {
    name: "Sotheby's NE",
    listingsUrl: "https://www.switzerland-sothebysrealty.ch/",
    canton: "neuchatel",
  },
  neGerofinance: {
    name: "Gerofinance NE",
    listingsUrl: "https://www.gerofinance.ch/neuchatel",
    canton: "neuchatel",
  },
  neMaillard: {
    name: "Maillard Immo NE",
    listingsUrl: "https://www.maillard-immo.ch/",
    canton: "neuchatel",
  },
  // ── Agences Neuchâtel supplémentaires (import CSV) ──────────────────
  neAchatImmobilier: { name: "Achat Immobilier", listingsUrl: "https://achat-immobilier.ch/", canton: "neuchatel" },
  neAgesteam: { name: "AGesteam Sàrl", listingsUrl: "https://www.agesteam.ch/", canton: "neuchatel" },
  neAjaImmobilier: { name: "AJA Immobilier", listingsUrl: "http://ajaimmobilier.ch/", canton: "neuchatel" },
  neAsAssetServices: { name: "AS Asset Services SA", listingsUrl: "https://assetservices.ch/", canton: "neuchatel" },
  neAtriumConseilsGestionImmobiliere: { name: "Atrium, conseils & gestion immobilière Sàrl", listingsUrl: "https://atrium2016.ch/", canton: "neuchatel" },
  neBFreeImmobilier: { name: "B-Free Immobilier", listingsUrl: "https://www.bfree-sa.ch/", canton: "neuchatel" },
  neB2p: { name: "B2P SA", listingsUrl: "https://www.b2p.ch/", canton: "neuchatel" },
  neBornandImmobilier: { name: "Bornand Immobilier", listingsUrl: "https://bornandimmobilier.ch/", canton: "neuchatel" },
  neBrImmobilierCorporate: { name: "BR Immobilier Corporate Sàrl", listingsUrl: "https://br-immobilier.ch/", canton: "neuchatel" },
  neBroggi: { name: "Broggi SA", listingsUrl: "http://WWW.BROGGISA.CH/", canton: "neuchatel" },
  neBzimmobilier: { name: "BZImmobilier Sàrl", listingsUrl: "https://www.bzimmobilier.ch/", canton: "neuchatel" },
  neCLagerance: { name: "C-Lagérance Sàrl", listingsUrl: "https://c-lagerance.ch/", canton: "neuchatel" },
  neCarreNoir: { name: "Carré-Noir Sàrl", listingsUrl: "https://www.carre-noir.ch/", canton: "neuchatel" },
  neChansonImmobilier: { name: "Chanson Immobilier", listingsUrl: "https://chanson-immobilier.ch/", canton: "neuchatel" },
  neClaudeMayorRegieImmobiliere: { name: "Claude Mayor Régie Immobilière", listingsUrl: "https://claude-mayor.ch/", canton: "neuchatel" },
  neCompagnieImmobiliereRomande: { name: "Compagnie Immobilière Romande Sàrl", listingsUrl: "https://cirgroup.ch/", canton: "neuchatel" },
  neCopriva: { name: "COPRIVA SA", listingsUrl: "https://www.copriva.ch/", canton: "neuchatel" },
  neCoworkingLaChauxDeFondsGare: { name: "Coworking La Chaux-de-Fonds Gare", listingsUrl: "https://coworking-neuchatel.ch/la-chaux-de-fonds", canton: "neuchatel" },
  neDomicimLaChauxDeFonds: { name: "Domicim La Chaux-de-Fonds", listingsUrl: "https://domicim.ch/", canton: "neuchatel" },
  neEtudeNicolasPointet: { name: "Etude Nicolas Pointet", listingsUrl: "https://www.mandataires.ch/", canton: "neuchatel" },
  neExpertissimmo: { name: "Expertissimmo Sàrl", listingsUrl: "https://www.expertissimmo.ch/", canton: "neuchatel" },
  neFiscaplus: { name: "Fiscaplus SA", listingsUrl: "https://fiscaplus.ch/", canton: "neuchatel" },
  neGeranceBosshartGautschi: { name: "Gérance Bosshart & Gautschi SA", listingsUrl: "https://www.gerancebg.ch/", canton: "neuchatel" },
  neGeranceCharlesBerset: { name: "Gérance Charles-Berset SA", listingsUrl: "https://berset-gerance.ch/", canton: "neuchatel" },
  neGeranceCpcn: { name: "Gérance CPCN", listingsUrl: "https://gerance.cpcn.ch/", canton: "neuchatel" },
  neGhbGerance: { name: "GHB Gérance", listingsUrl: "https://www.ghb-gerance.ch/", canton: "neuchatel" },
  neGpcGerancePpeCourtage: { name: "gpc gérance ppe courtage sa", listingsUrl: "https://gpc.ch/", canton: "neuchatel" },
  neHypoimmo: { name: "Hypoimmo SA", listingsUrl: "http://www.hypoimmo.ch/", canton: "neuchatel" },
  neImmobilierNeCh: { name: "immobilier-NE.ch Sàrl", listingsUrl: "https://immobilier-ne.ch/", canton: "neuchatel" },
  neJdPlanification: { name: "JD Planification Sàrl", listingsUrl: "https://moneyhouse.ch/de/company/jd-planification-sarl-19812108391", canton: "neuchatel" },
  neKsImmobilier: { name: "KS Immobilier", listingsUrl: "https://ks-immobilier.ch/", canton: "neuchatel" },
  neLAtelierImmobilier: { name: "L\'Atelier Immobilier Sàrl", listingsUrl: "https://www.atelier-immobilier.ch/", canton: "neuchatel" },
  neLittoralGerance: { name: "Littoral-Gérance SA", listingsUrl: "https://littoralgerance.ch/", canton: "neuchatel" },
  neMartiGeranceEtConseils: { name: "Marti Gérance et Conseils", listingsUrl: "http://martigerance.ch/", canton: "neuchatel" },
  neMasiniImmobilier: { name: "Masini Immobilier SA", listingsUrl: "https://masini-groupe.ch/", canton: "neuchatel" },
  neMcmImmobilier: { name: "MCM Immobilier SA", listingsUrl: "https://mcm-immobilier.ch/", canton: "neuchatel" },
  neMetanova: { name: "METANOVA SA", listingsUrl: "https://metanova.ch/", canton: "neuchatel" },
  neMfGestionImmobiliere: { name: "MF Gestion immobilière", listingsUrl: "https://sggestionimmobiliere.ch/", canton: "neuchatel" },
  neNexiumImmobilier: { name: "NEXIUM IMMOBILIER Sàrl", listingsUrl: "https://www.nexium-immobilier.ch/", canton: "neuchatel" },
  neNoobsImmo: { name: "NOOBS-Immo", listingsUrl: "https://www.noobs-immo.ch/", canton: "neuchatel" },
  neOffidusRegieImmobiliere: { name: "Offidus Régie Immobilière SA", listingsUrl: "https://offidus.ch/", canton: "neuchatel" },
  neEnSegrin1: { name: "En Segrin 1", listingsUrl: "https://www.ensegrin.ch/", canton: "neuchatel" },
  neOptigestionServicesImmobiliers: { name: "OptiGestion Services Immobiliers SA", listingsUrl: "https://optigestion.ch/", canton: "neuchatel" },
  nePeruccioGerance: { name: "Peruccio Gérance", listingsUrl: "https://www.peruccio.ch/", canton: "neuchatel" },
  nePetoudImmobilier: { name: "Petoud Immobilier", listingsUrl: "https://www.petoud-immobilier.ch/fr", canton: "neuchatel" },
  neProConseils: { name: "PRO Conseils", listingsUrl: "https://lavenu.ch/", canton: "neuchatel" },
  neProImmob: { name: "Pro Immob SA", listingsUrl: "http://www.proimmob.ch/", canton: "neuchatel" },
  neProxiservices: { name: "ProxiServices", listingsUrl: "https://proxiservices.ch/", canton: "neuchatel" },
  nePyGerance: { name: "PY Gérance", listingsUrl: "https://www.pygerance.ch/", canton: "neuchatel" },
  neRegieDesMontagnes: { name: "Régie des Montagnes", listingsUrl: "https://regiedesmontagnes.ch/", canton: "neuchatel" },
  neRoccabellaImmo: { name: "Roccabella Immo SA", listingsUrl: "https://www.roccabellaimmo.ch/en", canton: "neuchatel" },
  neRotilioImmobilier: { name: "Rotilio Immobilier SA", listingsUrl: "https://rotilio-immobilier.ch/", canton: "neuchatel" },
  neRtImmo2: { name: "RT-Immo SA", listingsUrl: "https://rt-immo.ch/", canton: "neuchatel" },
  neSocieteCooperativeDHabitationLesRocailles: { name: "Société coopérative d\'habitation Les Rocailles", listingsUrl: "https://lesrocailles.ch/", canton: "neuchatel" },
  neTerrier: { name: "TERRIER SA", listingsUrl: "http://www.terriersa.ch/", canton: "neuchatel" },
  neTheSwatchGroupImmeubles: { name: "The Swatch Group Immeubles SA", listingsUrl: "https://swatchimmo.ch/", canton: "neuchatel" },
  neVernetsParcSwissSelectImmo: { name: "Vernets Parc – Swiss Select Immo SA", listingsUrl: "https://www.vernets-parc.ch/", canton: "neuchatel" },
  // ── Fribourg ──────────────────────────────────────────────────────────────
  frNaef: { name: "Naef FR", listingsUrl: "https://www.naef.ch/", canton: "fribourg" },
  frVotreCourtier: { name: "Votre Courtier FR", listingsUrl: "https://www.votrecourtier.ch/", canton: "fribourg" },
  frFavreNaudeix: { name: "Favre-Naudeix", listingsUrl: "https://www.favre-naudeix.ch/", canton: "fribourg" },
  frRfsa: { name: "RFSA", listingsUrl: "https://www.rfsa.ch/", canton: "fribourg" },
  frAck: { name: "ACK Immobilier", listingsUrl: "https://www.ack-immobilier.ch/", canton: "fribourg" },
  frPatrick: { name: "Patrick Immobilier", listingsUrl: "https://www.patrick-immobilier.ch/", canton: "fribourg" },
  frSallin: { name: "Sallin Immobilier", listingsUrl: "https://www.sallin-immobilier.ch/", canton: "fribourg" },
  frBulliard: { name: "Bulliard", listingsUrl: "https://www.bulliard.ch/", canton: "fribourg" },
  frBussard: { name: "Bussard", listingsUrl: "https://www.bussard.ch/", canton: "fribourg" },
  frGerama: { name: "Gérama", listingsUrl: "https://www.gerama.ch/", canton: "fribourg" },
  frWeckAeby: { name: "Weck-Aeby", listingsUrl: "https://www.weck-aeby.ch/", canton: "fribourg" },
  frCnc: { name: "CNC Immobilier", listingsUrl: "https://www.cnc-immobilier.ch/", canton: "fribourg" },
  frRegis: { name: "Régis SA", listingsUrl: "https://www.regis-sa.ch/", canton: "fribourg" },
  frRemax: { name: "RE/MAX FR", listingsUrl: "https://www.remax.ch/fribourg", canton: "fribourg" },
  frGeranceHirt: { name: "Gérance Hirt", listingsUrl: "https://www.gerance-hirt.ch/", canton: "fribourg" },
  frMarbrick: { name: "MarBrick", listingsUrl: "https://www.marbrick.ch/", canton: "fribourg" },
  frPlumeria: { name: "Plumeria Immobilier", listingsUrl: "https://www.plumeria-immobilier.ch/", canton: "fribourg" },
  frLeduc: { name: "Leduc Immobilier", listingsUrl: "https://www.leduc-immobilier.ch/", canton: "fribourg" },
  frSothebys: { name: "Sotheby's FR", listingsUrl: "https://www.switzerland-sothebysrealty.ch/", canton: "fribourg" },
  frGerancesFoncieres: { name: "Gérances Foncières", listingsUrl: "https://www.gerances-foncieres.ch/", canton: "fribourg" },
  frSmisa: { name: "SMISA", listingsUrl: "https://www.smisa.ch/", canton: "fribourg" },
  frGruyereImmo: { name: "Gruyère Immo", listingsUrl: "https://www.gruyere-immo.ch/", canton: "fribourg" },
  frMurith: { name: "Murith Immobilier", listingsUrl: "https://www.murith-immobilier.ch/", canton: "fribourg" },
  frRegieBulle: { name: "Régie Bulle", listingsUrl: "https://www.regiebulle.ch/", canton: "fribourg" },
  frMorier: { name: "Morier Immobilier", listingsUrl: "https://www.morier-immobilier.ch/", canton: "fribourg" },
  frBarnes: { name: "Barnes Bulle", listingsUrl: "https://www.barnes-suisse.ch/", canton: "fribourg" },
  frConceptImmo: { name: "Concept Immo", listingsUrl: "https://www.conceptimmo.ch/", canton: "fribourg" },
  frCfImmobilier: { name: "CF Immobilier", listingsUrl: "https://www.cfimmobilier.ch/", canton: "fribourg" },
  frProginGrangier: { name: "Progin-Grangier", listingsUrl: "https://www.progin-grangier.ch/", canton: "fribourg" },
  frBdGerance: { name: "BD Gérance", listingsUrl: "https://www.bdgerance.ch/", canton: "fribourg" },
  frOmnia: { name: "Omnia FR", listingsUrl: "https://www.omnia.ch/", canton: "fribourg" },
  frGerancesGiroud: { name: "Gérances Giroud", listingsUrl: "https://www.gerances-giroud.ch/", canton: "fribourg" },
  frAlcConseils: { name: "ALC Conseils Immo", listingsUrl: "https://www.alc-conseils-immo.ch/", canton: "fribourg" },
  frImmoval: { name: "Immoval", listingsUrl: "https://www.immoval.ch/", canton: "fribourg" },
  frImmoSchwab: { name: "ImmoSchwab", listingsUrl: "https://www.immoschwab.ch/", canton: "fribourg" },
  frAsImmo: { name: "AS Immo", listingsUrl: "https://www.as-immo.ch/", canton: "fribourg" },
  frMarlinImmo: { name: "Marlin Immo", listingsUrl: "https://www.marlin-immo.ch/", canton: "fribourg" },
  frLocalCasa: { name: "LocalCasa", listingsUrl: "https://www.localcasa.ch/", canton: "fribourg" },
  frHorvatFils: { name: "Horvat & Fils", listingsUrl: "https://www.horvatfils-immo.ch/", canton: "fribourg" },
  frLombard: { name: "Lombard SA FR", listingsUrl: "https://www.lombard-sa.ch/", canton: "fribourg" },
  frRegieBroye: { name: "Régie Broye FR", listingsUrl: "https://www.regie-broye.ch/", canton: "fribourg" },
  frMollard: { name: "Mollard Immo", listingsUrl: "https://www.mollard-immo.ch/", canton: "fribourg" },
  frMonToit: { name: "MonToit", listingsUrl: "https://www.montoit.ch/", canton: "fribourg" },
  frNcInvest: { name: "NC Invest", listingsUrl: "https://www.nc-invest.immo/", canton: "fribourg" },
  frLaGestion: { name: "La Gestion Immobilière", listingsUrl: "https://www.lagestionimmobiliere.ch/", canton: "fribourg" },
  frMaillard: { name: "Maillard Immo FR", listingsUrl: "https://www.maillardimmo.ch/", canton: "fribourg" },
  frMavimmo: { name: "Mavimmo", listingsUrl: "https://www.mavimmo.ch/", canton: "fribourg" },
  frRubikImmo: { name: "Rubik Immo", listingsUrl: "https://www.rubik-immo.ch/", canton: "fribourg" },
  frAmma: { name: "Amma FR", listingsUrl: "https://www.amma.immo/", canton: "fribourg" },
  frXamaImmo: { name: "Xama Immo", listingsUrl: "https://www.xama-immo.ch/", canton: "fribourg" },
  frStackImmo: { name: "Stack Immobilier", listingsUrl: "https://www.stack-immobilier.ch/", canton: "fribourg" },
  frGoldenHome: { name: "Golden Home", listingsUrl: "https://www.goldenhome.ch/", canton: "fribourg" },
  frFffImmo: { name: "FFF Immobilier", listingsUrl: "https://www.fff-immobilier.ch/", canton: "fribourg" },
  frZimmo: { name: "Zimmo", listingsUrl: "https://www.zimmo.ch/", canton: "fribourg" },
  frFollowImmo: { name: "Follow Immo", listingsUrl: "https://www.follow.immo/", canton: "fribourg" },
  frSensea: { name: "Sensea", listingsUrl: "https://www.sensea.ch/", canton: "fribourg" },
  frDreamo: { name: "Dreamo", listingsUrl: "https://www.dreamo.ch/", canton: "fribourg" },
  frRosset: { name: "Rosset FR", listingsUrl: "https://www.rosset.ch/", canton: "fribourg" },
  frArcasa: { name: "Arcasa", listingsUrl: "https://www.arcasa.ch/", canton: "fribourg" },
  frRegieGlauser: { name: "Régie Glauser", listingsUrl: "https://www.regieglauser.ch/", canton: "fribourg" },
  frAfbImmo: { name: "AFB Immo", listingsUrl: "https://www.afb-immo.ch/", canton: "fribourg" },
  frCgsImmo: { name: "CGS Immobilier FR", listingsUrl: "https://www.cgs-immobilier.ch/", canton: "fribourg" },
  frRegieChatel: { name: "Régie Châtel", listingsUrl: "https://www.regiechatel.ch/", canton: "fribourg" },
  frImmoR: { name: "Immo-R", listingsUrl: "https://www.immo-r.ch/", canton: "fribourg" },
  frChatelImmo: { name: "Châtel Immo", listingsUrl: "https://www.chatel-immo.com/", canton: "fribourg" },
  frHomeEtFoyer: { name: "Home et Foyer", listingsUrl: "https://www.homeetfoyer.ch/", canton: "fribourg" },
  frEsteHomes: { name: "Este Homes FR", listingsUrl: "https://www.este-homes.ch/", canton: "fribourg" },
  frCoventi: { name: "Coventi", listingsUrl: "https://www.coventi.ch/", canton: "fribourg" },
  frCharmoisesImmo: { name: "Charmoises Immo", listingsUrl: "https://www.charmoises-immo.ch/", canton: "fribourg" },
  frImmoTgb: { name: "ImmoTGB", listingsUrl: "https://www.immotgb.ch/", canton: "fribourg" },
  frGerofinanceBulle: { name: "Gérofinance Bulle", listingsUrl: "https://www.gerofinance.ch/", canton: "fribourg" },
  // ── Agences Fribourg supplémentaires (import CSV) ──────────────────
  frAcImmobilis: { name: "AC Immobilis Sàrl", listingsUrl: "https://www.acimmobilis.ch/", canton: "fribourg" },
  frAgenceImmobiliereVotrecourtierChFribourg: { name: "Agence immobilière votrecourtier.ch SA Fribourg", listingsUrl: "https://votrecourtier.ch/", canton: "fribourg" },
  frAntamaImmo: { name: "Antama Immo SA", listingsUrl: "https://antama-groupe.ch/en/", canton: "fribourg" },
  frAnthonyImmobilier: { name: "Anthony Immobilier SA", listingsUrl: "http://www.anthony-immobilier.ch/", canton: "fribourg" },
  frAnura: { name: "ANURA SA", listingsUrl: "https://anura.ch/", canton: "fribourg" },
  frBarbaraProginImmobilier: { name: "Barbara Progin Immobilier", listingsUrl: "https://www.barbaraprogin.immo/en", canton: "fribourg" },
  frBatiCh: { name: "Bati.ch", listingsUrl: "https://bati.ch/", canton: "fribourg" },
  frBethelImmo: { name: "Bethel Immo", listingsUrl: "https://bethel-immo.ch/", canton: "fribourg" },
  frCasArtAgenceImmobiliere: { name: "Cas-Art Agence Immobilière", listingsUrl: "https://cas-art-immo.ch/", canton: "fribourg" },
  frCastorImmobilier: { name: "Castor immobilier", listingsUrl: "https://www.immocastor.com/", canton: "fribourg" },
  frCitrusimmo: { name: "Citrusimmo", listingsUrl: "https://www.citrusimmo.ch/", canton: "fribourg" },
  frClgImmo: { name: "CLG immo Sàrl", listingsUrl: "https://clg-immo.ch/", canton: "fribourg" },
  frConceptImmo2: { name: "Concept\'Immo Sàrl", listingsUrl: "https://conceptimmo.ch/", canton: "fribourg" },
  frCottierGerance: { name: "Cottier Gérance", listingsUrl: "https://www.solutionhabitat.ch/", canton: "fribourg" },
  frDanImmobilier: { name: "Dan-Immobilier", listingsUrl: "https://www.dan-immobilier.ch/", canton: "fribourg" },
  frDomivo: { name: "Domivo", listingsUrl: "https://domivo.ch/", canton: "fribourg" },
  frDomoa: { name: "Domoa Sàrl", listingsUrl: "https://www.domoa.ch/", canton: "fribourg" },
  frEazyImmo: { name: "Eazy Immo Sàrl", listingsUrl: "https://eazyimmo.ch/", canton: "fribourg" },
  frEcoquartierDesEchervettes: { name: "Ecoquartier des Echervettes", listingsUrl: "http://www.echervettes.ch/", canton: "fribourg" },
  frEirizRealisationsImmobilier: { name: "Eiriz Réalisations & Immobilier SA", listingsUrl: "https://www.eiriz.ch/", canton: "fribourg" },
  frEspacecimsa: { name: "espacecimsa", listingsUrl: "https://ecim.ch/", canton: "fribourg" },
  frFrevazConsult: { name: "FRevaz Consult Sàrl", listingsUrl: "https://frevaz-consult.ch/", canton: "fribourg" },
  frGapImmobilier: { name: "GAP Immobilier Sàrl", listingsUrl: "https://gap-immobilier.ch/", canton: "fribourg" },
  frGasserImmobilier: { name: "Gasser Immobilier", listingsUrl: "https://gasser-immobilier.ch/", canton: "fribourg" },
  frGeranceCVillarsSurGlane: { name: "Gérance C SA - Villars-sur-Glâne", listingsUrl: "https://www.gerancec.ch/en", canton: "fribourg" },
  frGestina: { name: "gestina SA", listingsUrl: "http://www.gestina.ch/", canton: "fribourg" },
  frGroupeSfImmo: { name: "Groupe SF Immo SA", listingsUrl: "https://groupe-sfimmo.ch/en/", canton: "fribourg" },
  frHekon: { name: "HEKON Sàrl", listingsUrl: "https://hekon.ch/", canton: "fribourg" },
  frHomeCreationArchitecture: { name: "home creation architecture Sàrl", listingsUrl: "https://home-creation.ch/", canton: "fribourg" },
  frHome4me: { name: "Home4me SA", listingsUrl: "https://home4me.ch/", canton: "fribourg" },
  frHussonImmobilier: { name: "Husson Immobilier", listingsUrl: "https://hussonimmobilier.ch/", canton: "fribourg" },
  frIdimmobilier: { name: "iDimmobilier SA", listingsUrl: "https://idimmobilier.ch/", canton: "fribourg" },
  frImmoMillenium: { name: "Immo Millénium", listingsUrl: "https://immo-millenium.ch/", canton: "fribourg" },
  frImmoTgb2: { name: "IMMO TGB SA", listingsUrl: "https://immotgb.ch/", canton: "fribourg" },
  frImmobilierTinguely: { name: "Immobilier Tinguely Sàrl", listingsUrl: "https://immobilier-tinguely.ch/", canton: "fribourg" },
  frImmoseekerAg: { name: "IMMOSEEKER AG", listingsUrl: "https://immoseeker.ch/", canton: "fribourg" },
  frIsoImmo: { name: "Iso Immo SA", listingsUrl: "https://isofutur.ch/", canton: "fribourg" },
  frIstarImmobilier: { name: "ISTAR Immobilier Sàrl", listingsUrl: "https://istarimmo.ch/", canton: "fribourg" },
  frJinene: { name: "Jinène SA", listingsUrl: "https://jinene-travel.ch/", canton: "fribourg" },
  frJpfImmobilier: { name: "JPF Immobilier SA", listingsUrl: "https://jpf-immobilier.ch/", canton: "fribourg" },
  frJrbImmobilier: { name: "JRB Immobilier", listingsUrl: "https://www.jrb-immobilier.ch/", canton: "fribourg" },
  frLaPierreImmobilier: { name: "La Pierre Immobilier", listingsUrl: "https://www.lapierre-immobilier.ch/", canton: "fribourg" },
  frLbGerance: { name: "LB Gérance SA", listingsUrl: "https://lb-immobilier.ch/", canton: "fribourg" },
  frLubaCourtageEstimationsImmobilieres: { name: "LUBA Courtage & Estimations immobilières", listingsUrl: "https://luba.ch/", canton: "fribourg" },
  frMaGerance: { name: "MA Gérance Sàrl", listingsUrl: "https://www.mamaisonimmo.ch/", canton: "fribourg" },
  frMavImmobilier: { name: "MAV immobilier sarl", listingsUrl: "https://mavimmo.ch/", canton: "fribourg" },
  frMcbimmo: { name: "MCBimmo", listingsUrl: "https://mcbimmo.ch/", canton: "fribourg" },
  frMdcImmobilier: { name: "MDC Immobilier Sàrl", listingsUrl: "https://mdcimmobilier.ch/", canton: "fribourg" },
  frMkImmo: { name: "MK.IMMO Sàrl", listingsUrl: "https://mkimmo-sarl.ch/", canton: "fribourg" },
  frMonneyImmobilier: { name: "Monney Immobilier SA", listingsUrl: "https://monney-immobilier.ch/", canton: "fribourg" },
  frMpiMarcProgin: { name: "MPI Marc Progin", listingsUrl: "https://marc-progin-immo.ch/", canton: "fribourg" },
  frNorbertChardonnens: { name: "Norbert Chardonnens SA", listingsUrl: "https://www.chardonnens.ch/", canton: "fribourg" },
  frO2Immo: { name: "O2 immo Sàrl", listingsUrl: "https://o2immo.ch/", canton: "fribourg" },
  frOmlImmo: { name: "OML Immo", listingsUrl: "https://omlimmo.ch/", canton: "fribourg" },
  frPamImmobilier: { name: "Pam Immobilier", listingsUrl: "https://pamimmobilier.ch/", canton: "fribourg" },
  frParcelle12: { name: "parcelle 12", listingsUrl: "https://parcelle12.ch/", canton: "fribourg" },
  frPolygoneConstructions: { name: "POLYGONE Constructions Sàrl", listingsUrl: "https://polygone-constructions.ch/", canton: "fribourg" },
  frPrestigeInvestment: { name: "Prestige Investment Sàrl", listingsUrl: "https://prestigeinvestment.ch/", canton: "fribourg" },
  frRBImmo: { name: "R&B Immo Sàrl", listingsUrl: "https://r-b-immo.ch/", canton: "fribourg" },
  frRdImmobilier: { name: "RD Immobilier", listingsUrl: "https://rdimmobilier.ch/", canton: "fribourg" },
  frRegieDeFribourg: { name: "Régie de Fribourg SA", listingsUrl: "https://rfsa.ch/", canton: "fribourg" },
  frRegieRolandDonner: { name: "Régie Roland Donner", listingsUrl: "https://www.donner-immobilier.ch/", canton: "fribourg" },
  frRubikImmobilierRomont: { name: "Rubik-immobilier Sàrl - Romont", listingsUrl: "https://rubik-immo.ch/", canton: "fribourg" },
  frServiceManagementImmobilierSmi: { name: "Service Management Immobilier (SMI SA)", listingsUrl: "https://smisa.ch/", canton: "fribourg" },
  frSodalitasSci: { name: "Sodalitas SCI", listingsUrl: "https://www.sodalitas.ch/fr", canton: "fribourg" },
  frSundanceProperty: { name: "Sundance Property", listingsUrl: "https://sundanceproperty.ch/", canton: "fribourg" },
  frSwitzerlandHouseCh: { name: "Switzerland House.ch", listingsUrl: "https://www.homegate.ch/en", canton: "fribourg" },
  frToffelImmobilier: { name: "Toffel Immobilier", listingsUrl: "https://toffel-immobilier.ch/", canton: "fribourg" },
  frVbImmobilier: { name: "VB IMMOBILIER", listingsUrl: "https://vb-immobilier.ch/", canton: "fribourg" },
  frWeckAebyCie: { name: "Weck Aeby & Cie SA", listingsUrl: "https://weck-aeby.ch/", canton: "fribourg" },
  frWedpro: { name: "WEDPRO Sàrl", listingsUrl: "https://wedpro.swiss/", canton: "fribourg" },
  frWiderImmoManagement: { name: "Wider Immo-Management Sàrl", listingsUrl: "https://widerimmo.ch/", canton: "fribourg" },
  frWinteamImmobilier: { name: "Winteam Immobilier Sàrl", listingsUrl: "https://www.winteam-immobilier.ch/", canton: "fribourg" },
  frYvesGuilletImmobilier: { name: "Yves Guillet Immobilier SA", listingsUrl: "http://www.yvesguillet.ch/", canton: "fribourg" },
  // ── Genève ────────────────────────────────────────────────────────────────
  geStoneInvest: { name: "Stone Invest", listingsUrl: "https://www.stone-invest.ch/", canton: "geneve" },
  geMillenium: { name: "Millenium Properties", listingsUrl: "https://www.milleniumproperties.ch/", canton: "geneve" },
  geNessell: { name: "Nessell", listingsUrl: "https://www.nessell.ch/", canton: "geneve" },
  geGary: { name: "Gary", listingsUrl: "https://www.gary.ch/", canton: "geneve" },
  geComptoirImmo: { name: "Comptoir Immo GE", listingsUrl: "https://www.comptoir-immo.ch/", canton: "geneve" },
  geSegimo: { name: "Segimo", listingsUrl: "https://www.segimo.com/", canton: "geneve" },
  geMoserVernet: { name: "Moser Vernet", listingsUrl: "https://www.moservernet.ch/", canton: "geneve" },
  geNaef: { name: "Naef GE", listingsUrl: "https://www.naef.ch/", canton: "geneve" },
  geRegimo: { name: "Regimo Genève", listingsUrl: "https://www.regimo-geneve.ch/", canton: "geneve" },
  geFgp: { name: "FGP Swiss & Alps", listingsUrl: "https://www.fgp-swissandalps.com/", canton: "geneve" },
  geBarnes: { name: "Barnes GE", listingsUrl: "https://www.barnes-suisse.ch/", canton: "geneve" },
  geRousseau5: { name: "Rousseau 5", listingsUrl: "https://www.rousseau5.ch/", canton: "geneve" },
  geRosset: { name: "Rosset GE", listingsUrl: "https://www.rosset.ch/", canton: "geneve" },
  geGrange: { name: "Grange", listingsUrl: "https://www.grange.ch/", canton: "geneve" },
  geAgci: { name: "AGCI", listingsUrl: "https://www.agci.ch/", canton: "geneve" },
  geServiceImmo: { name: "Service Immo Genevois", listingsUrl: "https://www.service-immobilier-genevois.ch/", canton: "geneve" },
  geRegieCentre: { name: "Régie du Centre", listingsUrl: "https://www.regieducentre.ch/", canton: "geneve" },
  gePiletRenaud: { name: "Pilet & Renaud", listingsUrl: "https://www.pilet-renaud.ch/", canton: "geneve" },
  geGerofinance: { name: "Gerofinance GE", listingsUrl: "https://www.gerofinance.ch/", canton: "geneve" },
  geTournier: { name: "Tournier", listingsUrl: "https://www.tournier.ch/", canton: "geneve" },
  geSpg: { name: "SPG", listingsUrl: "https://www.spg.ch/", canton: "geneve" },
  geRegieAlpes: { name: "Régie Alpes", listingsUrl: "https://www.regie-alpes.ch/", canton: "geneve" },
  geRegieBrun: { name: "Régie Brun", listingsUrl: "https://www.regiebrun.ch/", canton: "geneve" },
  geProgrimm: { name: "Progrimm", listingsUrl: "https://www.progrimm.com/", canton: "geneve" },
  geBory: { name: "Bory", listingsUrl: "https://www.bory.ch/", canton: "geneve" },
  geBurger: { name: "Burger SA", listingsUrl: "https://www.burger-sa.ch/", canton: "geneve" },
  geCogerim: { name: "Cogerim", listingsUrl: "https://www.cogerim.ch/", canton: "geneve" },
  geBordierSchmidhauser: { name: "Bordier-Schmidhauser", listingsUrl: "https://www.bordier-schmidhauser.ch/", canton: "geneve" },
  geRibordy: { name: "Ribordy SA", listingsUrl: "https://www.ribordysa.ch/", canton: "geneve" },
  geSgRealEstate: { name: "SG Real Estate", listingsUrl: "https://www.sg-realestate.ch/", canton: "geneve" },
  geFivc: { name: "FIVC", listingsUrl: "https://www.fivc.ch/", canton: "geneve" },
  geVingtNeuf: { name: "Vingt-Neuf", listingsUrl: "https://www.vingt-neuf.ch/", canton: "geneve" },
  geAffinityPrestige: { name: "Affinity Prestige", listingsUrl: "https://www.affinityprestige.ch/", canton: "geneve" },
  geOmnia: { name: "Omnia GE", listingsUrl: "https://www.omnia.ch/", canton: "geneve" },
  geImmoCep: { name: "ImmoCEP", listingsUrl: "https://www.immocep.ch/", canton: "geneve" },
  geEstherLauber: { name: "Esther Lauber", listingsUrl: "https://www.esther-lauber.ch/", canton: "geneve" },
  geBeaulieuImmo: { name: "Beaulieu Immobilier", listingsUrl: "https://www.beaulieu-immobilier.com/", canton: "geneve" },
  geCydonia: { name: "Cydonia", listingsUrl: "https://www.cydonia.swiss/", canton: "geneve" },
  geDaudin: { name: "Daudin", listingsUrl: "https://www.daudin.ch/", canton: "geneve" },
  geCiLeman: { name: "CI Léman", listingsUrl: "https://www.ci-leman.ch/", canton: "geneve" },
  geGlobalImmo: { name: "Global Immo", listingsUrl: "https://www.global-immo.ch/", canton: "geneve" },
  geBersier: { name: "Bersier SA", listingsUrl: "https://www.bersiersa.ch/", canton: "geneve" },
  geSpeedimmo: { name: "Speedimmo", listingsUrl: "https://www.speedimmo.ch/", canton: "geneve" },
  geFreeconcept: { name: "Freeconcept Immo", listingsUrl: "https://www.freeconceptimmo.ch/", canton: "geneve" },
  geNaefCommercial: { name: "Naef Commercial", listingsUrl: "https://www.naef-commercial.ch/", canton: "geneve" },
  geBmImmo: { name: "BM Immo", listingsUrl: "https://www.bm-immo.ch/", canton: "geneve" },
  geMatesa: { name: "Matesa Immo", listingsUrl: "https://www.matesaimmo.com/", canton: "geneve" },
  geRizzo: { name: "Rizzo Immobilier", listingsUrl: "https://www.rizzoimmobilier.ch/", canton: "geneve" },
  gePrestimmo: { name: "Prestimmo", listingsUrl: "https://www.prestimmo.ch/", canton: "geneve" },
  geAige: { name: "AIGE", listingsUrl: "https://www.aige.ch/", canton: "geneve" },
  geExcellence: { name: "Excellence International", listingsUrl: "https://www.excellence-international.ch/", canton: "geneve" },
  geMagnolia: { name: "Magnolia Immobilier", listingsUrl: "https://www.magnolia-immobilier.ch/", canton: "geneve" },
  geLuxuryPlaces: { name: "Luxury Places", listingsUrl: "https://www.luxury-places.ch/", canton: "geneve" },
  geBelImmo: { name: "Bel-Immo", listingsUrl: "https://www.bel-immo.ch/", canton: "geneve" },
  geRegieDuBoux: { name: "Régie du Boux GE", listingsUrl: "https://www.regieduboux.ch/", canton: "geneve" },
  geVerso: { name: "Verso Genève", listingsUrl: "https://www.verso-geneve.ch/", canton: "geneve" },
  geHomnia: { name: "Homnia", listingsUrl: "https://www.homnia.ch/", canton: "geneve" },
  geParcImmo: { name: "Parc Immobilier", listingsUrl: "https://www.parcimmobilier.ch/", canton: "geneve" },
  geGrk: { name: "GRK Immobilier", listingsUrl: "https://www.grkimmobilier.ch/", canton: "geneve" },
  geAbImmo: { name: "AB Immobilier Général", listingsUrl: "https://www.abimmobiliergeneral.ch/", canton: "geneve" },
  geGenimmo: { name: "Genimmo", listingsUrl: "https://www.genimmo.ch/", canton: "geneve" },
  geNewlife: { name: "NewLife Immo", listingsUrl: "https://www.newlifeimmo.ch/", canton: "geneve" },
  geStoffel: { name: "Stoffel Immo", listingsUrl: "https://www.stoffelimmo.ch/", canton: "geneve" },
  geCayden: { name: "Cayden", listingsUrl: "https://www.cayden.ch/", canton: "geneve" },
  geAceImmo: { name: "Ace Immo", listingsUrl: "https://www.aceimmo.ch/", canton: "geneve" },
  geRoofInvest: { name: "RoofInvest", listingsUrl: "https://www.roofinvest.ch/", canton: "geneve" },
  geImmotour: { name: "Immotour GE", listingsUrl: "https://www.immotour-ge.ch/", canton: "geneve" },
  geCrest: { name: "Crest Immobilier", listingsUrl: "https://www.crestimmobilier.com/", canton: "geneve" },
  geAbcGeneve: { name: "ABC Genève", listingsUrl: "https://www.abcgeneve.com/", canton: "geneve" },
  geFuturimmo: { name: "Futurimmo", listingsUrl: "https://www.futurimmo.ch/", canton: "geneve" },
  geVisionImmo: { name: "Vision Immo", listingsUrl: "https://www.visionimmo.ch/", canton: "geneve" },
  geGabb: { name: "GABB Immo", listingsUrl: "https://www.gabb-immo.ch/", canton: "geneve" },
  gePottuSeitz: { name: "Pottu Seitz", listingsUrl: "https://www.pottu-seitz.ch/", canton: "geneve" },
  geImmoCologny: { name: "Immobilier Cologny", listingsUrl: "https://www.immobilier-cologny.ch/", canton: "geneve" },
  geMaterr: { name: "Materr", listingsUrl: "https://www.materr.ch/", canton: "geneve" },
  geImro: { name: "IMRO", listingsUrl: "https://www.imro.ch/", canton: "geneve" },
  geSpiImmo: { name: "SPI Immo", listingsUrl: "https://www.spi-immo.ch/", canton: "geneve" },
  geRiveDroite: { name: "Rive Droite", listingsUrl: "https://www.rivedroite.ch/", canton: "geneve" },
  geChambesyImmo: { name: "Chambésy Immo", listingsUrl: "https://www.chambesy-immo.ch/", canton: "geneve" },
  geCfmb: { name: "CFMB", listingsUrl: "https://www.cfmb-sa.ch/", canton: "geneve" },
  geMadimmo: { name: "Madimmo", listingsUrl: "https://www.madimmo.ch/", canton: "geneve" },
  geGvaImmo: { name: "GVA Immo", listingsUrl: "https://www.gva-immo.ch/", canton: "geneve" },
  geSavinter: { name: "Savinter", listingsUrl: "https://www.savinter.ch/", canton: "geneve" },
  geChamperet: { name: "Champéret", listingsUrl: "https://www.champeret.ch/", canton: "geneve" },
  geAgenceMendes: { name: "Agence Mendes", listingsUrl: "https://www.agencemendes.ch/", canton: "geneve" },
  geCvRealEstate: { name: "CV Real Estate", listingsUrl: "https://www.cvrealestate.ch/", canton: "geneve" },
  geCpImmo: { name: "CP Immo", listingsUrl: "https://www.cp-immo.ch/", canton: "geneve" },
  geUrbania: { name: "Urbania", listingsUrl: "https://www.urbania.ch/", canton: "geneve" },
  geLaPerle: { name: "La Perle Immobilier", listingsUrl: "https://www.laperle-immobilier.ch/", canton: "geneve" },
  geRegieSaintGervais: { name: "Régie Saint-Gervais", listingsUrl: "https://www.regiesaintgervais.ch/", canton: "geneve" },
  geVeyratSarasin: { name: "Veyrat-Sarasin", listingsUrl: "https://www.veyrat-sarasin.ch/", canton: "geneve" },
  geBalisiers: { name: "Balisiers", listingsUrl: "https://www.balisiers.ch/", canton: "geneve" },
  geNeho: { name: "Neho GE", listingsUrl: "https://www.neho.ch/", canton: "geneve" },
  gePrivera: { name: "Privera GE", listingsUrl: "https://www.privera.ch/", canton: "geneve" },
  geHomeyImmo: { name: "Homey Immo", listingsUrl: "https://www.homeyimmo.com/", canton: "geneve" },
  // ── Agences Genève supplémentaires (import CSV) ──────────────────
  geA105Immo: { name: "105 Immo", listingsUrl: "https://105immo.ch/", canton: "geneve" },
  geAcasaImmobilierHabitat: { name: "Acasa Immobilier & Habitat", listingsUrl: "https://acasa-immobilien.ch/", canton: "geneve" },
  geActimmo: { name: "Actimmo Sàrl", listingsUrl: "https://actimmo-ge.ch/", canton: "geneve" },
  geAffairesTransactions: { name: "AFFAIRES TRANSACTIONS SARL", listingsUrl: "https://affrt.ch/", canton: "geneve" },
  geAgenceDuRhoneGeneveCite: { name: "Agence du Rhône Genève-Cité Sàrl", listingsUrl: "https://agencedurhone.ch/", canton: "geneve" },
  geAgenceGerardPaleyEtFils: { name: "Agence Gérard Paley et Fils SA", listingsUrl: "https://www.gpaley.ch/", canton: "geneve" },
  geAgim: { name: "AGIM SA", listingsUrl: "http://www.agim.ch/", canton: "geneve" },
  geAlkimia: { name: "Alkimia SA", listingsUrl: "https://www.alkimia.ch/", canton: "geneve" },
  geAllianceImmobiliereGenevoise: { name: "Alliance Immobilière Genevoise", listingsUrl: "https://aige.ch/", canton: "geneve" },
  geAlphaLogis: { name: "ALPHA-LOGIS SA", listingsUrl: "https://alpha-logis.ch/", canton: "geneve" },
  geAmiInternationalSuisse: { name: "AMI International (Suisse) SA", listingsUrl: "https://amint.ch/", canton: "geneve" },
  geAppartel: { name: "Appartel Sàrl", listingsUrl: "https://appartel.ch/", canton: "geneve" },
  geArcProperties: { name: "ARC PROPERTIES", listingsUrl: "https://arcproperties.ch/", canton: "geneve" },
  geAreniaCh: { name: "ARENIA.CH", listingsUrl: "https://arenia.ch/", canton: "geneve" },
  geArgecil: { name: "Argecil SA", listingsUrl: "http://www.argecil.ch/", canton: "geneve" },
  geArkady: { name: "Arkady SA", listingsUrl: "https://arkady.ch/", canton: "geneve" },
  geArveron: { name: "Arveron", listingsUrl: "https://arveron.ch/", canton: "geneve" },
  geAtelia: { name: "Atelia Sàrl", listingsUrl: "https://realestate.atelia.ch/", canton: "geneve" },
  geAtelierNombreDOr: { name: "ATELIER NOMBRE D\'OR", listingsUrl: "https://nombredor.ch/", canton: "geneve" },
  geAtonDeveloppement: { name: "ATON Développement SA", listingsUrl: "https://atonsa.ch/", canton: "geneve" },
  geBMooserImmobilier: { name: "B. Mooser Immobilier", listingsUrl: "https://bm-immo.ch/", canton: "geneve" },
  geBalPartnersImmo: { name: "Bal Partners immo SA", listingsUrl: "https://bal-partners.ch/", canton: "geneve" },
  geBeaverImmobilier: { name: "Beaver Immobilier SA", listingsUrl: "http://www.beaver-immo.ch/", canton: "geneve" },
  geBefi: { name: "BEFI SA", listingsUrl: "https://befi.ch/", canton: "geneve" },
  geBelleriveProperties: { name: "Bellerive Properties", listingsUrl: "https://bellerive-properties.ch/", canton: "geneve" },
  geBericManagement: { name: "BERIC Management SA", listingsUrl: "https://beric.ch/", canton: "geneve" },
  geBernardNicodGeneve: { name: "Bernard Nicod Genève", listingsUrl: "https://bernard-nicod.ch/", canton: "geneve" },
  geBerthaultImmobilier: { name: "Berthault Immobilier", listingsUrl: "https://berthault.ch/en", canton: "geneve" },
  geBertocImmo: { name: "Bertoc Immo SA", listingsUrl: "https://bertoc-immo.ch/", canton: "geneve" },
  geBessonDumontDelaunayCie: { name: "Besson, Dumont, Delaunay & Cie SA", listingsUrl: "https://www.bdd.ch/", canton: "geneve" },
  geBienEnViager: { name: "Bien en Viager", listingsUrl: "https://viagers.ch/", canton: "geneve" },
  geBoutiqueImmo: { name: "Boutique Immo", listingsUrl: "http://www.boutiqueimmo.ch/", canton: "geneve" },
  geBrConsulting: { name: "BR Consulting", listingsUrl: "http://rojanawisut.ch/", canton: "geneve" },
  geBurkardExpertsComptables: { name: "BURKARD Experts-comptables SA", listingsUrl: "https://burkard-fiduciaire.ch/", canton: "geneve" },
  geCCConceptsConseils: { name: "C&C Concepts & Conseils SA", listingsUrl: "https://www.ccconcept.ch/CC/", canton: "geneve" },
  geCampus: { name: "Campus", listingsUrl: "https://www.campus-offices.ch/", canton: "geneve" },
  geCapHome: { name: "CAP HOME Sàrl", listingsUrl: "https://caphome.ch/", canton: "geneve" },
  geCbreGeneve: { name: "CBRE SA - Genève", listingsUrl: "https://www.cbre.ch/", canton: "geneve" },
  geCciFranceSuisse: { name: "CCI France Suisse", listingsUrl: "https://www.ccifs.ch/", canton: "geneve" },
  geCfimmobilier: { name: "cfimmobilier", listingsUrl: "https://immobilier.ch/", canton: "geneve" },
  geCharlesBesuchet: { name: "CHARLES BESUCHET SA", listingsUrl: "https://besuchet.ch/", canton: "geneve" },
  geClassicusRealEstate: { name: "Classicus Real Estate SA", listingsUrl: "https://c-re.ch/", canton: "geneve" },
  geCmdPromotion: { name: "CMD promotion SA", listingsUrl: "https://cmd-promotion.ch/", canton: "geneve" },
  geCodhaCooperativeDeLHabitatAssociatif: { name: "Codha, Coopérative de l\'habitat associatif", listingsUrl: "https://www.codha.ch/", canton: "geneve" },
  geCompagnieFonciereDuLeman: { name: "Compagnie Foncière du Léman", listingsUrl: "https://fonciere.ch/", canton: "geneve" },
  geCompagnieImmobiliereDuLeman: { name: "Compagnie Immobilière du Léman SA", listingsUrl: "https://www.ci-leman.ch/en", canton: "geneve" },
  geCrowdpark: { name: "Crowdpark SA", listingsUrl: "https://www.crowdpark.ch/", canton: "geneve" },
  geDavelImmobilier: { name: "Davel Immobilier Sarl", listingsUrl: "http://www.davelimmobilier.ch/", canton: "geneve" },
  geDesormiereVanhalst: { name: "DESORMIERE & VANHALST Sàrl", listingsUrl: "https://desormiere-vanhalst.ch/", canton: "geneve" },
  geDiversificationEurope: { name: "Diversification Europe SA", listingsUrl: "https://www.diversification-europe.ch/", canton: "geneve" },
  geEasyFlat: { name: "EASY FLAT Sàrl", listingsUrl: "http://www.easyflat.ch/", canton: "geneve" },
  geEgimmobilier: { name: "EGimmobilier SA", listingsUrl: "https://egimmo.ch/", canton: "geneve" },
  geElucimmo: { name: "Elucimmo SA", listingsUrl: "https://elucimmo.ch/", canton: "geneve" },
  geEnvisages: { name: "Envisages Sàrl", listingsUrl: "http://envisages.ch/", canton: "geneve" },
  geExpatServicesRelocation: { name: "Expat Services Relocation", listingsUrl: "https://expat-services-relocation.ch/", canton: "geneve" },
  geFidysGroupImmobilier: { name: "Fidys Group Immobilier", listingsUrl: "https://fidysgroup.ch/gestion-de-limmobilier", canton: "geneve" },
  geFipoi: { name: "FIPOI", listingsUrl: "https://fipoi.ch/", canton: "geneve" },
  geFirstHomeImmobilier: { name: "First Home Immobilier", listingsUrl: "http://www.firsthome.ch/", canton: "geneve" },
  geGabbImmo: { name: "GABB-IMMO Sàrl", listingsUrl: "https://gabb-immo.ch/", canton: "geneve" },
  geGenevaHomes: { name: "Geneva Homes SA", listingsUrl: "https://genevahomes.ch/", canton: "geneve" },
  geGerardBaeznerCie: { name: "Gérard Baezner & Cie SA", listingsUrl: "https://www.regiebaezner.ch/", canton: "geneve" },
  geGestassistImmobilierDecoration: { name: "Gestassist Immobilier & Décoration", listingsUrl: "https://www.gestassist.ch/", canton: "geneve" },
  geGestimob: { name: "Gestimob SA", listingsUrl: "https://www.gestimobsa.ch/", canton: "geneve" },
  geGhImmobilier: { name: "GH immobilier Sàrl", listingsUrl: "https://ghimmobilier.ch/", canton: "geneve" },
  geGpfGerance: { name: "GPF - Gérance", listingsUrl: "https://www.gerances.ch/en/", canton: "geneve" },
  geGpfVentesResidentielles: { name: "GPF - Ventes résidentielles", listingsUrl: "https://www.gerances.ch/", canton: "geneve" },
  geGreit: { name: "GREIT SA", listingsUrl: "http://www.greit.ch/", canton: "geneve" },
  geGroupeFondeco: { name: "Groupe Fondeco", listingsUrl: "http://www.fondeco.ch/", canton: "geneve" },
  geGvaConnect: { name: "GVA Connect Sàrl", listingsUrl: "https://gva-connect.ch/", canton: "geneve" },
  geGvaImmo2: { name: "GVA-IMMO SA", listingsUrl: "http://gva-immo.ch/", canton: "geneve" },
  geHayi: { name: "HAYI SA", listingsUrl: "https://www.hayi.ch/", canton: "geneve" },
  geHlpHomelocPrestige: { name: "HLP – Homeloc & Prestige", listingsUrl: "https://homeloc.ch/", canton: "geneve" },
  geHomeLocation: { name: "Home Location", listingsUrl: "https://homelocation.ch/", canton: "geneve" },
  geHomenhancement: { name: "Homenhancement SA", listingsUrl: "http://www.homenhancement.ch/", canton: "geneve" },
  geHorizonImmobilier: { name: "Horizon Immobilier", listingsUrl: "https://remax.ch/", canton: "geneve" },
  geHouseImmobilier: { name: "House Immobilier", listingsUrl: "http://house-immobilier.ch/", canton: "geneve" },
  geHousePartner: { name: "HOUSE PARTNER SA", listingsUrl: "http://www.housepartner.ch/", canton: "geneve" },
  geHsoTradeServices: { name: "HSO Trade&Services", listingsUrl: "https://hsotrade.ch/", canton: "geneve" },
  geIgmImmobilier: { name: "IGM Immobilier", listingsUrl: "http://igm-immobilier.ch/", canton: "geneve" },
  geIkami: { name: "Ikami", listingsUrl: "https://ikami.ch/", canton: "geneve" },
  geImges: { name: "Imges Sàrl", listingsUrl: "http://www.imges.ch/", canton: "geneve" },
  geImmoInvestLac: { name: "IMMO INVEST LAC Sàrl", listingsUrl: "https://immoinvest-lac.ch/", canton: "geneve" },
  geImmoReflex: { name: "Immo Reflex Sàrl", listingsUrl: "https://immoreflex.ch/", canton: "geneve" },
  geImmoEvent: { name: "Immo-Event SA", listingsUrl: "https://immo-event.ch/", canton: "geneve" },
  geImmoFutur: { name: "Immo-Futur", listingsUrl: "https://futurimmo.ch/", canton: "geneve" },
  geImmo2geneve: { name: "IMMO2GENEVE", listingsUrl: "https://www.immo2geneve.ch/", canton: "geneve" },
  geImmobiliereGenevoise: { name: "Immobilière Genevoise", listingsUrl: "https://immobiliere-genevoise.ch/", canton: "geneve" },
  geImmogeste: { name: "Immogeste", listingsUrl: "http://immogeste.ch/", canton: "geneve" },
  geImmolacInvest: { name: "Immolac Invest SA", listingsUrl: "https://immolac.ch/", canton: "geneve" },
  geImmomatterAssocies: { name: "ImmoMatter & Associés", listingsUrl: "https://immomatter.ch/", canton: "geneve" },
  geImmomotion: { name: "Immomotion Sàrl", listingsUrl: "https://www.immomotion.ch/", canton: "geneve" },
  geImmosamGroup: { name: "IMMOSAM Group SA", listingsUrl: "https://debloquezvosventes.ch/", canton: "geneve" },
  geImmotrendy: { name: "Immotrendy", listingsUrl: "https://immotrendy.ch/", canton: "geneve" },
  geImwireProperties: { name: "Imwire Properties", listingsUrl: "https://www.imwire.ch/", canton: "geneve" },
  geIndigoImmobilier: { name: "Indigo Immobilier", listingsUrl: "https://wstreuhand.ch/", canton: "geneve" },
  geIseliImmobilier: { name: "ISELI IMMOBILIER SA", listingsUrl: "http://www.regieiseli.ch/iseli/", canton: "geneve" },
  geJosephHenriSnc: { name: "Joseph Henri SNC", listingsUrl: "https://joseph-henri.ch/", canton: "geneve" },
  geJouanDeRham: { name: "Jouan - de Rham SA", listingsUrl: "http://www.jouan-derham.ch/", canton: "geneve" },
  geJsreEstimationVenteImmobiliere: { name: "JSRE - Estimation & Vente immobilière", listingsUrl: "https://www.jsre.ch/", canton: "geneve" },
  geCoursDesBastions13: { name: "Cours des Bastions 13", listingsUrl: "https://neupsy.ch/", canton: "geneve" },
  geLAppart: { name: "L\'APPART\' Sàrl", listingsUrl: "https://appart-lausanne.ch/", canton: "geneve" },
  geLEmotionImmobiliereAlainBaruchel: { name: "L\'Emotion Immobilière - Alain Baruchel", listingsUrl: "https://l-emotion-immobiliere.ch/", canton: "geneve" },
  geLaPierreBleueImmobilier: { name: "La Pierre Bleue Immobilier", listingsUrl: "https://lapierrebleue.ch/", canton: "geneve" },
  geLacTowerPromotion: { name: "LAC Tower Promotion", listingsUrl: "https://lac-tower.ch/", canton: "geneve" },
  geLakeGenevaPrestige: { name: "Lake Geneva Prestige", listingsUrl: "https://lakegenevaprestige.ch/en/", canton: "geneve" },
  geLauraMuntmarkRealEstate: { name: "Laura Muntmark Real Estate", listingsUrl: "https://www.muntmark.ch/", canton: "geneve" },
  geLePilierDeLImmobilier: { name: "Le Pilier De l\'Immobilier Sàrl", listingsUrl: "https://le-pilier.ch/", canton: "geneve" },
  geLemanPropertyAdviser: { name: "Leman Property Adviser", listingsUrl: "https://www.leprad.ch/en/", canton: "geneve" },
  geLemaniaImmo: { name: "Lemania Immo SA", listingsUrl: "http://www.lemania-immo.ch/", canton: "geneve" },
  geLemanikHome: { name: "Lemanik Home SA", listingsUrl: "https://lemanikhome.ch/", canton: "geneve" },
  geLesRegisseursAssocies: { name: "Les Régisseurs Associés", listingsUrl: "https://regisseurs.ch/", canton: "geneve" },
  geLocadvisory: { name: "Locadvisory Sàrl", listingsUrl: "https://locadvisory.ch/", canton: "geneve" },
  geLpCoDeveloppement: { name: "Lp&Co développement SA", listingsUrl: "https://www.lp-co.ch/", canton: "geneve" },
  geLux: { name: "Lux SA", listingsUrl: "http://www.luxhomes.ch/", canton: "geneve" },
  geMartheRelocation: { name: "Marthe Relocation", listingsUrl: "http://www.marthe-relocation.ch/", canton: "geneve" },
  geMelcarne: { name: "MELCARNE SA", listingsUrl: "http://www.melcarne.ch/", canton: "geneve" },
  geMellender: { name: "Mellender Sàrl", listingsUrl: "https://mellender.ch/", canton: "geneve" },
  geMettaProperties: { name: "Metta Properties SA", listingsUrl: "https://www.mettaproperties.ch/", canton: "geneve" },
  geMgImmoPrestige: { name: "MG-Immo Prestige", listingsUrl: "https://mg-immo.ch/", canton: "geneve" },
  geMtbRealisations: { name: "MTB Réalisations Sàrl", listingsUrl: "http://www.mtbimmo.ch/", canton: "geneve" },
  geMvhImmobilier: { name: "MVH Immobilier", listingsUrl: "https://mvh-immobilier.ch/", canton: "geneve" },
  geMwPropertyManagementConsulting: { name: "MW Property Management & Consulting", listingsUrl: "http://www.mwrealestate.ch/", canton: "geneve" },
  geMyFamilyHouse: { name: "My Family House", listingsUrl: "https://myfamilyhouse.ch/", canton: "geneve" },
  geNahidSappinoRealEstate: { name: "Nahid Sappino Real Estate", listingsUrl: "https://nsre.ch/", canton: "geneve" },
  geNepsa: { name: "NEPSA", listingsUrl: "http://www.nepsa.ch/", canton: "geneve" },
  geNestya: { name: "Nestya SA", listingsUrl: "https://nestya.ch/", canton: "geneve" },
  geNettilac: { name: "Nettilac SA", listingsUrl: "http://nettilac.ch/", canton: "geneve" },
  geNextgenWealthManagers: { name: "NextGen Wealth Managers SA", listingsUrl: "https://nextgen-wm.ch/", canton: "geneve" },
  geNidSProperties: { name: "NID\'S PROPERTIES Sàrl", listingsUrl: "https://nidsproperties.ch/", canton: "geneve" },
  geNmh: { name: "NMH SA", listingsUrl: "https://newmobilhair.ch/", canton: "geneve" },
  geNovihome: { name: "Novihome SA", listingsUrl: "https://www.novihome.ch/", canton: "geneve" },
  geNsrGroup: { name: "NSR GROUP SA", listingsUrl: "https://nsr-group.ch/", canton: "geneve" },
  geOaksGroup: { name: "OAKS GROUP SA", listingsUrl: "https://oaks.ch/en", canton: "geneve" },
  geOryxFinance: { name: "ORYX Finance", listingsUrl: "https://oryx-finance.ch/", canton: "geneve" },
  geParkimmo: { name: "PARKIMMO SA", listingsUrl: "https://parkimmo.ch/", canton: "geneve" },
  gePeyrotConseilImmobilier: { name: "Peyrot Conseil Immobilier SA", listingsUrl: "https://pc-immo.ch/", canton: "geneve" },
  gePlafidaImmobilier: { name: "Plafida Immobilier SA", listingsUrl: "https://plafida.ch/", canton: "geneve" },
  gePolimmo: { name: "Polimmo SA", listingsUrl: "https://polimmo.ch/", canton: "geneve" },
  gePraemiumImmobilier: { name: "Praemium Immobilier", listingsUrl: "https://praemium.ch/", canton: "geneve" },
  gePreoPrivateRealEstateOffice: { name: "PREO Private Real Estate Office", listingsUrl: "http://www.preo.ch/", canton: "geneve" },
  gePrivaliaImmobilier: { name: "Privalia Immobilier SA", listingsUrl: "https://privalia-immobilier.ch/", canton: "geneve" },
  geProkeschImmobilier: { name: "Prokesch Immobilier SA", listingsUrl: "http://www.prokeschimmobilier.ch/", canton: "geneve" },
  geProprietesDuLeman: { name: "Propriétés du Léman SA", listingsUrl: "http://www.pl-immo.ch/", canton: "geneve" },
  gePxcImmobilier: { name: "PXC Immobilier", listingsUrl: "https://pxcimmobilier.ch/", canton: "geneve" },
  geQualityLiving: { name: "QUALITY LIVING", listingsUrl: "http://www.qualityliving.ch/", canton: "geneve" },
  geRdbImmobilier: { name: "RDB Immobilier", listingsUrl: "https://reprisedebailappartement.ch/fr", canton: "geneve" },
  geReaim: { name: "ReAIM", listingsUrl: "https://c59-geneve.ch/", canton: "geneve" },
  geRealys: { name: "Realys SA", listingsUrl: "http://www.realys.ch/", canton: "geneve" },
  geRegieDuMail: { name: "Régie du Mail", listingsUrl: "http://www.regies.ch/", canton: "geneve" },
  geRegieFlorissante: { name: "Régie Florissante", listingsUrl: "https://regieflorissante.ch/", canton: "geneve" },
  geRegieFonciere: { name: "Régie Foncière SA", listingsUrl: "https://rfgv.ch/", canton: "geneve" },
  geRegisseursDuLeman: { name: "Régisseurs du Léman SA", listingsUrl: "http://regisseursduleman.ch/", canton: "geneve" },
  geRelocationGenevoise: { name: "Relocation Genevoise", listingsUrl: "https://relocation-genevoise.ch/", canton: "geneve" },
  geRenisma: { name: "Renisma Sàrl", listingsUrl: "https://renisma.ch/", canton: "geneve" },
  geRentimo: { name: "Rentimo SA", listingsUrl: "https://www.rentimmogroup.ch/", canton: "geneve" },
  geRetailAdvisorsGeneva: { name: "Retail Advisors Geneva SA", listingsUrl: "https://retailadvisors.ch/", canton: "geneve" },
  geRevacImmobilier: { name: "REVAC IMMOBILIER S.A.", listingsUrl: "https://revacimmo.ch/", canton: "geneve" },
  geRezActifs: { name: "Rez Actifs", listingsUrl: "https://rez-actifs.ch/", canton: "geneve" },
  geRgimmo: { name: "RGIMMO", listingsUrl: "https://rgimmo.ch/", canton: "geneve" },
  geRousseauN5LAgenceImmobiliere: { name: "Rousseau N°5 L\'Agence Immobilière", listingsUrl: "https://rousseau5.ch/", canton: "geneve" },
  geSalmonImmobilier: { name: "Salmon Immobilier Sàrl", listingsUrl: "https://salmon-immobilier.ch/", canton: "geneve" },
  geSchweitzerRealEstate: { name: "SCHWEITZER REAL ESTATE", listingsUrl: "http://www.schweitzer-realestate.ch/", canton: "geneve" },
  geSigwaltImmo: { name: "Sigwalt Immo", listingsUrl: "https://sigwalt-immo.ch/", canton: "geneve" },
  geSilensiaProperties: { name: "Silensia Properties SA", listingsUrl: "https://silensia-properties.ch/", canton: "geneve" },
  geSpgVentesResidentielles: { name: "SPG - Ventes résidentielles", listingsUrl: "https://www.spg.ch/vente/", canton: "geneve" },
  geSpgOneChristieSInternationalRealEstate: { name: "SPG One - Christie\'s International Real Estate", listingsUrl: "https://spgone.ch/", canton: "geneve" },
  geStonePartners: { name: "Stone Partners SA", listingsUrl: "https://stonepartners.ch/", canton: "geneve" },
  geStrategimo: { name: "Strategimo Sàrl", listingsUrl: "https://www.strategimo.ch/", canton: "geneve" },
  geSunnyProperties: { name: "Sunny Properties Sàrl", listingsUrl: "https://www.sunny-properties.ch/", canton: "geneve" },
  geSwissInvestmentAndFinance: { name: "Swiss Investment and Finance SA", listingsUrl: "https://www.swissiaf.com/", canton: "geneve" },
  geSwissPatrimoineImmobilier: { name: "Swiss Patrimoine Immobilier SA", listingsUrl: "https://spi-immo.ch/", canton: "geneve" },
  geSwissPrivateCompany: { name: "SWISS PRIVATE COMPANY SA", listingsUrl: "https://swissprivatecompany.ch/", canton: "geneve" },
  geSwissrealServices: { name: "SwissReal & Services Sàrl", listingsUrl: "https://www.swissrealestategroup.com/about/", canton: "geneve" },
  geA37ChJPhilibertDeSauvage: { name: "37, Ch. J.-Philibert de Sauvage", listingsUrl: "https://armoire-a-vin.ch/en/", canton: "geneve" },
  geTillitInvest: { name: "Tillit Invest Sàrl", listingsUrl: "https://www.tillitinvest.ch/", canton: "geneve" },
  geUnToitPourRever: { name: "Un Toit Pour Rêver", listingsUrl: "http://untoitpourrever.ch/", canton: "geneve" },
  geUni5: { name: "uni5", listingsUrl: "https://uni5.ch/fr", canton: "geneve" },
  geUrbanLodge: { name: "URBAN LODGE SA", listingsUrl: "https://urban-lodge.ch/", canton: "geneve" },
  geVerbelGeneve: { name: "VERBEL GENÈVE", listingsUrl: "https://local.ch/fr/d/geneve/1206/agence-immobiliere/verbel-geneve-eg7IYbx3vhvcfrrusGfBAQ", canton: "geneve" },
  geVisionimmo: { name: "Visionimmo SA", listingsUrl: "https://visionimmo.ch/fr/", canton: "geneve" },
  geVoisinsServices: { name: "Voisins Services SA", listingsUrl: "https://www.voisins.ch/", canton: "geneve" },
  geVpiCourtage: { name: "VPI Courtage SA", listingsUrl: "https://www.vpi-sa.ch/en", canton: "geneve" },
  geWaveArtImmobilier: { name: "Wave Art Immobilier", listingsUrl: "https://www.waveart.ch/", canton: "geneve" },
  geYemaProperties: { name: "YEMA Properties Sàrl", listingsUrl: "https://www.yema-properties.ch/", canton: "geneve" },
  geYneo: { name: "YNEO SA", listingsUrl: "https://yneo.ch/?lang=en", canton: "geneve" },
  geYourGreenHome: { name: "Your Green Home SA", listingsUrl: "https://ygh.ch/", canton: "geneve" },
};

const DEFAULT_CHECKED_AGENCIES = new Set([
  "naef","bernardnicod","frNaef","frFavreNaudeix","frVotreCourtier",
  "geMillenium","geNessell","geStoneInvest","neBarnes","neImmobilierNe",
  "neNaef","vsComptoirImmo","vsHermes","vsTwixy","vsValimmobilier"
]);

function getAgencyCanton(key, agency) {
  if (agency.canton) return agency.canton;
  if (key.startsWith("vs")) return "valais";
  if (key.startsWith("ne") && key !== "neho") return "neuchatel";
  if (key.startsWith("fr")) return "fribourg";
  if (key.startsWith("ge")) return "geneve";
  if (key === "restreinte" || key === "elargie") return "geneve";
  return "vaud";
}

function populateAgencyCheckboxes() {
  const groups = {};
  ["vaud","valais","neuchatel","fribourg","geneve"].forEach(c => groups[c] = []);

  for (const [key, agency] of Object.entries(AGENCIES)) {
    const canton = getAgencyCanton(key, agency);
    if (groups[canton]) groups[canton].push({ key, name: agency.name });
  }

  for (const [canton, agencies] of Object.entries(groups)) {
    agencies.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const container = document.querySelector(`.agency-canton-group[data-canton="${canton}"]`);
    if (!container) continue;
    container.innerHTML = agencies.map(a => {
      const checked = DEFAULT_CHECKED_AGENCIES.has(a.key) ? " checked" : "";
      const escaped = a.name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return `<label class="agency-check"><input type="checkbox" value="${a.key}"${checked}> ${escaped}</label>`;
    }).join("\n");
  }
}

function toggleAllAgencies(checked) {
  // Ne toggler que les agences du canton actif (visibles)
  const activeGroup = document.querySelector(`.agency-canton-group[data-canton="${currentCanton}"]`);
  if (activeGroup) {
    activeGroup.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = checked);
  } else {
    // Fallback
    const checkboxes = document.querySelectorAll("#agencyChecklist input[type=checkbox]");
    checkboxes.forEach(cb => cb.checked = checked);
  }
}

// ── Category Switching ─────────────────────────────────────────────────────

const SCRAPER_DEFAULTS = {
  immobilier: { url: 'https://www.petitesannonces.ch/r/270724', placeholder: 'Collez l\'URL de la rubrique achat (ex: https://www.petitesannonces.ch/r/270724)' },
};

// Per-canton state
const cantonState = {
  vaud: { buyers: [], biens: [], results: [], groups: [], currentGroupIdx: 0 },
  valais: { buyers: [], biens: [], results: [], groups: [], currentGroupIdx: 0 },
  neuchatel: { buyers: [], biens: [], results: [], groups: [], currentGroupIdx: 0 },
  fribourg: { buyers: [], biens: [], results: [], groups: [], currentGroupIdx: 0 },
  geneve: { buyers: [], biens: [], results: [], groups: [], currentGroupIdx: 0 },
};

function getState() { return cantonState[currentCanton]; }

function switchCanton(canton) {
  // Save current state
  cantonState[currentCanton].buyers = matchBuyers;
  cantonState[currentCanton].biens = matchBiens;
  cantonState[currentCanton].results = matchResults;

  currentCanton = canton;
  // Update canton sub-tab highlights
  const suffixMap = { vaud: 'VD', valais: 'VS', neuchatel: 'NE', fribourg: 'FR', geneve: 'GE' };
  document.querySelectorAll('.canton-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById('cantonTab' + suffixMap[canton]);
  if (activeTab) activeTab.classList.add('active');

  const config = getCantonConfig();

  // Restore state for this canton
  matchBuyers = cantonState[canton].buyers;
  matchBiens = cantonState[canton].biens;
  matchResults = cantonState[canton].results;

  // Update label
  const label = document.getElementById("matchCantonLabel");
  if (label) label.textContent = config.label;

  // Update buyer URL
  const buyerUrlEl = document.getElementById("matchBuyersUrl");
  if (buyerUrlEl) buyerUrlEl.value = config.acheteurs_url;

  // Show/hide agency groups
  document.querySelectorAll('.agency-canton-group').forEach(g => {
    g.style.display = g.dataset.canton === canton ? '' : 'none';
  });

  // Update badges
  const buyersBadge = document.getElementById("buyersCountBadge");
  const biensBadge = document.getElementById("biensCountBadge");
  if (buyersBadge) {
    if (matchBuyers.length > 0) {
      buyersBadge.textContent = `${matchBuyers.length} acheteur(s) trouve(s)`;
      buyersBadge.classList.add("visible");
    } else {
      buyersBadge.classList.remove("visible");
    }
  }
  if (biensBadge) {
    if (matchBiens.length > 0) {
      biensBadge.textContent = `${matchBiens.length} bien(s) trouves`;
      biensBadge.classList.add("visible");
    } else {
      biensBadge.classList.remove("visible");
    }
  }

  // Re-display results if they exist, otherwise hide
  const matchResultsDiv = document.getElementById("matchResults");
  const matchNav = document.getElementById("matchNav");
  if (matchResults.length > 0) {
    afficherMatchResultsPaginated();
    if (matchResultsDiv) matchResultsDiv.classList.add("visible");
  } else {
    if (matchResultsDiv) matchResultsDiv.classList.remove("visible");
    if (matchNav) matchNav.style.display = 'none';
  }
}


let buyersCurrentPage = 0;

async function scannerAcheteurs() {
  buyersCurrentPage = 0;
  matchBuyers = [];

  const urlEl = document.getElementById("matchBuyersUrl");
  const input = urlEl ? urlEl.value.trim() : "";
  if (!input) { showMatchError("matchBuyersError", "Veuillez coller l'URL d'une rubrique."); return; }

  let baseUrl;
  try { baseUrl = new URL(input).href; } catch { showMatchError("matchBuyersError", "URL invalide."); return; }

  const btn = document.getElementById("btnScanBuyers");
  const btnNext = document.getElementById("btnNextPageBuyers");
  const loading = document.getElementById("matchBuyersLoading");
  const loadingText = document.getElementById("matchBuyersLoadingText");
  const errBox = document.getElementById("matchBuyersError");

  if (errBox) errBox.classList.remove("visible");
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  if (btnNext) btnNext.style.display = 'none';
  if (loading) loading.classList.add("visible");

  try {
    const maxPages = 20;
    for (let page = 1; page <= maxPages; page++) {
      if (loadingText) loadingText.textContent = `Scan acheteurs page ${page}...`;
      const pageUrl = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;

      const response = await fetch("/api/scrape-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-secret-token": SECRET_TOKEN },
        body: JSON.stringify({ url: pageUrl }),
      });
      if (!response.ok) break;
      const data = await response.json();

      if (data.annonces && data.annonces.length > 0) {
        const filtered = data.annonces.filter(a => !isSellerAd(a) && !isRentalListing(a) && isSwissListing(a));
        matchBuyers.push(...filtered);
      }

      buyersCurrentPage = page;

      const badge = document.getElementById("buyersCountBadge");
      if (badge) {
        badge.textContent = `${matchBuyers.length} acheteur(s) trouvé(s) (page ${page}...)`;
        badge.classList.add("visible");
      }

      if (!data.annonces || data.annonces.length === 0 || data.hasMore === false) break;
      if (page < maxPages) await new Promise(r => setTimeout(r, 2000));
    }

    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }

    const badge = document.getElementById("buyersCountBadge");
    if (badge) {
      badge.textContent = `${matchBuyers.length} acheteur(s) trouvé(s) (${buyersCurrentPage} pages scannées)`;
      badge.classList.add("visible");
    }

    if (matchBuyers.length === 0) {
      showMatchError("matchBuyersError", "Aucun acheteur trouvé.");
    }
  } catch (err) {
    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    showMatchError("matchBuyersError", "Erreur : " + err.message);
  }
}

async function scannerAcheteursPageSuivante() {
  await scannerAcheteursPage(buyersCurrentPage + 1);
}

async function scannerAcheteursPage(page) {
  const urlEl = document.getElementById("matchBuyersUrl");
  const input = urlEl ? urlEl.value.trim() : "";

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
  const btnNext = document.getElementById("btnNextPageBuyers");
  const loading = document.getElementById("matchBuyersLoading");
  const loadingText = document.getElementById("matchBuyersLoadingText");
  const errBox = document.getElementById("matchBuyersError");

  if (errBox) errBox.classList.remove("visible");
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  if (btnNext) { btnNext.disabled = true; btnNext.classList.add("loading"); }
  if (loading) loading.classList.add("visible");

  try {
    if (loadingText) loadingText.textContent = `Scan acheteurs page ${page}...`;
    const pageUrl = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;

    const response = await fetch("/api/scrape-listings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-secret-token": SECRET_TOKEN },
      body: JSON.stringify({ url: pageUrl }),
    });

    if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
    const data = await response.json();

    let newCount = 0;
    if (data.annonces && data.annonces.length > 0) {
      const filtered = data.annonces.filter(a => !isSellerAd(a) && !isRentalListing(a) && isSwissListing(a));
      matchBuyers.push(...filtered);
      newCount = filtered.length;
    }

    buyersCurrentPage = page;

    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    if (btnNext) { btnNext.disabled = false; btnNext.classList.remove("loading"); }

    // Afficher le bouton "Page suivante" s'il y a potentiellement plus de resultats
    const hasMore = data.annonces && data.annonces.length > 0 && data.hasMore !== false;
    if (btnNext) btnNext.style.display = hasMore ? '' : 'none';

    const badge = document.getElementById("buyersCountBadge");
    if (badge) {
      badge.textContent = `${matchBuyers.length} acheteur(s) trouve(s) (page ${buyersCurrentPage})`;
      badge.classList.add("visible");
    }

    if (matchBuyers.length === 0) {
      showMatchError("matchBuyersError", "Aucun acheteur trouve.");
    }

  } catch (err) {
    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    if (btnNext) { btnNext.disabled = false; btnNext.classList.remove("loading"); }
    showMatchError("matchBuyersError", "Erreur : " + err.message);
  }
}

async function importerAcheteurPDF(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;

  const btn = document.getElementById("btnImportPDF");
  const loading = document.getElementById("pdfImportLoading");
  const errorBox = document.getElementById("pdfImportError");
  const badge = document.getElementById("pdfImportBadge");

  if (errorBox) errorBox.style.display = "none";
  if (badge) badge.classList.remove("visible");
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  if (loading) loading.classList.add("visible");

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
      reader.readAsDataURL(file);
    });

    const response = await fetch("/api/parse-buyer-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-secret-token": SECRET_TOKEN },
      body: JSON.stringify({ pdf_base64: base64, filename: file.name }),
    });

    if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
    const data = await response.json();

    if (!data.buyer) throw new Error(data.error || "Impossible d'extraire les criteres du PDF");

    const buyer = data.buyer;
    buyer.source = 'PDF off-market';
    buyer.url = '';
    matchBuyers.push(buyer);

    if (badge) {
      badge.textContent = `Acheteur importe : ${buyer.titre || file.name} — ${matchBuyers.length} acheteur(s) au total`;
      badge.classList.add("visible");
    }

    const mainBadge = document.getElementById("buyersCountBadge");
    if (mainBadge) {
      mainBadge.textContent = `${matchBuyers.length} acheteur(s) au total`;
      mainBadge.classList.add("visible");
    }

  } catch (err) {
    showMatchError("pdfImportError", "Erreur : " + err.message);
  } finally {
    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    fileInput.value = '';
  }
}

function parseAdText(text) {
  // Prix
  let prix = null;
  const prixMatch = text.match(/(?:CHF|Frs\.?|Fr\.?|SFr\.?)\s*([\d''\u2019.,\-]+)/i)
      || text.match(/([\d''\u2019.,\-]+)\s*(?:CHF|Frs\.?|Fr\.?|SFr\.?)/i);
  if (prixMatch) {
    prix = parseInt(prixMatch[1].replace(/[''\u2019.,\s\-]/g, ''), 10) || null;
  }

  // Pieces
  let pieces = null;
  const piecesMatch = text.match(/(\d+(?:[.,]\d)?)\s*(?:pi[eè]ces?|pcs?\.?|rooms?|Zimmer)/i);
  if (piecesMatch) {
    pieces = parseFloat(piecesMatch[1].replace(',', '.'));
  }

  // Surface
  let surface_m2 = null;
  const surfaceMatch = text.match(/(\d+)\s*m[²2]/i);
  if (surfaceMatch) {
    surface_m2 = parseInt(surfaceMatch[1], 10);
  }

  // Localisation (NPA + ville)
  let localisation = null;
  const locMatch = text.match(/\b(\d{4}\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+)?)\b/);
  if (locMatch) {
    localisation = locMatch[1].trim();
  }
  // Fallback: chercher un nom de ville connu dans CITY_NPA_MAP
  if (!localisation && typeof CITY_NPA_MAP !== 'undefined') {
    const textLower = text.toLowerCase();
    for (const [city, npa] of Object.entries(CITY_NPA_MAP)) {
      if (textLower.includes(city)) {
        localisation = npa + ' ' + city.charAt(0).toUpperCase() + city.slice(1);
        break;
      }
    }
  }
  // Fallback: chercher un nom de region/canton
  if (!localisation) {
    const regionPatterns = [
      // Arc lemanique (Lausanne-Montreux-Nyon, rive nord du Leman)
      { pattern: /\barc\s+l[ée]manique\b/i, loc: '1000 Lausanne' },
      { pattern: /\brive\s+nord\b/i, loc: '1000 Lausanne' },
      { pattern: /\blac\s+l[ée]man\b/i, loc: '1000 Lausanne' },
      // Vaud - regions
      { pattern: /\bla\s+c[oô]te\b/i, loc: '1260 Nyon' },
      { pattern: /\bgros[- ]de[- ]vaud\b/i, loc: '1040 Echallens' },
      { pattern: /\bnord\s+vaudois\b/i, loc: '1400 Yverdon' },
      { pattern: /\bbroye\b/i, loc: '1530 Payerne' },
      { pattern: /\blavaux\b/i, loc: '1095 Lutry' },
      { pattern: /\briviera\b/i, loc: '1820 Montreux' },
      { pattern: /\bvaud\b/i, loc: '1000 Lausanne' },
      // Valais
      { pattern: /\bvalais\s+central\b/i, loc: '1950 Sion' },
      { pattern: /\bhaut[- ]valais\b/i, loc: '3900 Brig' },
      { pattern: /\bbas[- ]valais\b/i, loc: '1870 Monthey' },
      { pattern: /\brégion\s+(?:de\s+)?sion\b/i, loc: '1950 Sion' },
      { pattern: /\brégion\s+(?:de\s+)?sierre\b/i, loc: '3960 Sierre' },
      { pattern: /\brégion\s+(?:de\s+)?martigny\b/i, loc: '1920 Martigny' },
      { pattern: /\brégion\s+(?:de\s+)?monthey\b/i, loc: '1870 Monthey' },
      { pattern: /\bchablais\b/i, loc: '1870 Monthey' },
      { pattern: /\bvalais\b/i, loc: '1950 Sion' },
      // Geneve / Fribourg
      { pattern: /\bgen[eè]ve\b/i, loc: '1200 Geneve' },
      { pattern: /\bfribourg\b/i, loc: '1700 Fribourg' },
    ];
    for (const { pattern, loc } of regionPatterns) {
      if (pattern.test(text)) {
        localisation = loc;
        break;
      }
    }
  }

  // Titre (premiere ligne, max 80 car.)
  const firstLine = text.split('\n')[0].trim();
  const titre = firstLine.length > 80 ? firstLine.substring(0, 80) + '...' : firstLine;

  // Type via extractPropertyType existant
  const fakeAnnonce = { titre, description: text, localisation, fullText: text };
  const type = extractPropertyType(fakeAnnonce);

  return { titre, description: text.substring(0, 500), fullText: text, prix, pieces, surface_m2, localisation, type, url: '', source: 'Annonce collee' };
}

function ajouterAnnonceCollee() {
  const textarea = document.getElementById("pasteAdText");
  const text = (textarea ? textarea.value : '').trim();
  if (!text) {
    showMatchError("pasteAdError", "Collez d'abord le texte d'une annonce.");
    return;
  }

  const buyer = parseAdText(text);

  if (!buyer.prix && !buyer.pieces && !buyer.surface_m2 && !buyer.localisation && (!buyer.type || buyer.type === 'unknown')) {
    showMatchError("pasteAdError", "Impossible d'extraire des criteres. Verifiez le texte colle.");
    return;
  }

  matchBuyers.push(buyer);

  // MAJ badges
  const badge = document.getElementById("pasteAdBadge");
  if (badge) {
    const summary = [
      buyer.localisation,
      buyer.prix ? formatPrix(buyer.prix) : null,
      buyer.pieces ? `${buyer.pieces} pcs` : null,
      buyer.surface_m2 ? `${buyer.surface_m2} m²` : null,
    ].filter(Boolean).join(' · ');
    badge.textContent = `Acheteur ajoute : ${summary || buyer.titre} — ${matchBuyers.length} acheteur(s) au total`;
    badge.classList.add("visible");
  }
  const mainBadge = document.getElementById("buyersCountBadge");
  if (mainBadge) {
    mainBadge.textContent = `${matchBuyers.length} acheteur(s) au total`;
    mainBadge.classList.add("visible");
  }

  // Vider le textarea
  if (textarea) textarea.value = '';
  // Masquer l'erreur
  const errBox = document.getElementById("pasteAdError");
  if (errBox) errBox.classList.remove("visible");
}

async function scannerAgences() {
  // Ne prendre que les agences cochees du canton actif
  const activeGroup = document.querySelector(`.agency-canton-group[data-canton="${currentCanton}"]`);
  const checkboxes = activeGroup
    ? activeGroup.querySelectorAll('input[type=checkbox]:checked')
    : document.querySelectorAll("#agencyChecklist input[type=checkbox]:checked");
  const selectedAgencies = [...checkboxes].map(cb => cb.value);
  const scanAnibis = document.getElementById("matchSourceAnibis")?.checked;

  if (selectedAgencies.length === 0 && !scanAnibis) {
    showMatchError("matchBienError", "Selectionnez au moins une source.");
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
  const agencyStatuses = [];
  let scannedCount = 0;

  // Scanner les sources en ligne d'abord
  const onlineSources = [];
  const cantonCfg = getCantonConfig();
  if (scanAnibis && cantonCfg.anibis_url) onlineSources.push({ name: 'anibis.ch', url: cantonCfg.anibis_url });

  for (const source of onlineSources) {
    if (loadingText) loadingText.textContent = `Scan ${source.name}...`;
    try {
      for (let page = 1; page <= 2; page++) {
        const pageUrl = page === 1 ? source.url : `${source.url}${source.url.includes('?') ? '&' : '?'}page=${page}`;
        const response = await fetch("/api/scrape-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-secret-token": SECRET_TOKEN },
          body: JSON.stringify({ url: pageUrl }),
        });
        if (!response.ok) break;
        const data = await response.json();
        if (data.annonces && data.annonces.length > 0) {
          matchBiens.push(...data.annonces);
        }
        if (!data.annonces || data.annonces.length === 0 || !data.hasMore) break;
        await new Promise(r => setTimeout(r, 1500));
      }
      agencyStatuses.push({ name: source.name, status: 'ok', count: matchBiens.filter(b => b.source === source.name.replace('.ch', '.ch')).length, message: null });
    } catch (e) {
      agencyStatuses.push({ name: source.name, status: 'error', count: 0, message: e.message });
    }
  }

  const CONCURRENCY = 5;
  const agencyEntries = selectedAgencies
    .map(key => ({ key, agency: AGENCIES[key] }))
    .filter(e => e.agency);
  const total = agencyEntries.length;

  async function scanOneAgency({ key, agency }) {
    try {
      const response = await fetch("/api/scrape-agency", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-secret-token": SECRET_TOKEN },
        body: JSON.stringify({ url: agency.listingsUrl, agencyName: agency.name }),
      });

      if (response.ok) {
        const data = await response.json();
        const count = data.annonces?.length || 0;
        const annonces = count > 0
          ? data.annonces.map(a => ({ ...a, source: agency.name }))
          : [];
        return {
          name: agency.name,
          status: data.status || (count > 0 ? 'ok' : 'empty'),
          count, message: data.message || null, annonces,
        };
      } else {
        return { name: agency.name, status: 'error', count: 0, message: `HTTP ${response.status}`, annonces: [] };
      }
    } catch (e) {
      return { name: agency.name, status: 'error', count: 0, message: e.message, annonces: [] };
    }
  }

  // Traitement par batches de CONCURRENCY agences en parallèle
  for (let i = 0; i < agencyEntries.length; i += CONCURRENCY) {
    const batch = agencyEntries.slice(i, i + CONCURRENCY);
    const batchNames = batch.map(e => e.agency.name).join(', ');
    if (loadingText) {
      loadingText.textContent = `Scan ${i + 1}-${Math.min(i + CONCURRENCY, total)}/${total} : ${batchNames}...`;
    }

    const results = await Promise.all(batch.map(scanOneAgency));

    for (const r of results) {
      scannedCount++;
      if (r.annonces.length > 0) matchBiens.push(...r.annonces);
      agencyStatuses.push({ name: r.name, status: r.status, count: r.count, message: r.message });
    }

    // Mise à jour progressive des statuts
    afficherAgencyStatuses(agencyStatuses);
  }

  // Filtrer les biens hors Suisse et les annonces de location, puis dedupliquer
  matchBiens = matchBiens.filter(b => isSwissListing(b) && !isRentalListing(b));
  matchBiens = deduplicateBiens(matchBiens);

  if (loading) loading.classList.remove("visible");
  if (btn) { btn.disabled = false; btn.classList.remove("loading"); }

  const badge = document.getElementById("biensCountBadge");
  if (badge) {
    const totalSources = scannedCount + onlineSources.length;
    badge.textContent = `${matchBiens.length} bien(s) trouves sur ${totalSources} source(s)`;
    badge.classList.add("visible");
  }

  afficherAgencyStatuses(agencyStatuses);

  if (matchBiens.length === 0) {
    showMatchError("matchBienError", "Aucun bien extrait. Les sites bloquent peut-etre l'acces automatique.");
  }
}

function afficherAgencyStatuses(statuses) {
  const container = document.getElementById("agencyStatusList");
  if (!container) return;
  container.innerHTML = statuses.map(s => {
    const icon = s.status === 'ok' ? '\u2705' : s.status === 'spa_empty' ? '\u26A0\uFE0F' : s.status === 'empty' ? '\u26AB' : '\u274C';
    const label = s.status === 'ok' ? `${s.count} bien(s)`
      : s.status === 'spa_empty' ? 'Site SPA'
      : s.status === 'empty' ? 'Aucun resultat'
      : `Erreur`;
    const tooltip = s.message ? ` title="${escapeHTML(s.message)}"` : '';
    return `<span class="agency-status-item agency-status-${s.status}"${tooltip}>${icon} ${escapeHTML(s.name)}: ${label}</span>`;
  }).join('');
  container.classList.add("visible");
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
    if (excludedBuyers.has(getBuyerKey(buyer))) continue;
    for (const bien of matchBiens) {
      // Ignorer les auto-matchs (même annonce dans les deux listes)
      if (buyer.url && bien.url && buyer.url === bien.url) continue;

      // Filtres d'exclusion STOP/GO
      const exclusion = checkExclusions(buyer, bien);
      if (!exclusion.compatible) continue;

      // Score de pertinence
      const { score, breakdown } = calculerMatchScore(buyer, bien);
      const minScore = getSearchMode() === 'elargie' ? 30 : 50;
      if (score >= minScore) {
        matchResults.push({ buyer, bien, score, breakdown });
      }
    }
  }

  // Trier par score decroissant
  matchResults.sort((a, b) => b.score - a.score);

  // Sauvegarder dans l'etat du canton
  cantonState[currentCanton].results = matchResults;

  // Grouper et afficher avec navigation
  afficherMatchResultsPaginated();
}

// ── Navigation entre les groupes de matchs ────────────────────────────────
function afficherMatchResultsPaginated() {
  const state = cantonState[currentCanton];

  // Regrouper par BIEN unique (evite de voir les memes biens pour chaque acheteur)
  const grouped = new Map();
  for (const m of matchResults) {
    const urlKey = m.bien.url ? m.bien.url.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() : null;
    const contentKey = [(m.bien.titre || '').toLowerCase().trim(), m.bien.prix || '', (m.bien.localisation || '').toLowerCase().trim()].join('|');
    const key = urlKey || (contentKey !== '||' ? contentKey : JSON.stringify(m.bien));

    if (!grouped.has(key)) {
      grouped.set(key, { bien: m.bien, buyers: [], bestScore: 0, bestBreakdown: null });
    }
    const g = grouped.get(key);
    // Garder le meilleur score parmi tous les acheteurs
    if (m.score > g.bestScore) {
      g.bestScore = m.score;
      g.bestBreakdown = m.breakdown;
    }
    // Ajouter l'acheteur s'il n'est pas deja present
    const buyerKey = m.buyer.url || m.buyer.titre || '';
    if (!g.buyers.some(b => (b.url || b.titre || '') === buyerKey)) {
      g.buyers.push(m.buyer);
    }
  }

  // Trier par meilleur score decroissant
  state.groups = [...grouped.values()].sort((a, b) => b.bestScore - a.bestScore);

  // Compter le total de biens uniques
  const countEl = document.getElementById("matchCount");
  if (countEl) countEl.textContent = state.groups.length;

  const resultsDiv = document.getElementById("matchResults");
  const nav = document.getElementById("matchNav");
  const grid = document.getElementById("matchGrid");

  if (state.groups.length === 0) {
    if (grid) grid.innerHTML = '<div class="history-empty">Aucune correspondance trouvee avec les criteres actuels.</div>';
    if (nav) nav.style.display = 'none';
    if (resultsDiv) resultsDiv.classList.add("visible");
    return;
  }

  // Afficher la navigation
  if (nav) nav.style.display = 'flex';
  state.currentGroupIdx = 0;
  renderCurrentGroup();
  if (resultsDiv) resultsDiv.classList.add("visible");
}

function navigateMatch(delta) {
  const state = cantonState[currentCanton];
  const newIdx = state.currentGroupIdx + delta;
  if (newIdx < 0 || newIdx >= state.groups.length) return;
  state.currentGroupIdx = newIdx;
  renderCurrentGroup();
  // Scroll to results
  const nav = document.getElementById("matchNav");
  if (nav) nav.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCurrentGroup() {
  const state = cantonState[currentCanton];
  const idx = state.currentGroupIdx;
  const total = state.groups.length;
  const group = state.groups[idx];

  // Update nav indicator
  const indicator = document.getElementById("matchNavIndicator");
  if (indicator) indicator.textContent = `${idx + 1} / ${total}`;

  // Update buttons
  const btnPrev = document.getElementById("btnMatchPrev");
  const btnNext = document.getElementById("btnMatchNext");
  if (btnPrev) btnPrev.disabled = idx === 0;
  if (btnNext) btnNext.disabled = idx === total - 1;

  // Render this group (maintenant groupe par bien unique)
  const grid = document.getElementById("matchGrid");
  if (!grid) return;

  const bien = group.bien;
  const score = group.bestScore;
  const b = group.bestBreakdown || {};
  const scoreClass = score >= 70 ? "match-high" : score >= 50 ? "match-medium" : "match-low";
  const scoreLabel = score >= 70 ? "Excellent" : score >= 50 ? "Bon" : "Faible";

  // Liste des acheteurs interesses
  const buyersHtml = group.buyers.map(buyer => `
    <div class="match-buyer-item">
      <div class="match-side-title">${escapeHTML(buyer.titre || '')}</div>
      <div class="match-side-details">
        ${buyer.prix ? formatPrix(buyer.prix) : ''}
        ${buyer.pieces ? ` · ${buyer.pieces} pcs` : ''}
        ${buyer.surface_m2 ? ` · ${buyer.surface_m2} m²` : ''}
      </div>
      <div class="match-side-loc">${escapeHTML(buyer.localisation || '')}</div>
      ${buyer.url ? `<a href="${escapeHTML(buyer.url)}" target="_blank" class="match-link">Voir annonce</a>` : ''}
      <button class="match-exclude-btn" onclick="exclureAcheteur('${escapeHTML(getBuyerKey(buyer))}')">Exclure</button>
    </div>
  `).join('');

  grid.innerHTML = `
  <div class="match-group ${scoreClass}">
    <div class="match-group-header">
      <div class="match-side match-bien-main">
        ${bien.image_url ? `<div class="match-thumb" style="background-image:url('${escapeHTML(bien.image_url)}')"></div>` : ''}
        <div>
          <div class="match-side-title">${escapeHTML(bien.titre || '')}</div>
          <div class="match-side-details">
            ${bien.prix ? formatPrix(bien.prix) : '\u2014'}
            ${bien.pieces ? ` \u00b7 ${bien.pieces} pcs` : ''}
            ${bien.surface_m2 ? ` \u00b7 ${bien.surface_m2} m\u00b2` : ''}
          </div>
          <div class="match-side-loc">${escapeHTML(bien.localisation || '\u2014')}</div>
          ${bien.source ? `<div class="match-side-source">${escapeHTML(bien.source)}</div>` : ''}
        </div>
        <div class="match-score-badge-small ${scoreClass}">
          <span class="match-score-value">${score}/100</span>
          <span class="match-score-label">${scoreLabel}</span>
        </div>
      </div>
    </div>
    <div class="match-breakdown">
      <span class="breakdown-pill ${b.location > 0 ? 'active' : ''}" title="Localisation: ${b.location}/50">Localisation ${b.location}/50</span>
      <span class="breakdown-pill ${b.type > 0 ? 'active' : ''}" title="Type: ${b.type}/20">Type ${b.type}/20</span>
      <span class="breakdown-pill ${b.roomsSurface > 0 ? 'active' : ''}" title="Pieces/Surface: ${b.roomsSurface}/20">Pcs/m\u00b2 ${b.roomsSurface}/20</span>
      <span class="breakdown-pill ${b.price > 0 ? 'active' : ''}" title="Prix: ${b.price}/10">Prix ${b.price}/10</span>
    </div>
    <div class="match-actions">
      <a href="${escapeHTML(bien.url || '#')}" target="_blank" class="match-link">Voir le bien</a>
      <button class="match-exclude-btn" onclick="exclureBien('${escapeHTML(getBienKey(bien))}')">Exclure</button>
    </div>
    ${group.buyers.length > 0 ? `
    <div class="match-group-buyers">
      <div class="match-group-count">${group.buyers.length} acheteur(s) intéressé(s)</div>
      ${buyersHtml}
    </div>` : ''}
  </div>`;
}

// Villes courantes de Suisse romande avec leur NPA principal
const CITY_NPA_MAP = {
  'lausanne': '1000', 'morges': '1110', 'nyon': '1260', 'rolle': '1180',
  'renens': '1020', 'pully': '1009', 'lutry': '1095', 'prilly': '1008',
  'ecublens': '1024', 'chavannes': '1022', 'crissier': '1023',
  'yverdon': '1400', 'payerne': '1530', 'moudon': '1510', 'aigle': '1860',
  'montreux': '1820', 'vevey': '1800', 'la tour-de-peilz': '1814',
  'clarens': '1815', 'villeneuve': '1844',
  'sion': '1950', 'sierre': '3960', 'martigny': '1920', 'monthey': '1870',
  // Geneve
  'geneve': '1200', 'genève': '1200', 'carouge': '1227', 'lancy': '1212',
  'vernier': '1214', 'meyrin': '1217', 'onex': '1213', 'thonex': '1226',
  'versoix': '1290', 'bellevue': '1293', 'pregny': '1292',
  'cologny': '1223', 'vandoeuvres': '1253', 'chene-bourg': '1224',
  // La Cote
  'gland': '1196', 'prangins': '1197', 'coppet': '1296', 'founex': '1297',
  'begnins': '1268', 'aubonne': '1170', 'etoy': '1163', 'allaman': '1165',
  'st-prex': '1162', 'saint-prex': '1162',
  // Vaud autres
  'grandson': '1422', 'orbe': '1350', 'chavornay': '1373',
  'echallens': '1040', 'cossonay': '1148',
  'villars-sur-ollon': '1884', 'bex': '1880', 'ollon': '1867',
  // Fribourg
  'fribourg': '1700', 'bulle': '1630', 'villars-sur-glane': '1752',
  'romont': '1680', 'estavayer': '1470',
  // Neuchatel / Jura / Berne
  'neuchatel': '2000', 'neuchâtel': '2000', 'la chaux-de-fonds': '2300',
  'bienne': '2500', 'biel': '2500', 'delemont': '2800', 'delémont': '2800',
  'bern': '3000', 'berne': '3000', 'thun': '3600', 'thoune': '3600',
  // Valais
  'visp': '3930', 'brig': '3900', 'naters': '3904', 'zermatt': '3920',
  'crans-montana': '3963', 'verbier': '1936', 'saxon': '1907',
  'fully': '1926', 'conthey': '1964', 'savièse': '1965',
  'zurich': '8000', 'zürich': '8000', 'bale': '4000', 'bâle': '4000', 'basel': '4000',
};

function extractNPAFromText(annonce) {
  // D'abord essayer depuis localisation
  const loc = annonce.localisation || '';
  const npaMatch = loc.match(/\b(\d{4})\b/);
  if (npaMatch && !isYearNotNPA(npaMatch[1])) return npaMatch[1];

  // Chercher un NPA (4 chiffres suivi d'un nom de lieu) dans le texte complet
  if (annonce.fullText) {
    const fullNpaMatch = annonce.fullText.match(/\b(\d{4})\s+[A-ZÀ-Ÿ][a-zà-ÿ]/);
    if (fullNpaMatch && !isYearNotNPA(fullNpaMatch[1])) return fullNpaMatch[1];
  }

  // Sinon chercher un nom de ville dans titre + description + fullText + localisation
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '') + ' ' + (annonce.fullText || '') + ' ' + loc).toLowerCase();
  for (const [city, npa] of Object.entries(CITY_NPA_MAP)) {
    if (text.includes(city)) return npa;
  }
  return null;
}

// Exclure les annees courantes qui ne sont pas des NPA
function isYearNotNPA(val) {
  const n = parseInt(val, 10);
  return n >= 2020 && n <= 2035;
}

const excludedBiens = new Set();

function exclureBien(bienKey) {
  excludedBiens.add(bienKey);
  const state = cantonState[currentCanton];
  state.groups = state.groups.filter(g => {
    const key = getBienKey(g.bien);
    return !excludedBiens.has(key);
  });
  if (state.groups.length === 0) {
    document.getElementById("matchGrid").innerHTML = '<div class="history-empty">Aucune correspondance restante.</div>';
    document.getElementById("matchCount").textContent = '0';
    document.getElementById("matchNav").style.display = 'none';
    return;
  }
  if (state.currentGroupIdx >= state.groups.length) state.currentGroupIdx = state.groups.length - 1;
  renderCurrentGroup();
  document.getElementById("matchCount").textContent = state.groups.length;
}

function getBienKey(bien) {
  return (bien.url || bien.titre || '').toLowerCase().trim();
}

const excludedBuyers = new Set();

function getBuyerKey(buyer) {
  return (buyer.url || buyer.titre || '').toLowerCase().trim();
}

function exclureAcheteur(buyerKey) {
  excludedBuyers.add(buyerKey);
  const state = cantonState[currentCanton];
  state.groups.forEach(g => {
    g.buyers = g.buyers.filter(b => !excludedBuyers.has(getBuyerKey(b)));
  });
  state.groups = state.groups.filter(g => g.buyers.length > 0);
  if (state.groups.length === 0) {
    document.getElementById("matchGrid").innerHTML = '<div class="history-empty">Aucune correspondance restante.</div>';
    document.getElementById("matchCount").textContent = '0';
    document.getElementById("matchNav").style.display = 'none';
    return;
  }
  if (state.currentGroupIdx >= state.groups.length) state.currentGroupIdx = state.groups.length - 1;
  renderCurrentGroup();
  document.getElementById("matchCount").textContent = state.groups.length;
}

function exclureAcheteurReverse(buyerKey) {
  excludedBuyers.add(buyerKey);
  reverseResults = reverseResults.filter(r => !excludedBuyers.has(getBuyerKey(r.buyer)));
  afficherResultatsReverse();
}

function calculerMatchScore(buyer, bien, searchMode) {
  const breakdown = { location: 0, type: 0, roomsSurface: 0, price: 0 };
  if (!searchMode) searchMode = getSearchMode();

  // Localisation : +50 pts max (priorite #1)
  const buyerNPA = extractNPAFromText(buyer);
  const bienNPA = extractNPAFromText(bien);
  if (buyerNPA && bienNPA) {
    if (buyerNPA === bienNPA) breakdown.location = 50;
    else {
      const proximity = npaProximityScore(buyerNPA, bienNPA);
      if (proximity >= 0.7) breakdown.location = 35;
      else if (proximity >= 0.3) breakdown.location = searchMode === 'elargie' ? 25 : 15;
    }
  }

  // Type de bien : +20 pts max (priorite #2)
  const buyerType = buyer.type || extractPropertyType(buyer);
  const bienType = bien.type || extractPropertyType(bien);
  if (buyerType !== 'unknown' && bienType !== 'unknown') {
    if (buyerType === bienType) breakdown.type = 20;
    else breakdown.type = 0;
  } else if (buyerType === 'unknown' && bienType === 'unknown') {
    breakdown.type = 10;
  } else {
    breakdown.type = 5;
  }

  // Pieces + Surface : +20 pts max (12 pieces + 8 surface)
  if (buyer.pieces && bien.pieces) {
    const diff = Math.abs(buyer.pieces - bien.pieces);
    if (diff === 0) breakdown.roomsSurface += 12;
    else if (diff <= 0.5) breakdown.roomsSurface += 9;
    else if (diff <= 1) breakdown.roomsSurface += 5;
  }
  if (buyer.surface_m2 && bien.surface_m2) {
    const ratio = Math.abs(buyer.surface_m2 - bien.surface_m2) / buyer.surface_m2;
    if (ratio <= 0.1) breakdown.roomsSurface += 8;
    else if (ratio <= 0.2) breakdown.roomsSurface += 5;
    else if (ratio <= 0.3) breakdown.roomsSurface += 2;
  }

  // Budget : +10 pts max
  if (buyer.prix && bien.prix) {
    if (bien.prix <= buyer.prix) breakdown.price = 10;
    else if (bien.prix <= buyer.prix * 1.15) breakdown.price = 5;
  }

  const score = breakdown.location + breakdown.type + breakdown.roomsSurface + breakdown.price;

  return { score, breakdown };
}

// Old afficherMatchResults removed — replaced by afficherMatchResultsPaginated + renderCurrentGroup

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

function toggleFbPasteArea() {
  const area = document.getElementById("fbPasteArea");
  const btn = document.getElementById("btnFbPasteImport");
  if (area) {
    const show = area.style.display === 'none';
    area.style.display = show ? '' : 'none';
    if (btn) btn.style.display = show ? '' : 'none';
  }
}

async function importerFacebookJSON(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    let annonces = [];
    if (Array.isArray(data)) annonces = data;
    else if (data.annonces) annonces = data.annonces;
    else if (data.results) annonces = data.results;
    else if (data.data) annonces = Array.isArray(data.data) ? data.data : [data.data];

    let count = 0;
    for (const a of annonces) {
      const bien = {
        titre: a.titre || a.title || a.name || a.headline || '',
        prix: parseInt(String(a.prix || a.price || a.amount || '0').replace(/[^\d]/g, ''), 10) || null,
        localisation: a.localisation || a.location || a.city || a.address || null,
        pieces: parseFloat(a.pieces || a.rooms || a.numberOfRooms || 0) || null,
        surface_m2: parseInt(a.surface_m2 || a.surface || a.area || a.livingSpace || 0, 10) || null,
        image_url: a.image_url || a.image || a.photo || a.thumbnail || null,
        url: a.url || a.link || a.href || '',
        type: a.type || 'unknown',
        source: 'Facebook Marketplace',
      };
      if ((bien.titre || bien.prix || bien.localisation) && !isRentalListing(bien)) {
        matchBiens.push(bien);
        count++;
      }
    }
    const badge = document.getElementById("fbImportBadge");
    if (badge) {
      badge.textContent = count + ' bien(s) importes depuis JSON — ' + matchBiens.length + ' bien(s) au total';
      badge.classList.add("visible");
    }
    input.value = '';
  } catch (err) {
    showMatchError("fbImportError", "Erreur JSON : " + err.message);
  }
}

function importerFacebookTexte() {
  const textarea = document.getElementById("fbPasteArea");
  const text = (textarea ? textarea.value : '').trim();
  if (!text) {
    showMatchError("fbImportError", "Collez d'abord le texte d'annonces.");
    return;
  }
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
  let count = 0;
  for (const block of blocks) {
    const parsed = parseAdText(block.trim());
    parsed.source = 'Facebook Marketplace';
    if ((parsed.titre || parsed.prix || parsed.localisation || (parsed.type && parsed.type !== 'unknown')) && !isRentalListing(parsed)) {
      matchBiens.push(parsed);
      count++;
    }
  }
  const badge = document.getElementById("fbImportBadge");
  if (badge) {
    badge.textContent = count + ' bien(s) ajoutes — ' + matchBiens.length + ' bien(s) au total';
    badge.classList.add("visible");
  }
  if (textarea) textarea.value = '';
  const errBox = document.getElementById("fbImportError");
  if (errBox) errBox.classList.remove("visible");
}

// ── Matching Inversé — Trouver Acheteurs ────────────────────────────────────

let reverseBien = null;
let reverseAcheteurs = [];
let reverseResults = [];
let reverseCurrentPage = 0;
let reverseInputMode = 'url';
let reverseCurrentCanton = 'vaud';

function switchReverseInputMode(mode) {
  reverseInputMode = mode;
  const modes = ['url', 'text', 'pdf'];
  const btnMap = { url: 'btnRevModeUrl', text: 'btnRevModeText', pdf: 'btnRevModePdf' };
  const divMap = { url: 'reverseInputUrl', text: 'reverseInputText', pdf: 'reverseInputPdf' };
  for (const m of modes) {
    const btn = document.getElementById(btnMap[m]);
    const div = document.getElementById(divMap[m]);
    if (btn) btn.classList.toggle('active', m === mode);
    if (div) div.style.display = m === mode ? '' : 'none';
  }
}

function switchReverseCanton(canton) {
  reverseCurrentCanton = canton;
  const suffixMap = { vaud: 'VD', valais: 'VS', neuchatel: 'NE', fribourg: 'FR', geneve: 'GE' };
  document.querySelectorAll('#reverseCantonTabs .canton-tab').forEach(t => t.classList.remove('active'));
  const tab = document.getElementById('revCantonTab' + suffixMap[canton]);
  if (tab) tab.classList.add('active');
  const cfg = CANTON_CONFIG[canton];
  const urlEl = document.getElementById('reverseAcheteursUrl');
  if (urlEl && cfg && cfg.acheteurs_url) urlEl.value = cfg.acheteurs_url;
}

async function validerBienReverse() {
  const btn = document.getElementById('btnValiderBien');
  const errBox = document.getElementById('reverseInputError');
  const loading = document.getElementById('reverseInputLoading');
  const badge = document.getElementById('reverseBienBadge');
  if (errBox) errBox.classList.remove('visible');
  if (badge) badge.classList.remove('visible');

  if (reverseInputMode === 'url') {
    const url = (document.getElementById('reverseUrlInput')?.value || '').trim();
    if (!url) { showMatchError('reverseInputError', 'Collez un lien d\'annonce.'); return; }
    try { new URL(url); } catch { showMatchError('reverseInputError', 'URL invalide.'); return; }

    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    if (loading) loading.classList.add('visible');
    try {
      const resp = await fetch('/api/scrape-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-secret-token': SECRET_TOKEN },
        body: JSON.stringify({ url, singleAd: true }),
      });
      if (!resp.ok) throw new Error('Erreur HTTP ' + resp.status);
      const data = await resp.json();
      if (!data.annonces || data.annonces.length === 0) throw new Error('Aucune annonce trouvee a cette URL.');
      reverseBien = data.annonces[0];
      reverseBien.source = 'Lien vendeur';
    } catch (e) {
      showMatchError('reverseInputError', e.message); return;
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
      if (loading) loading.classList.remove('visible');
    }

  } else if (reverseInputMode === 'text') {
    const text = (document.getElementById('reverseTextInput')?.value || '').trim();
    if (!text) { showMatchError('reverseInputError', 'Collez le texte de l\'annonce.'); return; }
    reverseBien = parseAdText(text);
    reverseBien.source = 'Texte colle';
    if (!reverseBien.prix && !reverseBien.pieces && !reverseBien.surface_m2 && !reverseBien.localisation) {
      showMatchError('reverseInputError', 'Aucun critere extrait du texte. Verifiez le contenu.');
      reverseBien = null;
      return;
    }

  } else if (reverseInputMode === 'pdf') {
    // PDF is handled by importerVendeurPDF() which sets reverseBien directly
    if (!reverseBien) {
      showMatchError('reverseInputError', 'Importez d\'abord un PDF.');
      return;
    }
  }

  // Show recap badge
  if (reverseBien && badge) {
    const parts = [];
    if (reverseBien.titre) parts.push(reverseBien.titre);
    if (reverseBien.prix) parts.push(formatPrix(reverseBien.prix));
    if (reverseBien.pieces) parts.push(reverseBien.pieces + ' pcs');
    if (reverseBien.surface_m2) parts.push(reverseBien.surface_m2 + ' m²');
    if (reverseBien.localisation) parts.push(reverseBien.localisation);
    badge.textContent = 'Bien valide : ' + parts.join(' · ');
    badge.classList.add('visible');
  }
}

async function importerVendeurPDF(fileInput) {
  if (!fileInput.files || !fileInput.files[0]) return;
  const file = fileInput.files[0];
  const btn = document.getElementById('btnValiderBien');
  const loading = document.getElementById('reverseInputLoading');
  const loadingText = document.getElementById('reverseInputLoadingText');
  const errBox = document.getElementById('reverseInputError');
  const badge = document.getElementById('reverseBienBadge');

  if (errBox) errBox.classList.remove('visible');
  if (badge) badge.classList.remove('visible');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  if (loading) loading.classList.add('visible');
  if (loadingText) loadingText.textContent = 'Analyse du PDF en cours...';

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const resp = await fetch('/api/parse-seller-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-secret-token': SECRET_TOKEN },
      body: JSON.stringify({ pdf_base64: base64, filename: file.name }),
    });
    if (!resp.ok) throw new Error('Erreur HTTP ' + resp.status);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    if (!data.bien) throw new Error('Aucune donnee extraite du PDF.');

    reverseBien = {
      titre: data.bien.titre || file.name,
      prix: data.bien.prix || null,
      pieces: data.bien.pieces || null,
      surface_m2: data.bien.surface_m2 || null,
      localisation: data.bien.localisation || null,
      type: data.bien.type || 'unknown',
      description: data.bien.description || '',
      url: '',
      source: 'PDF vendeur',
    };

    const parts = [];
    if (reverseBien.titre) parts.push(reverseBien.titre);
    if (reverseBien.prix) parts.push(formatPrix(reverseBien.prix));
    if (reverseBien.pieces) parts.push(reverseBien.pieces + ' pcs');
    if (reverseBien.surface_m2) parts.push(reverseBien.surface_m2 + ' m²');
    if (reverseBien.localisation) parts.push(reverseBien.localisation);
    if (badge) {
      badge.textContent = 'Bien importe : ' + parts.join(' · ');
      badge.classList.add('visible');
    }
  } catch (e) {
    showMatchError('reverseInputError', e.message);
    reverseBien = null;
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    if (loading) loading.classList.remove('visible');
    fileInput.value = '';
  }
}

async function scannerAcheteursReverse() {
  reverseCurrentPage = 0;
  reverseAcheteurs = [];

  const urlEl = document.getElementById('reverseAcheteursUrl');
  const input = urlEl ? urlEl.value.trim() : '';
  if (!input) { showMatchError('reverseAcheteursError', 'Veuillez coller l\'URL d\'une rubrique.'); return; }

  let baseUrl;
  try { baseUrl = new URL(input).href; } catch { showMatchError('reverseAcheteursError', 'URL invalide.'); return; }

  const btn = document.getElementById('btnRevScanBuyers');
  const btnNext = document.getElementById('btnRevNextPage');
  const loading = document.getElementById('reverseAcheteursLoading');
  const loadingText = document.getElementById('reverseAcheteursLoadingText');
  const errBox = document.getElementById('reverseAcheteursError');

  if (errBox) errBox.classList.remove('visible');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  if (btnNext) btnNext.style.display = 'none';
  if (loading) loading.classList.add('visible');

  try {
    const maxPages = 20;
    for (let page = 1; page <= maxPages; page++) {
      if (loadingText) loadingText.textContent = 'Scan acheteurs page ' + page + '...';
      const pageUrl = page === 1 ? baseUrl : baseUrl + '?page=' + page;

      const response = await fetch('/api/scrape-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-secret-token': SECRET_TOKEN },
        body: JSON.stringify({ url: pageUrl }),
      });
      if (!response.ok) break;
      const data = await response.json();

      if (data.annonces && data.annonces.length > 0) {
        const filtered = data.annonces.filter(a => !isSellerAd(a) && !isRentalListing(a) && isSwissListing(a));
        reverseAcheteurs.push(...filtered);
      }

      reverseCurrentPage = page;

      const badge = document.getElementById('reverseAcheteursBadge');
      if (badge) {
        badge.textContent = reverseAcheteurs.length + ' acheteur(s) trouvé(s) (page ' + page + '...)';
        badge.classList.add('visible');
      }

      if (!data.annonces || data.annonces.length === 0 || data.hasMore === false) break;
      if (page < maxPages) await new Promise(r => setTimeout(r, 2000));
    }

    if (loading) loading.classList.remove('visible');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }

    const badge = document.getElementById('reverseAcheteursBadge');
    if (badge) {
      badge.textContent = reverseAcheteurs.length + ' acheteur(s) trouvé(s) (' + reverseCurrentPage + ' pages scannées)';
      badge.classList.add('visible');
    }

    if (reverseAcheteurs.length === 0) {
      showMatchError('reverseAcheteursError', 'Aucun acheteur trouvé.');
    }
  } catch (e) {
    showMatchError('reverseAcheteursError', e.message);
    if (loading) loading.classList.remove('visible');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

async function scannerAcheteursReverseSuivante() {
  await scannerAcheteursReversePage(reverseCurrentPage + 1);
}

async function scannerAcheteursReversePage(page) {
  const urlEl = document.getElementById('reverseAcheteursUrl');
  const input = urlEl ? urlEl.value.trim() : '';
  if (!input) { showMatchError('reverseAcheteursError', 'Veuillez coller l\'URL d\'une rubrique.'); return; }

  let baseUrl;
  try { baseUrl = new URL(input).href; } catch { showMatchError('reverseAcheteursError', 'URL invalide.'); return; }

  const btn = document.getElementById('btnRevScanBuyers');
  const btnNext = document.getElementById('btnRevNextPage');
  const loading = document.getElementById('reverseAcheteursLoading');
  const loadingText = document.getElementById('reverseAcheteursLoadingText');
  const errBox = document.getElementById('reverseAcheteursError');

  if (errBox) errBox.classList.remove('visible');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  if (btnNext) { btnNext.disabled = true; btnNext.classList.add('loading'); }
  if (loading) loading.classList.add('visible');

  try {
    if (loadingText) loadingText.textContent = 'Scan acheteurs page ' + page + '...';
    const pageUrl = page === 1 ? baseUrl : baseUrl + '?page=' + page;

    const response = await fetch('/api/scrape-listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-secret-token': SECRET_TOKEN },
      body: JSON.stringify({ url: pageUrl }),
    });
    if (!response.ok) throw new Error('Erreur HTTP ' + response.status);
    const data = await response.json();

    let newCount = 0;
    if (data.annonces && data.annonces.length > 0) {
      const filtered = data.annonces.filter(a => !isSellerAd(a) && !isRentalListing(a) && isSwissListing(a));
      reverseAcheteurs.push(...filtered);
      newCount = filtered.length;
    }

    reverseCurrentPage = page;

    if (loading) loading.classList.remove('visible');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    if (btnNext) {
      btnNext.disabled = false;
      btnNext.classList.remove('loading');
      btnNext.style.display = (data.hasMore) ? '' : 'none';
    }

    const badge = document.getElementById('reverseAcheteursBadge');
    if (badge) {
      badge.textContent = reverseAcheteurs.length + ' acheteur(s) charges (page ' + page + ', +' + newCount + ' nouveaux)';
      badge.classList.add('visible');
    }
  } catch (e) {
    showMatchError('reverseAcheteursError', e.message);
    if (loading) loading.classList.remove('visible');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    if (btnNext) { btnNext.disabled = false; btnNext.classList.remove('loading'); }
  }
}

function lancerMatchingReverse() {
  if (!reverseBien) {
    showMatchError('reverseInputError', 'Validez d\'abord un bien (etape 1).');
    return;
  }
  if (reverseAcheteurs.length === 0) {
    showMatchError('reverseAcheteursError', 'Scannez d\'abord des acheteurs (etape 2).');
    return;
  }

  const searchMode = document.querySelector('input[name="reverseSearchMode"]:checked')?.value || 'restreinte';
  const minScore = searchMode === 'elargie' ? 30 : 50;
  reverseResults = [];

  for (const buyer of reverseAcheteurs) {
    if (excludedBuyers.has(getBuyerKey(buyer))) continue;
    const exclusion = checkExclusions(buyer, reverseBien, searchMode);
    if (!exclusion.compatible) continue;
    const { score, breakdown } = calculerMatchScore(buyer, reverseBien, searchMode);
    if (score >= minScore) {
      reverseResults.push({ buyer, score, breakdown });
    }
  }

  reverseResults.sort((a, b) => b.score - a.score);
  afficherResultatsReverse();
}

function afficherResultatsReverse() {
  const resultsDiv = document.getElementById('reverseResults');
  if (resultsDiv) resultsDiv.classList.add('visible');

  const countEl = document.getElementById('reverseMatchCount');
  const grid = document.getElementById('reverseMatchGrid');
  const recap = document.getElementById('reverseBienRecap');

  if (countEl) countEl.textContent = reverseResults.length;

  // Recap du bien
  if (recap && reverseBien) {
    const parts = [];
    if (reverseBien.titre) parts.push('<strong>' + escapeHTML(reverseBien.titre) + '</strong>');
    if (reverseBien.prix) parts.push(formatPrix(reverseBien.prix));
    if (reverseBien.pieces) parts.push(reverseBien.pieces + ' pcs');
    if (reverseBien.surface_m2) parts.push(reverseBien.surface_m2 + ' m²');
    if (reverseBien.localisation) parts.push(escapeHTML(reverseBien.localisation));
    recap.innerHTML = '<div class="reverse-recap-label">Bien recherche :</div><div class="reverse-recap-details">' + parts.join(' · ') + '</div>';
    recap.style.display = '';
  }

  if (!grid) return;

  if (reverseResults.length === 0) {
    grid.innerHTML = '<div class="history-empty">Aucun acheteur correspondant trouve.</div>';
    return;
  }

  let html = '';
  for (const r of reverseResults) {
    const b = r.buyer;
    const scoreClass = r.score >= 70 ? 'excellent' : r.score >= 50 ? 'bon' : 'faible';
    const scoreLabel = r.score >= 70 ? 'Excellent' : r.score >= 50 ? 'Bon' : 'Faible';

    html += '<div class="reverse-buyer-card">';
    html += '<div class="reverse-buyer-header">';
    html += '<div class="score-badge ' + scoreClass + '">' + r.score + ' · ' + scoreLabel + '</div>';
    html += '<div class="reverse-buyer-title">' + escapeHTML(b.titre || 'Acheteur') + '</div>';
    html += '</div>';

    // Breakdown pills
    html += '<div class="match-breakdown-pills">';
    html += '<span class="match-pill">Loc ' + r.breakdown.location + '/50</span>';
    html += '<span class="match-pill">Type ' + r.breakdown.type + '/20</span>';
    html += '<span class="match-pill">Pcs/Surf ' + r.breakdown.roomsSurface + '/20</span>';
    html += '<span class="match-pill">Prix ' + r.breakdown.price + '/10</span>';
    html += '</div>';

    // Details
    const details = [];
    if (b.prix) details.push('Budget: ' + formatPrix(b.prix));
    if (b.pieces) details.push(b.pieces + ' pcs');
    if (b.surface_m2) details.push(b.surface_m2 + ' m²');
    if (b.localisation) details.push(escapeHTML(b.localisation));
    if (details.length) {
      html += '<div class="reverse-buyer-details">' + details.join(' · ') + '</div>';
    }

    if (b.description) {
      const desc = b.description.length > 200 ? b.description.substring(0, 200) + '...' : b.description;
      html += '<div class="reverse-buyer-desc">' + escapeHTML(desc) + '</div>';
    }

    if (b.url) {
      html += '<a href="' + escapeHTML(b.url) + '" target="_blank" class="match-link">Voir l\'annonce</a>';
    }
    html += '<button class="match-exclude-btn" onclick="exclureAcheteurReverse(\'' + escapeHTML(getBuyerKey(b)) + '\')">Exclure</button>';

    html += '</div>';
  }
  grid.innerHTML = html;
}

// ── Recensement (Census) ──────────────────────────────────────────────────────
let censusCurrentCanton = "vaud";
let censusAllListings = []; // toutes les annonces scannées
let censusFiltered = [];    // après filtrage
let censusDisplayed = 0;    // combien affichées
const CENSUS_PAGE_SIZE = 60;

function censusSwitchCanton(canton) {
  censusCurrentCanton = canton;
  const suffixMap = { vaud: 'VD', valais: 'VS', neuchatel: 'NE', fribourg: 'FR', geneve: 'GE' };
  document.querySelectorAll('#pageCensus .canton-tab').forEach(t => t.classList.remove('active'));
  const btn = document.getElementById('censusCanton' + suffixMap[canton]);
  if (btn) btn.classList.add('active');
  // Reset quand on change de canton
  censusAllListings = [];
  censusFiltered = [];
  censusDisplayed = 0;
  const grid = document.getElementById('censusGrid');
  if (grid) grid.innerHTML = '';
  const stats = document.getElementById('censusStats');
  if (stats) stats.textContent = '';
  const results = document.getElementById('censusResults');
  if (results) results.classList.remove('visible');
  const statuses = document.getElementById('censusAgencyStatuses');
  if (statuses) { statuses.innerHTML = ''; statuses.classList.remove('visible'); }
}

async function censusLancerScan() {
  const btn = document.getElementById('btnCensusScan');
  const loading = document.getElementById('censusLoading');
  const loadingText = document.getElementById('censusLoadingText');
  const errBox = document.getElementById('censusError');

  if (errBox) errBox.classList.remove('visible');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  if (loading) loading.classList.add('visible');

  censusAllListings = [];
  const agencyStatuses = [];

  // Récupérer toutes les agences du canton sélectionné
  const entries = [];
  for (const [key, agency] of Object.entries(AGENCIES)) {
    const canton = getAgencyCanton(key, agency);
    if (canton === censusCurrentCanton) {
      entries.push({ key, agency });
    }
  }

  const CONCURRENCY = 5;
  let scannedCount = 0;
  const total = entries.length;

  async function scanOne({ key, agency }) {
    try {
      const response = await fetch("/api/scrape-agency", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-secret-token": SECRET_TOKEN },
        body: JSON.stringify({ url: agency.listingsUrl, agencyName: agency.name }),
      });
      if (response.ok) {
        const data = await response.json();
        const count = data.annonces?.length || 0;
        const annonces = count > 0 ? data.annonces.map(a => ({ ...a, source: agency.name })) : [];
        return { name: agency.name, status: data.status || (count > 0 ? 'ok' : 'empty'), count, message: data.message || null, annonces };
      } else {
        return { name: agency.name, status: 'error', count: 0, message: `HTTP ${response.status}`, annonces: [] };
      }
    } catch (e) {
      return { name: agency.name, status: 'error', count: 0, message: e.message, annonces: [] };
    }
  }

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    if (loadingText) {
      loadingText.textContent = `Scan ${i + 1}-${Math.min(i + CONCURRENCY, total)}/${total} agences...`;
    }
    const results = await Promise.all(batch.map(scanOne));
    for (const r of results) {
      scannedCount++;
      if (r.annonces.length > 0) censusAllListings.push(...r.annonces);
      agencyStatuses.push({ name: r.name, status: r.status, count: r.count, message: r.message });
    }
    // Mise à jour progressive
    censusUpdateStats(scannedCount, total, agencyStatuses);
    afficherCensusAgencyStatuses(agencyStatuses);
  }

  // Filtrer location/doublons
  censusAllListings = censusAllListings.filter(b => isSwissListing(b) && !isRentalListing(b));
  censusAllListings = deduplicateBiens(censusAllListings);

  if (loading) loading.classList.remove('visible');
  if (btn) { btn.disabled = false; btn.classList.remove('loading'); }

  censusUpdateStats(scannedCount, total, agencyStatuses);
  censusPopulateRegions();
  censusApplyFilters();

  if (censusAllListings.length === 0) {
    if (errBox) { errBox.textContent = 'Aucune annonce trouvee.'; errBox.classList.add('visible'); }
  }
}

function censusUpdateStats(scanned, total, statuses) {
  const stats = document.getElementById('censusStats');
  if (!stats) return;
  const ok = statuses.filter(s => s.status === 'ok').length;
  const totalListings = statuses.reduce((sum, s) => sum + s.count, 0);
  stats.textContent = `${scanned}/${total} agences scannees · ${ok} avec resultats · ${totalListings} annonces`;
}

function afficherCensusAgencyStatuses(statuses) {
  const container = document.getElementById('censusAgencyStatuses');
  if (!container) return;
  container.innerHTML = statuses.map(s => {
    const icon = s.status === 'ok' ? '\u2705' : s.status === 'empty' ? '\u26AB' : '\u274C';
    const label = s.status === 'ok' ? `${s.count} bien(s)` : s.status === 'empty' ? 'Aucun' : 'Erreur';
    const tooltip = s.message ? ` title="${escapeHTML(s.message)}"` : '';
    return `<span class="agency-status-item agency-status-${s.status}"${tooltip}>${icon} ${escapeHTML(s.name)}: ${label}</span>`;
  }).join('');
  container.classList.add('visible');
}

function getCensusSearchMode() {
  return document.querySelector('input[name="censusSearchMode"]:checked')?.value || 'restreinte';
}

// Extraire le NPA depuis "1200 Lausanne" → "1200"
function extractNPA(localisation) {
  const m = (localisation || '').match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

// Peupler le dropdown de régions à partir des annonces scannées
function censusPopulateRegions() {
  const select = document.getElementById('censusFilterRegion');
  if (!select) return;
  const regions = new Map(); // code -> { name, count }
  censusAllListings.forEach(a => {
    const npa = extractNPA(a.localisation);
    if (!npa) return;
    const code = getNPARegion(npa);
    if (!code) return;
    const name = NPA_REGIONS[code] || code;
    if (!regions.has(code)) regions.set(code, { name, count: 0 });
    regions.get(code).count++;
  });
  // Trier par count décroissant
  const sorted = [...regions.entries()].sort((a, b) => b[1].count - a[1].count);
  select.innerHTML = '<option value="">Toutes les regions</option>' +
    sorted.map(([code, { name, count }]) =>
      `<option value="${code}">${name} (${count})</option>`
    ).join('');
}

function censusApplyFilters() {
  const mode = getCensusSearchMode();
  const locationVal = (document.getElementById('censusFilterLocation')?.value || '').toLowerCase().trim();
  const regionVal = document.getElementById('censusFilterRegion')?.value || '';
  const typeVal = document.getElementById('censusFilterType')?.value || '';
  const priceVal = document.getElementById('censusFilterPrice')?.value || '';

  censusFiltered = censusAllListings.filter(a => {
    const npa = extractNPA(a.localisation);
    const region = npa ? getNPARegion(npa) : null;

    // ── Filtre lieu (texte libre) ──
    if (locationVal) {
      const loc = (a.localisation || '').toLowerCase();
      const src = (a.source || '').toLowerCase();
      if (mode === 'restreinte') {
        // Strict : le texte doit correspondre exactement
        if (!loc.includes(locationVal) && !src.includes(locationVal)) return false;
      } else {
        // Élargie : inclure aussi les NPA voisins
        const searchNPA = locationVal.match(/^\d{4}$/)?.[0];
        if (searchNPA) {
          const proximity = npa ? npaProximityScore(searchNPA, npa) : 0;
          if (proximity === 0) return false;
        } else {
          if (!loc.includes(locationVal) && !src.includes(locationVal)) return false;
        }
      }
    }

    // ── Filtre région ──
    if (regionVal) {
      if (mode === 'restreinte') {
        if (region !== regionVal) return false;
      } else {
        // Élargie : inclure les régions adjacentes
        if (region !== regionVal) {
          const adj = ADJACENT_REGIONS[regionVal];
          if (!adj || !adj.includes(region)) return false;
        }
      }
    }

    // ── Filtre type ──
    if (typeVal) {
      if (mode === 'restreinte') {
        // Strict : le type doit correspondre exactement
        if (!a.type || a.type !== typeVal) return false;
      } else {
        // Élargie : accepter les types inconnus
        if (a.type && a.type !== 'unknown' && a.type !== typeVal) return false;
      }
    }

    // ── Filtre prix ──
    if (priceVal) {
      const [min, max] = priceVal.split('-').map(Number);
      if (mode === 'restreinte') {
        if (!a.prix) return false; // pas de prix = exclu en restreinte
        if (min && a.prix < min) return false;
        if (max && a.prix > max) return false;
      } else {
        // Élargie : accepter les biens sans prix, tolérance ±15%
        if (a.prix) {
          if (min && a.prix < min * 0.85) return false;
          if (max && a.prix > max * 1.15) return false;
        }
        // Sans prix → on garde
      }
    }

    return true;
  });

  // Trier par prix décroissant
  censusFiltered.sort((a, b) => (b.prix || 0) - (a.prix || 0));

  censusDisplayed = 0;
  const grid = document.getElementById('censusGrid');
  if (grid) grid.innerHTML = '';
  censusShowMore();

  // Compteur de résultats avec top villes et régions
  const stats = document.getElementById('censusStats');
  if (stats && censusAllListings.length > 0) {
    const locCounts = {};
    censusFiltered.forEach(a => {
      const loc = a.localisation || 'Inconnu';
      const city = loc.replace(/^\d{4}\s*/, '') || 'Inconnu';
      locCounts[city] = (locCounts[city] || 0) + 1;
    });
    const topCities = Object.entries(locCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c} (${n})`).join(', ');
    stats.textContent = `${censusFiltered.length}/${censusAllListings.length} annonces [${mode}] · ${topCities}`;
  }
}

function censusShowMore() {
  const grid = document.getElementById('censusGrid');
  const loadMoreBtn = document.getElementById('censusLoadMore');
  if (!grid) return;

  const slice = censusFiltered.slice(censusDisplayed, censusDisplayed + CENSUS_PAGE_SIZE);
  censusDisplayed += slice.length;

  grid.innerHTML += slice.map(a => `
    <div class="scraper-card" ${a.url ? `onclick="window.open('${escapeHTML(a.url)}','_blank')"` : ''}>
      ${a.image_url ? `<div class="scraper-card-img" style="background-image:url('${escapeHTML(a.image_url)}')"></div>` : '<div class="scraper-card-img scraper-card-noimg">Pas de photo</div>'}
      <div class="scraper-card-body">
        <div class="scraper-card-price">${a.prix ? formatPrix(a.prix) : 'Prix sur demande'}</div>
        <div class="scraper-card-details">
          ${a.pieces ? `<span>${a.pieces} pcs</span>` : ''}
          ${a.surface_m2 ? `<span>${a.surface_m2} m\u00B2</span>` : ''}
          ${a.type ? `<span class="census-type-badge">${escapeHTML(a.type)}</span>` : ''}
        </div>
        <div class="scraper-card-location">${escapeHTML(a.localisation || 'Localisation inconnue')}</div>
        <div class="scraper-card-title">${escapeHTML(a.titre || '')}</div>
        <div class="scraper-card-source">${escapeHTML(a.source || '')}</div>
      </div>
    </div>
  `).join('');

  const results = document.getElementById('censusResults');
  if (results) results.classList.add('visible');

  if (loadMoreBtn) {
    loadMoreBtn.style.display = censusDisplayed < censusFiltered.length ? '' : 'none';
  }
}

window.onload = () => { populateAgencyCheckboxes(); loadHistory(); };
