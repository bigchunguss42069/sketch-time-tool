# Business Rules — sketch-time-tool

## Zweck

Dieses Dokument beschreibt die fachlichen Regeln der Zeiterfassungs-App **sketch-time-tool** für **Norm Aufzüge AG**. Es dient als fachliche Source of Truth für Entwicklung, Refactoring, Tests und spätere Architektur-Dokumentation.

Dieses Dokument beschreibt primär das **Soll-Verhalten**. Es trennt bewusst zwischen:

* **verbindlichen fachlichen Regeln**
* **aktueller App-Abbildung**
* **offenen Punkten / noch nicht vollständig implementierten Regeln**

---

## Autoritative Grundlagen

Die fachlichen Regeln basieren auf folgenden Quellen, in dieser Reihenfolge:

1. Personalreglement / betriebliche Vorgaben von Norm Aufzüge AG
2. Fachliche Entscheidungen für die App
3. Aktuelle, bewusst bestätigte Implementationsregeln der bestehenden Anwendung

Falls bestehender Code und Reglement voneinander abweichen, ist **nicht automatisch der Code korrekt**. Solche Abweichungen müssen explizit entschieden und dokumentiert werden.

---

## Geltungsbereich

Die App unterstützt insbesondere folgende Bereiche:

* tägliche Zeiterfassung via Stempelkarte
* Pikett-Erfassung
* Dashboard mit Monatsübersicht, Ferien und ÜZ-Konto
* Admin-Funktionen für Präsenz, Absenzen, Konten, Arbeitszeitmodelle und Lohnabrechnung

Die App ist eine interne PWA für Monteure und Büropersonal und befindet sich aktuell in der Testphase.

---

## Grundprinzipien

### Persönliche Verantwortung und Prüfung

* Mitarbeitende sind persönlich für die korrekte Erfassung ihrer Arbeitszeit verantwortlich.
* Vorgesetzte sind für die Prüfung und Visierung der Zeiterfassung der ihnen unterstellten Mitarbeitenden verantwortlich.

### Server als fachliche Entscheidungsinstanz

* Für persistierte fachliche Zustände gilt der Server als massgeblich.
* Lokale Zwischenstände dienen nur als Arbeitsentwurf, nicht als endgültige Wahrheit.

### Historisierung statt stiller Überschreibung

* Fachlich relevante Änderungen sollen nachvollziehbar bleiben.
* Manuelle Stempel-Bearbeitungen sind auditierbar zu protokollieren.

---

## Rollen und Berechtigungen

### Rollen

* `user`: normale Mitarbeitende
* `admin`: administrative Benutzer mit erweiterten Auswertungs- und Verwaltungsrechten

### Grundregeln

* Normale Benutzer dürfen nur ihre eigenen Zeiten, Drafts, Übertragungen, Absenzen und Konten sehen bzw. bearbeiten, soweit der Prozessstatus dies zulässt.
* Admins dürfen zusätzliche team- und mitarbeiterbezogene Verwaltungsfunktionen ausführen.
* Admin-Funktionen sind fachlich besonders sensibel und unterliegen serverseitiger Rollenprüfung.

---

## Arbeitszeit

### Wochenarbeitszeit

* Die Sollarbeitszeit beträgt **40 Stunden pro Woche**.
* Zusätzlich werden bei **100% Pensum** **1.50 Stunden pro Woche** als **Vorarbeit** für zusätzliche freie Tage angerechnet.
* Diese Zusatzlogik ist Teil des Vorarbeitsmodells und hängt von Jahreskonfigurationen und betrieblichen Brückentagen ab.

### Teilzeitpensum

* Bei Teilzeit wird das Soll proportional zum Beschäftigungsgrad reduziert.
* Beispiel: `8.0h × (employmentPct / 100)` für ein Standard-Tagessoll.

### Arbeitszeitmodell

* Pro Benutzer kann ein individuelles Arbeitszeitmodell hinterlegt werden.
* Das Modell ist historisiert über `valid_from`.
* Jeder Wochentag Montag bis Freitag hat ein eigenes Soll.
* Falls kein individuelles Modell existiert, gilt der Standard:

  * 100% Pensum
  * Montag bis Freitag je 8.0h

