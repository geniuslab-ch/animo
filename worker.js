// ── Cloudflare Worker — Animo Proxy ─────────────────────────────────────────
// Secrets Cloudflare (Settings → Variables & Secrets) :
//   animo_anthropic  → clé API Anthropic
//   SECRET_TOKEN     → token d'accès privé (doit correspondre à app.js)

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // ── Route : scrape-listings (scan en masse petitesannonces) ─────────
        if (url.pathname === "/api/scrape-listings") {
            return handleScrapeListings(request, env);
        }

        // ── Route : scrape-agency (scan automatique site agence) ─────────────
        if (url.pathname === "/api/scrape-agency") {
            return handleScrapeAgency(request, env);
        }

        // ── Route : parse-buyer-pdf (import acheteur off-market) ──────────
        if (url.pathname === "/api/parse-buyer-pdf") {
            return handleParseBuyerPDF(request, env);
        }

        // ── Route : parse-seller-pdf (matching inversé — bien vendeur) ──────
        if (url.pathname === "/api/parse-seller-pdf") {
            return handleParseSellerPDF(request, env);
        }

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
            const { listingUrl, listingContent, listingImages, canton } = await request.json();
            if (!listingUrl && !listingContent) {
                return new Response(JSON.stringify({ error: "listingUrl ou listingContent manquant" }), {
                    status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }
            const cantonName = canton || "Vaud";

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
                text: buildPrompt(text, listingUrl || "contenu extrait par bookmarklet", images.length, cantonName),
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

// ── Scrape Listings (scan en masse d'une rubrique) ──────────────────────────
async function handleScrapeListings(request, env) {
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

    const token = request.headers.get("x-secret-token");
    if (!token || token !== env.SECRET_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }

    try {
        const { url: pageUrl, singleAd } = await request.json();
        if (!pageUrl) {
            return new Response(JSON.stringify({ error: "url manquant" }), {
                status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        // Mode fiche individuelle (pour le matching)
        if (singleAd) {
            try {
                const ad = await scrapeAdDetail(pageUrl, env);
                return new Response(JSON.stringify({
                    annonces: ad ? [ad] : [],
                    hasMore: false,
                    total: ad ? 1 : 0,
                }), {
                    status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            } catch (e) {
                return new Response(JSON.stringify({ annonces: [], hasMore: false, total: 0 }), {
                    status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }
        }

        // Fetcher la page de liste (SmartProxy en priorité)
        let html = null;

        // Tentative 1 : SmartProxy (meilleur taux de succès)
        if (env.SMARTPROXY_AUTH) {
            try {
                html = await fetchViaSmartProxy(pageUrl, env);
            } catch (e) { /* SmartProxy échoué, on essaie le fetch direct */ }
        }

        // Tentative 2 : fetch direct (fallback gratuit)
        if (!html) {
            try {
                const response = await fetch(pageUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "fr-CH,fr;q=0.9,en;q=0.8",
                    },
                });
                if (response.ok) html = await response.text();
            } catch (e) { /* ignore */ }
        }

        if (!html) {
            return new Response(JSON.stringify({
                error: "Impossible de charger la page",
            }), {
                status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        // Detecter la source (anibis vs petitesannonces)
        const isAnibis = pageUrl.includes('anibis.ch');

        // Extraire les liens vers les fiches individuelles
        const adLinkPattern = isAnibis
            ? /href=["']([^"']*\/fr\/d\/[^"']+)["']/gi
            : /href=["']([^"']*\/a\/\d+[^"']*)["']/gi;
        // Patterns d'URLs de location a exclure (anibis et petitesannonces)
        const rentalUrlPattern = /immobilier-(?:immobilier-)?locations?[-/]|\/louer\b|\/location\b|\/mieten\b/i;
        const adLinks = new Set();
        let match;
        while ((match = adLinkPattern.exec(html)) !== null) {
            let href = match[1];
            if (href.startsWith("/")) {
                const base = new URL(pageUrl);
                href = base.origin + href;
            }
            // Exclure les liens de location (louer)
            if (rentalUrlPattern.test(href)) continue;
            adLinks.add(href);
        }

        // Scraper chaque fiche (max 20 par page)
        const annonces = [];
        const links = [...adLinks].slice(0, 20);

        for (const adUrl of links) {
            try {
                const ad = await scrapeAdDetail(adUrl, env);
                if (ad) annonces.push(ad);
            } catch (e) {
                // Ignorer les fiches qui echouent
            }
        }

        // Detecter la pagination
        const hasMore = html.includes('rel="next"')
            || /suivant/i.test(html)
            || /next/i.test(html)
            || adLinks.size >= 10;

        return new Response(JSON.stringify({ annonces, hasMore, total: adLinks.size }), {
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }
}

// ── Scraper une fiche individuelle ──────────────────────────────────────────
async function scrapeAdDetail(adUrl, env) {
    let html = null;

    // Tentative 1 : SmartProxy (prioritaire)
    if (env?.SMARTPROXY_AUTH) {
        try {
            html = await fetchViaSmartProxy(adUrl, env);
        } catch (e) { /* SmartProxy échoué, fallback au fetch direct */ }
    }

    // Tentative 2 : fetch direct (fallback)
    if (!html) {
        try {
            const response = await fetch(adUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "fr-CH,fr;q=0.9",
                },
            });
            if (response.ok) html = await response.text();
        } catch (e) { /* ignore */ }
    }

    if (!html) return null;

    // Nettoyer le HTML pour extraire le texte
    const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

    // Titre : <title> ou og:title
    let titre = null;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
        || html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (titleMatch) {
        titre = titleMatch[1].trim()
            .replace(/ - Petitesannonces\.ch.*$/i, '')
            .replace(/ [-|] [Aa]nibis.*$/i, '')
            .trim();
    }

    // Description : og:description ou meta description
    let description = null;
    const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (descMatch) {
        description = descMatch[1].trim();
    }

    // Prix : CHF xxx'xxx ou Fr. xxx'xxx
    let prix = null;
    const prixMatch = text.match(/(?:CHF|Fr\.?|SFr\.?)\s*([\d''\u2019.,]+)/i)
        || text.match(/([\d''\u2019.,]+)\s*(?:CHF|Fr\.?|SFr\.?)/i);
    if (prixMatch) {
        prix = parseInt(prixMatch[1].replace(/[''\u2019.,\s]/g, ''), 10) || null;
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

    // Localisation : NPA + ville
    let localisation = null;
    const locMatch = text.match(/\b(\d{4}\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+)?)\b/);
    if (locMatch) {
        localisation = locMatch[1].trim();
    }

    // Image
    let image_url = null;
    const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogImg) {
        image_url = ogImg[1];
    } else {
        const imgMatch = html.match(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
        if (imgMatch && !imgMatch[1].includes('logo') && !imgMatch[1].includes('icon')) {
            image_url = imgMatch[1];
        }
    }

    // Ne retourner que si au moins un champ utile
    if (!prix && !pieces && !surface_m2 && !localisation) return null;

    const result = {
        url: adUrl,
        titre,
        description,
        fullText: text.substring(0, 2000),
        prix,
        pieces,
        surface_m2,
        localisation,
        image_url,
        source: adUrl.includes('anibis.ch') ? 'anibis.ch' : 'petitesannonces.ch',
    };

    // Detecter et exclure les annonces de location (louer)
    if (isRentalAd(result)) return null;

    return result;
}

// ── Scrape Agency (scan automatique d'un site d'agence) ─────────────────────
async function handleScrapeAgency(request, env) {
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

    const token = request.headers.get("x-secret-token");
    if (!token || token !== env.SECRET_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }

    try {
        const { url: pageUrl, agencyName } = await request.json();
        if (!pageUrl) {
            return new Response(JSON.stringify({ error: "url manquant" }), {
                status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        const baseObj = new URL(pageUrl);
        const baseDomain = baseObj.origin;
        const maxPages = 15;
        let allAnnonces = [];
        let currentUrl = pageUrl;
        let usedSmartProxy = false;
        let emptyPages = 0;

        for (let page = 1; page <= maxPages; page++) {
            let html = '';
            let fetchOk = false;
            let annonces = [];

            // Tentative 1 : SmartProxy avec rendu JS (prioritaire, sites SPA/infinite scroll)
            if (env.SMARTPROXY_AUTH) {
                try {
                    const spHtml = await fetchViaSmartProxy(currentUrl, env, {
                        headless: true,
                        browser_actions: [
                            { type: 'wait', wait_time_s: 5 },
                        ],
                    });
                    if (spHtml) {
                        html = spHtml;
                        annonces = extractAgencyListings(html, baseDomain, agencyName || "Agence");
                        if (annonces.length > 0) {
                            fetchOk = true;
                            usedSmartProxy = true;
                        }
                    }
                } catch (e) { /* SmartProxy échoué, fallback au fetch direct */ }
            }

            // Tentative 2 : fetch direct (fallback gratuit)
            if (!fetchOk) {
                try {
                    const response = await fetch(currentUrl, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                            "Accept-Language": "fr-CH,fr;q=0.9,en;q=0.8",
                            "Referer": baseDomain + "/",
                        },
                    });
                    if (response.ok) {
                        html = await response.text();
                        fetchOk = true;
                        annonces = extractAgencyListings(html, baseDomain, agencyName || "Agence");
                    }
                } catch (e) { /* fetch direct échoué */ }
            }

            // Dernier recours : meta tags pour les SPA
            if (annonces.length === 0 && detectSPAShell(html)) {
                const spaAd = extractMetaTagsAd(html, currentUrl, agencyName || "Agence");
                if (spaAd) annonces.push(spaAd);
            }

            if (annonces.length > 0) {
                emptyPages = 0;
                allAnnonces.push(...annonces);
            } else {
                emptyPages++;
                if (emptyPages >= 2) break; // 2 pages vides consecutives = fin
            }

            // Chercher un lien de page suivante
            const nextUrl = findNextPageUrl(html, currentUrl, baseDomain);
            if (!nextUrl) break;
            currentUrl = nextUrl;
        }

        const status = allAnnonces.length > 0 ? 'ok' : 'empty';
        const message = allAnnonces.length === 0 ? 'Aucune annonce trouvee' :
            (usedSmartProxy ? 'Via SmartProxy (rendu JS)' : null);

        return new Response(JSON.stringify({ annonces: allAnnonces, total: allAnnonces.length, status, message }), {
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });

    } catch (err) {
        return new Response(JSON.stringify({ annonces: [], error: err.message }), {
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }
}

// ── Parse Buyer PDF (import acheteur off-market) ────────────────────────────
async function handleParseBuyerPDF(request, env) {
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

    const token = request.headers.get("x-secret-token");
    if (!token || token !== env.SECRET_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }

    try {
        const { pdf_base64, filename } = await request.json();
        if (!pdf_base64) {
            return new Response(JSON.stringify({ error: "pdf_base64 manquant" }), {
                status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": env.animo_anthropic,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1000,
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "document",
                            source: {
                                type: "base64",
                                media_type: "application/pdf",
                                data: pdf_base64,
                            },
                        },
                        {
                            type: "text",
                            text: `Analyse ce document PDF d'un acheteur immobilier et extrais les criteres de recherche.

Reponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans backticks) avec ces champs :
{
  "titre": "description courte de la recherche (ex: Cherche 4 pieces Lausanne)",
  "prix": nombre ou null (budget max en CHF, sans decimales),
  "pieces": nombre ou null (nombre de pieces/chambres),
  "surface_m2": nombre ou null (surface souhaitee en m2),
  "localisation": "NPA Ville" ou null (ex: "1000 Lausanne"),
  "description": "resume des criteres en une phrase",
  "type": "apartment" ou "house" ou "land" ou "commercial" ou "unknown"
}

Si un champ n'est pas mentionne dans le document, mets null.
Pour le prix, convertis toujours en CHF. Utilise le budget maximum si une fourchette est donnee.
Pour la localisation, utilise le format "NPA Ville" suisse (4 chiffres + nom de ville).`,
                        },
                    ],
                }],
            }),
        });

        if (!anthropicResponse.ok) {
            const errData = await anthropicResponse.text();
            return new Response(JSON.stringify({ error: "Erreur API Claude: " + errData }), {
                status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        const data = await anthropicResponse.json();
        const responseText = data.content?.[0]?.text || '';

        let buyer;
        try {
            buyer = JSON.parse(responseText);
        } catch {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                buyer = JSON.parse(jsonMatch[0]);
            } else {
                return new Response(JSON.stringify({ error: "Impossible de parser la reponse Claude", raw: responseText }), {
                    status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }
        }

        return new Response(JSON.stringify({ buyer, filename }), {
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }
}

// ── Parse Seller PDF (matching inversé — bien vendeur) ──────────────────────
async function handleParseSellerPDF(request, env) {
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

    const token = request.headers.get("x-secret-token");
    if (!token || token !== env.SECRET_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }

    try {
        const { pdf_base64, filename } = await request.json();
        if (!pdf_base64) {
            return new Response(JSON.stringify({ error: "pdf_base64 manquant" }), {
                status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": env.animo_anthropic,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1000,
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "document",
                            source: {
                                type: "base64",
                                media_type: "application/pdf",
                                data: pdf_base64,
                            },
                        },
                        {
                            type: "text",
                            text: `Analyse ce document PDF d'un bien immobilier en vente et extrais ses caracteristiques.

Reponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans backticks) avec ces champs :
{
  "titre": "description courte du bien (ex: Villa 5 pieces Lausanne)",
  "prix": nombre ou null (prix de vente en CHF, sans decimales),
  "pieces": nombre ou null (nombre de pieces),
  "surface_m2": nombre ou null (surface habitable en m2),
  "localisation": "NPA Ville" ou null (ex: "1000 Lausanne"),
  "description": "resume du bien en une phrase",
  "type": "apartment" ou "house" ou "land" ou "commercial" ou "building" ou "unknown"
}

Si un champ n'est pas mentionne dans le document, mets null.
Pour le prix, convertis toujours en CHF.
Pour la localisation, utilise le format "NPA Ville" suisse (4 chiffres + nom de ville).`,
                        },
                    ],
                }],
            }),
        });

        if (!anthropicResponse.ok) {
            const errData = await anthropicResponse.text();
            return new Response(JSON.stringify({ error: "Erreur API Claude: " + errData }), {
                status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        const data = await anthropicResponse.json();
        const responseText = data.content?.[0]?.text || '';

        let bien;
        try {
            bien = JSON.parse(responseText);
        } catch {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                bien = JSON.parse(jsonMatch[0]);
            } else {
                return new Response(JSON.stringify({ error: "Impossible de parser la reponse Claude", raw: responseText }), {
                    status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }
        }

        return new Response(JSON.stringify({ bien, filename }), {
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }
}

// Detecter le lien vers la page suivante dans le HTML
// Detecter les annonces de location (a exclure)
function isRentalAd(annonce) {
    const text = ((annonce.titre || '') + ' ' + (annonce.description || '') + ' ' + (annonce.fullText || '')).toLowerCase();
    const rentalPatterns = /\b(à louer|a louer|en location|louer|bail|sous-location|sous location|mois de loyer|loyer mensuel|loyer|charges comprises|charges en sus|zu vermieten|miete|affitto|per mese|to rent)\b/;
    const salePatterns = /\b(à vendre|a vendre|vente|achat|acheter|prix de vente|rendement|immeuble de rapport|zu verkaufen|vendita)\b/;
    if (rentalPatterns.test(text) && !salePatterns.test(text)) return true;
    // Prix mensuel detecte (pattern /mois ou /m ou par mois)
    if (/\b\d[\d''.]*\s*(?:\/\s*mois|\/\s*m\b|p\.?\s*m\.?|par mois|mensuel)/i.test(text)) return true;
    return false;
}

// SmartProxy Web Scraping API — rendu JavaScript cote serveur
async function fetchViaSmartProxy(url, env, options = {}) {
    if (!env.SMARTPROXY_AUTH) return null;

    const auth = btoa(env.SMARTPROXY_AUTH);
    const body = {
        target: 'universal',
        url: url,
    };

    // Activer le rendu JS headless (sites SPA, infinite scroll)
    if (options.headless) {
        body.headless = 'html';
    }

    // Ajouter des browser actions (click, wait, etc.)
    if (options.browser_actions) {
        body.headless = 'html'; // requis pour les browser actions
        body.browser_actions = options.browser_actions;
    }

    const response = await fetch('https://scraper-api.decodo.com/v2/scrape', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) return null;

    const data = await response.json();
    // L'API retourne le HTML rendu dans le champ "results"
    if (data.results && data.results[0] && data.results[0].content) {
        return data.results[0].content;
    }
    // Certaines versions retournent directement le body
    if (data.body) return data.body;
    if (typeof data === 'string') return data;

    return null;
}

function findNextPageUrl(html, currentUrl, baseDomain) {
    // Patterns courants de pagination
    const patterns = [
        // rel="next"
        /<a[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i,
        // href avant class contenant "next"
        /<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*next[^"']*["']/i,
        // class contenant "next" avant href
        /<a[^>]+class=["'][^"']*next[^"']*["'][^>]+href=["']([^"']+)["']/i,
        // aria-label="next" ou "suivant"
        /<a[^>]+aria-label=["'][^"']*(?:next|suivant)[^"']*["'][^>]+href=["']([^"']+)["']/i,
        // Texte "Suivant", "Next", ">" dans le lien
        /<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:Suivant|Next|Suivante|&gt;|›|»)\s*<\/a>/i,
        /<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*(?:Suivant|Next|Suivante)[^<]*<\/a>/i,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            let href = match[1].replace(/&amp;/g, '&');
            if (href.startsWith('/')) href = baseDomain + href;
            if (href.startsWith('http') && href !== currentUrl) return href;
        }
    }

    // Chercher un parametre page= ou p= dans l'URL courante et incrementer
    const urlObj = new URL(currentUrl);
    const pageParam = urlObj.searchParams.get('page') || urlObj.searchParams.get('p');
    if (pageParam) {
        const nextPage = parseInt(pageParam, 10) + 1;
        const param = urlObj.searchParams.has('page') ? 'page' : 'p';
        urlObj.searchParams.set(param, nextPage);
        return urlObj.href;
    }

    // Detecter /page/N/ dans le path et incrementer
    const pathPageMatch = currentUrl.match(/\/page\/(\d+)(\/|$)/);
    if (pathPageMatch) {
        const nextPage = parseInt(pathPageMatch[1], 10) + 1;
        return currentUrl.replace(/\/page\/\d+(\/|$)/, `/page/${nextPage}$2`);
    }

    // Dernier recours : ajouter ?page=2 meme si l'URL n'a pas de parametre page
    // La plupart des sites supportent ce parametre
    urlObj.searchParams.set('page', '2');
    return urlObj.href;
}

// Extraire un minimum d'infos depuis les meta tags d'un site SPA
function extractMetaTagsAd(html, pageUrl, agencyName) {
    let titre = null;
    const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) titre = titleMatch[1].trim();

    let description = null;
    const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (descMatch) description = descMatch[1].trim();

    const text = ((titre || '') + ' ' + (description || '')).trim();
    if (!text || text.length < 20) return null;

    let prix = null;
    const prixM = text.match(/(?:CHF|Fr\.?|SFr\.?)\s*([\d''\u2019.,]+)/i);
    if (prixM) prix = parseInt(prixM[1].replace(/[''\u2019.,\s]/g, ''), 10) || null;

    let pieces = null;
    const pcsM = text.match(/(\d+(?:[.,]\d)?)\s*(?:pi[eè]ces?|pcs?\.?|rooms?|Zimmer)/i);
    if (pcsM) pieces = parseFloat(pcsM[1].replace(',', '.'));

    let surface_m2 = null;
    const surfM = text.match(/(\d+)\s*m[²2]/i);
    if (surfM) surface_m2 = parseInt(surfM[1], 10);

    let localisation = null;
    const locM = text.match(/\b(\d{4}\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+)?)\b/);
    if (locM) localisation = locM[1].trim();

    let image_url = null;
    const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImg) image_url = ogImg[1];

    return {
        url: pageUrl,
        titre,
        description,
        fullText: text.substring(0, 2000),
        prix,
        pieces,
        surface_m2,
        localisation,
        image_url,
        source: agencyName,
    };
}

function detectSPAShell(html) {
    const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return textContent.length < 500;
}

// ── Extraction generique des listings depuis une page d'agence ──────────────
function extractAgencyListings(html, baseDomain, agencyName) {
    const annonces = [];

    // Nettoyer le HTML pour le texte
    const textOnly = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

    // Strategie 1 : JSON-LD (schema.org) — beaucoup d'agences l'utilisent
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of jsonLdMatches) {
        try {
            const jsonData = JSON.parse(m[1].trim());
            const items = Array.isArray(jsonData) ? jsonData : [jsonData];
            for (const item of items) {
                if (item["@type"] === "RealEstateListing" || item["@type"] === "Product" ||
                    item["@type"] === "Apartment" || item["@type"] === "House" ||
                    item["@type"] === "Residence") {
                    const ad = extractFromJsonLd(item, baseDomain, agencyName);
                    if (ad) annonces.push(ad);
                }
                // ItemList contenant des listings
                if (item["@type"] === "ItemList" && item.itemListElement) {
                    for (const el of item.itemListElement) {
                        const subItem = el.item || el;
                        const ad = extractFromJsonLd(subItem, baseDomain, agencyName);
                        if (ad) annonces.push(ad);
                    }
                }
            }
        } catch (e) { /* JSON invalide */ }
    }

    // Si JSON-LD a donne des resultats, on les retourne (sans les locations)
    if (annonces.length > 0) return annonces.filter(a => !isRentalAd(a));

    // Strategie 1.5 : Donnees SSR embarquees (Next.js, Nuxt.js, etc.)
    const ssrAnnonces = extractSSRData(html, baseDomain, agencyName);
    if (ssrAnnonces.length > 0) return ssrAnnonces.filter(a => !isRentalAd(a));

    // Strategie 2 : Extraction par patterns HTML generiques
    // Chercher les blocs qui ressemblent a des annonces (contenant prix + lien)
    const prixPattern = /(?:CHF|Fr\.?|SFr\.?)\s*([\d''\u2019.,]+)/gi;
    const piecesPattern = /(\d+(?:[.,]\d)?)\s*(?:pi[eè]ces?|pcs?\.?|rooms?|Zimmer|½)/gi;
    const surfacePattern = /(\d+)\s*m[²2]/gi;
    const npaPattern = /\b(\d{4})\s+([A-ZÀ-Ÿ][a-zà-ÿ\-]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+)?)\b/g;

    // Trouver les liens internes qui menent a des fiches
    const linkPattern = /href=["']((?:https?:\/\/[^"']*|\/[^"']*))["'][^>]*>([\s\S]*?)<\/a>/gi;
    const seenUrls = new Set();
    let linkMatch;

    while ((linkMatch = linkPattern.exec(textOnly)) !== null) {
        let href = linkMatch[1];
        const linkContent = linkMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        // Ignorer les liens courts (navigation, etc.)
        if (linkContent.length < 10) continue;
        // Ignorer les liens externes
        if (href.startsWith("http") && !href.includes(baseDomain.replace("https://", "").replace("http://", ""))) continue;
        // Ignorer les liens generiques
        if (/\/(contact|about|agence|team|login|register|privacy|legal|cgu|faq)\b/i.test(href)) continue;

        if (href.startsWith("/")) href = baseDomain + href;

        if (seenUrls.has(href)) continue;
        seenUrls.add(href);

        // Chercher les infos autour du lien (500 chars avant et apres dans le HTML)
        const linkPos = linkMatch.index;
        const context = textOnly.substring(Math.max(0, linkPos - 300), Math.min(textOnly.length, linkPos + linkMatch[0].length + 300));
        const contextText = context.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

        // Extraire le prix
        let prix = null;
        const prixM = contextText.match(/(?:CHF|Fr\.?|SFr\.?)\s*([\d''\u2019.,]+)/i);
        if (prixM) {
            prix = parseInt(prixM[1].replace(/[''\u2019.,\s]/g, ''), 10) || null;
            // Ignorer les prix trop petits (probablement loyer mensuel) ou aberrants
            if (prix && prix < 5000) prix = null;
        }

        // Extraire les pieces
        let pieces = null;
        const pcsM = contextText.match(/(\d+(?:[.,]\d)?)\s*(?:pi[eè]ces?|pcs?\.?|rooms?|Zimmer)/i);
        if (pcsM) pieces = parseFloat(pcsM[1].replace(',', '.'));

        // Extraire la surface
        let surface_m2 = null;
        const surfM = contextText.match(/(\d+)\s*m[²2]/i);
        if (surfM) surface_m2 = parseInt(surfM[1], 10);

        // Extraire la localisation
        let localisation = null;
        const locM = contextText.match(/\b(\d{4}\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+)?)\b/);
        if (locM) localisation = locM[1].trim();

        // Ne garder que si au moins un champ utile (prix, pieces, surface ou localisation)
        if (!prix && !pieces && !surface_m2 && !localisation) continue;

        // Extraire l'image la plus proche (chercher dans le meme contexte nettoyé)
        let image_url = null;
        const imgContext = textOnly.substring(Math.max(0, linkPos - 500), Math.min(textOnly.length, linkPos + 500));
        const imgM = imgContext.match(/(?:src|data-src)=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
        if (imgM && !imgM[1].includes('logo') && !imgM[1].includes('icon')) {
            image_url = imgM[1];
        }

        // Extraire le type de bien
        const typeText = (linkContent + ' ' + contextText).toLowerCase();
        let type = 'unknown';
        if (/maison|villa|chalet/i.test(typeText)) type = 'house';
        else if (/appartement|appart\b/i.test(typeText)) type = 'apartment';
        else if (/terrain|parcelle/i.test(typeText)) type = 'land';
        else if (/commercial|bureau|local\b/i.test(typeText)) type = 'commercial';
        else if (/parking|garage|box/i.test(typeText)) type = 'parking';
        else if (/immeuble/i.test(typeText)) type = 'building';

        annonces.push({
            url: href,
            titre: linkContent.substring(0, 100),
            description: contextText.substring(0, 300),
            fullText: contextText.substring(0, 2000),
            prix,
            pieces,
            surface_m2,
            localisation,
            image_url,
            type,
            source: agencyName,
        });

        if (annonces.length >= 100) break;
    }

    return annonces.filter(a => !isRentalAd(a));
}

// Extraire les donnees depuis les frameworks SSR (Next.js, Nuxt.js, etc.)
function extractSSRData(html, baseDomain, agencyName) {
    const annonces = [];

    // Next.js : __NEXT_DATA__
    const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
        try {
            const nextData = JSON.parse(nextDataMatch[1]);
            const listings = findListingsInObject(nextData, baseDomain);
            for (const l of listings) {
                annonces.push({ ...l, source: agencyName });
            }
            if (annonces.length > 0) return annonces;
        } catch (e) { /* JSON invalide */ }
    }

    // Nuxt.js : window.__NUXT__
    const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i);
    if (nuxtMatch) {
        try {
            // Nuxt data peut contenir des fonctions, on essaie quand meme
            const nuxtStr = nuxtMatch[1].replace(/undefined/g, 'null').replace(/\bfunction\b[^}]*\}/g, 'null');
            const nuxtData = JSON.parse(nuxtStr);
            const listings = findListingsInObject(nuxtData, baseDomain);
            for (const l of listings) {
                annonces.push({ ...l, source: agencyName });
            }
            if (annonces.length > 0) return annonces;
        } catch (e) { /* JSON invalide */ }
    }

    // Generique : gros blocs JSON dans les <script> contenant des donnees immobilieres
    const scriptBlocks = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
    for (const block of scriptBlocks) {
        const content = block[1].trim();
        // Chercher des objets JSON assignes a des variables (window.__DATA__ = {...}, var data = [...])
        const jsonAssignments = content.matchAll(/(?:window\.[A-Z_]+|var\s+\w+|let\s+\w+|const\s+\w+)\s*=\s*(\[[\s\S]{100,}?\]);/gi);
        for (const m of jsonAssignments) {
            try {
                const data = JSON.parse(m[1]);
                if (Array.isArray(data) && data.length > 1) {
                    const listings = findListingsInObject(data, baseDomain);
                    for (const l of listings) {
                        annonces.push({ ...l, source: agencyName });
                    }
                    if (annonces.length > 0) return annonces;
                }
            } catch (e) { /* pas du JSON valide */ }
        }
    }

    return annonces;
}

// Parcourir un objet JSON recursif pour trouver des listings immobiliers
function findListingsInObject(obj, baseDomain, depth = 0) {
    if (depth > 8 || !obj) return [];
    const results = [];

    if (Array.isArray(obj)) {
        // Si c'est un tableau d'objets avec des champs immobiliers
        const validItems = obj.filter(item =>
            item && typeof item === 'object' && !Array.isArray(item) &&
            (item.price || item.prix || item.rooms || item.pieces || item.numberOfRooms ||
             item.surface || item.area || item.floorSize || item.address || item.location || item.localisation)
        );
        if (validItems.length >= 2) {
            for (const item of validItems) {
                const ad = extractListingFromObject(item, baseDomain);
                if (ad) results.push(ad);
            }
            return results;
        }
        // Sinon recurser dans chaque element
        for (const item of obj.slice(0, 50)) {
            results.push(...findListingsInObject(item, baseDomain, depth + 1));
            if (results.length >= 100) return results;
        }
        return results;
    }

    if (typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
            if (value && typeof value === 'object') {
                results.push(...findListingsInObject(value, baseDomain, depth + 1));
                if (results.length >= 100) return results;
            }
        }
    }

    return results;
}

// Extraire un listing depuis un objet JSON generique
function extractListingFromObject(item, baseDomain) {
    let prix = null;
    const priceVal = item.price || item.prix || item.sellingPrice || item.salePrice ||
        (item.offers && item.offers.price) || (item.pricing && item.pricing.price);
    if (priceVal) prix = parseInt(String(priceVal).replace(/[^\d]/g, ''), 10) || null;

    let pieces = null;
    const roomsVal = item.rooms || item.pieces || item.numberOfRooms || item.nbRooms || item.nbPieces;
    if (roomsVal) pieces = parseFloat(String(roomsVal).replace(',', '.'));

    let surface_m2 = null;
    const surfVal = item.surface || item.area || item.livingSpace || item.surfaceHabitable ||
        (item.floorSize && (item.floorSize.value || item.floorSize));
    if (surfVal) surface_m2 = parseInt(String(surfVal).replace(/[^\d]/g, ''), 10) || null;

    let localisation = null;
    if (item.address) {
        const addr = typeof item.address === 'string' ? item.address :
            [item.address.postalCode || item.address.zip, item.address.city || item.address.addressLocality].filter(Boolean).join(' ');
        if (addr) localisation = addr;
    } else if (item.location) {
        localisation = typeof item.location === 'string' ? item.location :
            (item.location.city || item.location.name || null);
    } else if (item.city || item.ville) {
        const zip = item.zip || item.postalCode || item.npa || '';
        localisation = [zip, item.city || item.ville].filter(Boolean).join(' ');
    }

    if (!prix && !pieces && !surface_m2) return null;

    let url = item.url || item.href || item.link || item.slug || null;
    if (url && url.startsWith('/')) url = baseDomain + url;

    let image_url = item.image || item.imageUrl || item.mainImage || item.photo || item.thumbnail || null;
    if (image_url && typeof image_url === 'object') image_url = image_url.url || image_url.src || null;
    if (Array.isArray(image_url)) image_url = image_url[0];

    const titre = item.title || item.titre || item.name || item.headline || null;

    let type = 'unknown';
    const typeStr = (item.type || item.propertyType || item.category || titre || '').toString().toLowerCase();
    if (/maison|villa|chalet|house/i.test(typeStr)) type = 'house';
    else if (/appartement|apartment|appart\b/i.test(typeStr)) type = 'apartment';
    else if (/terrain|land|parcelle/i.test(typeStr)) type = 'land';
    else if (/commercial|bureau|office/i.test(typeStr)) type = 'commercial';

    const desc = (item.description || item.desc || item.summary || '').toString();

    return {
        url,
        titre,
        description: desc.substring(0, 300),
        fullText: ((titre || '') + ' ' + desc + ' ' + (localisation || '')).substring(0, 2000),
        prix,
        pieces,
        surface_m2,
        localisation,
        image_url,
        type,
    };
}

function extractFromJsonLd(item, baseDomain, agencyName) {
    if (!item) return null;

    let prix = null;
    if (item.offers && item.offers.price) {
        prix = parseInt(String(item.offers.price).replace(/[^\d]/g, ''), 10) || null;
    } else if (item.price) {
        prix = parseInt(String(item.price).replace(/[^\d]/g, ''), 10) || null;
    }

    let url = item.url || null;
    if (url && url.startsWith("/")) url = baseDomain + url;

    let image_url = null;
    if (item.image) {
        image_url = Array.isArray(item.image) ? item.image[0] : item.image;
        if (typeof image_url === "object") image_url = image_url.url || null;
    }

    const name = item.name || item.headline || null;
    let localisation = null;
    if (item.address) {
        const addr = item.address;
        localisation = [addr.postalCode, addr.addressLocality].filter(Boolean).join(" ") || null;
    }

    let pieces = null;
    let surface_m2 = null;
    if (item.numberOfRooms) pieces = parseFloat(item.numberOfRooms);
    if (item.floorSize && item.floorSize.value) surface_m2 = parseInt(item.floorSize.value, 10);

    if (!prix && !pieces && !surface_m2 && !localisation) return null;

    // Type de bien depuis schema.org @type ou le nom
    let type = 'unknown';
    const schemaType = (item["@type"] || '').toLowerCase();
    const nameText = (name || '').toLowerCase();
    if (schemaType === 'apartment' || /appartement|appart\b/i.test(nameText)) type = 'apartment';
    else if (schemaType === 'house' || /maison|villa|chalet/i.test(nameText)) type = 'house';
    else if (/terrain|parcelle/i.test(nameText)) type = 'land';
    else if (/parking|garage|box/i.test(nameText)) type = 'parking';
    else if (/commercial|bureau|local\b/i.test(nameText)) type = 'commercial';
    else if (/immeuble/i.test(nameText)) type = 'building';

    const desc = item.description || '';
    return {
        url,
        titre: name,
        description: desc.substring(0, 300),
        fullText: ((name || '') + ' ' + desc + ' ' + (localisation || '')).substring(0, 2000),
        prix,
        pieces,
        surface_m2,
        localisation,
        image_url,
        type,
        source: agencyName,
    };
}

function buildPrompt(text, url, imageCount, canton = "Vaud") {
    const isAgencySite = !url.includes('anibis.ch') && !url.includes('contenu');
    const sellerContext = isAgencySite
        ? "published by a real estate agency"
        : "published by a private seller";

    return `You are a Swiss real estate market intelligence analyst specialized in the canton of ${canton}.

Your role is to analyze a real estate listing ${sellerContext} and generate:
1) a listing quality diagnostic
2) a seller opportunity radar score (probability that the seller could be receptive to professional help)
3) prospecting messages that a real estate professional could send.

Your analysis must reflect how real estate listings are typically presented and perceived in the ${canton} property market.

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

1. Evaluate the attractiveness of the listing compared to common standards in the ${canton} real estate market:
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
      "texte": "Explain why this matters for buyers in the canton of ${canton}."
    },
    {
      "titre": "Short issue title",
      "texte": "Explain why this matters for buyers in the canton of ${canton}."
    },
    {
      "titre": "Short issue title",
      "texte": "Explain why this matters for buyers in the canton of ${canton}."
    }
  ],
  "comparaison_marche": "Explain briefly how comparable listings in the ${canton} region are usually presented.",
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
