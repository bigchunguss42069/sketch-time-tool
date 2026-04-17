# Security Invariants — sketch-time-tool

## Zweck

Dieses Dokument definiert die **nicht verhandelbaren Sicherheitsinvarianten** von **sketch-time-tool**.

Eine Security Invariant ist eine Regel, die bei Refactoring, neuen Features, Bugfixes, Performance-Arbeit oder UI-Anpassungen **niemals verletzt** werden darf.

Dieses Dokument ist absichtlich strenger als normale Architektur- oder Implementationsdokumentation. Es beschreibt nicht, was heute zufällig im Code passiert, sondern was sicherheitlich **immer gelten muss**.

---

## Geltungsbereich

Diese Invarianten gelten für:

* Frontend (PWA / Browser)
* Backend (Node.js / Express)
* PostgreSQL-Datenmodell
* Authentifizierung und Autorisierung
* Draft-Sync und Monatsübertragung
* Admin-Funktionen, Exporte und Auswertungen
* Hosting auf VPS mit Nginx / PM2

---

## Grundannahmen

* Die App ist ein **internes System**, aber trotzdem sicherheitsrelevant.
* Die App verarbeitet personenbezogene Arbeitszeit-, Absenz-, Konto- und Auswertungsdaten.
* Auch interne Systeme müssen so gebaut werden, dass Fehlbedienung, Rechteausweitung, Datenvermischung und stiller Datenverlust verhindert werden.
* Frontend-Code, Browser-Storage und Client-seitige Zustände gelten **nie** als Vertrauensgrenze.

---

## 1. Identität und Sessions

### 1.1 Authentifizierung ist rein serverseitig gültig

* Ein Benutzer gilt nur dann als authentifiziert, wenn der Server eine gültige, nicht widerrufene Session erkennt.
* Ein Client-seitiges User-Objekt, ein Token im Browser oder ein sichtbarer Admin-Tab sind **kein** Beweis für Berechtigung.

### 1.2 Nur aktive Benutzer dürfen Zugriff haben

* Inaktive oder deaktivierte Benutzer dürfen keine gültige Fachaktion mehr ausführen.
* Wird ein Benutzer deaktiviert, muss jeder weitere Zugriff serverseitig scheitern, auch wenn noch ein altes Token existiert.

### 1.3 Jede geschützte Anfrage braucht eine gültige Session

* Jeder geschützte API-Endpunkt muss serverseitig eine gültige Session verlangen.
* Fehlt die Session oder ist sie ungültig, muss der Request fehlschlagen.
* Fehlerfall = **fail closed**, nicht „best effort“.

### 1.4 Logout muss Sessions wirklich entwerten

* Logout darf nicht nur den Client-Zustand löschen.
* Die Session muss serverseitig widerrufen oder anderweitig ungültig gemacht werden.

### 1.5 Rollen dürfen nie aus dem Client abgeleitet werden

* Ob jemand Admin ist, wird serverseitig aus dem autoritativen Benutzerzustand bestimmt.
* Frontend-Rolleninfos dienen nur der Darstellung, nie der Freigabe privilegierter Aktionen.

---

## 2. Autorisierung und Scope

### 2.1 Standardregel: Benutzer arbeiten nur auf eigenen Daten

Ein normaler Benutzer darf ausschliesslich auf seine **eigenen** Daten zugreifen, insbesondere auf:

* eigene Drafts
* eigene Übertragungen
* eigene Absenzen
* eigene Konten
* eigene Wochen-Sperr-Ansicht
* eigene Stempel- und Pikett-Daten

### 2.2 Fremdzugriffe brauchen explizite serverseitige Berechtigung

* Jeder Zugriff auf Daten anderer Benutzer braucht eine explizite serverseitige Prüfung.
* Ein clientseitig gesendeter `userId`, `username`, `teamId` oder ähnlicher Wert darf niemals allein als Autorisierungsgrundlage dienen.

