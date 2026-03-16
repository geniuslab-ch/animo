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

function checkExclusions(buyer, bien) {
  const searchMode = getSearchMode();
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
  const tabs = ["analyse", "agences", "scraper", "matchingVD", "matchingVS", "historique"];
  const pageIds = { analyse: "pageAnalyse", agences: "pageAgences", scraper: "pageScraper", matchingVD: "pageMatchingVD", matchingVS: "pageMatchingVD", historique: "pageHistorique" };
  const tabIds = { analyse: "tabAnalyse", agences: "tabAgences", scraper: "tabScraper", matchingVD: "tabMatchingVD", matchingVS: "tabMatchingVS", historique: "tabHistorique" };
  for (const t of tabs) {
    const page = document.getElementById(pageIds[t]);
    const btn = document.getElementById(tabIds[t]);
    // matchingVD and matchingVS share the same page — show it for either
    if (page) page.classList.toggle("active", pageIds[t] === pageIds[tab]);
    if (btn) btn.classList.toggle("active", t === tab);
  }
  if (tab === "historique") loadHistory();
  // Canton switching
  if (tab === "matchingVD") switchCanton('vaud');
  if (tab === "matchingVS") switchCanton('valais');
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
  const rentalPatterns = /\b(à louer|a louer|location|louer|en location|bail|sous-location|sous location|mois de loyer|loyer mensuel|loyer|charges comprises|charges en sus|dès le|disponible dès|à remettre)\b/;
  const salePatterns = /\b(à vendre|a vendre|vente|acheter|achat|prix de vente|offre d'achat)\b/;
  // Si patterns de location détectés et aucun pattern de vente => c'est une location
  if (rentalPatterns.test(text) && !salePatterns.test(text)) return true;
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
};

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
};

function getState() { return cantonState[currentCanton]; }

function switchCanton(canton) {
  // Save current state
  cantonState[currentCanton].buyers = matchBuyers;
  cantonState[currentCanton].biens = matchBiens;
  cantonState[currentCanton].results = matchResults;

  currentCanton = canton;
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
  await scannerAcheteursPage(1);
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
        const count = data.annonces?.length || 0;
        if (count > 0) {
          matchBiens.push(...data.annonces.map(a => ({ ...a, source: agency.name })));
        }
        agencyStatuses.push({
          name: agency.name,
          status: data.status || (count > 0 ? 'ok' : 'empty'),
          count,
          message: data.message || null,
        });
      } else {
        agencyStatuses.push({ name: agency.name, status: 'error', count: 0, message: `HTTP ${response.status}` });
      }
    } catch (e) {
      agencyStatuses.push({ name: agency.name, status: 'error', count: 0, message: e.message });
    }

    // Pause entre les agences
    if (scannedCount < selectedAgencies.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
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

function calculerMatchScore(buyer, bien) {
  const breakdown = { location: 0, type: 0, roomsSurface: 0, price: 0 };
  const searchMode = getSearchMode();

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

window.onload = () => loadHistory();
