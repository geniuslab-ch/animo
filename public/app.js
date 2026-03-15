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
  const r1 = getNPARegion(npa1);
  const r2 = getNPARegion(npa2);
  if (!r1 || !r2) return 0;
  if (r1 === r2) return 0.7;
  const adj = ADJACENT_REGIONS[r1];
  if (adj && adj.includes(r2)) return 0.3;
  return 0;
}

function extractPropertyType(annonce) {
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '') + ' ' + (annonce.localisation || '')).toLowerCase();
  if (/maison|villa|chalet/.test(text)) return 'house';
  if (/appartement|appart\b|apt\.?/.test(text)) return 'apartment';
  if (/terrain|parcelle/.test(text)) return 'land';
  if (/commercial|bureau|local\b/.test(text)) return 'commercial';
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

function checkExclusions(buyer, bien) {
  // Filtre 1 : Localisation hors zone
  const buyerNPA = extractNPAFromText(buyer);
  const bienNPA = extractNPAFromText(bien);

  // Si les deux NPA sont identifiés, vérifier la proximité
  // Si l'un des deux manque (lieu dans le descriptif sans NPA), on laisse passer
  if (buyerNPA && bienNPA) {
    const proximity = npaProximityScore(buyerNPA, bienNPA);
    if (proximity === 0) {
      return { compatible: false, reason: 'Localisation hors zone de recherche' };
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

// ── Filtres de qualite ───────────────────────────────────────────────────────
function isSellerAd(annonce) {
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '')).toLowerCase();
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

// ── Matching Acheteur / Bien ─────────────────────────────────────────────────
let matchBuyers = [];
let matchBiens = [];
let matchResults = [];

// URLs sources en ligne pour le matching immobilier
const PA_ACHETEURS_URL = 'https://www.petitesannonces.ch/r/2707';
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
};

function toggleAllAgencies(checked) {
  const checkboxes = document.querySelectorAll("#agencyChecklist input[type=checkbox]");
  checkboxes.forEach(cb => cb.checked = checked);
}

// ── Category Switching ─────────────────────────────────────────────────────

const SCRAPER_DEFAULTS = {
  immobilier: { url: 'https://www.petitesannonces.ch/r/2707', placeholder: 'Collez l\'URL de la rubrique (ex: https://www.petitesannonces.ch/r/2707)' },
};


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

    // Filtrer les vendeurs et les annonces hors Suisse
    const beforeFilter = matchBuyers.length;
    matchBuyers = matchBuyers.filter(a => !isSellerAd(a) && isSwissListing(a));
    const filtered = beforeFilter - matchBuyers.length;

    if (loading) loading.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }

    const badge = document.getElementById("buyersCountBadge");
    if (badge) {
      badge.textContent = `${matchBuyers.length} acheteur(s) trouve(s)` + (filtered > 0 ? ` (${filtered} exclus)` : '');
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

async function scannerAgences() {
  const checkboxes = document.querySelectorAll("#agencyChecklist input[type=checkbox]:checked");
  const selectedAgencies = [...checkboxes].map(cb => cb.value);
  const scanPA = document.getElementById("matchSourcePA")?.checked;
  const scanAnibis = document.getElementById("matchSourceAnibis")?.checked;

  if (selectedAgencies.length === 0 && !scanPA && !scanAnibis) {
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
  if (scanPA) onlineSources.push({ name: 'petitesannonces.ch', url: PA_ACHETEURS_URL });
  if (scanAnibis) onlineSources.push({ name: 'anibis.ch', url: ANIBIS_IMMOBILIER_URL });

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

  // Filtrer les biens hors Suisse
  matchBiens = matchBiens.filter(b => isSwissListing(b));

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
  const incompatibles = [];

  for (const buyer of matchBuyers) {
    for (const bien of matchBiens) {
      // Etape 2 : Filtres d'exclusion STOP/GO
      const exclusion = checkExclusions(buyer, bien);
      if (!exclusion.compatible) {
        incompatibles.push({ buyer, bien, score: 0, breakdown: null, reason: exclusion.reason });
        continue;
      }

      // Etape 3 : Score de pertinence
      const { score, breakdown } = calculerMatchScore(buyer, bien);
      if (score >= 70) {
        matchResults.push({ buyer, bien, score, breakdown });
      }
    }
  }

  // Trier par score decroissant
  matchResults.sort((a, b) => b.score - a.score);

  afficherMatchResults(matchResults, incompatibles);
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
  'geneve': '1200', 'gen\u00e8ve': '1200', 'carouge': '1227', 'lancy': '1212',
  'vernier': '1214', 'meyrin': '1217', 'onex': '1213', 'thonex': '1226',
  'fribourg': '1700', 'bulle': '1630', 'villars-sur-glane': '1752',
  'neuchatel': '2000', 'neuch\u00e2tel': '2000', 'la chaux-de-fonds': '2300',
  'bienne': '2500', 'biel': '2500', 'delemont': '2800', 'del\u00e9mont': '2800',
  'bern': '3000', 'berne': '3000', 'thun': '3600', 'thoune': '3600',
  'zurich': '8000', 'z\u00fcrich': '8000', 'bale': '4000', 'b\u00e2le': '4000', 'basel': '4000',
};

function extractNPAFromText(annonce) {
  // D'abord essayer depuis localisation
  const loc = annonce.localisation || '';
  const npaMatch = loc.match(/\d{4}/);
  if (npaMatch) return npaMatch[0];

  // Sinon chercher un nom de ville dans titre + description + localisation
  const text = ((annonce.titre || '') + ' ' + (annonce.description || '') + ' ' + loc).toLowerCase();
  for (const [city, npa] of Object.entries(CITY_NPA_MAP)) {
    if (text.includes(city)) return npa;
  }
  return null;
}

function calculerMatchScore(buyer, bien) {
  const breakdown = { location: 0, type: 0, roomsSurface: 0, price: 0 };

  // Localisation : +50 pts max (priorite #1)
  const buyerNPA = extractNPAFromText(buyer);
  const bienNPA = extractNPAFromText(bien);
  if (buyerNPA && bienNPA) {
    if (buyerNPA === bienNPA) breakdown.location = 50;
    else {
      const proximity = npaProximityScore(buyerNPA, bienNPA);
      if (proximity >= 0.7) breakdown.location = 35;
      else if (proximity >= 0.3) breakdown.location = 15;
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

function afficherMatchResults(results, incompatibles) {
  const resultsDiv = document.getElementById("matchResults");
  const grid = document.getElementById("matchGrid");
  const countEl = document.getElementById("matchCount");

  if (countEl) countEl.textContent = results.length;

  if (results.length === 0 && (!incompatibles || incompatibles.length === 0)) {
    grid.innerHTML = '<div class="history-empty">Aucune correspondance trouvee avec les criteres actuels.</div>';
    if (resultsDiv) resultsDiv.classList.add("visible");
    return;
  }

  // Regrouper par acheteur (par URL unique)
  const grouped = new Map();
  for (const m of results) {
    const key = m.buyer.url || m.buyer.titre || JSON.stringify(m.buyer);
    if (!grouped.has(key)) {
      grouped.set(key, { buyer: m.buyer, biens: [] });
    }
    grouped.get(key).biens.push({ bien: m.bien, score: m.score, breakdown: m.breakdown });
  }

  // Trier les groupes par meilleur score
  const groups = [...grouped.values()].sort((a, b) => {
    const bestA = Math.max(...a.biens.map(x => x.score));
    const bestB = Math.max(...b.biens.map(x => x.score));
    return bestB - bestA;
  });

  let html = groups.map(group => {
    const buyer = group.buyer;
    // Trier les biens par score decroissant
    group.biens.sort((a, b) => b.score - a.score);
    const bestScore = group.biens[0].score;
    const groupClass = bestScore >= 70 ? "match-high" : bestScore >= 40 ? "match-medium" : "match-low";

    const biensHtml = group.biens.map(({ bien, score, breakdown }) => {
      const scoreClass = score >= 70 ? "match-high" : score >= 40 ? "match-medium" : "match-low";
      const scoreLabel = score >= 70 ? "Excellent" : score >= 40 ? "Bon" : "Faible";
      const b = breakdown || {};
      return `
      <div class="match-bien-item ${scoreClass}">
        <div class="match-bien-row">
          ${bien.image_url ? `<div class="match-thumb" style="background-image:url('${escapeHTML(bien.image_url)}')"></div>` : ''}
          <div class="match-bien-info">
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
        <div class="match-breakdown">
          <span class="breakdown-pill ${b.location > 0 ? 'active' : ''}" title="Localisation: ${b.location}/50">Lieu ${b.location}/50</span>
          <span class="breakdown-pill ${b.type > 0 ? 'active' : ''}" title="Type: ${b.type}/20">Type ${b.type}/20</span>
          <span class="breakdown-pill ${b.roomsSurface > 0 ? 'active' : ''}" title="Pieces/Surface: ${b.roomsSurface}/20">Pcs/m\u00b2 ${b.roomsSurface}/20</span>
          <span class="breakdown-pill ${b.price > 0 ? 'active' : ''}" title="Prix: ${b.price}/10">Prix ${b.price}/10</span>
        </div>
        <div class="match-actions">
          <a href="${escapeHTML(bien.url || '#')}" target="_blank" class="match-link">Voir bien</a>
        </div>
      </div>`;
    }).join("");

    return `
    <div class="match-group ${groupClass}">
      <div class="match-group-header">
        <div class="match-side match-buyer">
          <div class="match-side-label">Acheteur recherche</div>
          <div class="match-side-price">${buyer.prix ? formatPrix(buyer.prix) : '\u2014'}</div>
          <div class="match-side-details">
            ${buyer.pieces ? `${buyer.pieces} pcs` : ''}
            ${buyer.surface_m2 ? ` \u00b7 ${buyer.surface_m2} m\u00b2` : ''}
          </div>
          <div class="match-side-loc">${escapeHTML(buyer.localisation || '\u2014')}</div>
          <div class="match-side-title">${escapeHTML(buyer.titre || '')}</div>
          <a href="${escapeHTML(buyer.url || '#')}" target="_blank" class="match-link">Voir annonce</a>
        </div>
        <div class="match-group-count">${group.biens.length} bien(s) correspondant(s)</div>
      </div>
      <div class="match-group-biens">
        ${biensHtml}
      </div>
    </div>`;
  }).join("");

  // Afficher les incompatibles en grise
  if (incompatibles && incompatibles.length > 0) {
    html += `<div class="match-incompatible-header">INCOMPATIBLES (${incompatibles.length} exclus)</div>`;
    html += incompatibles.slice(0, 10).map(m => `
    <div class="match-card match-incompatible">
      <div class="match-score-badge">STOP</div>
      <div class="match-pair">
        <div class="match-side match-buyer">
          <div class="match-side-label">Acheteur</div>
          <div class="match-side-price">${m.buyer.prix ? formatPrix(m.buyer.prix) : '\u2014'}</div>
          <div class="match-side-loc">${escapeHTML(m.buyer.localisation || '\u2014')}</div>
        </div>
        <div class="match-arrow">&#10007;</div>
        <div class="match-side match-bien">
          <div class="match-side-label">Bien</div>
          <div class="match-side-price">${m.bien.prix ? formatPrix(m.bien.prix) : '\u2014'}</div>
          <div class="match-side-loc">${escapeHTML(m.bien.localisation || '\u2014')}</div>
        </div>
      </div>
      <div class="match-exclusion-reason">${escapeHTML(m.reason)}</div>
    </div>`).join("");
  }

  grid.innerHTML = html;
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
