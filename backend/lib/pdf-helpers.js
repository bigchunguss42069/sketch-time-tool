'use strict';

/**
 * @fileoverview PDF-Hilfsfunktionen für Lohnabrechnung und Präsenz-Audit
 *
 * Da PDFKit ein `doc`-Objekt als Kontext braucht, werden die Helpers
 * via Factory-Funktion `createPdfHelpers(doc)` erzeugt.
 *
 * Verwendung:
 * ```js
 * const { createPdfHelpers, fmtHours, fmtSignedHours, fmtCount, fmtDays } = require('./lib/pdf-helpers');
 *
 * const doc = new PDFDocument({ ... });
 * const { ensurePdfSpace, sectionTitle, writeMetricLines } = createPdfHelpers(doc);
 * ```
 *
 * Formatierungsfunktionen (fmtHours etc.) sind doc-unabhängig und direkt exportiert.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Formatierungsfunktionen (doc-unabhängig, direkt verwendbar)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatiert eine Stundenzahl als positiven Wert mit Komma.
 *
 * @param {*} v
 * @returns {string} z.B. "8,5 h"
 */
function fmtHours(v) {
  return `${(Number(v) || 0).toFixed(1).replace('.', ',')} h`;
}

/**
 * Formatiert eine Stundenzahl mit Vorzeichen.
 *
 * @param {*} v
 * @returns {string} z.B. "+2,5 h", "-1,0 h", "0,0 h"
 */
function fmtSignedHours(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n).toFixed(1).replace('.', ',');
  if (n > 0) return `+${abs} h`;
  if (n < 0) return `-${abs} h`;
  return '0,0 h';
}

/**
 * Formatiert eine Anzahl Tage mit Komma.
 *
 * @param {*} v
 * @returns {string} z.B. "2,5 Tage"
 */
function fmtDays(v) {
  return `${String(Number(v) || 0).replace('.', ',')} Tage`;
}

/**
 * Formatiert eine Ganzzahl (für Mahlzeiten, Zulagen etc.).
 *
 * @param {*} v
 * @returns {string} z.B. "3"
 */
function fmtCount(v) {
  return String(Math.round(Number(v) || 0));
}

/**
 * Formatiert einen Vorarbeit-Saldo als "aktuell / ziel h".
 *
 * @param {*} filled - Aktueller Stand
 * @param {*} required - Ziel
 * @returns {string} z.B. "20,0 / 59,0 h"
 */
function fmtCounterHours(filled, required) {
  const f = (Number(filled) || 0).toFixed(1).replace('.', ',');
  const r = (Number(required) || 0).toFixed(1).replace('.', ',');
  return `${f} / ${r} h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF-Helpers Factory (braucht doc-Kontext)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt doc-gebundene PDF-Hilfsfunktionen.
 * Immer aufrufen nachdem `new PDFDocument(...)` erstellt wurde.
 *
 * @param {import('pdfkit')} doc - PDFKit Dokument-Instanz
 * @returns {{ ensurePdfSpace, sectionTitle, writeMetricLines }}
 */
function createPdfHelpers(doc) {
  /**
   * Stellt sicher dass genug Platz auf der aktuellen Seite ist.
   * Fügt eine neue Seite hinzu wenn nötig.
   *
   * @param {number} [height=24] - Benötigter Platz in Punkten
   */
  function ensurePdfSpace(height = 24) {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  }

  /**
   * Rendert einen fett formatierten Abschnittstitel mit Abstand.
   *
   * @param {string} text
   */
  function sectionTitle(text) {
    ensurePdfSpace(28);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(11).text(text);
    doc.moveDown(0.25);
  }

  /**
   * Rendert eine Liste von Label/Wert-Paaren als Zeilen.
   * Label ist fett, Wert ist normal.
   *
   * @param {Array<[string, string]>} items - Array von [label, value] Paaren
   *
   * @example
   * writeMetricLines([
   *   ['Präsenz', '170,0 h'],
   *   ['ÜZ1 roh', '+2,0 h'],
   * ]);
   */
  function writeMetricLines(items) {
    items.forEach(([label, value]) => {
      ensurePdfSpace(16);
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`${label}: `, { continued: true });
      doc.font('Helvetica').fontSize(9).text(value);
    });
  }

  return { ensurePdfSpace, sectionTitle, writeMetricLines };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Factory
  createPdfHelpers,

  // Formatierungsfunktionen
  fmtHours,
  fmtSignedHours,
  fmtDays,
  fmtCount,
  fmtCounterHours,
};
