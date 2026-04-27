# TeddyScan Radar

Prototype de site statique pour indexer les moments ou Teddyboy annonce un `scan` / `TeddyScan` dans ses transcripts.

Le repo versionne le site, les scripts d'extraction et les donnees generees, mais pas les transcripts `.srt` bruts.

## Pipeline

```powershell
node .\scripts\build-teddyscan-data.mjs
node .\scripts\audit-teddyscans.mjs
node .\scripts\publish-teddyscans.mjs
```

Le pipeline :

- lit tous les fichiers `.srt` des dossiers `Public/` et `Patreon/` ;
- repere les occurrences autour de `scan` ;
- audite chaque occurrence avec un contexte plus large ;
- fusionne les doublons et produit un dataset canonique pour le site ;
- conserve la source (`public` vs `patreon`) dans les donnees publiees ;
- exporte un vault Obsidian structure.

## Recuperer des liens Patreon

Le collecteur Patreon automatise la connexion, les clics "charger plus" et l'extraction des liens trouves sur une page Patreon.

```powershell
.\scripts\collect-patreon-links.ps1 -Url "https://www.patreon.com/..."
```

Le script demande l'email et le mot de passe localement dans PowerShell, puis lance Playwright via `npx`. Les cookies de session sont gardes dans `.browser-state/patreon` pour eviter de se reconnecter a chaque execution. Les exports sont ecrits dans `patreon_links/` :

Si Patreon est connecte via Google, utilise plutot le mode manuel la premiere fois :

```powershell
.\scripts\collect-patreon-links.ps1 -Url "https://www.patreon.com/..." -ManualLogin
```

Au premier lancement, le script installe Playwright dans `node_modules/` si necessaire. Une fenetre navigateur s'ouvre ensuite : connecte-toi avec Google, puis appuie sur Entree dans PowerShell. La session sera ensuite reutilisee depuis `.browser-state/patreon`.

Si Google refuse la fenetre Chromium de Playwright, lance la meme collecte avec Chrome installe sur ta machine :

```powershell
.\scripts\collect-patreon-links.ps1 -Url "https://www.patreon.com/..." -ManualLogin -UseChrome
```

Si Google affiche "Ce navigateur ou cette application ne sont peut-etre pas securises", utilise la session Chrome normale deja connectee :

1. double-clique `copy-patreon-browser-collector.cmd` ;
2. ouvre la page Patreon dans ton Chrome habituel ;
3. appuie sur `F12`, onglet `Console` ;
4. colle le script et appuie sur `Entree`.

Le collecteur tourne directement dans la page Patreon connectee et telecharge `patreon_video_links.txt`, `patreon_posts.txt` et `patreon_links.json`.

- `video_links.txt` pour les liens YouTube/Vimeo/etc. ;
- `patreon_posts.txt` pour les posts Patreon ;
- `all_links.txt` et `patreon_links.json` pour audit.

Si la session Patreon est deja ouverte dans `.browser-state/patreon`, tu peux aussi lancer directement :

```powershell
npx --yes --package playwright node .\scripts\collect-patreon-links.mjs --url "https://www.patreon.com/..."
```

Ensuite, pour telecharger les transcripts des videos collectees :

```powershell
.\scripts\download-transcripts-from-links.ps1
```

Par defaut, ce script lit `patreon_links/video_links.txt`, utilise les cookies YouTube dans `Downloads\youtube_cookies.txt`, deduplique via `downloaded_ids_fr_orig.txt`, et ecrit les `.srt` dans `Patreon/`.

## Sorties principales

- Site brut : [site/data/teddyscans.json](C:\Users\kano\Documents\Transcripts\site\data\teddyscans.json)
- Audit detaille : [site/data/teddyscan-audit.json](C:\Users\kano\Documents\Transcripts\site\data\teddyscan-audit.json)
- Site canonique : [site/data/teddyscans-curated.json](C:\Users\kano\Documents\Transcripts\site\data\teddyscans-curated.json)
- Vault Obsidian : [obsidian-vault](C:\Users\kano\Documents\Transcripts\obsidian-vault)

## Ouvrir le site

Ouvre simplement [site/index.html](C:\Users\kano\Documents\Transcripts\site\index.html) dans un navigateur.

Le site charge maintenant ses donnees via [site/data/teddyscans-curated.js](C:\Users\kano\Documents\Transcripts\site\data\teddyscans-curated.js), ce qui permet un usage direct sans serveur local.

## Deploiement

Pour un hebergement direct, le plus simple est de publier le dossier `site/` sur Cloudflare Pages.
