---
name: pr-anlegen
description: Verwenden, sobald ein Pull Request angelegt, geöffnet oder geändert werden soll („leg einen PR an“, „PR öffnen“, „mach einen PR“, „PR-Text anpassen“), auch für Release-PRs (release/* → main, beta → live), die Rückführung live → beta und wenn ein Entwurf als fertig gemeldet wird. Legt PRs auf GitHub und Bitbucket nach den PR-Regeln an – Kopfzeilen oben, Art-Label, Entwurf oder fertig, löschende Migrationen – und legt nichts an, wenn die Prüfung rot ist.
---

# PR anlegen nach den PR-Regeln

Das Skript liegt zwei Ordner über diesem Skill: `<Basisordner>/../../scripts/create-pr.mjs`. Den Basisordner nennt
die Zeile „Base directory for this skill“ oben. `${CLAUDE_PLUGIN_ROOT}` gibt es in Bash- und PowerShell-Befehlen
nicht. PRs nie mit `gh pr create`, `gh api` oder einem eigenen REST-Aufruf anlegen.

## Ablauf

1. **Branch.** Er heißt `<art>/<thema>`. Arten: `feat`, `fix`, `hotfix`, `chore`, `refactor`, `docs`, `test`, `part`,
   `release`, `revert`. Das Thema ist klein geschrieben, mit `a-z`, `0-9`, `-`, `.` und `/`. Gleiches Thema in API und
   Hub heißt gleich. Ein `claude/…`-Branch braucht `--rename-to <art>/<thema>`; das Skript benennt ihn um und pusht ihn
   unter dem neuen Namen.
2. **Text in eine Datei.** Schreib den PR-Text mit dem Write-Werkzeug in eine Datei im Scratchpad, nie in den Befehl:

   ```markdown
   ## Abhängigkeiten und Reihenfolge
   Keine. (oder: was vorher oder zusammen gemergt werden muss)

   ## Worum es geht
   …

   ## Bitte testen
   …
   ```

   Kopfzeilen gehören nicht in die Datei, sondern als Optionen in den Aufruf (Punkt 4). Stehen sie doch oben in der
   Datei, übernimmt das Skript sie.
3. **Fertig oder Entwurf.** `--ready`, wenn die Arbeit fertig ist; sonst `--draft`. Einen Standard gibt es nicht.
   „Bereit“ heißt nur: kein Entwurf. Kein Label ✅, kein Kommentar „bereit“.
4. **Kopfzeilen als Optionen:**
   - `--stop "<Grund>"`: nicht mergen, bis die Zeile entfernt ist. Jeder Stopp gehört hierher, nie nur in den Text.
     Nie „keiner“ oder „-“ schreiben: Fehlt die Zeile, gilt nichts.
   - `--needs <repo>#<nr>`: Dieser PR braucht einen anderen, der zuerst gemergt sein muss. Repo ohne Besitzer
     (`fusion-api-v3#412`), eine Option je PR.
   - `--paired-with <repo> <url>`: Gegenstück in einem anderen Repo, **nur** wenn die Branch-Namen verschieden sind.
   - `--after "<Schritt>"`: was nach dem Merge zu tun ist, nur zur Information.
5. **Aufrufen:**

   ```
   node "<Basisordner>/../../scripts/create-pr.mjs" create --repo-dir <repo> --base <ziel> --title "<Titel>" --body-file <datei> --ready
   ```

   Das Skript pusht den Branch (nie `main`, `master`, `beta`, `live`; auf diese Namen benennt `--rename-to` auch nicht
   um), setzt auf GitHub das Art-Label, erkennt löschende Migrationen (`database/migrations/` in jeder Tiefe) und
   prüft den PR. Ist die Prüfung rot, legt es nichts an und nennt jeden Fehler mit Abhilfe
   (Exit 1). Dann die Abhilfe umsetzen und neu aufrufen. Mit `--dry-run` zeigt es Text, Labels und Funde, ohne
   etwas anzulegen.
6. **Ausgabe.** In der letzten Zeile steht die PR-Adresse, davor stehen Hinweise. Hinweise blockieren nicht. Behebe
   sie trotzdem, wenn es geht.

## Release- und Rückführungs-PRs

- Hub: `release/<name>` → `main` vom ausgecheckten Release-Branch aus.
- fusion-api-v3: `--head beta --base live`; Rückführung `--head live --base beta`. Feste Branches pusht das Skript nie.
- Die Kopfzeilen der enthaltenen PRs nicht in den Text kopieren: Weiter unten sind sie ein Fehler (K1). Was für den
  Release noch gilt, kommt als eigene Option in den Aufruf (`--stop`, `--needs`).

## Migrationen, die Daten löschen

- GitHub: Das Skript setzt das Label `🔑 Marcs Ja fehlt`. `🔑 Marcs Ja` setzt die KI nur nach Marcs Ja im Cockpit.
- Bitbucket: Das Skript schreibt `Merge-Stopp: Marcs Ja fehlt (Migration löscht Daten)`. Die Merge-KI entfernt die
  Zeile nach Marcs Ja und hält das Ja als Kommentar mit dem Head fest.

## Ändern und fertig melden

- `update --repo-dir <repo> --number <nr> --body-file <datei>` schreibt Text und Kopfzeilen eines offenen PRs neu.
  Jeder Stopp, der schon am PR steht, bleibt, auch eine fette, eingerückte oder leere `Merge-Stopp:`-Zeile weiter
  unten. Hat der alte Text keine Zeile, aber einen Satz wie „nicht mergen“, wird daraus
  `Merge-Stopp: <Satz> (übernommen aus dem Text)`. Einen Stopp aufheben: `--remove-stop "<Grund>"` mit genau dem Text
  nach dem Doppelpunkt, eine leere Zeile mit `--remove-stop ""`. Was entfernt würde, zeigt `--dry-run`.
- `Braucht:`- und `Paired-with:`-Zeilen übernimmt `update` nicht von selbst: Gib sie wieder als Option an, oder lass
  sie oben in der Textdatei stehen. Mit `--ready` oder `--draft` ändert sich auch der Entwurfsstatus.
- `ready --repo-dir <repo> --number <nr>` nimmt einen PR aus dem Entwurf, wenn die Prüfung keine Fehler hat.
