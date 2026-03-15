#!/bin/bash
# Usage : ./run.sh
# Installe les deps, lance les 2 spiders, puis le matching.

set -e

echo "=== Installation des dependances ==="
pip install -r requirements.txt
playwright install chromium

echo ""
echo "=== Scraping petitesannonces.ch ==="
scrapy crawl petitesannonces

echo ""
echo "=== Scraping agences ==="
scrapy crawl agences

echo ""
echo "=== Matching des annonces ==="
python3 matcher.py

echo ""
echo "=== Termine ==="
echo "Fichiers generes :"
echo "  - petitesannonces.json  (annonces petitesannonces.ch)"
echo "  - agences.json          (annonces agences)"
echo "  - matched_annonces.json (correspondances)"
