# pr-regeln

Die PR-Regeln für alle Repos von wemotion (GitHub-Organisation `wemotion-gmbh` und Bitbucket-Workspace `wemotion-bucket`) an einer Stelle. Die Regeln selbst stehen in [docs/superpowers/specs/2026-11-01-pr-regeln-design.md](docs/superpowers/specs/2026-11-01-pr-regeln-design.md).

## Was hier liegt

- `lib/pr-rules.mjs` – die Regeldatei, ESM ohne Abhängigkeiten, Node ≥ 22. Sie nutzen das Prüfprogramm, der Hook, der Skill `pr-anlegen` und das Team-Cockpit. Typen in `lib/pr-rules.d.ts`.
- `cli.mjs` – das Prüfprogramm.
- Das Claude-Code-Plugin `pr-regeln`: das Repo ist zugleich das Plugin-Verzeichnis (`.claude-plugin/plugin.json`, `hooks/`, `skills/`, `scripts/`).
- `scripts/convert-open-prs.mjs` – der Umstellungslauf für die offenen PRs (Abschnitt 6.3 der Regeln), siehe unten.

## Die Regeln in Kürze

- **Bereit** heißt: kein Entwurf. Kein Label ✅, kein Kommentar „bereit“.
- **Kopfzeilen** ganz oben im PR-Text, in Spalte 0: `Paired-with: <repo> <https-Link>`, `Braucht: <repo>#<nr>`, `Merge-Stopp: <Grund>`, `Nach dem Merge: <Schritt>`. Jeder Stopp steht als `Merge-Stopp:`-Zeile, nie nur im Text. Fehlt die Zeile, gilt nichts; „keiner“ oder „-“ ist ein Fehler.
- **Branch-Namen** `<art>/<thema>` mit den Arten `feat`, `fix`, `hotfix`, `chore`, `refactor`, `docs`, `test`, `part`, `release`, `revert`. Feste Branches (`main`, `master`, `beta`, `live`), Bot-PRs und Branches des Revert-Knopfs sind immer erlaubt.
- **Art-Labels** (nur GitHub) setzt die KI aus der Branch-Art: `hotfix` 🚑 Hotfix, `part` 🧩 Teilschritt, `revert` ⏪ Rücksetzen, `chore`/`refactor`/`docs`/`test` 🔧 Wartung, sonst keins.
- **Migrationen, die Daten löschen** (hinzugefügte Zeile außerhalb von `down()` einer Datei in einem Ordner `database/migrations/`): auf GitHub rot, bis `🔑 Marcs Ja` dran ist; auf Bitbucket eine Warnung und eine `Merge-Stopp:`-Zeile. Diese Regel gilt immer und für alle PRs.

## Stichtage

`CUTOFFS` in `lib/pr-rules.mjs` hat `T0`, `T1` und `T2`. Solange sie `null` sind, ist kein PR „neu“: Die Prüfung ist bis auf die Migrationsregel grün mit Hinweisen, und der Hook verweigert nie. Ab `T1` sind die Funde neuer PRs Fehler, und der Hook verweigert neue PRs mit falschem Branch-Namen oder Text. Ab `T2` zählt auch bei alten PRs nur noch „kein Entwurf“, und Labels, freier Text und Kommentare zählen nicht mehr als Stopp.

Seit Version 1.2.0 sind alle drei gesetzt, auf denselben Zeitpunkt: **02.11.2026 15:00 Berlin** (`2026-11-02T14:00:00Z`). Ein PR, der ab dann angelegt wird, muss die Regeln erfüllen. Ältere PRs fallen nie durch, ihre Funde bleiben Hinweise, bis auf die Migrationsregel.

## Prüfprogramm

```
npx --yes github:wemotion-gmbh/pr-regeln#v1 check <PR-URL> [--mark-migration] [--json]
```

- Liest einen PR von GitHub (über `gh`) oder Bitbucket (über `BITBUCKET_USER` und `BITBUCKET_API_TOKEN`; unter Windows auch aus der Benutzerumgebung) und gibt das Ergebnis auf Deutsch aus. Zugangsdaten gibt es nie aus.
- `--mark-migration` setzt auf GitHub `🔑 Marcs Ja fehlt`, wenn eine löschende Migration da ist und keins der beiden 🔑-Labels dran ist, und nimmt es ab, wenn `🔑 Marcs Ja` dazugekommen ist. `🔑 Marcs Ja` setzt es nie.
- `--json` gibt das Ergebnis als JSON aus.
- Exit 0 bei Grün, 1 bei Fehlern, 2 bei falschem Aufruf, fehlendem Zugriff oder wenn ein Label nicht gesetzt werden konnte.
- Einen Status an den PR schreibt es nicht.

