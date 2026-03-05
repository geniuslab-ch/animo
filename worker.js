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
            const debugObj = {
                error: "Unauthorized",
                hasExpectedToken: !!env.SECRET_TOKEN,
                expectedLength: env.SECRET_TOKEN ? env.SECRET_TOKEN.length : 0,
                receivedLength: token ? token.length : 0,
            };
            return new Response(JSON.stringify(debugObj), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
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

            // Filtrer strictement les HTTPS (Anibis a des vieux liens http://)
            const secureImages = images.filter(img => img.startsWith("https://"));

            // Ajout des images en base64 (max 5)
            // L'API Anthropic requiert que les images soient envoyées en base64
            for (const imgUrl of secureImages.slice(0, 5)) {
                try {
                    const imgResp = await fetch(imgUrl);
                    if (imgResp.ok) {
                        const buffer = await imgResp.arrayBuffer();
                        let mimeType = imgResp.headers.get("content-type") || "image/jpeg";

                        // Anthropic supporte image/jpeg, image/png, image/gif, image/webp
                        if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)) {
                            mimeType = "image/jpeg"; // Fallback
                        }

                        // Conversion ArrayBuffer -> Base64
                        const base64 = btoa(
                            new Uint8Array(buffer)
                                .reduce((data, byte) => data + String.fromCharCode(byte), '')
                        );

                        content.push({
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: mimeType,
                                data: base64,
                            },
                        });
                    }
                } catch (e) {
                    // Ignorer silencieusement si l'image échoue
                }
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
            let imgUrl = m[1] || m[0];

            // Forcer le HTTPS si l'URL commence par //
            if (imgUrl && imgUrl.startsWith('//')) {
                imgUrl = 'https:' + imgUrl;
            }

            if (imgUrl && imgUrl.startsWith('https://') && !imgUrl.includes('logo') && !imgUrl.includes('icon') && !imgUrl.includes('avatar') && !imgUrl.includes('placeholder')) {
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

function buildPrompt(text, url, imageCount) {
    return `You are a Swiss real estate market analyst specialized in the canton of Vaud.
Your task is to analyze a real estate listing published by a private seller and generate a short diagnostic report.
The goal of the report is to highlight opportunities to improve the attractiveness of the listing compared to typical listings in the Vaud real estate market.

Tone: Professional, neutral, constructive, never judgmental. Write the report in French.

Analyze this real estate listing (URL: ${url}).
${imageCount > 0 ? `You also have access to ${imageCount} photo(s) of the listing — analyze them as well.` : ''}

You MUST reply ONLY with valid JSON, without any markdown formatting or \`\`\` wrappers.

EXPECTED EXACT JSON FORMAT:
{
  "diagnostic": [
    {
      "titre": "Short title",
      "texte": "Explain why this matters for buyers in the canton of Vaud and how it affects the attractiveness of the listing. (2-3 sentences max)"
    }
  ], // Identify exactly the 3 most important improvement opportunities
  "comparaison": "Explain briefly how similar properties in the region are usually presented (photos, description, information provided).",
  "recommandations": [
    "Concrete recommendation 1",
    "Concrete recommendation 2",
    "Concrete recommendation 3"
  ], // Provide 3–5 concrete recommendations that could increase buyer interest
  "message1": "Write a short ice-breaker message. Example: 'Bonjour, Je me permets de vous écrire car j’ai analysé votre annonce... Souhaitez-vous que je vous le transmette ?'",
  "message2": "Write the follow-up message containing the actual analysis findings, based on the diagnostic, comparisons, and recommendations above. (formal French 'vous')."
}

Listing text content:
${text}`;
}
