// ── Config ──────────────────────────────────────────────────────────────────
// Remplacez cette valeur par votre clé API Anthropic.
// Ne commitez JAMAIS votre clé réelle ici : utilisez une variable d'environnement
// ou un backend proxy en production.
const API_KEY = "VOTRE_CLE_API_ICI";

// ── Prompt système ───────────────────────────────────────────────────────────
function buildPrompt(texte) {
  return `Tu es un expert en négociation et vente sur le marché Anibis, spécialiste du Canton de Vaud (Suisse).

Analyse cette annonce immobilière et réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks.

Format exact attendu:
{
  "diagnostic": [
    {"titre": "TITRE COURT", "texte": "Explication précise du frein à la vente (2-3 phrases)"},
    {"titre": "TITRE COURT", "texte": "Explication précise du frein à la vente (2-3 phrases)"},
    {"titre": "TITRE COURT", "texte": "Explication précise du frein à la vente (2-3 phrases)"}
  ],
  "message": "Message complet en français formel avec vouvoiement, prêt à envoyer au vendeur. Poli, constructif, demande les informations manquantes ou propose un contact."
}

Critères d'analyse pour le marché vaudois:
- Prix: cohérence avec le marché immobilier vaudois (PPE, Vaud) — si le prix n'est pas mentionné, signaler cette absence
- Précision technique: CECB, année de construction, charges PPE, état de la toiture, diagnostics techniques, règlement de PPE
- Psychologie: ton adapté à l'acheteur suisse romand (confiance, sérieux, précision)
- Qualité visuelle: nombre et qualité des photos mentionnées
- Informations manquantes clés pour le marché suisse

Annonce à analyser:
${texte}`;
}

// ── Analyse principale ───────────────────────────────────────────────────────
async function analyser() {
  const texte = document.getElementById("annonce").value.trim();
  if (!texte) {
    afficherErreur("Veuillez coller le texte d'une annonce avant de lancer l'analyse.");
    return;
  }

  const btn       = document.getElementById("btnAnalyse");
  const errorBox  = document.getElementById("errorBox");
  const loading   = document.getElementById("loadingState");
  const results   = document.getElementById("results");
  const divider   = document.getElementById("divider");

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
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: buildPrompt(texte) }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Erreur HTTP ${response.status}`);
    }

    const data = await response.json();
    const raw  = data.content.map(b => b.text || "").join("");
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
  const grid    = document.getElementById("diagGrid");

  // Diagnostic
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

  // Message
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