## Plugin

Eingetragen im Marketplace [claude-plugins](https://github.com/wemotion-gmbh/claude-plugins):

```
/plugin install pr-regeln@wemotion
```

- **Hook** (PreToolUse auf `Bash|PowerShell` und auf die MCP-Werkzeuge zum Anlegen und Ändern von PRs). Er prüft neue Branches, den Push neuer Branches, `gh pr create` und `gh pr edit`, PR-Aufrufe direkt über die API von GitHub und Bitbucket und die MCP-Werkzeuge. Text in Heredocs, Here-Strings, `echo` und `grep` lässt er aus; was er nicht sicher lesen kann, lässt er durch. Verweigern kann er nur das Anlegen eines PRs, und nur ab `T1` und in einem Repo von `wemotion-gmbh` oder `wemotion-bucket` (aus `--repo`, der API-Adresse, dem MCP-Aufruf oder dem Remote `origin`). Neue Branches, Pushes und Änderungen an PRs bekommen nur einen Hinweis, damit Sitzungs-Branches wie `claude/…` gepusht werden können; `pr-anlegen` benennt sie vor dem PR um. In fremden Repos sagt er nichts. „Erlauben“ gibt er nie aus, und fällt er aus, läuft der Befehl weiter. Treffer zählt er in `${CLAUDE_PLUGIN_DATA}/hits.json`.
- **Skill `pr-anlegen`** mit dem Skript `scripts/create-pr.mjs` (`create`, `update`, `ready`). Er schreibt die Kopfzeilen, setzt das Art-Label, erkennt löschende Migrationen, prüft den PR und legt bei Rot nichts an. Aufruf und Optionen stehen in [skills/pr-anlegen/SKILL.md](skills/pr-anlegen/SKILL.md).

## Umstellungslauf

```
node scripts/convert-open-prs.mjs plan --out <datei.json> --owner-bitbucket <Anzeigename> [--owner-github <login>] [--md <datei.md>]
node scripts/convert-open-prs.mjs apply --plan <datei.json> --yes
```

- `plan` liest alle offenen PRs der GitHub-Organisation und des Bitbucket-Workspace und ändert nichts. Je PR schlägt es Stopp-Zeilen aus Text, Labels und Kommentaren vor, `Braucht:`- und `Paired-with:`-Zeilen, das Entfernen von 🚧, die Rückkehr zum Entwurf und veraltete PRs. Jeder Vorschlag hat ein Feld `decision`, das die Sitzung je PR füllt.
- `apply` führt nur entschiedene Einträge aus, je PR in fester Reihenfolge: Kopfzeilen, dann 🚧 entfernen, dann Entwurf mit Kommentar. Hat sich auch nur ein PR mit Arbeit seit dem Plan bewegt (Head, Text, Entwurf oder Labels), ändert es nichts; dann neu planen. Ohne `--yes` endet es mit Exit 2.
- Ein `repo#n` im Text zählt für den PR, der auf einer der beiden Plattformen offen ist; zuerst auf der, zu der der Repo-Name gehört.
- Der Plan enthält ganze PR-Texte und Kommentare, auch aus privaten Repos. Plan-Dateien deshalb außerhalb dieses Klons ablegen, nie hier einchecken.
- Die PRs des Lauf-Inhabers (`--owner-bitbucket`, `--owner-github`) gehen nicht auf Entwurf.

## Versionen

Git-Tags `v1.0.0` … und ein mitlaufender Tag `v1`. Die Version steht in `package.json` und `.claude-plugin/plugin.json` und wird bei jeder Änderung hochgezählt. Das Cockpit, der Marketplace-Eintrag und pr-pruefen pinnen auf einen Tag.

## Entwicklung

```
npm test
```

Tests nur mit erfundenen Beispielen. Texte aus privaten Repos kommen nicht in dieses Repo.
