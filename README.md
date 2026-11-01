# pr-regeln

Die PR-Regeln für alle Repos von wemotion (GitHub-Organisation `wemotion-gmbh` und Bitbucket-Workspace `wemotion-bucket`) an einer Stelle:

- `lib/pr-rules.mjs` – die Regeldatei, ohne Abhängigkeiten. Sie nutzen das Prüfprogramm, der Hook, der Skill `pr-anlegen` und das Team-Cockpit.
- `cli.mjs` – das Prüfprogramm: `node cli.mjs check <PR-URL>`.
- Das Claude-Code-Plugin `pr-regeln`: ein Hook, der beim Anlegen von Branches und PRs auf die Regeln hinweist, und der Skill `pr-anlegen`.

Die Regeln selbst stehen in [docs/superpowers/specs/2026-11-01-pr-regeln-design.md](docs/superpowers/specs/2026-11-01-pr-regeln-design.md).
