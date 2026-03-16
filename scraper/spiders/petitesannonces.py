"""
Spider pour extraire les annonces immobilieres de petitesannonces.ch
Usage :
    cd scraper
    scrapy crawl petitesannonces                   # canton par defaut (vaud)
    scrapy crawl petitesannonces -a canton=valais   # canton specifique

Le resultat est ecrit dans petitesannonces_{canton}.json (cf. settings.py FEEDS).
"""

import re
import scrapy

from cantons import get_canton_config


class PetitesAnnoncesSpider(scrapy.Spider):
    name = "petitesannonces"
    allowed_domains = ["www.petitesannonces.ch"]

    custom_settings = {
        "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": 30_000,
    }

    def __init__(self, canton="vaud", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.canton = canton.lower().strip()
        config = get_canton_config(self.canton)
        self.start_urls = [config["petitesannonces_url"]]
        self.custom_settings["FEEDS"] = {
            f"petitesannonces_{self.canton}.json": {
                "format": "json",
                "encoding": "utf-8",
                "indent": 2,
                "overwrite": True,
            },
        }

    # ── Entrypoint : liste des annonces ──────────────────────────────────
    def start_requests(self):
        for url in self.start_urls:
            yield scrapy.Request(
                url,
                meta={"playwright": True, "playwright_include_page": True},
                callback=self.parse_listing,
                errback=self.errback_close_page,
            )

    async def parse_listing(self, response):
        page = response.meta["playwright_page"]

        # Attendre que les annonces soient rendues
        try:
            await page.wait_for_selector(
                "a[href*='/a/']", timeout=10_000
            )
        except Exception:
            self.logger.warning("Aucun lien d'annonce trouve sur %s", response.url)

        await page.close()

        # Extraire les liens vers les fiches individuelles
        ad_links = response.css("a[href*='/a/']::attr(href)").getall()
        ad_links = list(dict.fromkeys(ad_links))  # deduplicate, preserve order
        ad_links = [
            response.urljoin(href)
            for href in ad_links
            if re.search(r"/a/\d+", href)
        ]

        self.logger.info(
            "[%s] Page %s : %d annonces trouvees", self.canton.upper(), response.url, len(ad_links)
        )

        for link in ad_links:
            yield scrapy.Request(
                link,
                meta={"playwright": True, "playwright_include_page": True},
                callback=self.parse_detail,
                errback=self.errback_close_page,
            )

        # ── Pagination ───────────────────────────────────────────────────
        next_page = self._find_next_page(response)
        if next_page:
            self.logger.info("Page suivante : %s", next_page)
            yield scrapy.Request(
                next_page,
                meta={"playwright": True, "playwright_include_page": True},
                callback=self.parse_listing,
                errback=self.errback_close_page,
            )

    # ── Page de detail d'une annonce ─────────────────────────────────────
    async def parse_detail(self, response):
        page = response.meta["playwright_page"]

        try:
            await page.wait_for_selector("body", timeout=10_000)
        except Exception:
            pass

        await page.close()

        item = {
            "url": response.url,
            "titre": self._extract_title(response),
            "prix": self._extract_price(response),
            "pieces": self._extract_rooms(response),
            "surface_m2": self._extract_surface(response),
            "localisation": self._extract_location(response),
            "image_url": self._extract_image(response),
            "source": "petitesannonces.ch",
            "canton": self.canton,
        }

        # Ne garder que les annonces avec au moins un champ utile
        if any(item[k] for k in ("prix", "pieces", "surface_m2", "localisation")):
            yield item
        else:
            self.logger.debug("Annonce sans donnees utiles : %s", response.url)

    # ── Extracteurs (multi-selecteurs, du plus precis au plus generique) ─

    def _extract_title(self, response):
        for sel in [
            "h1::text",
            "h1 *::text",
            "[class*='title'] h1::text",
            "meta[property='og:title']::attr(content)",
        ]:
            val = response.css(sel).get()
            if val and val.strip():
                return val.strip()
        return None

    def _extract_price(self, response):
        # Chercher dans les meta, puis dans le texte visible
        for sel in [
            "[class*='price']::text",
            "[class*='prix']::text",
            "[class*='Price']::text",
            "[itemprop='price']::attr(content)",
            "meta[property='product:price:amount']::attr(content)",
        ]:
            val = response.css(sel).get()
            if val:
                price = self._parse_number(val)
                if price:
                    return price

        # Fallback : regex sur tout le body
        body_text = " ".join(response.css("body *::text").getall())
        match = re.search(
            r"(?:CHF|Fr\.?|SFr\.?)\s*([\d'\u2019.,]+)", body_text
        )
        if match:
            return self._parse_number(match.group(1))

        match = re.search(
            r"([\d'\u2019.,]+)\s*(?:CHF|Fr\.?|SFr\.?)", body_text
        )
        if match:
            return self._parse_number(match.group(1))

        return None

    def _extract_rooms(self, response):
        for sel in [
            "[class*='room']::text",
            "[class*='piece']::text",
            "[class*='pièce']::text",
            "[class*='Room']::text",
        ]:
            val = response.css(sel).get()
            if val:
                num = self._parse_decimal(val)
                if num:
                    return num

        body_text = " ".join(response.css("body *::text").getall())
        match = re.search(
            r"(\d+(?:[.,]\d)?)\s*(?:pi[eè]ces?|rooms?|Zimmer|pcs?\.?)", body_text
        )
        if match:
            return self._parse_decimal(match.group(1))
        return None

    def _extract_surface(self, response):
        for sel in [
            "[class*='surface']::text",
            "[class*='area']::text",
            "[class*='Surface']::text",
        ]:
            val = response.css(sel).get()
            if val:
                num = self._parse_number(val)
                if num:
                    return num

        body_text = " ".join(response.css("body *::text").getall())
        match = re.search(r"(\d+)\s*m[²2]", body_text)
        if match:
            return int(match.group(1))
        return None

    def _extract_location(self, response):
        for sel in [
            "[class*='location']::text",
            "[class*='localit']::text",
            "[class*='address']::text",
            "[class*='lieu']::text",
            "[itemprop='addressLocality']::text",
            "meta[property='og:locality']::attr(content)",
        ]:
            val = response.css(sel).get()
            if val and val.strip():
                return val.strip()

        # Chercher un NPA suisse (4 chiffres) suivi d'un nom de ville
        body_text = " ".join(response.css("body *::text").getall())
        match = re.search(r"\b(\d{4}\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]+)?)\b", body_text)
        if match:
            return match.group(1).strip()
        return None

    def _extract_image(self, response):
        for sel in [
            "meta[property='og:image']::attr(content)",
            "[class*='gallery'] img::attr(src)",
            "[class*='photo'] img::attr(src)",
            "[class*='image'] img::attr(src)",
            "[class*='slider'] img::attr(src)",
            "img[src*='photo']::attr(src)",
            "img[src*='image']::attr(src)",
        ]:
            val = response.css(sel).get()
            if val:
                return response.urljoin(val)

        # Premiere image significative (pas icone/logo)
        for img in response.css("img::attr(src)").getall():
            if any(skip in img.lower() for skip in ("logo", "icon", "pixel", "tracker", "blank", "spacer")):
                continue
            return response.urljoin(img)
        return None

    # ── Pagination ────────────────────────────────────────────────────────

    def _find_next_page(self, response):
        # Lien "Suivant", "Next", ">"
        for sel in [
            "a[rel='next']::attr(href)",
            "a:contains('Suivant')::attr(href)",
            "a:contains('suivant')::attr(href)",
            "a:contains('Next')::attr(href)",
            "[class*='pag'] a:contains('>')::attr(href)",
            "[class*='pag'] a:last-child::attr(href)",
            "a[class*='next']::attr(href)",
        ]:
            val = response.css(sel).get()
            if val:
                full = response.urljoin(val)
                if full != response.url:
                    return full

        # Pattern URL : /r/XXXXX?page=2 ou /r/XXXXX/2
        current = response.url
        match = re.search(r"[?&]page=(\d+)", current)
        if match:
            page_num = int(match.group(1))
            next_url = re.sub(r"([?&])page=\d+", rf"\1page={page_num + 1}", current)
            # Verifier qu'il y a des annonces sur cette page
            if response.css("a[href*='/a/']").getall():
                return next_url

        return None

    # ── Utilitaires ───────────────────────────────────────────────────────

    @staticmethod
    def _parse_number(text):
        if not text:
            return None
        cleaned = re.sub(r"[^\d]", "", text)
        return int(cleaned) if cleaned else None

    @staticmethod
    def _parse_decimal(text):
        if not text:
            return None
        cleaned = text.replace(",", ".").strip()
        match = re.search(r"(\d+(?:\.\d)?)", cleaned)
        if match:
            return float(match.group(1))
        return None

    async def errback_close_page(self, failure):
        page = failure.request.meta.get("playwright_page")
        if page:
            await page.close()
        self.logger.error("Erreur : %s", failure.value)