### Wochenenden

* Wochenenden zählen nie als reguläre Arbeitstage.
* An Wochenenden ist das reguläre Tagessoll 0.

### Feiertage und Brückentage

* Feiertage im Kanton Bern reduzieren das Tagessoll auf 0.
* Betriebliche Brückentage reduzieren das Tagessoll ebenfalls auf 0.
* Feiertage und Brückentage sind kalenderjahresbezogen zu pflegen.

---

## Pausen

Gemäss Reglement gelten folgende Mindestpausen:

* ab **5 Std. 30 Min.** Arbeitszeit: mindestens **15 Minuten**
* ab **7 Std.** Arbeitszeit: mindestens **30 Minuten**
* ab **9 Std.** Arbeitszeit: mindestens **60 Minuten**

Zusätzliche Regeln:

* Pausen von mehr als 30 Minuten dürfen aufgeteilt werden.
* Die Mittagspause unterliegt einer Mindestdauer von 30 Minuten.

**App-Entscheidung aktuell:** Die Pausenregeln werden derzeit **nur dokumentiert** und **nicht aktiv technisch validiert oder erzwungen**. Eine spätere technische Prüfung kann als separates Feature ergänzt werden.

---

## Zeiterfassung

### Grundsatz der Zeiterfassung

Arbeitszeit ist grundsätzlich zu erfassen:

* bei jedem Arbeitsbeginn
* bei jedem Arbeitsende
* bei jeder Arbeitsunterbrechung (Pausen, Absenzen, Abwesenheiten)
* bei Beginn und Ende allfälliger Pikettdiensteinsätze inklusive An- und Rückfahrt

### Stempelkarte

* Benutzer stempeln Ein/Aus über die App.
* Normale Stempelung verwendet die aktuelle Zeit.
* Stempeln in der Zukunft ist nicht zulässig.
* Vergangene Tage dürfen über die Edit-Sektion bearbeitet werden.
* Das Datum für manuelle Bearbeitungen darf maximal heute sein.

### Auditierbarkeit von Stempeländerungen

* Normale laufende Stempelung ist nicht dasselbe wie eine manuelle Korrektur.
* Manuelle Bearbeitungen an Stempeln werden in `stamp_edits` protokolliert.
* Die Protokollierung dient Nachvollziehbarkeit und späterer Prüfung.

### Live-Präsenz

* Live-Stempel-Status wird separat geführt.
* Die Live-Präsenz dient der administrativen Einsicht in aktuelle Präsenzlagen.
* Aktuell bekannte Einschränkung: Pikett-Einsätze erscheinen nicht im Live-Präsenz-Tab.

---

## Tagessoll

### Standardregel

* Tagessoll bei 100% Pensum: **8.0h**
* Tagessoll bei Teilzeit: `8.0h × (employmentPct / 100)`

### Modifikationen des Tagessolls

Das Tagessoll kann reduziert oder auf 0 gesetzt werden durch:

* Wochenenden
* Feiertage (Bern)
* betriebliche Brückentage
* genehmigte ganztägige Absenzen
* genehmigte stundenweise Absenzen
* individuelles Arbeitszeitmodell

### Ganztägige Absenz

* Bei genehmigter ganztägiger Absenz (`hours = null`) wird das Tagessoll auf 0 gesetzt.
* Allfällig gestempelte Stunden werden an diesem Tag für die Soll/Ist-Differenz ignoriert.

### Stundenweise Absenz

* Bei genehmigter stundenweiser Absenz wird das Tagessoll reduziert:

  * `max(0, soll - hours)`

---

## Vorarbeit und ÜZ1

### Grundmodell

Die Differenz zwischen gestempelter Arbeitszeit und Tagessoll wird täglich verarbeitet.

### Definitionen

* **ÜZ1**: Überzeitkonto aus Differenz Soll/Ist
* **Vorarbeit**: Anteil der positiven Differenz, der zur Abdeckung betrieblicher Zusatzfreitage dient

