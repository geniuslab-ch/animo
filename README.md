# 🇨🇭 Analyste d'Annonces Anibis

Outil d'analyse d'annonces immobilières pour le marché suisse (Canton de Vaud), propulsé par l'API Claude d'Anthropic.

## Fonctionnalités

- **Diagnostic en 3 points** : identifie les freins à la vente selon les codes du marché vaudois
- **Message prêt à envoyer** : rédige automatiquement un message poli en français formel (vouvoiement)
- **Critères suisses** : CECB, charges PPE, précision technique, psychologie de l'acheteur romand

## Structure du projet

```
anibis-analyzer/
├── index.html     # Structure HTML
├── style.css      # Styles (esthétique suisse)
├── app.js         # Logique et appel API Claude
└── README.md
```

## Déploiement rapide

### GitHub Pages (recommandé)

1. **Forkez** ce dépôt ou créez un nouveau repo GitHub
2. Uploadez les 3 fichiers (`index.html`, `style.css`, `app.js`)
3. Allez dans **Settings → Pages → Source : Deploy from branch → main**
4. Votre site sera disponible à `https://votre-pseudo.github.io/anibis-analyzer/`

> ⚠️ **Important** : Avant de déployer, ajoutez votre clé API (voir ci-dessous).

### Clé API Anthropic

Ouvrez `app.js` et remplacez :

```js
const API_KEY = "VOTRE_CLE_API_ICI";
```

par votre clé depuis [console.anthropic.com](https://console.anthropic.com).

> 🔒 **Sécurité** : Pour un usage personnel uniquement, exposer la clé côté client est acceptable. Pour une mise en production publique, utilisez un backend proxy (voir section avancée ci-dessous).

## Usage en local

Aucun build nécessaire. Ouvrez simplement `index.html` dans votre navigateur.

> Note : L'appel API peut être bloqué par CORS en local. Utilisez une extension comme "Live Server" dans VS Code, ou déployez directement sur GitHub Pages.

## Sécurité avancée (production publique)

Pour protéger votre clé API en production, créez un proxy backend simple (ex. Cloudflare Worker) :

```js
// Cloudflare Worker (proxy)
export default {
  async fetch(request) {
    const body = await request.json();
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY, // variable d'environnement
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    return resp;
  }
};
```

Puis dans `app.js`, remplacez l'URL par celle de votre Worker.

## Technologies

- HTML / CSS / JavaScript vanilla
- [API Claude](https://docs.anthropic.com) — modèle `claude-sonnet-4`
- [Google Fonts](https://fonts.google.com) — Playfair Display, Source Sans 3, Courier Prime
- Hébergement : GitHub Pages (statique, gratuit)

## Licence

MIT — libre d'utilisation et de modification.
