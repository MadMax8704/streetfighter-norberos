# Ragdoll Masters – ranglista (Netlify)

Statikus játék + egyetlen Netlify Function, ami a **Netlify Blobs**-ban tárolja a
közös ranglistát. Nincs külön adatbázis-szolgáltató, nincs API-kulcs a kliensben,
és nincs build lépés.

## Fájlok

| Fájl | Mi ez |
|---|---|
| `public/index.html` | A játék (ezt látják a látogatók). **Ez a valódi fájl** – ezt szerkeszd. |
| `netlify/functions/scores.mjs` | A ranglista API: `GET /api/scores` (top 10), `POST /api/scores` (beküldés). |
| `netlify.toml` | Kimeneti mappa + függvénykönyvtár beállítása. |
| `package.json` | Egyetlen függőség: `@netlify/blobs`. |

## Telepítés / deploy

```bash
npm install -g netlify-cli     # ha még nincs
cd ragdoll-site
npm install                    # a @netlify/blobs miatt egyszer kell
netlify login
netlify link                   # a meglévő site-od kiválasztása
netlify deploy --prod
```

A `netlify.toml` miatt a `--dir` kapcsoló nem kell: a `public/` megy ki, a
`netlify/functions/` pedig automatikusan függvényként deployolódik.

> **Fontos:** a Netlify UI-ba történő drag & drop feltöltés **nem** visz fel
> Function-t. Utána a játék ugyan elindul, de a ranglista a tábla alatt azt írja
> majd: „Local only" – ilyenkor CLI-vel vagy Git-alapú deployjal kell telepíteni.

Git-alapú deploynál a repo gyökere ez a mappa legyen (build command nélkül),
a `publish` és a functions könyvtár a `netlify.toml`-ból jön.

## Helyi próba

```bash
netlify dev
```

Ez a `http://localhost:8888` címen kiszolgálja a játékot, és a Blobs-ot is
emulálja, tehát a ranglista helyben is működik.

Ha csak a HTML-t nyitod meg közvetlenül (`file://`), a fetch nem talál
végpontot, ezért a játék automatikusan localStorage-ba ment, és a tábla alatt
jelzi, hogy csak helyi eredmény látszik.

## Az API

**`GET /api/scores`** → a legjobb 10 eredmény

```json
{ "scores": [ { "name": "ZOLTAN", "score": 12345, "wave": 7, "time": 132, "ts": 1789548439103 } ],
  "source": "global" }
```

**`POST /api/scores`** – beküldés

```json
{ "name": "Zoltan", "score": 12345, "wave": 7, "time": 132 }
```

A szerver a nevét megtisztítja és 12 karakterre vágja, a pontszámot 0 és
1 000 000 000 közé szorítja, a `ts`-t pedig maga állítja be (a kliens nem
hamisíthatja az időbélyeget). A válasz ugyanaz, mint a GET-nél, plusz a
létrehozott `entry` és a `rank`.

## Amit a szerver véd

- **Név:** HTML/karakter tisztítás (nincs XSS a táblában), max 12 karakter.
- **Pontszám:** típus- és tartomány-ellenőrzés; értelmezhetetlen pontszám → `400`.
- **Kérésméret:** max 2 KB.
- **Rate limit:** IP-nként 6 beküldés / perc (best-effort, a meleg példányon
  belül – a durva spam ellen jó; ha ez kevés, később rá lehet tenni egy
  Netlify rate limit szabályt is).
- **Párhuzamos írás:** a lista írása ETag-ellenőrzéssel történik
  (`onlyIfMatch`), ütközésnél újrapróbálja – két egyszerre beérkező eredmény
  nem írja felül egymást.

A tárolt lista 60 bejegyzésre van vágva, a kliensnek ebből a legjobb 10 megy ki.

## Szerkesztés

A játék forrása a `public/index.html` (egy fájl, benne a CSS és a JS). Ha a
munkaterületen a `ragdoll3.html` útvonalon nyitod meg, az egy symlink ide:
mindig ugyanazt a fájlt írod.

A `ragdoll3.original.html` a ranglista beépítése előtti állapot, ha vissza
akarnál állni.

## Fejlesztés

Ez a projekt lokális LLM-asszisztenssel készült: **Qwen3.8** modell,
**RTX 3090**-en futtatva – nincs felhő, nincs API-kulcs.

Fejlesztő: **Norbertos**
