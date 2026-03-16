BOT_NAME = "animo_scraper"
SPIDER_MODULES = ["spiders"]
NEWSPIDER_MODULE = "spiders"

# --- Playwright (rendu JS) ---
DOWNLOAD_HANDLERS = {
    "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
    "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
}
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
PLAYWRIGHT_BROWSER_TYPE = "chromium"
PLAYWRIGHT_LAUNCH_OPTIONS = {"headless": True}

# --- Politesse ---
CONCURRENT_REQUESTS = 2
DOWNLOAD_DELAY = 2
RANDOMIZE_DOWNLOAD_DELAY = True
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 2
AUTOTHROTTLE_MAX_DELAY = 10

ROBOTSTXT_OBEY = True
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# --- Sortie ---
# Les FEEDS sont configures dynamiquement par chaque spider
# via custom_settings en fonction du canton (ex: petitesannonces_vaud.json)

LOG_LEVEL = "INFO"