### Schwelle pro Tag

* Vorarbeit-Schwelle pro Tag:

  * `0.5h × (employmentPct / 100)`
* Beispiele:

  * 100% = 0.5h
  * 80% = 0.4h

### Berechnungslogik

Für jeden Tag gilt:

```text
Pro Tag:
  diff = gestempelt - tagessoll

  wenn diff <= 0:
    → komplett in ÜZ1 global (kann negativ werden)
    → Vorarbeit bleibt unberührt

  wenn diff > 0:
    schwelle = 0.5h × (employmentPct / 100)
    in_vorarbeit = min(diff, schwelle)
    in_uez1 = diff - in_vorarbeit

    wenn vorarbeit < vorarbeit_required:
      vorarbeit += in_vorarbeit (bis Maximum)
    sonst:
      uez1 += in_vorarbeit

    uez1 += in_uez1
```

### Vorarbeitsziel pro Jahr

```js
const PAYROLL_YEAR_CONFIG = {
  2025: { vorarbeitRequired: 39 },
  2026: { vorarbeitRequired: 59 },
};
```

### Jahreswechsel

* Vorarbeit wird per Jahreswechsel auf 0 zurückgesetzt.
* Das globale ÜZ1-Konto bleibt erhalten.

### Brückentage 2026

```js
const COMPANY_BRIDGE_DAYS = {
  2026: new Set(['2026-05-15','2026-12-28','2026-12-29','2026-12-30','2026-12-31']),
};
```

### Erläuterung 2026

* 15. Mai = 8h
* 28.–31. Dezember = 31h
* Total Brückentage = 39h
* plus 20h Arbeitnehmer-Anteil = 59h Vorarbeitsziel total

---

## ÜZ-Typen

| Typ | Quelle                 | Bedeutung                                                   |
| --- | ---------------------- | ----------------------------------------------------------- |
| ÜZ1 | Stempel                | Differenz aus Soll/Ist unter Berücksichtigung von Vorarbeit |
| ÜZ2 | Pikett                 | Pikettdienst-Stunden                                        |
| ÜZ3 | Pikett (`isOvertime3`) | Wochenend-Pikettarbeit                                      |

---

## Pikett

* Pikett wird separat zur normalen Stempelkarte geführt.
* Pikett-Stunden fliessen in ÜZ2 bzw. ÜZ3 ein.
* Wochenend-Pikettarbeit kann als ÜZ3 klassifiziert werden.
* Gemäss Reglement sind Beginn und Ende von Pikettdiensteinsätzen inklusive An- und Rückfahrt zu erfassen.

**Offener Abgleichspunkt:** Es ist zu prüfen, ob die aktuelle App Abbildung von Pikett inkl. An-/Rückfahrt und Präsenzdarstellung vollständig mit dem Reglement übereinstimmt.

---

## Ferien

### Grundanspruch

Der Ferienanspruch pro Kalenderjahr beträgt mindestens:

* bis zum vollendeten 20. Altersjahr: **25 Arbeitstage**
* ab dem 21. Altersjahr: **20 Arbeitstage**
* ab dem 50. Altersjahr: **25 Arbeitstage**

### Zusätzliche arbeitsfreie Woche

* Norm Aufzüge AG gewährt zusätzlich eine arbeitsfreie Woche.
* Behandlung bei 100% Pensum:

  * **2.5 Tage zulasten Arbeitgeberin**
  * **2.5 Tage zulasten Arbeitnehmerin / Arbeitnehmer**
* Für die App wird diese Zusatzlogik **nicht als eigener separater Ferientyp** modelliert, sondern über das bestehende **Brückentage-/Vorarbeitsmodell** abgebildet.
* Diese Zusatzlogik steht damit direkt in Zusammenhang mit dem Vorarbeitsmodell und den betrieblichen Zusatzfreitagen.

### Nichtraucher-Tag

* Mitarbeitende, die seit mindestens 1 Jahr Nichtraucher sind, haben Anspruch auf **einen zusätzlichen arbeitsfreien Tag**.
* Status in aktueller App: noch nicht implementiert.

