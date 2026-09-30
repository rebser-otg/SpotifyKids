# SpotifyKids

Kinderfreundlicher Spotify-Player für Hörspiele: ein Album verhält sich wie
ein einziger langer Titel, mit einer durchgehenden Zeitleiste.

Läuft am Laptop in Chrome, Firefox oder Edge. Braucht Spotify Premium.

## Einrichtung (einmalig, Eltern)

1. Auf <https://developer.spotify.com/dashboard> eine App anlegen.
   - APIs: **Web API** und **Web Playback SDK**
   - Redirect URIs: `http://127.0.0.1:8888/` und `https://rebser-otg.github.io/SpotifyKids/`
2. Unter **User Management** die Spotify-Konten der Kinder eintragen (max. 5).
3. Die **Client ID** in `auth.js` bei `CLIENT_ID` eintragen (für dieses Repo schon erledigt).
4. Eine Playlist anlegen (sie muss dir gehören) und Folgen hineinlegen.
   Ein Titel reicht: das ganze Album erscheint.
5. App öffnen → „Mit Spotify verbinden“ → Playlist-Link einfügen → Speichern.
   Einstellungen später: **Zahnrad 3 Sekunden gedrückt halten**.

## Lokal starten

```sh
python3 -m http.server 8888 --bind 127.0.0.1
```

Dann <http://127.0.0.1:8888/> öffnen (nicht `localhost`).

## Tests

```sh
node --test
```

## Test-Checkliste (mit echtem Premium-Konto)

- [ ] Verbinden → Spotify-Login → zurück in der App, Einstellungen öffnen sich
- [ ] Fremder Playlist-Link → Meldung „Die Playlist muss dir gehören …“
- [ ] Eigener Playlist-Link → Cover-Wand mit allen Alben (jedes nur einmal)
- [ ] Suche filtert nach Albumname und Künstler
- [ ] Album öffnen → spielt ab; Zeitleiste zeigt Gesamtzeit des Albums
- [ ] ⏪30 / 30⏩ über eine Titelgrenze hinweg → spielt ohne Sprung weiter
- [ ] ⏮ mitten im Titel → Titelanfang; nochmal innerhalb 3 s → voriger Titel
- [ ] Zeitleiste ziehen → springt an die Stelle, auch in einen anderen Titel
- [ ] ← zurück → Musik pausiert, Fortschrittsbalken unter dem Cover
- [ ] Album wieder öffnen → macht an der gespeicherten Stelle weiter
- [ ] Seite neu laden, Album öffnen → Stelle ist noch gespeichert
- [ ] ⏭ auf dem letzten Titel → pausiert, ✓ auf der Cover-Wand, Neustart bei 0
- [ ] ↺ Von vorne → Anfang des Albums
- [ ] Nach einer Stunde (Token läuft ab) funktionieren die Knöpfe noch
- [ ] Zahnrad kurz antippen → nichts; 3 s halten → Einstellungen