### 2.3 Admin-Rechte sind explizit und eng zu prüfen

* Admin-Endpunkte dürfen nur nach erfolgreicher Authentifizierung **und** expliziter Admin-Prüfung ausgeführt werden.
* „Im UI versteckt“ ist keine Sicherheitsmassnahme.

### 2.4 Team-Zugehörigkeit ist keine automatische Berechtigung

* Teamdaten oder Teamfilter dürfen nur dann als Zugriffskriterium dienen, wenn diese Regel serverseitig explizit umgesetzt ist.
* Eine Team-Zugehörigkeit darf nicht stillschweigend als Vollzugriff auf alle Teamdaten interpretiert werden.

---

## 3. Schutz der fachlich kritischen Daten

### 3.1 Drafts sind benutzerspezifisch isoliert

* Ein Draft gehört immer genau einem authentifizierten Benutzer.
* Ein Benutzer darf nie Draft-Daten eines anderen Benutzers lesen oder überschreiben.
* Draft-Sync muss immer an die serverseitig festgestellte Identität gebunden sein, nie an frei gesendete Benutzerparameter.

### 3.2 Monatliche Übertragungen sind fachlich nachvollziehbar

* Jede Monatsübertragung muss als eigener nachvollziehbarer Zustand persistiert werden.
* Eine Übertragung darf nicht still und spurlos frühere fachliche Wahrheit überschreiben.
* Übertragungen müssen einer eindeutigen Identität, einem Zeitraum und einem Empfangszeitpunkt zuordenbar sein.

### 3.3 Kontenänderungen müssen reproduzierbar sein

* Änderungen an Ferien-, Vorarbeit- oder ÜZ-Konten müssen aus fachlichen Primärdaten nachvollziehbar oder rekonstruierbar sein.
* Kontoänderungen dürfen nicht als nicht erklärbarer Seiteneffekt entstehen.

### 3.4 Arbeitszeitmodelle und Jahreskonfigurationen sind hochkritisch

* Arbeitszeitmodelle, Feiertage, Brückentage und jährliche Payroll-Konfigurationen beeinflussen Sollzeiten, Überzeit und Abrechnungen.
* Änderungen daran sind sicherheits- und abrechnungsrelevant und dürfen nur kontrolliert erfolgen.

---

## 4. Schreibschutz und Zustandsgrenzen

### 4.1 Gesperrte Wochen dürfen nicht umgangen werden

* Eine gesperrte Woche darf durch normale Benutzer nicht mehr frei verändert werden.
* Dieser Schutz darf nicht durch alternative Pfade umgangen werden, insbesondere nicht über:

  * Draft-Sync
  * manuelle Stempelbearbeitung
  * Monatsübertragung
  * Auto-Transmit
  * nachträgliche lokale Rehydration aus dem Browser

### 4.2 Übertragene Monate sind besonders geschützt

* Bereits übertragene Monatsdaten dürfen nicht unkontrolliert verändert werden.
* Wenn Korrekturen nach Übertragung zulässig sind, brauchen sie einen expliziten, nachvollziehbaren Prozess.
* Eine UI-Aktion darf keine bereits bestätigte Monatswahrheit still revidieren.

### 4.3 Fachlich relevante Statuswechsel sind serverseitig massgeblich

* Ob ein Monat übertragen, eine Woche gesperrt, eine Absenz akzeptiert oder eine Session widerrufen ist, muss serverseitig entschieden werden.
* Der Client darf solche Status nie nur lokal simulieren.

---

## 5. Auditierbarkeit

### 5.1 Manuelle Stempelkorrekturen sind auditpflichtig

* Jede manuelle Bearbeitung von Stempeln muss nachvollziehbar protokolliert werden.
* Ein Audit-Eintrag muss mindestens fachlich rekonstruierbar machen:

  * wer geändert hat
  * wann geändert wurde
  * was geändert wurde
  * auf welchen Benutzer / Tag sich die Änderung bezog

