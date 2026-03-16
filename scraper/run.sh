#!/bin/bash
# Usage : ./run.sh              # tous les cantons (vaud + valais)
#         ./run.sh vaud          # un seul canton
#         ./run.sh valais        # un seul canton
# Installe les deps, lance les spiders par canton, puis le matching.

set -e

CANTONS="${@:-vaud valais}"

echo "=== Installation des dependances ==="
pip install -r requirements.txt
playwright install chromium

for CANTON in $CANTONS; do
    echo ""
    echo "========================================"
    echo "=== Canton : $CANTON ==="
    echo "========================================"

    echo ""
    echo "=== Scraping petitesannonces.ch ($CANTON) ==="
    scrapy crawl petitesannonces -a canton=$CANTON

    echo ""
    echo "=== Scraping agences ($CANTON) ==="
    scrapy crawl agences -a canton=$CANTON
done

echo ""
echo "=== Matching des annonces ==="
python3 matcher.py $CANTONS

echo ""
echo "=== Termine ==="
echo "Fichiers generes par canton :"
for CANTON in $CANTONS; do
    echo "  - petitesannonces_${CANTON}.json  (annonces petitesannonces.ch)"
    echo "  - agences_${CANTON}.json          (annonces agences)"
    echo "  - matched_annonces_${CANTON}.json (correspondances)"
done
