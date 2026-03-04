// ── Cloudflare Worker — Animo Proxy ─────────────────────────────────────────
// Secrets Cloudflare (Settings → Variables & Secrets) :
//   animo_anthropic  → clé API Anthropic
//   SECRET_TOKEN     → token d'accès privé (doit correspondre à app.js)

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname !== "/api/analyze") {
            return new Response("Not found", { status: 404 });
        }

        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, x-secret-token",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }
        if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405, headers: corsHeaders });
        }

        // ── Vérification du token ──────────────────────────────────────────────────
        const token = request.headers.get("x-secret-token");
        if (!token || token !== env.SECRET_TOKEN) {
            return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        }

        try {
            const { listingUrl } = await request.json();
            if (!listingUrl) {
                return new Response(JSON.stringify({ error: "listingUrl manquant" }), {
                    status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }

            // ── Scraping de l'annonce ──────────────────────────────────────────────
            const { text, images } = await scrapeAnibis(listingUrl);

            // ── Construction des messages multimodaux ──────────────────────────────
            const content = [];

            // Ajout des images (max 5)
            for (const imgUrl of images.slice(0, 5)) {
                content.push({
                    type: "image",
                    source: { type: "url", url: imgUrl },
                });
            }

            // Ajout du prompt texte
            content.push({
                type: "text",
                text: buildPrompt(text, listingUrl, images.length),
            });

            // ── Appel Anthropic ────────────────────────────────────────────────────
            const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": env.animo_anthropic,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                    model: "claude-sonnet-4-20250514",
                    max_tokens: 1500,
                    messages: [{ role: "user", content }],
                }),
            });

            const data = await anthropicResponse.json();
            return new Response(JSON.stringify(data), {
                status: anthropicResponse.status,
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }
    },
};

// ── Scraping de la page Anibis ───────────────────────────────────────────────
async function scrapeAnibis(url) {
    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-CH,fr;q=0.9",
        },
    });

    if (!response.ok) {
        throw new Error(`Impossible de charger la page (${response.status}). Vérifiez que le lien est correct et public.`);
    }

    const html = await response.text();

    // ── Extraction des images ──────────────────────────────────────────────────
    const images = [];

    // 1. og:image (image principale)
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch) images.push(ogMatch[1]);

    // 2. Images de la galerie Anibis (patterns courants)
    const galleryPatterns = [
        /https:\/\/[^"'\s]+anibis[^"'\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/gi,
        /https:\/\/img\.[^"'\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/gi,
        /"url"\s*:\s*"(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
        /data-src=["'](https:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi,
        /src=["'](https:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi,
    ];

    for (const pattern of galleryPatterns) {
        const matches = [...html.matchAll(pattern)];
        for (const m of matches) {
            const imgUrl = m[1] || m[0];
            if (imgUrl && !imgUrl.includes('logo') && !imgUrl.includes('icon') && !imgUrl.includes('avatar') && !imgUrl.includes('placeholder')) {
                images.push(imgUrl);
            }
        }
        if (images.length >= 6) break;
    }

    // Dédoublonnage
    const uniqueImages = [...new Set(images)].slice(0, 5);

    // ── Extraction du texte ────────────────────────────────────────────────────
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 4000);

    return { text, images: uniqueImages };
}

// ── Prompt système ───────────────────────────────────────────────────────────
function buildPrompt(text, url, imageCount) {
    return `Tu es un expert en négociation et vente sur le marché Anibis, spécialiste du Canton de Vaud (Suisse).

Analyse cette annonce immobilière (lien : ${url}) et réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks.
${imageCount > 0 ? `Tu as accès à ${imageCount} photo(s) de l'annonce — analyse-les également (qualité, luminosité, mise en scène, ce qu'elles révèlent ou cachent).` : ''}

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
- Prix: cohérence avec le marché immobilier vaudois (PPE, Vaud) — si absent, le signaler
- Qualité des photos: nombre, luminosité, mise en scène, angles, ce qui est caché
- Précision technique: CECB, année de construction, charges PPE, état toiture, diagnostics, règlement PPE
- Psychologie: ton adapté à l'acheteur suisse romand (confiance, sérieux, précision)
- Informations manquantes clés pour le marché suisse

Contenu extrait de la page:
${text}`;
}