### 5.2 Normale Stempelung und manuelle Korrektur dürfen nicht vermischt werden

* Laufende Ein-/Aus-Stempelung ist fachlich etwas anderes als eine nachträgliche manuelle Korrektur.
* Diese beiden Vorgänge müssen unterscheidbar bleiben.

### 5.3 Exporte und Audit-Dokumente müssen auf serverautorisierter Datenbasis beruhen

* Präsenz-Audit-PDFs, Payroll-Exporte und Admin-Auswertungen dürfen nur auf serverseitig autorisierten und konsistenten Daten basieren.

---

## 6. Draft-Sync und Konfliktauflösung

### 6.1 Browser-Storage ist nur Cache, nicht Source of Truth

* `localStorage` dient als Arbeitsentwurf und Offline-/Zwischenspeicher.
* Fachlich massgebliche Persistenz entsteht erst auf dem Server.

### 6.2 Kein Sync vor abgeschlossenem Initial-Load

* Vor dem vollständigen Laden des serverseitigen Zustands darf kein automatischer Sync alte oder leere lokale Daten auf den Server schreiben.
* Schutzmechanismen gegen vorschnellen Sync dürfen nicht entfernt werden, ohne einen gleichwertigen Ersatz einzuführen.

### 6.3 Erfolgreich gespeichert heisst: serverseitig bestätigt

* Ein Zustand gilt erst dann als sicher gespeichert, wenn der Server den Sync erfolgreich bestätigt hat.
* Lokale Timestamps oder UI-Indikatoren dürfen nicht vortäuschen, dass ein Server-Sync erfolgreich war, wenn das nicht stimmt.

### 6.4 Konfliktregel muss konsistent bleiben

* Wenn der Serverstand neuer ist als der lokale Stand, gewinnt der Server.
* Diese Regel darf nicht inkonsistent zwischen Frontend und Backend auseinanderlaufen.

### 6.5 Sync darf nie benutzerübergreifend wirken

* Ein Sync eines Benutzers darf unter keinen Umständen Daten eines anderen Benutzers beeinflussen.

---

## 7. Rechenlogik und Abrechnungsintegrität

### 7.1 Fachlich kritische Berechnungen sind serverautoritativ

Folgende fachlich sensiblen Berechnungen dürfen nicht allein vom Frontend abhängen:

* Tagessoll
* ÜZ1 / Vorarbeit
* Konto-Updates nach Übertragung
* Payroll-/Abrechnungsdaten
* Wochen-/Monatsstatus mit Sperrwirkung

### 7.2 Anzeige ist nicht Wahrheit

* Frontend-Anzeigen, Dashboard-Karten oder lokale Vorschauen sind nur Darstellung.
* Die fachlich verbindliche Wahrheit liegt in serverseitig berechneten und persistierten Zuständen.

### 7.3 Client- und Serverkonfigurationen dürfen nicht fachlich auseinanderlaufen

* Kalenderlogik wie Feiertage, Brückentage oder ähnliche Referenzdaten darf zwischen Frontend und Backend nicht unbemerkt divergieren.
* Wenn clientseitige Spiegelungen existieren, muss klar sein, dass die Serverlogik massgeblich bleibt.

---

## 8. Absenzen und HR-relevante Prozesse

### 8.1 Absenzstatus sind serverseitig autoritativ

* Ob eine Absenz pending, accepted, auto-accepted, cancelled oder gelöscht ist, wird serverseitig bestimmt.
* Der Client darf daraus keine eigene Wahrheit ableiten.

### 8.2 Nur zulässige Statusübergänge sind erlaubt

* Ein Benutzer darf nur die Statusübergänge ausführen, die seinem Prozessschritt entsprechen.
* Beispiel: normale Benutzer dürfen nicht eigenmächtig akzeptierte Absenzen umklassifizieren.

### 8.3 HR-/Admin-Sonderfälle dürfen die Invarianten nicht unterlaufen