### Bezug der Ferien

* Ferien dienen ausschliesslich der Erholung.
* Ferien sind in der Regel im entsprechenden Kalenderjahr zu beziehen.
* Pro Kalenderjahr müssen mindestens **4 Ferienwochen** bezogen werden.
* Davon müssen **2 Wochen aufeinanderfolgend** bezogen werden.

### Feriensaldo per 31.12.

* Per 31.12. dürfen maximal **10 Tage** auf dem Ferienkonto verbleiben.
* Liegt der Feriensaldo Ende Kalenderjahr über 10 Tagen, ist zwischen Vorgesetzten und Mitarbeitenden ein Abbauplan zu erstellen.

### Zu viel bezogene Ferien

* Zu viel bezogene Ferien werden beim Austritt mit der letzten Lohnzahlung verrechnet.

### Ferienplanung und Prioritäten

* Die Ferienplanung ist in der App grundsätzlich **digital abgebildet**.
* Der Zeitpunkt der Ferien wird am Anfang des Jahres durch die Arbeitgeberin nach Absprache mit dem Arbeitnehmenden bestimmt.
* Mitarbeitende nehmen Rücksicht auf die Betriebsverhältnisse.
* Prioritäten gemäss Reglement:

  1. Mitarbeitende mit schulpflichtigen Kindern oder Ehepartner mit Betriebsferien
  2. Mitarbeitende ohne Kinder oder mit noch nicht schulpflichtigen Kindern
  3. Bei gleichen Voraussetzungen und gleichen Wunschdaten entscheidet der Vorgesetzte mittels Los
  4. Tritt dieselbe Situation später erneut ein, hat die Person Vorrang, die beim vorherigen Mal verschoben hat
* Ferienwünsche sind bis **31. Januar** des jeweiligen Jahres schriftlich anzugeben.
* Später bekanntgegebene Termine werden bei den Prioritäten nicht mehr berücksichtigt.
* Falls einzelne Priorisierungs- oder Entscheidungsregeln nicht automatisiert werden, gelten sie mindestens als fachliche Vorgaben für die administrative Entscheidung.

### Krankheit oder Unfall während Ferien

* Krankheits- oder Unfalltage während Ferien können nur nachbezogen werden, wenn eine ärztlich bescheinigte Ferienunfähigkeit vorliegt.
* Vorgesetzte sind unverzüglich zu informieren.
* Ein Arztzeugnis ist ab dem ersten Tag in deutscher Sprache zuzustellen.
* Anderssprachige Arztzeugnisse werden nicht akzeptiert.

### Kürzung des Ferienanspruchs

* Das Personalreglement sieht vor, dass bei Absenzen infolge Militärdienst, Unfall, Krankheit, Mutterschaft usw., die innerhalb eines Kalenderjahres **länger als 6 Wochen** dauern, der jährliche Ferienanspruch für jede weitere Absenz anteilsmässig gekürzt wird.
* Diese Kürzung wird in der App **vorerst nicht automatisiert**.
* Solche Fälle werden **manuell durch HR / Administration** behandelt.

**Status App-Abbildung:**

* Altersabhängige Ferienansprüche sind aktuell noch manuell via Admin zu setzen.
* Nichtraucher-Tag ist ein mögliches späteres Feature und aktuell noch nicht implementiert.
* Eine automatische Kürzung des Ferienanspruchs bei Langzeitabsenzen ist vorerst **nicht vorgesehen**; solche Fälle werden manuell durch HR / Administration behandelt.

---

## Absenzen

### Typen in der App

| Typ                   | Genehmigung        | Besonderheit                                                             |
| --------------------- | ------------------ | ------------------------------------------------------------------------ |
| `ferien`              | Admin erforderlich | Tage werden unter Berücksichtigung von Feiertagen/Brückentagen berechnet |
| `krank`               | Auto-accept        | Stundenweise möglich                                                     |
| `unfall`              | Admin erforderlich | Ganztägig                                                                |
| `militaer`            | Admin erforderlich | Ganztägig                                                                |
| `mutterschaft`        | Admin erforderlich | Ganztägig                                                                |
| `vaterschaft`         | Admin erforderlich | Ganztägig / fachlich weiter zu präzisieren                               |
| `bezahlteAbwesenheit` | Admin erforderlich | Ganztägig                                                                |
| `sonstiges`           | Admin erforderlich | Ganztägig                                                                |

