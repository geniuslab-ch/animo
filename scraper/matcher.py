#!/usr/bin/env python3
"""
Croise les annonces de petitesannonces.ch avec celles des agences
pour detecter les doublons / correspondances.

Usage :
    python matcher.py                  # tous les cantons actifs
    python matcher.py vaud             # un canton specifique
    python matcher.py vaud valais      # plusieurs cantons

Prerequis : petitesannonces_{canton}.json et agences_{canton}.json doivent exister
(generes par les spiders petitesannonces et agences).

Sortie : matched_annonces_{canton}.json par canton
"""

import json
import sys
from pathlib import Path

from cantons import DEFAULT_CANTONS

# ── Seuils de correspondance ─────────────────────────────────────────────────
PRICE_TOLERANCE = 0.05   # 5 % d'ecart tolere
SURFACE_TOLERANCE = 5    # m² d'ecart tolere
ROOMS_TOLERANCE = 0.5    # demi-piece d'ecart toleree
MATCH_THRESHOLD = 0.50   # 50 % de correspondance minimum


def load_json(path: str) -> list[dict]:
    p = Path(path)
    if not p.exists():
        print(f"Fichier introuvable : {path}")
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def normalize_location(loc: str | None) -> str:
    """Normalise une localisation pour comparaison."""
    if not loc:
        return ""
    # Retirer le NPA, garder le nom de ville en minuscule
    parts = loc.strip().split()
    # Si le premier token est un NPA (4 chiffres), le retirer
    if parts and parts[0].isdigit() and len(parts[0]) == 4:
        parts = parts[1:]
    return " ".join(parts).lower().strip()


def price_match(p1: int | None, p2: int | None) -> bool:
    if p1 is None or p2 is None:
        return False
    if p1 == 0 or p2 == 0:
        return False
    ratio = abs(p1 - p2) / max(p1, p2)
    return ratio <= PRICE_TOLERANCE


def surface_match(s1: int | None, s2: int | None) -> bool:
    if s1 is None or s2 is None:
        return False
    return abs(s1 - s2) <= SURFACE_TOLERANCE


def rooms_match(r1: float | None, r2: float | None) -> bool:
    if r1 is None or r2 is None:
        return False
    return abs(r1 - r2) <= ROOMS_TOLERANCE


def location_match(l1: str | None, l2: str | None) -> bool:
    n1 = normalize_location(l1)
    n2 = normalize_location(l2)
    if not n1 or not n2:
        return False
    # Match exact ou inclusion
    return n1 == n2 or n1 in n2 or n2 in n1


def compute_score(pa: dict, ag: dict) -> float:
    """
    Score de correspondance entre 0 et 1.
    Poids : localisation (0.35) + prix (0.30) + surface (0.20) + pieces (0.15)
    """
    score = 0.0

    if location_match(pa.get("localisation"), ag.get("localisation")):
        score += 0.35

    if price_match(pa.get("prix"), ag.get("prix")):
        score += 0.30

    if surface_match(pa.get("surface_m2"), ag.get("surface_m2")):
        score += 0.20

    if rooms_match(pa.get("pieces"), ag.get("pieces")):
        score += 0.15

    return round(score, 2)


def match_annonces(pa_data: list[dict], ag_data: list[dict], seuil: float = MATCH_THRESHOLD):
    """
    Pour chaque annonce petitesannonces.ch, trouve les meilleures
    correspondances parmi les annonces d'agences.
    Seuil minimum : 50 % (localisation compte pour 35 %).
    """
    results = []

    for pa in pa_data:
        matches = []
        for ag in ag_data:
            score = compute_score(pa, ag)
            if score >= seuil:
                matches.append({
                    "agence_url": ag.get("url"),
                    "agence": ag.get("agence", ""),
                    "agence_prix": ag.get("prix"),
                    "agence_pieces": ag.get("pieces"),
                    "agence_surface_m2": ag.get("surface_m2"),
                    "agence_localisation": ag.get("localisation"),
                    "score": score,
                })

        matches.sort(key=lambda m: m["score"], reverse=True)

        entry = {
            "petitesannonces_url": pa.get("url"),
            "titre": pa.get("titre"),
            "prix": pa.get("prix"),
            "pieces": pa.get("pieces"),
            "surface_m2": pa.get("surface_m2"),
            "localisation": pa.get("localisation"),
            "image_url": pa.get("image_url"),
            "canton": pa.get("canton", ""),
            "nb_matches": len(matches),
            "matches": matches[:5],  # Top 5
        }
        results.append(entry)

    # Trier : annonces avec le plus de matches en premier
    results.sort(key=lambda r: (r["nb_matches"], r["matches"][0]["score"] if r["matches"] else 0), reverse=True)
    return results


def process_canton(canton: str):
    """Traite le matching pour un canton donne."""
    pa_file = f"petitesannonces_{canton}.json"
    ag_file = f"agences_{canton}.json"
    out_file = f"matched_annonces_{canton}.json"

    print(f"\n{'=' * 60}")
    print(f"Canton : {canton.upper()}")
    print(f"{'=' * 60}")

    pa_data = load_json(pa_file)
    ag_data = load_json(ag_file)

    if not pa_data:
        print(f"  Aucune annonce petitesannonces pour {canton}, skipping.")
        return
    if not ag_data:
        print(f"  Aucune annonce agence pour {canton}, skipping.")
        return

    print(f"  petitesannonces.ch : {len(pa_data)} annonces")
    print(f"  agences            : {len(ag_data)} annonces")

    print(f"\n  Recherche des correspondances (seuil >= {MATCH_THRESHOLD:.0%})...")
    results = match_annonces(pa_data, ag_data)

    matched = [r for r in results if r["nb_matches"] > 0]
    unmatched = [r for r in results if r["nb_matches"] == 0]

    print(f"\n  Resultats :")
    print(f"    {len(matched)} annonces avec correspondance(s) agence")
    print(f"    {len(unmatched)} annonces sans correspondance")

    # Afficher un resume des meilleurs matches
    if matched:
        print(f"\n  Top correspondances :")
        for r in matched[:10]:
            best = r["matches"][0]
            print(
                f"    [{best['score']:.0%}] {r.get('localisation', '?')} "
                f"| {r.get('prix', '?')} CHF "
                f"| {r.get('pieces', '?')} pcs "
                f"| {r.get('surface_m2', '?')} m2 "
                f"-> {best['agence']}"
            )

    # Sauvegarder
    output = Path(out_file)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n  Fichier sauvegarde : {output}")


def main():
    # Determiner les cantons a traiter
    if len(sys.argv) > 1:
        cantons = [c.lower().strip() for c in sys.argv[1:]]
    else:
        cantons = DEFAULT_CANTONS

    print(f"Cantons a traiter : {', '.join(c.upper() for c in cantons)}")
    print(f"Seuil de correspondance : {MATCH_THRESHOLD:.0%}")

    for canton in cantons:
        process_canton(canton)

    print(f"\n{'=' * 60}")
    print("Termine.")


if __name__ == "__main__":
    main()
