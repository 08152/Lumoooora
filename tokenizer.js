"use strict";

/*
=========================================================
LUMORA TOKENIZER
=========================================================

Diese Datei ist ausschließlich für das Tokenisieren
und Normalisieren von Text zuständig.
=========================================================
*/

const STOPWORDS = new Set([
  "aber",
  "alle",
  "als",
  "also",
  "am",
  "an",
  "auch",
  "auf",
  "aus",
  "bei",
  "bin",
  "bis",
  "bist",
  "da",
  "dabei",
  "damit",
  "dann",
  "das",
  "dass",
  "dein",
  "dem",
  "den",
  "der",
  "des",
  "die",
  "dir",
  "doch",
  "du",
  "ein",
  "eine",
  "einem",
  "einen",
  "einer",
  "eines",
  "er",
  "es",
  "für",
  "ganz",
  "hat",
  "hast",
  "hier",
  "ich",
  "im",
  "in",
  "ist",
  "ja",
  "kann",
  "kein",
  "mit",
  "nach",
  "nicht",
  "noch",
  "nur",
  "oder",
  "sie",
  "sind",
  "so",
  "und",
  "uns",
  "vom",
  "von",
  "vor",
  "war",
  "was",
  "wie",
  "wir",
  "zu",
  "zum",
  "zur"
]);


/*
=========================================================
TEXT NORMALISIEREN
=========================================================
*/

function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/*
=========================================================
TOKENISIEREN
=========================================================
*/

function tokenize(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+/)
    .filter(token => token.length >= 2)
    .filter(token => !STOPWORDS.has(token));
}


/*
=========================================================
DOPPELTE TOKEN ENTFERNEN
=========================================================
*/

function uniqueTokens(tokens) {
  return [...new Set(tokens)];
}


/*
=========================================================
TOKENIZER-KLASSE
=========================================================
*/

class Tokenizer {

  normalize(text) {
    return normalizeText(text);
  }

  tokenize(text) {
    return tokenize(text);
  }

  unique(tokens) {
    return uniqueTokens(tokens);
  }

  process(text) {
    const normalized = this.normalize(text);
    const tokens = this.tokenize(text);
    const unique = this.unique(tokens);

    return {
      original: String(text),
      normalized,
      tokens,
      unique
    };
  }

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {
  Tokenizer,
  normalizeText,
  tokenize,
  uniqueTokens
};