### Fachliche Wirkung von Absenzen auf das Soll

* Ganztags-Absenz → Tagessoll = 0
* Stundenweise Absenz → Tagessoll wird reduziert
* Absenzen müssen in der ÜZ-Berechnung korrekt berücksichtigt werden

### Bezahlte Absenzen gemäss Reglement

Vom Betrieb bezahlte Absenzen sind bei Teilzeitpensum entsprechend anzupassen.

#### 1/2 Tag

* Todesfall eines Mitarbeitenden, bei Teilnahme an der Beerdigung

#### 1 Tag

* Heirat eines Kindes des Arbeitnehmenden, sofern die Hochzeitsfeier auf einen Arbeitstag fällt
* Todesfälle im engen Familienkreis (z. B. Schwiegereltern, Grosseltern, Enkel/Enkelin, Schwager/Schwägerin)
* Inspektion, Rekrutierung, Stellensuche nach Entlassung
* Umzug des eigenen Haushaltes, sofern kein Arbeitgeberwechsel damit verbunden ist und höchstens einmal jährlich stattfindet

#### 2 Tage

* Heirat des Arbeitnehmenden
* Tod des Ehepartners, eines Kindes oder der Eltern
* Todesfälle aus dem engeren Familienkreis, sofern in derselben Hausgemeinschaft gelebt wurde

#### Weitere bezahlte Absenzen

* Für weitere Fälle, z. B. öffentliche Ämter, sind individuelle Regelungen mit der Geschäftsleitung zu vereinbaren.

### Arzt- und Zahnarztbesuche

* Arzt-, Zahnarzt- oder Therapiebesuche sind möglichst ausserhalb der offiziellen Arbeitszeit zu vereinbaren.
* Zwingende Besuche während der Arbeitszeit werden bis **max. 1 Stunde** zulasten der Arbeitgeberin verrechnet.
* Längere Abwesenheit ist durch Zeitkompensation auszugleichen.
* Ausgenommen sind Arztbesuche aufgrund beruflicher Unfälle oder beruflich verursachter Krankheiten; diese gehen vollständig zulasten der Arbeitgeberin.

### Vaterschaftsurlaub

* Anspruch: **2 Wochen / 14 Kalendertage**
* Bezug innert **6 Monaten nach Geburt des Kindes**
* Bezug wochenweise oder tageweise möglich
* Zusätzlicher unbezahlter Urlaub kann durch die Geschäftsleitung gewährt werden
* Entschädigung über die Ausgleichskasse mit **80% des Bruttolohns**

**App-Abbildung aktuell:**

* Die App führt `vaterschaft` als Absenztyp.
* Die Detailprüfung dieser Reglementsvorgaben wird aktuell **nicht vollständig automatisiert**.
* Für Spezialfälle oder Grenzfälle erfolgt die fachliche Beurteilung vorerst manuell durch Administration / HR.

### Bekannte Lücke

* Halber Tag krank: Wenn stundenweise Absenz eingetragen wird (z.B. 4h krank), wird das Tagessoll entsprechend reduziert (z.B. 8h → 4h). Der Mitarbeitende ist verantwortlich, die verbleibenden Stunden zu stempeln. Fehlen die Stempel, entsteht ein Minus in ÜZ — dieses Verhalten ist **bewusst so entschieden** und fachlich korrekt.

---

## Wochen-Sperren

* Admins können Wochen sperren.
* Gesperrte Wochen dürfen nach der Sperre nicht mehr frei verändert werden.
* Der genaue erlaubte Änderungsumfang nach Sperre ist fachlich pro Prozessschritt eindeutig zu definieren.

---

## Drafts und Monatsübertragung

### Lokaler Draft

