# Rule Implementation Map — sketch-time-tool

## Zweck

Dieses Dokument verknüpft die **fachlichen Regeln** aus `business-rules.md` und die **nicht verhandelbaren Schutzregeln** aus `security-invariants.md` mit der **aktuellen Codebasis**.

Es beantwortet für jede kritische Regel:

* **was** fachlich gelten muss
* **wo** die Regel heute im System umgesetzt wird
* **welche Datenquellen / Tabellen** beteiligt sind
* **welche APIs / UI-Flows** betroffen sind
* **welche Tests** diese Regel absichern sollten
* **welche Refactor-Hotspots** beim Aufsplitten von `server.js` und `main.js` besonders riskant sind

Dieses Dokument ist absichtlich pragmatisch. Es ist kein perfektes Architekturdiagramm, sondern eine **Arbeitslandkarte** für Refactoring, Bugfixes und Testhärtung.

---

## Verwendete Referenzquellen

* `docs/domain/business-rules.md`
* `docs/security/security-invariants.md`
* `backend/server.js`
* `frontend/src/main.js`
* Tabellenstruktur / API-Struktur gemäss Projektkontext
* bestehende Tests:

  * `test-ueberzeit.js`
  * `backend/test-api.js`

---

## Legende

### Schweregrad

* **kritisch** = Fehler führt potenziell zu falscher Abrechnung, Rechteproblem oder Dateninkonsistenz
* **hoch** = Fehler stört fachlich wichtige Prozesse deutlich
* **mittel** = relevant, aber nicht Kern der ersten Refactor-Welle

### Refactor-Priorität

* **P1** = zuerst stabilisieren / extrahieren
* **P2** = danach
* **P3** = später

---

## 1. Authentifizierung und Session-Gültigkeit

### Regel

Nur Benutzer mit gültiger, serverseitig aktiver Session dürfen geschützte API-Endpunkte verwenden.

### Schweregrad

**kritisch**

### Backend-Orte

* Session-Tabellenaufbau / Session-Lifecycle in `backend/server.js`
* Session-Erzeugung und -Widerruf
* `requireAuth`
* Login / Logout / `me`-Flow

### Beteiligte Daten

* `users`
* `auth_sessions`

### Frontend-Orte

* Auth-Zustand in `frontend/src/main.js`
* Request-Wrapper / Authorization-Header
* Login-Flow
* Logout-Flow
* Initialer User-Load

### Sicherheitsinvarianten

* Auth ist nur serverseitig gültig
* Logout muss Session wirklich entwerten
* Client-Zustand ist kein Berechtigungsnachweis

### Tests

* Login mit korrekten / falschen Credentials
* Zugriff ohne Token → 401
* Zugriff mit widerrufener Session → 401
* Logout entwertet bestehende Session
* deaktivierter User kann nicht mehr arbeiten

### Refactor-Hotspots

* Extraktion in `auth/session.service.js`
* Extraktion in `auth/auth.middleware.js`
* Frontend: Auth-Storage und Request-Handling zentralisieren

### Priorität

**P1**

---

## 2. Rollenprüfung Admin vs. User

### Regel

Admin-Funktionen dürfen nur nach expliziter serverseitiger Admin-Prüfung ausgeführt werden.

### Schweregrad

**kritisch**

### Backend-Orte

* `requireAdmin` in `backend/server.js`
* alle `/api/admin/*`-Endpunkte
* User-Verwaltung
* Konten-Verwaltung
* Arbeitszeitmodell-Verwaltung
* Präsenz / Audit / Payroll / Absenzentscheidungen

### Frontend-Orte

* Admin-Tab Sichtbarkeit in `frontend/src/main.js`
* Admin-Datenladefunktionen
* Admin-Buttons / Workflows

### Sicherheitsinvarianten

* UI-Ausblendung ist keine Sicherheitsgrenze
* Rollen dürfen nie aus dem Client abgeleitet werden

### Tests

* normaler User auf `/api/admin/*` → 403
* Admin auf Admin-Endpunkte → erlaubt
* Manipulation von Frontend-State ohne Admin-Role darf nichts bringen

### Refactor-Hotspots

* Route-Trennung in `routes/admin.routes.js`
* Middleware-Trennung in `auth/role.middleware.js`
* Frontend-Admin-Layer separat bündeln

### Priorität

**P1**

---

