# TeddyScan Radar

Prototype de site statique pour indexer les moments où Teddyboy annonce un `scan` / `TeddyScan` dans ses transcripts.

Le repo versionne le site, le script d'extraction et les données générées, mais pas les transcripts `.srt` bruts.

## Générer les données

```powershell
node .\scripts\build-teddyscan-data.mjs
```

Le script :

- lit tous les fichiers `.srt` du dossier ;
- repère les occurrences autour de `scan` ;
- filtre quelques faux positifs évidents ;
- génère les sorties dans [site/data](C:\Users\kano\Documents\Transcripts\site\data).

## Ouvrir le site

Ouvre simplement [site/index.html](C:\Users\kano\Documents\Transcripts\site\index.html) dans un navigateur.

Le site charge ses données via [site/data/teddyscans.js](C:\Users\kano\Documents\Transcripts\site\data\teddyscans.js), ce qui permet un usage direct sans serveur local.

## Déploiement

Pour un hébergement direct, le plus simple est de publier le dossier `site/` sur Cloudflare Pages.