* Tages- und Pikett-Daten werden lokal im Browser zwischengespeichert.
* Lokale Daten dienen der Bearbeitung zwischen zwei Server-Synchronisationen.

### Server-Draft

* Pro Benutzer existiert ein Server-Draft für den aktuellen Monat.
* Bei Konflikten gilt der neuere fachlich gültige Stand gemäss Zeitstempel.
* Wenn `serverTime > localTime`, gewinnt der Server.

### Synchronisation

* Änderungen werden mit Debounce synchronisiert.
* `_savedAt` wird erst nach erfolgreichem Server-Sync gesetzt.
* `_draftLoadComplete` verhindert Synchronisation vor vollständigem Initial-Load.

### Monatsübertragung

* Eine Monatsübertragung persistiert den Monatsstand dauerhaft.
* Jede Übertragung wird als Submission gespeichert.
* Submission-Daten sind Grundlage für spätere Auswertungen und Konto-Updates.

### Auto-Transmit

* Täglich um **02:00 Uhr Europe/Zurich** wird für aktive Benutzer versucht, den aktuellen Monat automatisch zu übertragen.
* Fehler einzelner Benutzer dürfen den Gesamtjob nicht abbrechen.
* Der Auto-Transmit muss fachlich identisch zur manuellen Monatsübertragung sein.

---

## Konten und Snapshots

* Konten für ÜZ und Ferien werden pro Benutzer geführt.
* Monatliche Snapshots dienen der Nachvollziehbarkeit historischer Kontostände.
* Kontoänderungen infolge Übertragung müssen reproduzierbar sein.

---

## Lohnabrechnung

### Hauptmetriken

Aus Stamps / Submissions:

* Präsenzstunden
* Pikett (ÜZ2)
* ÜZ3 Wochenende
* Morgenessen / Mittagessen / Abendessen
* Schmutzzulage
* Nebenauslagen

Aus akzeptierten Absenzen:

* Tage und Stunden pro Absenztyp

Überzeit:

* ÜZ1 roh
* Vorarbeit angerechnet
* ÜZ1 nach Vorarbeit
* ÜZ2
* ÜZ3

### Nicht Teil der Lohnabrechnung

Folgende Daten gehören nur zur Tages- oder Anlagen-Auswertung, nicht direkt zur Lohnabrechnung:

* Transport-Stunden
* Schulungs-Stunden
* Sitzungs-/Kurs-Stunden
* Kommissionsstunden

---

## Jährliche Wartung

Die folgenden Jahresdaten müssen gepflegt werden:

1. Feiertage Bern serverseitig
2. betriebliche Brückentage serverseitig
3. Vorarbeitsziel / Payroll-Jahreskonfiguration
4. Feiertagskalender clientseitig synchron zur Serverlogik

---

## Bekannte Lücken und offene Entscheidungen

### Bereits bekannte Lücken

* Halber Tag krank ohne entsprechende Stempel erzeugt Minus in ÜZ — **bewusstes Verhalten**, kein Bug (Mitarbeitende sind für die Stempelung der verbleibenden Stunden verantwortlich)
* Pikett-Präsenz erscheint nicht im Live-Präsenz-Tab
* Ferienanspruch nach Alter ist noch manuell via Admin zu setzen
* Nichtraucher-Tag ist noch nicht implementiert
* Brückentage 2027+ sind noch nicht hinterlegt
* localStorage und `stamp_edits` wachsen aktuell unbegrenzt

### Fachlich noch zu präzisierende Punkte

* Wie streng sollen Wochen-Sperren technisch und fachlich wirken?
* Welche Teile der Ferienplanungs-Prioritätslogik werden automatisiert und welche bleiben administrativ?

---

## Nicht-Ziele dieses Dokuments

Dieses Dokument beschreibt **nicht**:

* konkrete Dateinamen oder Funktionsnamen des Codes
* Tabellen- oder API-Implementationsdetails im Sinn einer Systemarchitektur
* Refactoring-Schritte
* UI-Layouts

Diese Themen gehören in Architektur- und Implementationsdokumente.