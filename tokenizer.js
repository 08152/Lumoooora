"use strict";

/*
=========================================================
LUMORA TOKENIZER
=========================================================

Keine Stopwords.
Jedes Wort bleibt erhalten, damit die KI möglichst viel
Bedeutung aus der ursprünglichen Nachricht bekommt.
=========================================================
*/


/*
=========================================================
TEXT NORMALISIEREN
=========================================================
*/

function normalizeText(text) {

  return String(text)
    .toLowerCase()

    // Deutsche Umlaute vereinheitlichen
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")

    // Unicode-Zeichen vereinheitlichen
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

    // Satzzeichen entfernen
    .replace(/[^a-z0-9\s]/g, " ")

    // Mehrere Leerzeichen zusammenfassen
    .replace(/\s+/g, " ")

    .trim();
}


/*
=========================================================
TOKENISIEREN
=========================================================

WICHTIG:
Es werden KEINE Stopwords entfernt.

"Hallo wie geht es dir?"

wird zu:

[
  "hallo",
  "wie",
  "geht",
  "es",
  "dir"
]
=========================================================
*/

function tokenize(text) {

  const normalized =
    normalizeText(text);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+/)
    .filter(token => token.length > 0);
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
KOMPLETTE VERARBEITUNG
=========================================================
*/

function process(text) {

  const normalized =
    normalizeText(text);

  const tokens =
    tokenize(text);

  const unique =
    uniqueTokens(tokens);

  return {

    original:
      String(text),

    normalized,

    tokens,

    unique

  };

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
    return process(text);
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

  uniqueTokens,

  process

};
