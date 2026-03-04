// ── Config ──────────────────────────────────────────────────────────────────
// La clé API est protégée côté Worker Cloudflare — ne jamais l'écrire ici.
const WORKER_URL = "/api/analyze";
const SECRET_TOKEN = "animo*2026";

// ── Analyse principale ───────────────────────────────────────────────────────
async function analyser() {
  const input = document.getElementById("annonce").value.trim();

  if (!input) {
    afficherErreur("Veuillez coller le lien d'une annonce Anibis avant de lancer l'analyse.");
    return;
  }

  // Validation basique de l'URL
  let listingUrl;
  try {
    listingUrl = new URL(input).href;
  } catch {
    afficherErreur("Le texte saisi ne ressemble pas à une URL valide. Collez le lien complet de l'annonce (ex: https://www.anibis.ch/...)");
    return;
  }

  const btn = document.getElementById("btnAnalyse");
  const errorBox = document.getElementById("errorBox");
  const loading = document.getElementById("loadingState");
  const results = document.getElementById("results");
  const divider = document.getElementById("divider");

  // Reset UI
  errorBox.classList.remove("visible");
  results.classList.remove("visible");
  btn.disabled = true;
  btn.classList.add("loading");

  setTimeout(() => {
    loading.classList.add("visible");
    divider.classList.add("visible");
  }, 200);

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
    const raw = data.content.map(b => b.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    afficherResultats(parsed);

  } catch (err) {
    loading.classList.remove("visible");
    divider.classList.remove("visible");
    afficherErreur("Erreur lors de l'analyse : " + err.message);
  }

  btn.disabled = false;
  btn.classList.remove("loading");
}

// ── Affichage des résultats ──────────────────────────────────────────────────
function afficherResultats(parsed) {
  const loading = document.getElementById("loadingState");
  const results = document.getElementById("results");
  const grid = document.getElementById("diagGrid");

  grid.innerHTML = "";
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

  document.getElementById("messageBody").textContent = parsed.message;

  loading.classList.remove("visible");
  results.classList.add("visible");
}

// ── Copier le message ────────────────────────────────────────────────────────
function copierMessage() {
  const msg = document.getElementById("messageBody").textContent;
  navigator.clipboard.writeText(msg).then(() => {
    const btn = document.querySelector(".copy-btn");
    btn.textContent = "Copié ✓";
    setTimeout(() => (btn.textContent = "Copier"), 2000);
  });
}

// ── Utilitaires ─────────────────────────────────────────────────────────────
function afficherErreur(msg) {
  const box = document.getElementById("errorBox");
  box.textContent = msg;
  box.classList.add("visible");
}

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
