# PR-Regeln für alle Repos – Spezifikation

**Stand 01.11.2026, freigegeben von Marc am 01.11. um 16:28 (E389 A).** Eingearbeitet sind seine Antworten auf E387 (die einfachste Variante C: keine sichtbare Prüfung in GitHub, also kein zentraler Lauf und keine GitHub-App) und E388 A (Bitten erst nach Alex' Antwort). Ein Bauender hat die Spezifikation einmal gegengelesen; seine Rückfragen stehen in Abschnitt 9. Grundlage sind Marcs Entscheidungen im Cockpit: E297–E305 (Thema „PR-Regeln: einheitlich und durchgesetzt“, 01.11. 01:23–01:33) und E325–E331 (Thema „PR-Regeln: was die Prüfung der Technik ergeben hat“, 01.11. 11:28–11:37). Dazu kommt die Bestandsaufnahme vom 01.11. nachts: 139 offene PRs, Hooks, Cockpit-Code und KB. Teile, die an Alex' Antwort auf die Bitte 75ecd8cf hängen, sind mit **⚠ Alex** markiert.

## 1. Worum es geht

Jeder markiert PRs anders. Von 82 offenen PRs nutzte keiner die festen Zeilen. „Bereit“ kann einen von drei Wegen bedeuten, Stopps stehen als Label, im Text oder in Kommentaren. Darum ist der Release-Weg im Cockpit schwer zu lesen, und die Merge-KI muss raten. Ein übersehener Stopp ist der teure Fehler.

Künftig gelten für alle Repos der GitHub-Organisation `wemotion-gmbh` und des Bitbucket-Workspace `wemotion-bucket` dieselben Regeln. Sie stehen in **einer** Regeldatei, und vier Stellen nutzen sie: das Prüfprogramm, der Hook in Claude Code, der Skill `pr-anlegen` und das Cockpit (E331). Fast alle PRs legt die KI an (Marc zu E299: „alle unsere Pull Requests legen mittlerweile KI an“). Darum zielt die Durchsetzung vor allem auf die KI-Sitzungen.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**
- Jeder neue PR trägt Stopp und Abhängigkeiten in derselben Form oben im Text. Merge-KI und Cockpit lesen sie ohne Raten.
- „Bereit“ heißt überall dasselbe: kein Entwurf (E297).
- Branch-Namen und Art-Labels stimmen in allen Repos, ohne dass jemand daran denken muss (E299, E300).
- Für Migrationen, die Daten löschen, ist Marcs Ja auf dem PR sichtbar, und ohne dieses Ja wird nicht gemergt (E327).
- Offene PRs werden einmal zentral in die sichere Richtung umgestellt (E330). Nichts geht dabei verloren.

**Nicht-Ziele**
- Kein Tarifwechsel: GitHub bleibt Free (E325 B), Bitbucket bleibt beim jetzigen Plan (E326 A). Wer in GitHub selbst auf „Merge“ klickt, wird nicht aufgehalten.
- Kein Umbenennen offener Branches. Auf GitHub schließt ein Umbenennen den PR, Bitbucket kann gar nicht umbenennen.
- Das Cockpit beobachtet keine neuen Repos. Es zeigt die Regeln für die Repos, die es heute schon beobachtet (siehe 4.4).
- Keine Regeln für PR-Titel, Commit-Nachrichten oder den Aufbau des PR-Texts unterhalb der Kopfzeilen, außer den in 3.2 genannten Abschnitten.

**Anti-Ziele** (wäre ein Fehlschlag, auch wenn es technisch läuft)
- Ein Stopp, der heute sichtbar ist, wird durch die Umstellung unsichtbar.
- Ein offener PR wird durch die neue Bedeutung von „bereit“ plötzlich mergebar, obwohl sein Autor nie „fertig“ gesagt hat.
- Der Hook blockiert normale Shell-Arbeit, weil er einen Befehl falsch liest.
- Die KI setzt „🔑 Marcs Ja“ ohne Marcs Ja.

## 3. Die Regeln

### 3.1 „Bereit“ (E297)
Ein PR ist bereit, wenn er kein Entwurf ist. Das gilt gleich auf GitHub und Bitbucket. Wer noch nicht fertig ist, legt den PR als Entwurf an. Das Label ✅ und der Kommentar „bereit“ zählen nicht mehr. Für PRs von vor dem Stichtag T2 gilt die Übergangsregel in 3.7.

### 3.2 Kopfzeilen (E298)
Stopp und Abhängigkeiten stehen nur als Kopfzeilen ganz oben im PR-Text.

**Der Kopfblock** sind die Zeilen ab Zeile 1, solange jede mit einem dieser Schlüssel beginnt, in Spalte 0:

| Schlüssel | Form | Bedeutung |
|---|---|---|
| `Paired-with:` | `Paired-with: <repo> <https-Link>` | Gegenstück in einem anderen Repo, **nur** wenn die Branch-Namen verschieden sind |
| `Braucht:` | `Braucht: <repo>#<nr>`, danach optional ein Satzzeichen (`,` `;` `:` `.`), ein Leerzeichen und Freitext ohne weiteren Verweis | Der genannte PR muss gemergt sein. Eine Zeile je Abhängigkeit |
| `Merge-Stopp:` | `Merge-Stopp: <Grund>` | Nicht mergen, bis die Zeile entfernt ist. Mehrere Zeilen sind erlaubt, eine je Grund |
| `Nach dem Merge:` | `Nach dem Merge: <Schritt>` | Nur zur Information (z. B. KB-Seite speichern). Wird nicht ausgewertet |

Der Kopfblock endet an der ersten Zeile, die mit keinem Schlüssel beginnt, meist an einer Leerzeile. Die Reihenfolge innerhalb des Blocks ist frei; `pr-anlegen` schreibt sie in der Reihenfolge der Tabelle. `<repo>` ist der Repo-Name ohne Besitzer (`fusion-api-v3`, `canou-hub`). Welche Plattform gemeint ist, legt die Regeldatei fest: `canou-hub` und die anderen Bitbucket-Repos meinen Bitbucket, alles andere GitHub. Der eingefrorene Bitbucket-`fusion-api-v3` und der GitHub-Spiegel `canou-hub` sind nicht gemeint.

Nach dem Kopfblock folgen eine Leerzeile, dann `## Abhängigkeiten und Reihenfolge` (englisch `## Dependencies and release order`), dann der übrige Text. Den Abschnitt verlangt die KB heute schon. Die Prüfung prüft nur, ob er da ist; sie wertet ihn nicht aus.

**Fehler** (bei neuen PRs rot, siehe 3.7):
- **K1 Schlüssel außerhalb des Kopfblocks.** Eine Zeile beginnt weiter unten mit einem Schlüssel, oder ein Schlüssel steht eingerückt, fett (`**Merge-Stopp:**`), mit Backslash oder falsch geschrieben (`Merge-Stop:`, `Braucht :`) irgendwo im Text. Meldung: „steht nicht oben“ bzw. „falsch geschrieben“.
- **K2 Verneinte Zeile.** `Merge-Stopp: keiner`, `kein`, `nein`, `none`, `-` oder `Braucht: nichts`, `keine`, `none`, `-`. Meldung: „Zeile weglassen: Fehlt sie, gilt nichts“. Das Cockpit wertet eine verneinte `Merge-Stopp:`-Zeile weiter als Stopp (sichere Richtung, so steht es heute in der KB: „Aufheben heißt: Zeile entfernen“).
- **K3 `Braucht:` in falscher Form.** Ohne Repo-Namen (`Braucht: #12`), mit Branch-Namen statt Nummer, oder mit zwei Verweisen in einer Zeile.
- **K4 `Paired-with:` ohne https-Link** als letztes Wort.
- **K5 Stopp im Text ohne `Merge-Stopp:`-Zeile.** Siehe 3.3.
- **K6 `Merge-Stopp:` ohne Grund.**

**Warnungen** (nie rot): `Paired-with:` bei gleichem Branch-Namen (W2); `Braucht:` auf ein Repo, das es in der Organisation nicht gibt (nicht gebaut, braucht Netz); fehlender Abschnitt „Abhängigkeiten und Reihenfolge“ (W1); das Wort `Merge-Stopp` mitten im Satz ohne `Merge-Stopp:`-Zeile (W3, siehe 3.3).

Auf Bitbucket entfernt die Prüfung vor dem Lesen die Backslashes, die der Bitbucket-Editor vor Markdown-Zeichen setzt (Hub #277).

### 3.3 Stopp im Text (E298, zweiter Satz)
„Klingt etwas im Text nach Stopp und es fehlt die Zeile, fällt die Prüfung durch.“ Die Prüfung arbeitet ohne KI, deshalb nimmt sie zwei kurze Listen eindeutiger Wendungen.

**Was sie liest:** nur den PR-Text unterhalb des Kopfblocks. Den Abschnitt „Abhängigkeiten und Reihenfolge“ liest sie nicht, denn dort wird die Reihenfolge ausdrücklich beschrieben. Code (in Backticks oder Codeblöcken), HTML-Kommentare und PR-Kommentare liest sie ebenfalls nicht.

**Stoppwendungen:** `nicht mergen`, `do not merge`, `don't merge`, `Merge frühestens`, `merge only`, `[blocked]` und das Wort `Merge-Stopp`, wenn es am Zeilenanfang steht (auch nach `-`, `>` oder `#`) oder ein `:`, `bis` oder `until` folgt. Als Teil eines zusammengesetzten Wortes (`Merge-Stopp-Zeile`) zählt es nie. Ein Treffer ist K5, wenn der Kopfblock **keine** `Merge-Stopp:`-Zeile hat. Hat er eine, ist der PR ohnehin gestoppt. Steht das Wort sonst mitten im Satz („PRs mit Merge-Stopp erscheinen oben“), beschreibt der Text meist Stopps, statt einen zu setzen; das ist nur die Warnung **W3** (Abspielprobe 6.2).

**Abhängigkeitswendungen:** `#<n> zuerst`, `erst nach #<n>`, `erst mergen, wenn`, `nur zusammen mit`, `only together with`. Ein Treffer ist K5, wenn der Kopfblock weder eine `Merge-Stopp:`- noch eine `Braucht:`- noch eine `Paired-with:`-Zeile hat.

Beide Listen stammen aus `team-cockpit/src/rules/conventions.ts` und sind um die Funde vom 01.11. ergänzt.

Die Bestandsaufnahme zeigt, dass jede längere Liste falsch anschlägt (15 PRs mit nur falschen Treffern) und echte Stopps trotzdem übersieht (fusion #178: „hält … zurück“). Deshalb bleibt die Liste kurz und eindeutig. Was sie nicht fängt, fängt der pr-pruefen-Prüfer: Er liest den Text mit Verstand und meldet einen Stopp ohne Zeile als Kritisch-Fund (4.3).

### 3.4 Branch-Namen (E300, E328)
Für neue PRs gilt `<art>/<thema>`. Zulässige Arten: `feat`, `fix`, `hotfix`, `chore`, `refactor`, `docs`, `test`, `part`, `release`, `revert` (zehnte Art, E328). `<thema>` besteht aus `a-z`, `0-9`, `-`, `.` und `/`, beginnt mit einem Buchstaben oder einer Ziffer, und alles ist klein geschrieben. Gleiches Thema in API und Hub heißt gleich.

**Immer erlaubt (E328):**
- Freigabe-PRs, deren Kopf ein fester Branch ist: `main`, `master`, `beta`, `live`. Dazu gehört die Rückführung live → beta als PR direkt von `live` (E300).
- PRs von Bots. Der Autor ist ein Bot, wenn GitHub ihn als Bot führt (Login endet auf `[bot]` oder beginnt mit `app/`), also dependabot, github-actions, fusion-api-deploy. Bot-PRs prüft die Prüfung gar nicht.
- Branches des Revert-Knopfs von GitHub (`revert-<nr>-<branch>`). Sie zählen als Art `revert`. Das Muster muss beim Bau einmal mit einem echten Revert bestätigt werden.

**Umstellungen (E328):** `kb/` wird zu `docs/`, `bot/` zu `chore/`. Eine Sitzung mit einem `claude/…`-Branch benennt ihn vor dem PR um: `pr-anlegen` schiebt ihn unter dem neuen Namen und legt den PR von dort an. **⚠ Alex:** `kb/` betrifft vor allem seinen Ablauf im Repo `knowledge` (85 von 85 PRs) und `bot/` seinen Workflow `claude-accounts-refresh` im backbone.

Alles andere fällt bei neuen PRs durch, also etwa `feature/`, `ci/`, `sync/`, `train/`, `probe/`, `ccr-…` und Großbuchstaben.

### 3.5 Art-Labels (E299) – ⚠ Alex
Niemand setzt Art-Labels von Hand. Die KI setzt sie beim Anlegen aus der Branch-Art, die Prüfung vergleicht sie. Nur GitHub, denn Bitbucket hat keine Labels.

Vorschlag, so an Alex gegangen (Bitte 75ecd8cf), ergänzt um `revert` aus E328:

| Art | Label |
|---|---|
| `hotfix` | 🚑 Hotfix |
| `part` | 🧩 Teilschritt |
| `revert` | ⏪ Rücksetzen |
| `chore`, `refactor`, `docs`, `test` | 🔧 Wartung |
| `feat`, `fix`, `release`, Freigabe-PRs | kein Art-Label |

`test` und `release` standen nicht in der Bitte; die Zuordnung oben ist meine. Fehler, wenn ein Art-Label fehlt, ein falsches dran ist oder mehr als eines.

**Abgeschaffte Labels:** `✅ Bereit zum Review`, `🚧 Überarbeiten`, `⛔ Nicht mergen`. An neuen PRs sind sie ein Fehler. Aus den Repos gelöscht werden sie erst nach T2 (3.7).

### 3.6 Migrationen, die Daten löschen (E327)
- **Erkennen.** Eine Migration löscht Daten, wenn in einer neuen oder geänderten Datei in einem Ordner `database/migrations/` (auch tiefer, etwa `api-resource/database/migrations/`) eine hinzugefügte Zeile **außerhalb von `down()`** eines dieser Muster trifft: `dropColumn`, `dropIfExists`, `Schema::drop`, `->delete()`, `truncate`, `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`. `down()` zählt nicht, denn fast jede neue Migration hat dort ein `dropIfExists`. Alles andere zählt, auch Hilfsmethoden, die `up()` aufruft, wo immer sie stehen. Fehlt der Patch einer Migration (sehr große Datei), zählt sie als löschend. Die Liste kommt aus dem Cockpit (`isDataDeletingPatch`). Neu ist, dass nur Migrationen zählen und `down()` nicht.
- **GitHub.** Die Prüfung ist rot, solange `🔑 Marcs Ja` fehlt. Das Label `🔑 Marcs Ja fehlt` setzt `pr-anlegen` beim Anlegen und die Merge-KI vor dem Merge, wenn es fehlt (`check --mark-migration`, 4.1). Kommt `🔑 Marcs Ja` dazu, nimmt die KI `🔑 Marcs Ja fehlt` ab.
- **Marcs Ja.** Die Merge-KI ist eine Sitzung von Marc. Trifft sie auf einen PR mit `🔑 Marcs Ja fehlt`, stellt sie Marc eine Frage im Cockpit: „Darf <repo>#<nr> Daten löschen?“, mit der Migration und den betroffenen Tabellen und Spalten. Erst nach seinem Ja tauscht sie das Label gegen `🔑 Marcs Ja`. Unabhängig davon zeigt das Cockpit jeden PR mit `🔑 Marcs Ja fehlt` in Marcs „Du bist dran“. Das ist die Benachrichtigung.
- **Regel:** Das Label `🔑 Marcs Ja` setzt die KI nur nach Marcs Ja im Cockpit. Kein Hook kann das prüfen; es steht in der KB, im Skill und in den Merge-Regeln.
- **Ab dem ersten Tag, für alle PRs.** Diese Regel kennt weder „alt/neu“ noch T0/T1. Sie gilt ab der ersten Version für jeden offenen PR, auch für alte. Sie ist heute schon Regel 7 der Merge-Regeln („Migrationen, die Daten löschen, nur mit Marcs Ja“). Neu ist nur, wie das Ja sichtbar wird.
- **Bitbucket** (keine Labels):
  - `pr-anlegen` schreibt `Merge-Stopp: Marcs Ja fehlt (Migration löscht Daten)` in den Kopfblock. Das zeigt das Cockpit.
  - Die Prüfung meldet eine löschende Migration auf Bitbucket nur als Warnung, nie als Fehler. Ein fehlendes „Ja“-Zeichen ist dort nicht von „nie gefragt“ zu unterscheiden.
  - Die Sperre ist die Merge-KI. Sie prüft vor jedem Merge selbst auf löschende Migrationen und fragt Marc, wenn nicht schon ein Ja zum aktuellen Head vorliegt. Nach seinem Ja entfernt sie die Zeile und hält das Ja als Kommentar fest: `Marcs Ja (Cockpit E<nr>) für Head <sha7>`. Ändert sich die Migration danach, fragt sie neu.
  - Beim Bau ist zu prüfen, ob ein aktives Bitbucket-Repo überhaupt `database/migrations/` hat. Wenn keins, bleibt es bei der Warnung.

### 3.7 Neue und alte PRs, Stichtage (E301 B, E329 A)
- **T0:** Alles ist gebaut, der Umstellungslauf (6.3) ist durch, und alle bekommen ihre Bitte (6.4).
- **T1 = T0 + 2 Arbeitstage.** Die Prüfung sperrt neue PRs. Ein PR ist neu, wenn er am oder nach T1 angelegt wurde (GitHub `createdAt`, Bitbucket `created_on`). Für neue PRs gilt jeder Fehler aus 3.2–3.5: Die Prüfung ist rot, der Hook verweigert, die Merge-KI mergt nicht, und das Cockpit zeigt den PR als „wartet auf den Autor“.
- **T2 = T0 + 7 Tage.** „Kein Entwurf = bereit“ gilt auch für alle offenen PRs. ✅ und der Kommentar „bereit“ zählen nicht mehr. Danach werden die drei alten Labels gelöscht.
- **Alte PRs** (vor T1 angelegt) fallen nie durch. Die Prüfung zeigt ihre Funde nur als Hinweis, und das Cockpit zeigt sie als „umstellen“ mit der genauen Liste, was zu ändern ist (E301 B).
- **Vor T0** läuft alles nur warnend, auch für neu angelegte PRs: Prüfung immer grün mit Hinweisen, der Hook warnt, verweigert aber nicht.
- **Ausnahme:** Die Migrationsregel (3.6) gilt immer und für alle PRs.

Die Stichtage stehen als Konstanten in der Regeldatei. Sie werden an T0 gesetzt und als neue Version veröffentlicht.

## 4. Was gebaut wird

### 4.1 Repo `wemotion-gmbh/pr-regeln` (öffentlich, E331)
Ein neues öffentliches Repo enthält:
- **Die Regeldatei** `lib/pr-rules.mjs`: ESM, ohne Abhängigkeiten, Node ≥ 22. Sie exportiert die Listen (Arten, Labels, Schlüssel, Stoppwendungen, Bots, feste Branches), die Stichtage, `checkBranchName`, `parseHeadBlock`, `findStopPhrases`, `typeLabelFor`, `deletesData` und `checkPr({ forge, repo, head, base, title, body, draft, labels, author, createdAt, diff }) → { errors, warnings, isNew }`. Jeder Fehler hat eine Kennung (K1 …), einen deutschen Satz und, wo möglich, die genaue Abhilfe.
- **Das Prüfprogramm** `cli.mjs`: `check <PR-URL>` holt den PR (GitHub über `gh` oder `GITHUB_TOKEN`, Bitbucket über `BITBUCKET_USER`/`BITBUCKET_API_TOKEN`, unter Windows auch aus der Benutzerumgebung) und gibt das Ergebnis auf Deutsch aus. Exit 1 nur bei Fehlern eines neuen PRs. Mit `--mark-migration` setzt es auf GitHub `🔑 Marcs Ja fehlt`, wenn eine löschende Migration da ist und keins der beiden 🔑-Labels dran ist; `🔑 Marcs Ja` setzt es nie. Einen Status an den PR schreibt es nicht (E387 C).
- **Keinen zentralen Lauf** (E387 C). Kein Workflow, keine GitHub-App, kein Geheimnis im Repo.
- **Das Plugin** (4.2) im selben Repo. Das Plugin-Verzeichnis ist das Repo selbst; einen Ordner `bin/` darf es nicht geben, sonst lehnt der Organisations-Abgleich von claude.ai das Plugin ab.
- **Tests** mit erfundenen Beispielen, die jede Falle aus der Bestandsaufnahme nachbilden: verneinte Zeilen (#365, #370), eine eingerückte Zeile mit Bitbucket-Escapes (#277), mehrere Verweise in einer `Braucht:`-Zeile (#304–#306), ein Branch-Name statt einer Nummer (#307, #36), „Kein Merge-Stopp mehr:“ (#226). Texte aus privaten Repos kommen nicht ins öffentliche Repo. Gegen die echten Texte läuft die Abspielprobe (6.2), und zwar nur lokal.

Versionen als Git-Tags (`v1.0.0` …) plus ein mitlaufender Tag `v1`. Das Cockpit, der Marketplace-Eintrag und pr-pruefen pinnen auf einen Tag.

### 4.2 Plugin `pr-regeln`: Hook und Skill `pr-anlegen` (E304)
Eingetragen im Marketplace `claude-plugins` als GitHub-Quelle mit Tag und SHA, wie `account-meter`. Die Version wird bei jeder Änderung hochgezählt.

**Hook** (PreToolUse, Matcher `Bash|PowerShell` und `mcp__.*__(create|update)_pull_request`). Exec-Form: `node ${CLAUDE_PLUGIN_ROOT}/scripts/pr-guard.mjs`, Timeout 5 s, ohne `if`. Fällt der Hook aus, läuft der Befehl weiter.
- Er steigt sofort aus, wenn im Befehl weder `git`, `gh` noch `pullrequests` vorkommt.
- Er zerlegt den Befehl unter Beachtung von Anführungszeichen an `;`, `&&`, `||`, `|` und Zeilenumbrüchen. Heredocs, Here-Strings und Befehle wie `grep`, `echo` oder `Select-String` überspringt er. Einfache wörtliche Zuweisungen im selben Befehl (`$repo='…'`) löst er auf.
- Er prüft:
  - neue Branches (`checkout -b`, `switch -c`, `branch <name>`, `worktree add -b`) auf den Namen;
  - `git push` eines Branches mit falschem Namen, den es auf dem Remote noch nicht gibt. Schon gepushte Branches, `main`/`master`/`beta`/`live` und Löschungen lässt er durch;
  - `gh pr create` und `gh pr edit` mit wörtlichem `--title`, `--body` oder `--body-file`, mit `--label`, `--draft`, `--head` und `--base`, mit `checkPr`;
  - Bitbucket-Aufrufe, die PRs anlegen oder ändern (`POST`/`PUT` auf `…/pullrequests`), und `gh api … /pulls` mit `POST` oder `PATCH`, wenn sie nicht über `pr-anlegen` laufen. Er verweist dann auf `pr-anlegen`, statt Hilfsskripte zu lesen. Verweigern kann er nur das Anlegen; das Ändern eines bestehenden PRs bekommt immer nur einen Hinweis, denn alte PRs werden nie gesperrt;
  - die MCP-Werkzeuge zum Anlegen und Ändern von PRs, mit `checkPr` auf deren Eingabe.
- Was er nicht sicher lesen kann (Variablen, Hilfsskripte), lässt er durch und gibt nichts aus. Die Prüfung fängt es später.
- **Vor T1** schreibt er bei einem Fund nur einen Hinweis (`additionalContext`). **Ab T1** verweigert er bei neuen Branches und PRs mit einer deutschen Begründung und der Abhilfe. Er gibt nie „allow“ aus, sonst übersprängen Befehle die Rückfrage.
- Treffer zählt er in `${CLAUDE_PLUGIN_DATA}`. Bevor er verweigern darf, wird er gegen die Werkzeugaufrufe der letzten Wochen aus den Sitzungsprotokollen abgespielt. Ziel: null falsche Verweigerungen.

**Skill `pr-anlegen`** mit dem Skript `scripts/pr-anlegen.mjs`:
- Aufruf: `create|update|ready --repo-dir <pfad> --base <b> --title <t> --body-file <datei> (--ready|--draft) [--needs <repo>#<nr>]… [--stop "<grund>"]… [--paired-with <repo> <url>]`. `--ready` oder `--draft` ist Pflicht (Optionen englisch nach der KB-Regel „Code ist englisch“). Es gibt keinen Standard, damit die Sitzung entscheiden muss, ob der PR fertig ist.
- Es erkennt die Plattform an der `origin`-URL. Einen `claude/…`-Branch schiebt es unter einem Namen nach 3.4. Es pusht den Branch, wenn nötig.
- Es schreibt den Kopfblock vor den Text aus `--body-file`, setzt das Art-Label (GitHub), erkennt löschende Migrationen (3.6) und lässt `checkPr` laufen. Ist das Ergebnis rot, legt es nichts an.
- GitHub: `gh pr create`. Bitbucket: REST `POST` mit `draft`. Die Zugangsdaten nimmt es aus der Umgebung und gibt sie nie aus. Danach gibt es die PR-Adresse aus.
- `update` schreibt den Kopfblock eines offenen PRs neu. `ready` nimmt einen PR aus dem Entwurf, wenn die Prüfung grün ist.
- `SKILL.md` springt an bei „PR anlegen/öffnen“, Release- und Rückführungs-PRs. Es sagt der Sitzung, den Text zuerst in eine Datei im Scratchpad zu schreiben.

### 4.3 pr-pruefen (claude-plugins, neue Version)
- Vor dem Prüfer läuft `npx --yes github:wemotion-gmbh/pr-regeln#v1 check <PR-URL> --mark-migration`. Das Ergebnis geht in den Prüferauftrag. Jeder Fehler eines neuen PRs ist ein Kritisch-Fund. Ohne zentralen Lauf ist das die Stelle, an der auch PRs geprüft werden, die ohne Plugin angelegt wurden.
- Der Prüfer liest den Text auf Stopps ohne `Merge-Stopp:`-Zeile (3.3) und meldet sie als Kritisch-Fund.
- „Marcs Ja“ im Prüferauftrag wird zu: Label `🔑 Marcs Ja` (GitHub) bzw. Kommentar `Marcs Ja (Cockpit E<nr>) für Head <sha7>` zum aktuellen Stand der Migration (Bitbucket). Wurde die Migration nach dem Ja geändert, ist das ein Kritisch-Fund.
- **Eigener Stopp:** Endet eine Runde mit Kritisch-Funden, schreibt der Skill eine Kopfzeile `Merge-Stopp: pr-pruefen Runde <N>: Kritisch offen <K> (Head <sha7>)` in den PR. Eine eigene ältere Zeile ersetzt er dabei. Sagt eine Runde zum aktuellen Head „Kritisch offen: 0“, entfernt er seine Zeile. Andere `Merge-Stopp:`-Zeilen fasst er nie an. Heute steht so ein Stopp nur im Kommentar, und Kommentare zählen künftig nicht mehr.

### 4.4 Team-Cockpit
Das Cockpit nutzt die Regeldatei als Abhängigkeit vom Tag (`github:wemotion-gmbh/pr-regeln#v1.x.y`). Die eigenen Muster in `src/rules/conventions.ts` entfallen. Das gilt für die Repos, die es heute beobachtet: GitHub `fusion-api-v3`, `kubernetes-backbone-hetzner`, `canou-app`, `knowledge`, den `canou-hub`-Spiegel und Bitbucket `canou-hub`.
- **Bereit:** neue PRs und nach T2 alle PRs: `!isDraft`. Alte PRs vor T2: wie heute (Ereignis, ✅, Kommentar).
- **Stopp:** jede `Merge-Stopp:`-Zeile des Kopfblocks. Als Sicherheitsnetz auch eingerückte, fette oder verneinte Zeilen und solche weiter unten (Hub #277). Labels, freier Text und Kommentare zählen nur noch bei alten PRs vor T2.
- **Braucht:** nur `Braucht: <repo>#<nr>` aus dem Kopfblock. „Needs #n“ und `#n` ohne Repo zählen nur bei alten PRs. Ein `Braucht:` auf ein Repo, das das Cockpit nicht beobachtet, zeigt „nicht im Cockpit“ statt „unbekannt“.
- **Paired-with** aus dem Kopfblock, auch auf GitHub. Heute liest GitHub nur Commits und Zeile 1.
- **Neue Warteregeln:** „PR-Regeln“: ein neuer PR ohne Entwurf mit Fehlern wartet auf den Autor. „Marcs Ja fehlt“ wartet auf Marc, vor „mergen“: auf GitHub bei Label `🔑 Marcs Ja fehlt` oder bei einer löschenden Migration ohne `🔑 Marcs Ja` (eigene Erkennung mit `deletesData`, damit auch PRs ohne Plugin auffallen), auf Bitbucket bei der Zeile aus 3.6. Beide sperren den Merge (`MERGE_BARRING`).
- **Hinweis „umstellen“** an jedem alten PR mit Funden, mit der Liste der Änderungen (E301 B).
- **Aufräumen:** `release/*` als Kopf nach `live` ist erlaubt (heute „falsche Basis“). Die Auffälligkeiten „✅ ohne grünen Cluster-Lauf“ und „API-Hälfte trägt ✅“ entfallen. „Ohne genau ein Art-Label“ wird zu „Art-Label passt nicht zur Branch-Art“, für alle beobachteten GitHub-Repos, ohne Entwürfe. `TYPE_LABELS`, `READY_LABEL` und `STOP_LABELS` gelten nur noch für alte PRs bis T2.
- Der Halt „Bereit gemeldet“ im Fahrplan behält Namen und Schlüssel und liest die neue Bereit-Regel.
- `conventions.test.ts` und `anomalies.test.ts` werden auf die neuen Regeln umgeschrieben.

### 4.5 Vorlagen und Labels
- **`wemotion-gmbh/.github`:**
  - `pull_request_template.md` neu: Die Kopfzeilen sind nur in einem HTML-Kommentar erklärt, damit keine Platzhalterzeile als Stopp gilt. Dann `## Worum es geht`, `## Abhängigkeiten und Reihenfolge`, `## Bitte testen`. Keine Art-Kästchen.
  - `labels.json`: `🔑 Marcs Ja fehlt` und `🔑 Marcs Ja` kommen dazu. ✅, 🚧 und ⛔ entfallen nach T2.
  - `sync-labels.sh` bekommt einen Löschmodus für die drei alten Labels (nach T2).
  - `README.md` wird an die Regeln angepasst.
- **Bitbucket:** `.bitbucket/pull_request_template.md` mit demselben Inhalt in `canou-hub` und in jedem Bitbucket-Repo mit einem PR in den letzten 90 Tagen.

### 4.6 Branch-Schutz-Hooks in canou-hub und fusion-api-v3
Die Hooks in `.claude/settings.json` (canou-hub Z. 32 und 54, fusion-api-v3 Z. 36 und 46) nennen nur sechs Arten. Ihre Meldung nennt künftig die zehn Arten aus 3.4. Sonst ändert sich an diesen Hooks nichts. Ihre Fehlauslösung auf `main` ist ein eigenes Thema.

### 4.7 KB und Memory (erst nach dem Merge, „KB folgt dem Code“)
- **Neue KB-Seite** `kb-thema-konventionen/pr-regeln.md`: die Regeln aus Abschnitt 3 und die Durchsetzung aus Abschnitt 5.
- **Bestehende Seiten**, die künftig darauf verweisen oder angepasst werden:
  - `kb-fusion-api-v3/git-workflow/merge-stopp-und-bereit.md` wird zum Verweis;
  - `merge-nach-beta-durch-ki.md` Regeln 5–7;
  - `feature-und-part-branches.md`;
  - beide `ein-thema-ein-branch.md`: die Verlinkung in der ersten Zeile wird zu `Paired-with:` nur bei verschiedenen Namen;
  - die Branch-Namensseiten `kb-canou-hub/git-workflow/ebcd75ce.md` und `kb-fusion-api-v3/git-workflow/34203e2e.md`;
  - `release-nach-live.md` und die 🚑-Stelle in `nightly-release-betrieb.md`.
- **Memory**, nach dieser Freigabe:
  - `feedback_pr-carries-all-dependencies`, `feedback_merge-into-beta-by-rules`, `feedback_branch-per-topic` und `feedback_hub-release-branches` an die neuen Kopfzeilen, die Bereit-Regel und die Arten anpassen;
  - in `project_pr-regeln` richtigstellen: Der Branch-Schutz-Hook liegt im Projekt, nicht beim Nutzer.

## 5. Durchsetzung je Plattform

| | GitHub (Free) | Bitbucket |
|---|---|---|
| Sichtbar am PR | Kein Status (E387 C). Label `🔑 Marcs Ja fehlt` | Kein Status. Bei löschender Migration die `Merge-Stopp:`-Zeile aus 3.6 |
| Beim Anlegen | Hook + `pr-anlegen` | Hook + `pr-anlegen` |
| Vor dem Merge | Die Merge-KI mergt nur bei Grün (eigene Prüfung mit `cli.mjs check`). Die Regel steht in den Merge-Regeln. | Merge-Rechte auf `main` und `master` nur für Marcs Konto, das auch die KI nutzt (E326). Die KI mergt nur bei Grün, auch in `release/*` |
| Im Cockpit | Warteregeln und Hinweise für die beobachteten Repos | ebenso, für `canou-hub` |
| Nicht gedeckt | Merge-Knopf in GitHub; PRs von Hand oder aus Cloud-Sitzungen ohne Plugin, bis die Merge-KI sie prüft (laut Marc kommt das praktisch nicht vor) | Wer selbst im UI mergt, außer auf main/master |

## 6. Einführung

### 6.1 Bauen
In dieser Reihenfolge. Alles läuft bis T0 nur warnend.
1. Repo `pr-regeln` mit Regeldatei, Prüfprogramm und Tests.
2. Plugin mit Hook und `pr-anlegen`, Marketplace-Eintrag.
3. pr-pruefen.
4. Cockpit.
5. Vorlagen und Labels (`.github`, Bitbucket).
6. Branch-Schutz-Meldungen.

Die Teile mit **⚠ Alex** (Arten-Liste in 3.4, Labels in 3.5) werden mit dem Stand oben gebaut. Seine Antwort kann diese Konstanten vor T0 noch ändern. Nach E388 A verschicke ich die Bitten (T0) erst, wenn Alex geantwortet hat. Fehlt seine Antwort beim Bauende noch, erinnere ich ihn einmal und frage dann Marc.

### 6.2 Abspielprobe
- Der Hook läuft gegen die Werkzeugaufrufe aus den Sitzungsprotokollen seit 15.10. Ziel: null falsche Verweigerungen.
- Die Prüfung läuft gegen alle offenen PRs. Jeder Fehler wird einmal angesehen.

### 6.3 Umstellungslauf (E330), kurz vor T0
Ein Skript im Repo `pr-regeln`. Es läuft in Marcs Namen, zuerst als Probelauf, dessen Tabelle als Cockpit-Seite erscheint, dann echt. Es ändert nur Text, Labels und den Entwurfsstatus, und das nur in die sichere Richtung. Die Reihenfolge ist Pflicht:
1. **Stopps übernehmen.** Für jeden Stopp, der nur im Text, als Label oder in einem Kommentar steht, kommt oben die Zeile `Merge-Stopp: <zitierter Satz> (übernommen aus Text/Label/Kommentar)`. Ob ein Satz ein Stopp ist, beurteilt die Sitzung im Probelauf je PR selbst (die Liste aus 3.3 reicht dafür nicht). Ein Stopp wird nie entfernt oder umformuliert.
2. **Abhängigkeiten.** `Braucht:` kommt dazu, wo der Text eine offene PR-Nummer nennt. `Paired-with:` kommt dazu für die bekannten Paare mit verschiedenen Namen.
3. **Labels.**
   - 🚧 wird entfernt, aber erst nach Schritt 1, wenn seine `Merge-Stopp:`-Zeile steht.
   - ✅ bleibt bis T2. Bis dahin zählt es für alte PRs noch als „bereit“. Entfernt man es früher, gälte ein bereiter PR eine Woche lang als nicht bereit. Danach wird es mit den anderen alten Labels gelöscht.
4. **Entwürfe.** PRs ohne Entwurf und ohne jedes Bereit-Zeichen gehen zurück auf Entwurf, und der Autor bekommt einen Satz als Kommentar. Bereit-Zeichen sind ✅ und ein „bereit“-Kommentar. Am 01.11. waren das 14 PRs.
   - Marcs eigene PRs sind nicht dabei, so wie E330 sie gezählt hat („die 14“). Sie legt die KI in seinem Auftrag an, wenn eine Arbeit fertig ist. Wartet einer noch, trägt er eine `Merge-Stopp:`-Zeile.
   - Vor jedem Merge verlangt pr-pruefen zusätzlich einen Bericht „Kritisch offen: 0“ zum aktuellen Head.
5. **Nichts wird umbenannt.**
6. **Veraltete PRs** (am 01.11.: 39) kommen als Bitte „Schließen?“ zum Autor, gruppiert. Geschlossen wird nur nach seinem Ja, und der Branch bleibt.

Die Zahlen vom 01.11. sind dann alt. Das Skript erhebt alles neu.

### 6.4 Bitten und Stichtage (E305, E329)
- **T0:** Jeder im Team bekommt eine Bitte mit den Regeln in fünf Zeilen und den Daten T1 und T2. Die Stichtage gehen als neue Version der Regeldatei raus. Plugin, pr-pruefen und Cockpit ziehen nach.
- **T1:** Die Prüfung sperrt neue PRs, der Hook verweigert.
- **T2:** Die alte Bereit-Regel endet. Danach werden ✅, 🚧 und ⛔ von den PRs entfernt und aus den Repos gelöscht.
- **KB und Memory** folgen den Merges (4.7).

## 7. Wer was tut

**Ich (KI im Auftrag von Marc):**
- Repo `pr-regeln` anlegen (öffentlich, E331) und dort mergen.
- Mergen in `claude-plugins` und `team-cockpit`, Cockpit-Image und Pin wie bisher.
- PRs in `.github` (Merge nach Marcs Ja, siehe Freigabe).
- `fusion-api-v3` (`.claude/settings.json`) nach beta nach den Merge-Regeln.
- `canou-hub` über `release/*`; main bleibt bei Marc.
- Umstellungslauf, Bitten, KB, Memory.

**Marc:**
- Bitbucket: Merge-Rechte auf `main`/`master` auf sein Konto beschränken (E326). Ein Skript listet die Repos und kann die Rechte per API setzen, wenn er es mit einem Token mit Admin-Rechten ausführt.
- claude.ai: das Plugin `pr-regeln` in den Organisationseinstellungen auf „Pflicht“ stellen, damit es niemand abschaltet.
- Auf seinem Rechner im Marketplace `wemotion` die automatische Aktualisierung einschalten (heute läuft team-cockpit 1.3.0 statt 1.4.1).

**Alex:**
- Antwort auf Bitte 75ecd8cf.
- Seinen Ablauf von `kb/` auf `docs/` und den Workflow `claude-accounts-refresh` von `bot/` auf `chore/` umstellen.

## 8. Offen

- **F1 entschieden (E387, 16:26):** keine sichtbare Prüfung in GitHub. Marc: „lass uns hier die einfachste Variante wählen“; PRs von Hand oder aus der Cloud kommen „eigentlich sowieso nie“ vor. Es prüfen Hook, `pr-anlegen`, Merge-KI und Cockpit.
- **F2 entschieden (E388 A, 16:27):** alles mit dem heutigen Stand bauen; die Bitten (T0) warten auf Alex' Antwort.
- **⚠ Alex:** Arten-Liste (3.4) und Labels (3.5).
- **Beim Bau zu klären:**
  - das Muster der Revert-Knopf-Branches;
  - die Login-Namen der Bots.

## 9. Was ich selbst entschieden habe

1. **„Nach dem Merge:“ bleibt als vierte Kopfzeile erlaubt, aber nur zur Information.** Grund: KB und Memory verlangen sie heute oben. E298 nennt drei Schlüssel für Stopp und Abhängigkeit, diese Zeile ist keines von beiden.
2. **Reihenfolge im Kopfblock frei.** Grund: Eine feste Reihenfolge brächte nur Fehler ohne Nutzen. `pr-anlegen` schreibt sie trotzdem einheitlich.
3. **Verneinte Zeilen sind ein Fehler.** Das Cockpit wertet `Merge-Stopp: keiner` aber weiter als Stopp. Grund: sichere Richtung, die KB sagt schon heute „Aufheben heißt Zeile entfernen“.
4. **Stopp im Text:** kurze, eindeutige Liste in der Prüfung, nur PR-Text, kein Code, keine Kommentare. Die Feinarbeit macht der pr-pruefen-Prüfer. Grund: lange Listen schlagen nachweislich falsch an.
5. **`down()` von Migrationen zählt nicht** beim Erkennen löschender Migrationen, alles andere schon. Grund: `down()` hat fast immer ein `dropIfExists`, und `up()` ruft oft Hilfsmethoden auf, die auch nach `down()` stehen können.
6. **Bitbucket-Ja als `Merge-Stopp:`-Zeile** statt Label. Grund: Bitbucket hat keine Labels.
7. **Marcs Frage stellt die Merge-KI, nicht das Cockpit.** Grund: Das Cockpit schreibt nicht nach GitHub (nur lesen), und nur Marcs eigene Sitzung kann Fragen in sein Cockpit stellen. Die Benachrichtigung kommt trotzdem sofort über „Du bist dran“.
8. **pr-pruefen schreibt und entfernt eine eigene `Merge-Stopp:`-Zeile.** Grund: Kommentare zählen nicht mehr als Stopp. Diese Zeile ist die einzige, die er anfasst.
9. **`pr-anlegen` verlangt `--ready` oder `--draft`.** Grund: Nach E297 entscheidet der Entwurfsstatus über „bereit“. Das soll nie ein Standardwert entscheiden.
10. **Kein Status an PRs, auch nicht auf Bitbucket.** Grund: E387 C wählt die einfachste Variante für GitHub. Ein Bitbucket-Status, den nur `pr-anlegen` und die Merge-KI setzen, wäre zwischendurch veraltet, und eine Pipeline je Repo wären 328 Änderungen. Den aktuellen Stand zeigt das Cockpit, und die Merge-KI prüft vor dem Merge selbst.
11. **Das Cockpit beobachtet keine neuen Repos.** Hinweise für PRs in anderen Repos kommen über die Bitten des Umstellungslaufs. Grund: Die Ausweitung auf 37 + 328 Repos ist ein eigenes, großes Thema.
12. **Art-Labels für `test` (🔧) und `release` (keins).** Diese beiden standen nicht in der Bitte an Alex.
13. **Branch-Schutz-Hooks:** nur die Meldung ändert sich, die Fehlauslösung bleibt ein eigenes Thema.
14. **Die Migrationsregel gilt sofort und für alle PRs.** Grund: Sie ist heute schon Merge-Regel 7. Nur die Form des Ja ist neu.
15. **Bitbucket-Migrationen:** Die Prüfung warnt nur, die Sperre ist die Merge-KI. Das Ja steht als Kommentar mit Head-SHA. Grund: Ein fehlendes Zeichen lässt sich dort nicht von „nie gefragt“ unterscheiden, und vermutlich hat kein aktives Bitbucket-Repo Migrationen.
16. **Stopp im Text:** Der Abschnitt „Abhängigkeiten und Reihenfolge“ wird nicht gelesen. Eine Wendung zählt nur, wenn die passende Kopfzeile ganz fehlt. Grund: Sonst würde fast jeder PR mit Abhängigkeit rot.
17. **✅ bleibt bis T2, 🚧 geht an T0.** Grund: ✅ zählt bis T2 noch als „bereit“. 🚧 ist ein Stopp, und den ersetzt dann die `Merge-Stopp:`-Zeile.
18. **Öffentliches Repo:** Tests nur mit erfundenen Beispielen. Grund: Inhalte privater Repos dürfen nicht öffentlich werden.
19. **Das Cockpit erkennt löschende Migrationen auf GitHub auch ohne Label.** Grund: Ohne zentralen Lauf setzt niemand das Label an PRs, die ohne Plugin angelegt wurden. Marc soll sie trotzdem in „Du bist dran“ sehen.

## 10. Dem Bauenden überlassen

- Dateiaufbau im Repo `pr-regeln`.
- Genaue Wortlaute der Meldungen (Deutsch, mit Abhilfe).
- Wie der Hook Befehle zerlegt.
- Wie der Probelauf des Umstellungslaufs als Seite aussieht.
- Wie die Abhängigkeit im Cockpit eingebunden wird.

## 11. Risiken

- **Ohne Pflichtprüfung (Free)** heißt rot nur dort „kein Merge“, wo Hook, Merge-KI und Cockpit es achten.
- **Nicht gedeckt:** Cloud-Sitzungen laden keine Plugins. Menschen im UI umgehen den Hook.
- **Plugin-Stände:** Gleichnamige Plugin-Kopien (`@wemotion` und vom Organisations-Abgleich) können veralten. Es läuft nur der Hook einer Kopie.
- **„🔑 Marcs Ja“** kann jeder mit Schreibrechten in GitHub von Hand setzen. Und ändert sich die Migration nach dem Ja, bleibt das Label dran. Der pr-pruefen-Prüfer meldet eine nach dem Ja geänderte Migration als Kritisch-Fund.
- **Ohne sichtbare Prüfung (E387 C)** sieht ein Autor einen Fehler nur im Hook, in `pr-anlegen` oder im Cockpit. Ein PR, der an allen dreien vorbeigeht, fällt erst der Merge-KI auf. Sie mergt ihn dann nicht und schreibt die Funde in den PR.