## 3. Ownership / Zugriff nur auf eigene Daten

### Regel

Normale Benutzer dürfen nur ihre eigenen Drafts, Übertragungen, Absenzen, Konten und Wochen-Sperr-Ansichten sehen oder bearbeiten.

### Schweregrad

**kritisch**

### Backend-Orte

* User-Endpunkte in `backend/server.js`
* Draft-Load / Draft-Sync
* eigene Übertragungen
* eigene Absenzen
* eigenes Konto
* eigene Wochen-Sperren

### Beteiligte Daten

* `user_drafts`
* `month_submissions`
* `absences`
* `konten`
* `week_locks`

### Frontend-Orte

* alle „my/*“-artigen Ladeflüsse in `frontend/src/main.js`
* Dashboard / Wochenplan / Pikett / eigene Absenzen

### Sicherheitsinvarianten

* Scope nie aus clientgesendeter `userId` ableiten
* Server bindet Zugriff immer an `req.user`

### Tests

* User A kann Draft / Konten / Absenzen von User B nicht lesen
* User A kann fremde Daten nicht überschreiben
* ID-Manipulation im Request bleibt wirkungslos

### Refactor-Hotspots

* eigenes `ownership`-Denken in Services/Repositiories etablieren
* keine Repository-Funktion ohne klaren User-Scope

### Priorität

**P1**

---

## 4. Tagessoll-Berechnung

### Regel

Das Tagessoll ergibt sich aus Arbeitszeitmodell, Pensum, Wochenenden, Feiertagen, Brückentagen und genehmigten Absenzen.

### Schweregrad

**kritisch**

### Backend-Orte

* `getDailySoll(...)` in `backend/server.js`
* Feiertags- und Brückentagskonfiguration
* Arbeitszeitmodell-Zugriff
* accepted-absence Einbezug

### Beteiligte Daten

* `work_schedules`
* `absences`
* `BERN_HOLIDAYS`
* `COMPANY_BRIDGE_DAYS`

### Frontend-Orte

* Anzeige-/Spiegelkonfiguration in `frontend/src/main.js`
* Dashboard / Wochenplan / Ferienberechnung
* clientseitige Feiertagsdaten

### Fachliche Abhängigkeiten

* Teilzeitpensum
* Feiertage Kanton Bern
* Brückentage
* stundenweise vs. ganztägige Absenz

### Sicherheitsinvarianten

* serverseitige Logik ist autoritativ
* Client- und Serverkonfiguration dürfen nicht unbemerkt divergieren

### Tests

* Standardtag 100% → 8.0h
* Teilzeit 80% → 6.4h
* Wochenende → 0
* Feiertag → 0
* Brückentag → 0
* ganztägige Absenz → 0
* stundenweise Absenz reduziert Soll korrekt
* individuelles Arbeitszeitmodell überschreibt Standard

### Refactor-Hotspots

* Extraktion in `services/daily-soll.service.js`
* Jahres-/Kalenderdaten nach `domain/holidays.js`, `domain/bridge-days.js`
* `work_schedules`-Zugriff kapseln

### Priorität

**P1**

---

## 5. ÜZ1- und Vorarbeit-Berechnung

### Regel

Die tägliche Differenz `gestempelt - tagessoll` wird nach Vorarbeitslogik und ÜZ1-Regeln verarbeitet.

### Schweregrad

**kritisch**

### Backend-Orte

* `computeMonthUeZ1AndVorarbeit(...)` in `backend/server.js`
* `PAYROLL_YEAR_CONFIG`
* Hilfslogik für positive ÜZ1 / Payroll-Overtime
* Folgeverbuchung in Konto-Updates

### Beteiligte Daten

* Submission-/Payload-Tagesdaten
* `work_schedules`
* `absences`
* `konten`
* `konten_snapshots`

### Frontend-Orte

* Dashboard-Überzeitkarte
* Monatsanzeige / Vorschauen
* Transmit-Payload-Erstellung

### Fachliche Abhängigkeiten

* Teilzeitpensum
* Vorarbeit-Schwelle `0.5h × Pensum`
* Jahresziel `vorarbeitRequired`
* Jahreswechsel-Reset Vorarbeit
* Ferienlogik bei Tagesdifferenz

### Sicherheitsinvarianten

* Berechnung darf nicht allein frontendbasiert sein
* Kontoänderungen müssen reproduzierbar bleiben

### Tests

* diff <= 0 geht vollständig in ÜZ1
* positive Differenz füllt zuerst Vorarbeit
* Vorarbeit-Limit wird respektiert
* Rest geht in ÜZ1
* Teilzeit-Schwelle korrekt
* Jahreswechsel setzt Vorarbeit zurück, ÜZ1 bleibt
* Ferien-Flag verhält sich korrekt

### Refactor-Hotspots

* Extraktion in `services/overtime.service.js`
* Jahreskonfig aus `domain/payroll-config.js`
* keine UI-Berechnung als alleinige Wahrheit verwenden

### Priorität

**P1**

---

## 6. Konto-Update nach Monatsübertragung

### Regel

Nach einer Monatsübertragung werden Konten konsistent und nachvollziehbar aktualisiert.

### Schweregrad

**kritisch**

### Backend-Orte

* Logik zum Verarbeiten einer Submission in `backend/server.js`
* Konto-Update-Logik nach Übertragung
* Snapshot-Erstellung

### Beteiligte Daten

* `month_submissions`
* `konten`
* `konten_snapshots`

### Frontend-Orte

* Transmit-Flow
* Dashboard nach Übertragung
* Sync-/Status-Anzeige

### Sicherheitsinvarianten

* Kontoänderungen müssen reproduzierbar sein
* Mehrschritt-Prozesse dürfen keine halben Zustände hinterlassen

### Tests

* erfolgreiche Übertragung schreibt Submission und aktualisiert Konten
* Fehler mitten im Prozess erzeugt keinen still inkonsistenten Zustand
* wiederholte / doppelte Übertragung wird sauber behandelt

### Refactor-Hotspots

* Extraktion in `services/transmit.service.js`
* Transaktionsgrenzen sichtbar machen
* Snapshots separat kapseln

### Priorität

**P1**

---

## 7. Draft-Sync und Konfliktauflösung

### Regel

Lokale Drafts sind Arbeitskopien; serverseitige Drafts sind die massgebliche Persistenz. Bei Konflikten gewinnt der neuere Serverstand.

### Schweregrad

**kritisch**

### Backend-Orte

* Draft-Load / Draft-Sync Endpunkte in `backend/server.js`
* Persistenzlogik für `user_drafts`

### Beteiligte Daten

* `user_drafts`
* lokaler Browser-Storage

### Frontend-Orte

* `saveToStorage()`
* `scheduleDraftSync()`
* `syncDraftToServer()`
* `loadDraftFromServer()`
* `_savedAt`
* `_draftLoadComplete`

### Sicherheitsinvarianten

* Browser-Storage ist nicht Source of Truth
* kein Sync vor abgeschlossenem Initial-Load
* `savedAt` nur nach echter Serverbestätigung
* Sync darf nie benutzerübergreifend wirken

### Tests

* frischer Login lädt Server-Draft korrekt
* lokaler älterer Draft überschreibt nicht den neueren Serverstand
* Sync vor Initial-Load ist blockiert
* `_savedAt` wird nur nach erfolgreichem Server-Sync gesetzt
* User A kann User-B-Draft nicht beeinflussen

### Refactor-Hotspots

* Extraktion in `services/draft.service.js`
* Frontend-Draft-Layer separieren
* lokale und serverseitige Zeitstempel zentral definieren

### Priorität

**P1**

---

## 8. Monatsübertragung / Submission-Persistenz

### Regel

Jede Monatsübertragung wird als persistierte Submission gespeichert und bleibt fachlich nachvollziehbar.

### Schweregrad

**kritisch**

### Backend-Orte

* `/api/transmit-month`
* Submission-Erzeugung / Meta-Berechnung / Persistenz
* Laden früherer Übertragungen

### Beteiligte Daten

* `month_submissions`

### Frontend-Orte

* Payload-Bau für aktuellen Dashboard-Monat
* manueller Transmit-Flow
* Anzeige vergangener Übertragungen

### Sicherheitsinvarianten

* Übertragungen überschreiben nicht still frühere Wahrheit
* Übertragung ist Identität, Zeitraum und Zeitpunkt zuordenbar

### Tests

* Submission enthält korrekten Monat / Benutzer / Zeitstempel
* wiederholte Übertragung bleibt nachvollziehbar
* History ist pro Benutzer korrekt isoliert

### Refactor-Hotspots

* Submission-Repository extrahieren
* Payload-Normalisierung zentralisieren

### Priorität

**P1**

---

## 9. Wochen-Sperren

### Regel

Gesperrte Wochen dürfen nach der Sperre nicht mehr durch normale Benutzer verändert werden.

### Schweregrad

**kritisch**

### Backend-Orte

* `/api/admin/week-lock`
* Wochen-Sperrprüfung in schreibenden Flows
* userseitige Locks-Ansicht

### Beteiligte Daten

* `week_locks`
* Tagesdaten / Drafts / Submissions

### Frontend-Orte

* Laden eigener Locks
* UI-Deaktivierung / Hinweis im Wochenplan
* Stempel- und Edit-Flows in gesperrten Bereichen

### Sicherheitsinvarianten

* Sperre darf nicht über Draft-Sync, Edit-Section oder Transmit umgangen werden
* serverseitige Sperrprüfung ist massgeblich

### Tests

* Benutzer kann in gesperrter Woche nicht mehr frei ändern
* Admin kann Woche sperren
* UI zeigt Sperre an, aber Serverprüfung bleibt entscheidend
* alternative Schreibpfade respektieren die Sperre

### Refactor-Hotspots

* Lock-Prüfung als gemeinsame Service-Funktion extrahieren
* keine Endpunkt-spezifischen Sonderprüfungen verstreuen

### Priorität

**P1**

---

## 10. Absenzen — Erfassung, Entscheidung, Status

### Regel

Absenzstatus und ihre fachlichen Auswirkungen werden serverseitig geführt; nur zulässige Statusübergänge sind erlaubt.

### Schweregrad

**hoch**

### Backend-Orte

* User-Absenz-Endpunkte
* Admin-Entscheid-Endpunkt
* accepted-absence Nutzung in Soll-/ÜZ-Berechnung

### Beteiligte Daten

* `absences`

### Frontend-Orte

* Dashboard Ferien/Absenz-Anträge
* Admin-Tab „Absenzen & Konten“
* Sync eigener Absenzen

### Fachliche Abhängigkeiten

* `ferien`, `krank`, `unfall`, `militaer`, `mutterschaft`, `vaterschaft`, `bezahlteAbwesenheit`, `sonstiges`
* `krank` auto-accept
* stundenweise vs. ganztägig

### Sicherheitsinvarianten

* Absenzstatus ist serverautoritativ
* normale Benutzer dürfen keine Admin-Entscheide simulieren

### Tests

* `krank` auto-accept
* `ferien` braucht Admin-Entscheid
* pending Absenz löschbar / stornierbar gemäss Regel
* accepted Absenz beeinflusst Tagessoll korrekt
* unzulässige Statusübergänge werden abgelehnt

### Refactor-Hotspots

* Extraktion in `services/absence.service.js`
* Statusmaschine explizit machen

### Priorität

**P1**

---

## 11. Ferienlogik und Ferienanspruch

### Regel

Ferienansprüche, Ferienbezug und Ferienwirkungen auf Tagessoll und Konten müssen fachlich korrekt und transparent abgebildet sein.

### Schweregrad

**hoch**

### Backend-Orte

* Absenzbehandlung für `ferien`
* Konto-Logik / Ferienkonten
* Payroll-/Tagesauswertungen, sofern Ferien dort indirekt wirken

### Beteiligte Daten

* `absences`
* `konten`
* `konten_snapshots`

### Frontend-Orte

* Dashboard Ferienbereich
* Ferienantrag-UI
* Monatsdarstellung / Flags

### Fachliche Abhängigkeiten

* altersabhängiger Anspruch
* Feiertage / Brückentage bei Ferienzählung
* 10-Tage-Restferien-Regel
* mindestens 4 Wochen, davon 2 zusammenhängend
* Sonderregeln Krankheit/Unfall in Ferien
* Nichtraucher-Tag als späteres Feature

### Implementationsstatus

* Ein Teil ist aktuell administrativ / manuell
* Nicht alles ist vollständig automatisiert

### Tests

* Ferienantrag zieht Feiertage / Brückentage korrekt ab
* ganztägige Ferien beeinflussen Soll korrekt
* Alterslogik / Restferienregel später separat absichern

### Refactor-Hotspots

* Ferienlogik nicht unbemerkt in allgemeiner Absenzlogik verlieren
* klar trennen zwischen heute automatisiert vs. administrativ behandelt

### Priorität

**P2**

---

## 12. Pikett und ÜZ2 / ÜZ3

### Regel

Pikettdaten werden getrennt von normaler Stempelung erfasst und fliessen korrekt in ÜZ2 bzw. ÜZ3 ein.

### Schweregrad

**hoch**

### Backend-Orte

* Payroll-/Overtime-Logik
* Submission-Verarbeitung für Pikett-Einträge

### Beteiligte Daten

* Submission-Payload (`pikett`)
* ggf. Live-Präsenz / Stamps für Zusammenhang

### Frontend-Orte

* Pikett-View
* Payload-Bau
* Dashboard-/Payroll-Anzeigen

### Fachliche Abhängigkeiten

* `isOvertime3`
* Wochenend-Pikettarbeit
* Reglement: Beginn und Ende inkl. An- und Rückfahrt erfassen

### Bekannte Lücke

* Pikett-Präsenz erscheint aktuell nicht im Live-Präsenz-Tab

### Tests

* Pikettstunden → ÜZ2
* Wochenend-Pikett mit `isOvertime3` → ÜZ3
* Payload enthält Pikett korrekt

### Refactor-Hotspots

* Pikett nicht mit normaler Stempelkarte vermischen
* Live-Präsenz und Payroll-Sicht bewusst trennen

### Priorität

**P2**

---

## 13. Manuelle Stempelbearbeitung und Audit-Log

### Regel

Nachträgliche manuelle Stempelbearbeitungen müssen nachvollziehbar und von normaler Live-Stempelung unterscheidbar sein.

### Schweregrad

**kritisch**

### Backend-Orte

* Stempel-Edit-Verarbeitung
* Admin-Audit-Ansicht
* Audit-PDF

### Beteiligte Daten

* `stamp_edits`
* `live_stamps`
* ggf. Submission-/Stempeldaten

### Frontend-Orte

* Edit-Section im Wochenplan
* Admin-Präsenz-Tab
* Präsenz-/Audit-UI

### Sicherheitsinvarianten

* manuelle Korrekturen sind auditpflichtig
* normale Stempelung und manuelle Korrektur dürfen nicht vermischt werden

### Tests

* manuelle Bearbeitung erzeugt Audit-Eintrag
* normale Live-Stempelung erzeugt keinen manuellen Edit-Log-Eintrag
* Audit-Ansicht zeigt Daten nachvollziehbar

### Refactor-Hotspots

* Edit-Log-Service extrahieren
* Audit-Metadaten nicht im UI zusammensetzen, sondern serverseitig konsistent halten

### Priorität

**P1**

---

## 14. Live-Präsenz

### Regel

Die Admin-Präsenzansicht bildet den aktuellen serverseitigen Live-Status von Benutzern nachvollziehbar ab.

### Schweregrad

**mittel**

### Backend-Orte

* `POST /api/stamps/live`
* `GET /api/admin/live-status`

### Beteiligte Daten

* `live_stamps`

### Frontend-Orte

* Wochenplan-Stempelung
* Admin-Präsenz-Tab

### Sicherheitsinvarianten

* Präsenzdaten nur für autorisierte Admins sichtbar
* Live-Status ist kein Ersatz für Audit-Log oder Submission-Wahrheit

### Tests

* User kann eigenen Live-Status senden
* Admin sieht Live-Status
* normaler User sieht keine globale Präsenzansicht

### Refactor-Hotspots

* Live-Präsenz von historischer Arbeitszeit klar trennen

### Priorität

**P2**

---

## 15. Payroll / Lohnabrechnungs-Auswertung

### Regel

Payroll-Auswertungen und PDFs basieren auf konsistenten serverseitigen Daten aus Submissions, Stamps und akzeptierten Absenzen.

### Schweregrad

**kritisch**

### Backend-Orte

* Payroll-Period-Datenaufbau in `backend/server.js`
* PDF-Export-Endpunkte
* Überzeit-Auswertung für Payroll-Zeitraum

### Beteiligte Daten

* `month_submissions`
* `absences`
* `konten`
* ggf. `work_schedules`

### Frontend-Orte

* Admin-Tab „Lohnabrechnung“
* Zeitraumsauswahl
* PDF-Download

### Fachliche Abhängigkeiten

* Präsenzstunden
* ÜZ1 roh / Vorarbeit / ÜZ2 / ÜZ3
* Mahlzeiten
* Schmutzzulage / Nebenauslagen
* accepted absences

### Sicherheitsinvarianten

* Payroll darf nie nur clientseitig zusammengesetzt sein
* Exporte basieren auf serverautorisierter Datenbasis

### Tests

* Zeitraumsauswertung korrekt
* Payroll-PDF nur für Admin
* accepted absences werden einbezogen
* nicht relevante Tagesfelder landen nicht fälschlich in Payroll

### Refactor-Hotspots

* Extraktion in `services/payroll.service.js`
* PDF-Generierung vom Datensammeln trennen

### Priorität

**P1**

---

## 16. Arbeitszeitmodell-Verwaltung

### Regel

Arbeitszeitmodelle sind historisierte, pro Benutzer geltende Sollzeitdefinitionen und wirken direkt auf Tagessoll, Überzeit und Abrechnung.

### Schweregrad

**hoch**

### Backend-Orte

* Admin-Endpunkte für Work Schedule
* `getDailySoll(...)`
* historische Auswahl via `valid_from`

### Beteiligte Daten

* `work_schedules`

### Frontend-Orte

* Admin-Tab „Mitarbeiter“ / Arbeitszeitmodell konfigurieren

### Sicherheitsinvarianten

* nur Admin darf Arbeitszeitmodelle ändern
* Modelländerungen sind abrechnungsrelevant

### Tests

* neues Modell ab `valid_from` wirkt nur ab richtigem Datum
* ältere Daten nutzen historisch korrektes Modell
* nicht Admin kann Modell nicht ändern

### Refactor-Hotspots

* eigenes `work-schedule.service.js` / repository
* Datumslogik zentralisieren

### Priorität

**P1**

---

## 17. Jahreskonfigurationen / Feiertage / Brückentage

### Regel

Jährlich gepflegte Referenzdaten müssen konsistent, nachvollziehbar und serverautoritativ sein.

### Schweregrad

**hoch**

### Backend-Orte

* `BERN_HOLIDAYS`
* `COMPANY_BRIDGE_DAYS`
* `PAYROLL_YEAR_CONFIG`

### Frontend-Orte

* `BERN_HOLIDAYS_CLIENT`
* clientseitige Anzeige- und Hilfslogik

### Sicherheitsinvarianten

* Serverlogik ist massgeblich
* Client-Spiegelung darf nicht unbemerkt abweichen

### Tests

* neues Jahr kann ergänzt werden ohne Altjahre zu brechen
* Feiertag / Brückentag wirkt in Soll und Ferienzählung korrekt
* fehlendes Jahr fällt nicht still in falsches Verhalten

### Refactor-Hotspots

* Trennung in `domain/holidays.js`, `domain/bridge-days.js`, `domain/payroll-config.js`
* Wartungspunkt explizit dokumentieren

### Priorität

**P1**

---

## 18. Admin-User-Verwaltung

### Regel

Nur Admins dürfen Benutzer verwalten; Änderungen an Rolle, Aktivstatus und Team wirken sich sofort und serverseitig aus.

### Schweregrad

**hoch**

### Backend-Orte

* `GET/POST/PATCH /api/admin/users`
* Benutzer-DB-Zugriff
* Aktivstatus-Prüfung in Auth-Flows

### Beteiligte Daten

* `users`

### Frontend-Orte

* Admin-Tab „Mitarbeiter“

### Sicherheitsinvarianten

* deaktivierte Benutzer dürfen trotz altem Token keine Fachaktion mehr durchführen
* Rollenänderung darf nicht nur im UI sichtbar sein, sondern serverseitig gelten

### Tests

* User anlegen / ändern nur als Admin
* Deaktivierung sperrt weitere Nutzung
* Rollenwechsel greift serverseitig

### Refactor-Hotspots

* User-Repository / Admin-User-Service

### Priorität

**P2**

---

## 19. Frontend-HTML-Injektion / XSS-Risiko

### Regel

Kein unkontrollierter Inhalt darf in HTML-Sinks gelangen, da `localStorage` und Auth-Token im Browser sicherheitsrelevant sind.

### Schweregrad

**kritisch**

### Backend-Orte

* indirekt alle Felder, die im Frontend gerendert werden

### Frontend-Orte

* `frontend/src/main.js` allgemein
* alle Renderfunktionen, insbesondere HTML-Zusammenbau für Dashboard, Admin, Tabellen, Drawer, Stempelkarte

### Sicherheitsinvarianten

* Browser ist manipulierbar
* XSS ist hochkritisch
* `innerHTML` nur kontrolliert verwenden

### Tests / Prüfungen

* Suche nach `innerHTML`, `insertAdjacentHTML`, Template-Rendering mit untrusted data
* sicherstellen, dass User-/Serverdaten nicht roh injiziert werden

### Refactor-Hotspots

* Render-Layer trennen
* bevorzugt `textContent`, sichere DOM-Erzeugung, zentrale Escape-/Sanitization-Strategie

### Priorität

**P1**

---

## 20. Auto-Transmit Hintergrundjob

### Regel

Der nächtliche Auto-Transmit muss fachlich dieselben Regeln einhalten wie der manuelle Monats-Transmit und darf keine Inkonsistenzen erzeugen.

### Schweregrad

**hoch**

### Backend-Orte

* Cron-Setup in `backend/server.js`
* Auto-Transmit-Flow pro Benutzer

### Beteiligte Daten

* `user_drafts`
* `month_submissions`
* `konten`

### Sicherheitsinvarianten

* Hintergrundjob hat keine schwächeren Prüfungen
* Fehler einzelner Benutzer stoppen nicht den Gesamtjob
* Fehler bleiben nachvollziehbar

### Tests

* Auto-Transmit verarbeitet mehrere Benutzer robust
* Fehler bei einem Benutzer lässt andere weiterlaufen
* Ergebnis entspricht fachlich dem manuellen Flow

### Refactor-Hotspots

* Extraktion in `jobs/auto-transmit.job.js` oder `services/auto-transmit.service.js`
* gemeinsame Kernlogik mit manuellem Transmit erzwingen

### Priorität

**P1**

---

## Erste Refactor-Blöcke, die sich aus dieser Map ergeben

### Block A — Auth / Scope / Admin-Grenzen

Zuerst extrahieren:

* Session-Handling
* `requireAuth`
* `requireAdmin`
* User-/Admin-Route-Trennung

### Block B — Kern-Fachlogik Zeit

Zuerst extrahieren:

* `getDailySoll`
* ÜZ1/Vorarbeit-Logik
* Jahreskonfigurationen
* Arbeitszeitmodell-Zugriff

### Block C — Draft / Transmit / Konto-Update

Zuerst extrahieren:

* Draft-Sync Service
* Submission Service
* Konto-Update / Snapshot-Logik
* Auto-Transmit auf gemeinsame Kernfunktion umstellen

### Block D — Audit / Sperren / Absenzen

Danach extrahieren:

* Wochen-Sperren
* Stempel-Edit-Audit
* Absenz-Statusmaschine

### Block E — Payroll / Reporting

Erst wenn die Kernlogik gekapselt ist:

* Payroll-Period-Builder
* Export-PDFs
* Admin-Auswertungen

---

## Empfohlene Test-Härtung entlang der Map

### Sofort absichern

* Auth / Logout / revoked session
* Admin vs User Zugriff
* Ownership / fremde Daten
* Tagessoll
* ÜZ1 / Vorarbeit
* Draft-Konfliktauflösung
* Wochen-Sperren
* Monatsübertragung + Konto-Update

### Danach absichern

* Absenz-Statuslogik
* Pikett / ÜZ2 / ÜZ3
* Payroll-Zeitraum
* Work-Schedule-Historie
* Auto-Transmit

---

## Offene Mapping-Lücken

Diese Map ist absichtlich schon nutzbar, aber noch nicht vollständig feingranular. Später zu ergänzen:

* exakte Funktionsnamen / Zeilen pro Admin-Flow
* exakte Frontend-Renderer pro View
* SQL-/Repository-Zuordnung je Tabelle
* Transaktionsgrenzen je Mehrschritt-Prozess
* Liste aller HTML-Sinks im Frontend

---

## Nicht-Ziele dieses Dokuments

Dieses Dokument beschreibt nicht im Detail:

* das fachliche Soll-Verhalten selbst → siehe `business-rules.md`
* die übergreifenden Schutzregeln selbst → siehe `security-invariants.md`
* die endgültige Zielarchitektur nach dem Refactor

Es ist eine **Brückendokumentation** zwischen Regeln und Code.
