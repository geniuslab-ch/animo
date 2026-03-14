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
            const { listingUrl, listingContent, listingImages } = await request.json();
            if (!listingUrl && !listingContent) {
                return new Response(JSON.stringify({ error: "listingUrl ou listingContent manquant" }), {
                    status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }

            // ── Scraping ou contenu collé / bookmarklet ──────────────────────────
            let text, images;
            if (listingContent) {
                // Mode bookmarklet ou copier-coller
                text = listingContent.substring(0, 4000);
                images = listingImages || [];
            } else {
                try {
                    ({ text, images } = await scrapePage(listingUrl));
                } catch (scrapeErr) {
                    return new Response(JSON.stringify({
                        error: "SCRAPE_BLOCKED",
                        message: scrapeErr.message,
                    }), {
                        status: 200,
                        headers: { "Content-Type": "application/json", ...corsHeaders },
                    });
                }
            }

            // ── Construction des messages multimodaux ──────────────────────────────
            const content = [];

            // Filtrer strictement les HTTPS
            const secureImages = images.filter(img => img.startsWith("https://"));

            // Ajout des images en base64 (max 5)
            for (const imgUrl of secureImages.slice(0, 5)) {
                try {
                    const imgResp = await fetch(imgUrl, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                            "Referer": listingUrl || "",
                        },
                    });
                    if (imgResp.ok) {
                        const buffer = await imgResp.arrayBuffer();
                        // Ignorer les images trop petites (< 2KB, probablement des icônes)
                        if (buffer.byteLength < 2000) continue;

                        let mimeType = imgResp.headers.get("content-type") || "image/jpeg";
                        if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)) {
                            mimeType = "image/jpeg";
                        }

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
                text: buildPrompt(text, listingUrl || "contenu extrait par bookmarklet", images.length),
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

// ── Scraping générique d'une page immobilière ────────────────────────────────
async function scrapePage(url) {
    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "fr-CH,fr;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
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

    // 2. Images de la galerie (patterns courants pour sites immobiliers suisses)
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

            if (imgUrl && imgUrl.startsWith('//')) {
                imgUrl = 'https:' + imgUrl;
            }

            if (imgUrl && imgUrl.startsWith('https://') && !imgUrl.includes('logo') && !imgUrl.includes('icon') && !imgUrl.includes('avatar') && !imgUrl.includes('placeholder') && !imgUrl.includes('favicon')) {
                images.push(imgUrl);
            }
        }
        if (images.length >= 6) break;
    }

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
    const isAgencySite = !url.includes('anibis.ch') && !url.includes('contenu');
    const sellerContext = isAgencySite
        ? "published by a real estate agency"
        : "published by a private seller";

    return `You are a Swiss real estate market intelligence analyst specialized in the canton of Vaud.

Your role is to analyze a real estate listing ${sellerContext} and generate:
1) a listing quality diagnostic
2) a seller opportunity radar score (probability that the seller could be receptive to professional help)
3) prospecting messages that a real estate professional could send.

Your analysis must reflect how real estate listings are typically presented and perceived in the Vaud property market.

Tone:
Professional, neutral, constructive and respectful. Never judgmental.

Language:
French (formal "vous").

Important rules:
- Do NOT invent information that is not present in the listing.
- If some information is missing, mention it as a potential improvement.
- Keep explanations concise and practical.
- You MUST reply ONLY with valid JSON.
- No markdown formatting.
- No \`\`\` wrappers.

You are analyzing this listing:

URL: ${url}

${imageCount > 0 ? `The listing contains ${imageCount} photo(s). You should consider their quantity and potential coverage of the property.` : 'No photos were provided with this listing.'}

Listing content:
${text}

Your analysis should follow these steps internally:

1. Evaluate the attractiveness of the listing compared to common standards in the Vaud real estate market:
   - photo quantity
   - clarity of description
   - technical information
   - perceived completeness
   - potential buyer confidence

2. Identify the 3 most important weaknesses that could reduce buyer interest.

3. Evaluate signals that the seller might be open to professional assistance, such as:
   - incomplete listing
   - complexity of the property
   - missing information
   - listing age (if provided)
   - pricing uncertainty
   - atypical or niche property type

4. Estimate an "opportunite_score" from 0 to 100 representing the probability that the seller could be receptive to professional support.

Interpretation:
0-30: faible
30-50: moyenne
50-70: elevee
70-100: tres elevee

Return the following JSON structure EXACTLY:

{
  "score_annonce": {
    "valeur": 0,
    "interpretation": "faible|moyenne|bonne|excellente",
    "explication": "Brief explanation of the listing quality."
  },
  "radar_vendeur": {
    "opportunite_score": 0,
    "niveau": "faible|moyenne|elevee|tres_elevee",
    "explication": "Why this seller might be receptive to advice or professional assistance."
  },
  "diagnostic": [
    {
      "titre": "Short issue title",
      "texte": "Explain why this matters for buyers in the canton of Vaud."
    },
    {
      "titre": "Short issue title",
      "texte": "Explain why this matters for buyers in the canton of Vaud."
    },
    {
      "titre": "Short issue title",
      "texte": "Explain why this matters for buyers in the canton of Vaud."
    }
  ],
  "comparaison_marche": "Explain briefly how comparable listings in the Vaud region are usually presented.",
  "recommandations": [
    "Concrete improvement recommendation",
    "Concrete improvement recommendation",
    "Concrete improvement recommendation"
  ],
  "angle_prospection": {
    "positionnement": "Best professional angle to start a conversation with the seller.",
    "question_ouverture": "A natural professional question to open the discussion."
  },
  "message1": "Short ice-breaker message asking permission to share the analysis.",
  "message2": "Follow-up message presenting the diagnostic and suggestions."
}`;
}
