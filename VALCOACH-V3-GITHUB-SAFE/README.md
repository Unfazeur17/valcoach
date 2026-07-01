# VALCOACH V3

Application locale de coaching Valorant.

## Lancer

```powershell
cd "D:\OneDrive\FILENAMELESS\5_Streaming\APP coachVAL\V3"
copy .env.example .env
node server.js
```

Puis ouvrir :

```text
http://localhost:3000
```

## Rank actuel

Le serveur lit :

```text
https://valorantrank.chat/eu/Unfazeur/euw?onlyRank=true&mmrChange=true
```

et renvoie les infos a l'app via `/api/rank`.

## Tracker.gg

Ajoute ta cle API dans `.env` :

```env
TRACKER_API_KEY=
```

Puis relance `node server.js`.

L'app appelle ensuite `/api/tracker`. Si l'API Tracker bloque ou si la cle n'est pas configuree, VALCOACH continue avec tes donnees locales.

## Riot Developer API

Ajoute ta cle Riot dans `.env` :

```env
RIOT_API_KEY=
```

Important : si une cle a ete collee dans un chat ou un endroit public, regenere-la sur le portail Riot avant de l'utiliser.

Endpoints ajoutes :

```text
/api/riot/account
/api/riot/matches?limit=5
```

L'API Riot officielle donne le compte, le PUUID et les matchs. Le rank/RR exact reste gere via `/api/rank`, car Riot ne fournit pas un endpoint public simple equivalent au rank actuel affiche par Tracker.gg pour tous les rangs.