* Wenn gewisse Fälle manuell durch HR / Administration behandelt werden, darf das nicht bedeuten, dass fachliche oder sicherheitliche Nachvollziehbarkeit verloren geht.

---

## 9. Browser- und Frontend-Sicherheit

### 9.1 Alles im Browser ist potenziell manipulierbar

* Lokale Daten, Tokens, Rolleninfos, UI-Sichtbarkeit und JavaScript-Zustände sind angreifbar oder manipulierbar.
* Darum darf der Server nie auf Client-Zustände vertrauen.

### 9.2 XSS ist hochkritisch

* Da Auth-Session und Draft-/Arbeitsdaten im Browser gespeichert werden können, ist Cross-Site-Scripting besonders kritisch.
* Jede XSS-Lücke hätte potenziell Zugriff auf:

  * Auth-Token
  * lokale Drafts
  * Benutzerkontext
  * personenbezogene Zeitdaten

### 9.3 Keine unkontrollierte HTML-Injektion

* Benutzer- oder serverseitig gelieferte Inhalte dürfen nicht unkontrolliert in `innerHTML` oder äquivalente HTML-Sinks geschrieben werden.
* Falls HTML-Insertion nötig ist, müssen die Daten sicher kontrolliert oder sanitisiert sein.

### 9.4 Frontend darf Berechtigungsgrenzen nicht vorspiegeln

* Das Ausblenden von Tabs oder Buttons ist nur UX.
* Sicherheitsgrenzen entstehen ausschliesslich im Backend.

---

## 10. Secrets, Konfiguration und Deployment

### 10.1 Keine produktiven Secrets im Repo

* Datenbank-Zugangsdaten, Seed-Passwörter, Tokens, API-Keys oder andere Secrets dürfen nicht hartkodiert oder im öffentlich zugänglichen Repo liegen.
* Beispielwerte oder lokale Entwicklungswerte sind klar von produktiven Secrets zu trennen.

### 10.2 Geleakte oder wiederverwendete Secrets müssen rotiert werden

* Wenn Zugangsdaten jemals in Doku, Commits, Screenshots oder Chats auftauchen, sind sie als kompromittiert zu behandeln und zu ersetzen.

### 10.3 CORS und Origin-Freigaben müssen explizit bleiben

* Zulässige Origins dürfen nicht unnötig breit geöffnet werden.
* Cross-Origin-Zugriffe müssen bewusst konfiguriert sein.

### 10.4 Produktion nur über abgesicherte Transportwege

* Zugriff auf die produktive App darf nur über korrekt terminierte HTTPS-Verbindungen erfolgen.
* Unverschlüsselter Zugriff auf Session-Tokens oder personenbezogene Daten ist unzulässig.

---

## 11. Eingabevalidierung und API-Härtung

### 11.1 Jede schreibende API validiert serverseitig

* Jeder schreibende Endpunkt muss serverseitig prüfen:

  * Datentypen
  * erlaubte Werte
  * Datumsgrenzen
  * Ownership / Scope
  * Prozessstatus
  * Rollenerfordernisse

### 11.2 Fachlich unmögliche Eingaben müssen abgelehnt werden

Beispiele:

* Stempel in der Zukunft
* ungültige Datumsbereiche
* negative oder unplausible Stundenwerte
* unzulässige Statuswerte
* Bearbeitungen in gesperrten Bereichen

### 11.3 Fehler müssen sicher scheitern

* Bei Unsicherheit, Validierungsfehlern oder inkonsistenter Identität muss der Request fehlschlagen.
* Kein „partial success“ ohne klare Kontrolle.

---

## 12. Transaktionen und Konsistenz

### 12.1 Mehrschrittige fachliche Updates müssen konsistent sein

Wenn ein fachlicher Vorgang mehrere Zustände verändert, muss verhindert werden, dass nur ein Teil davon geschrieben wird.

Besonders kritisch sind:

* Monatsübertragung + Konto-Update
* Admin-Korrekturen + Audit-Log
* Absenzentscheid + Folgeauswirkungen
* Arbeitszeitmodell-Änderungen mit Wirkung auf Auswertungen

### 12.2 Teilfehler dürfen keine unbemerkte Datenkorruption hinterlassen

* Ein Fehler in einem Mehrschritt-Prozess darf keine halbgeschriebenen, fachlich widersprüchlichen Zustände zurücklassen.

---

## 13. Auto-Transmit und Hintergrundjobs

### 13.1 Hintergrundjobs handeln im gleichen Sicherheitsmodell wie manuelle Aktionen

* Auto-Transmit darf fachlich keine schwächeren Prüfungen haben als eine manuelle Übertragung.
* Ein Hintergrundjob darf keine Daten schreiben, die ein normaler, sauber validierter Flow ablehnen würde.

### 13.2 Fehler einzelner Benutzer dürfen den Gesamtjob nicht blockieren

* Ein Fehler bei einem Benutzer darf den Gesamtjob nicht abbrechen.
* Gleichzeitig dürfen Fehler nicht stillschweigend verschluckt werden; sie müssen nachvollziehbar sein.

---

## 14. Logging und Datenschutz

### 14.1 Keine Secrets oder Tokens in Logs

* Access-Tokens, Passwörter, Datenbank-Zugangsdaten oder andere Geheimnisse dürfen nicht in Logs auftauchen.

### 14.2 Logs enthalten nur das Nötige

* Logs sollen genug Informationen für Betrieb und Debugging enthalten, aber keine unnötige Offenlegung personenbezogener Daten erzeugen.

### 14.3 PDFs und Exporte minimieren Datenoffenlegung

* Export- und Audit-Funktionen dürfen nur die Daten enthalten, die für den jeweiligen Zweck erforderlich sind.
* Kein unbeabsichtigtes Leaken anderer Benutzer- oder Teamdaten.

---

## 15. Änderungsregeln

### 15.1 Diese Invarianten haben Vorrang vor Refactoring-Bequemlichkeit

* Wenn ein Refactor eine Invariant verletzt, ist der Refactor falsch.

### 15.2 Jede Änderung an Auth, Scope, Sperrlogik, Draft-Sync, Übertragung oder Audit ist high-risk

* Solche Änderungen brauchen explizite Prüfung, Tests und Review.

### 15.3 Sicherheitsrelevante Vereinfachungen brauchen bewusste Entscheidung

* Alles, was Zugriffsprüfung, Audit, Sperrlogik oder Datenisolation vereinfacht, muss als sicherheitsrelevante Entscheidung behandelt werden.

---

## Aktuelle Implementationshinweise für dieses Projekt

Diese Hinweise sind keine neuen Regeln, sondern wichtige Projektbeobachtungen für die Anwendung der Invarianten:

* Das Frontend arbeitet mit lokalem Browser-Storage für Drafts und Auth-Session.
* Die API arbeitet mit Bearer-Token-Sessions.
* Rollenprüfung erfolgt serverseitig.
* Manuelle Stempelbearbeitungen sind fachlich auditrelevant.
* Draft-Sync und serverseitige Konfliktauflösung sind zentrale Sicherheits- und Konsistenzmechanismen.

Diese Punkte machen insbesondere folgende Themen priorisiert:

* XSS-Vermeidung
* strikte serverseitige Scope-Prüfung
* Schutz gesperrter / übertragener Zustände
* konsistente Auditierung
* keine stillen Inkonsistenzen zwischen lokalem Zustand und Serverzustand

---

## Nicht-Ziele dieses Dokuments

Dieses Dokument beschreibt nicht:

* konkrete UI-Layouts
* Datei- oder Funktionsnamen als Architektur-Mapping
* Refactor-Schritte
* Business-Regeln zu Ferien, ÜZ oder Payroll im Detail

Diese Themen gehören in `business-rules.md` und spätere Architektur-/Implementationsdokumente.
