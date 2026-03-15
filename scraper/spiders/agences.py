"""
Spider generique pour extraire les annonces des sites d'agences immobilieres
du canton de Vaud.

Usage :
    cd scraper
    scrapy crawl agences

Le resultat est ecrit dans agences.json.
"""

import re
import scrapy


class AgencesSpider(scrapy.Spider):
    name = "agences"

    custom_settings = {
        "FEEDS": {
            "agences.json": {
                "format": "json",
                "encoding": "utf-8",
                "indent": 2,
                "overwrite": True,
            },
        },
        "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": 30_000,
    }

    # Liste des pages de vente des principales agences vaudoises
    # Adaptez les URLs selon les pages reelles de chaque agence
    start_urls = [
        "https://www.naef.ch/acheter/",
        "https://www.bernard-nicod.ch/fr/acheter",
        "https://www.cogestim.ch/fr/acheter",
        "https://www.domicim.ch/fr/acheter",
        "https://www.gerofinance.ch/fr/acheter",
    ]

    def start_requests(self):
        for url in self.start_urls:
            yield scrapy.Request(
                url,
                meta={"playwright": True, "playwright_include_page": True},
                callback=self.parse_agency_listing,
                errback=self.errback_close_page,
            )

    async def parse_agency_listing(self, response):
        page = response.meta["playwright_page"]

        try:
            await page.wait_for_selector("a[href]", timeout=10_000)
        except Exception:
            pass

        await page.close()

        domain = self._get_domain(response.url)

        # Trouver les liens vers les fiches de biens
        property_links = set()
        for href in response.css("a::attr(href)").getall():
            full = response.urljoin(href)
            if self._is_property_link(full, domain):
                property_links.add(full)

        self.logger.info(
            "Agence %s : %d biens trouves", domain, len(property_links)
        )

        for link in property_links:
            yield scrapy.Request(
                link,
                meta={
                    "playwright": True,
                    "playwright_include_page": True,
                    "agence": domain,
                },
                callback=self.parse_property,
                errback=self.errback_close_page,
            )

    async def parse_property(self, response):
        page = response.meta["playwright_page"]

        try:
            await page.wait_for_selector("body", timeout=10_000)
        except Exception:
            pass

        await page.close()

        item = {
            "url": response.url,
            "agence": response.meta.get("agence", ""),
            "titre": self._extract_first(response, [
                "h1::text", "h1 *::text",
                "meta[property='og:title']::attr(content)",
            ]),
            "prix": self._extract_price(response),
            "pieces": self._extract_rooms(response),
            "surface_m2": self._extract_surface(response),
            "localisation": self._extract_location(response),
            "image_url": self._extract_image(response),
            "source": "agence",
        }

        if any(item[k] for k in ("prix", "pieces", "surface_m2", "localisation")):
            yield item

    # ── Extracteurs ───────────────────────────────────────────────────────

    def _extract_first(self, response, selectors):
        for sel in selectors:
            val = response.css(sel).get()
            if val and val.strip():
                return val.strip()
        return None

    def _extract_price(self, response):
        for sel in [
            "[class*='price']::text",
            "[class*='prix']::text",
            "[itemprop='price']::attr(content)",
        ]:
            val = response.css(sel).get()
            if val:
                price = self._parse_number(val)
                if price:
                    return price

        body_text = " ".join(response.css("body *::text").getall())
        match = re.search(r"(?:CHF|Fr\.?)\s*([\d'\u2019.,]+)", body_text)
        if match:
            return self._parse_number(match.group(1))
        return None

    def _extract_rooms(self, response):
        body_text = " ".join(response.css("body *::text").getall())
        match = re.search(
            r"(\d+(?:[.,]\d)?)\s*(?:pi[eè]ces?|rooms?|Zimmer|pcs?\.?)",
            body_text,
        )
        if match:
            return float(match.group(1).replace(",", "."))
        return None

    def _extract_surface(self, response):
        body_text = " ".join(response.css("body *::text").getall())
        match = re.search(r"(\d+)\s*m[²2]", body_text)
        if match:
            return int(match.group(1))
        return None

    def _extract_location(self, response):
        for sel in [
            "[class*='location']::text",
            "[class*='address']::text",
            "[itemprop='addressLocality']::text",
        ]:
            val = response.css(sel).get()
            if val and val.strip():
                return val.strip()

        body_text = " ".join(response.css("body *::text").getall())
        match = re.search(
            r"\b(\d{4}\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+)?)\b",
            body_text,
        )
        if match:
            return match.group(1).strip()
        return None

    def _extract_image(self, response):
        for sel in [
            "meta[property='og:image']::attr(content)",
            "[class*='gallery'] img::attr(src)",
            "[class*='photo'] img::attr(src)",
            "[class*='slider'] img::attr(src)",
        ]:
            val = response.css(sel).get()
            if val:
                return response.urljoin(val)
        return None

    # ── Utilitaires ───────────────────────────────────────────────────────

    @staticmethod
    def _get_domain(url):
        match = re.search(r"https?://(?:www\.)?([^/]+)", url)
        return match.group(1) if match else url

    @staticmethod
    def _is_property_link(url, domain):
        """Heuristique : un lien de fiche contient souvent un identifiant numerique."""
        if domain not in url:
            return False
        patterns = [
            r"/(?:bien|property|object|annonce|detail|vente|achat)/",
            r"/(?:acheter|buy|kaufen)/[^?]+\d",
            r"/[a-z-]+/\d{4,}",
        ]
        return any(re.search(p, url, re.IGNORECASE) for p in patterns)

    @staticmethod
    def _parse_number(text):
        if not text:
            return None
        cleaned = re.sub(r"[^\d]", "", text)
        return int(cleaned) if cleaned else None

    async def errback_close_page(self, failure):
        page = failure.request.meta.get("playwright_page")
        if page:
            await page.close()
        self.logger.error("Erreur : %s", failure.value)
