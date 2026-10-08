"use strict";

/*
=========================================================
LUMORA GENERATOR
=========================================================

Erzeugt aus relevanten Informationen eine neue Antwort.

Es wird NICHT einfach nur das Antwortfeld kopiert.
Die Informationen werden gesammelt und neu formuliert.
=========================================================
*/


function cleanText(text) {

  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();

}


function splitSentences(text) {

  return cleanText(text)
    .split(/[.!?]+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 2);

}


function unique(array) {

  return [...new Set(array)];
}


/*
=========================================================
TEXT AUS JSON-DATEN HOLEN
=========================================================
*/

function extractInformation(document) {

  const information = [];

  /*
    Antwortfeld
  */

  if (document.answer) {

    information.push(
      cleanText(document.answer)
    );

  }


  /*
    Frage kann ebenfalls Kontext liefern
  */

  if (document.question) {

    information.push(
      cleanText(document.question)
    );

  }


  /*
    Sonstige JSON-Werte
  */

  if (document.fields) {

    for (const [, value] of document.fields) {

      const text = cleanText(value);

      if (
        text.length > 2 &&
        text.length < 1000
      ) {

        information.push(text);

      }

    }

  }


  return unique(
    information
  );

}


/*
=========================================================
RELEVANTE SÄTZE SAMMELN
=========================================================
*/

function collectSentences(documents) {

  const sentences = [];

  for (const document of documents) {

    const information =
      extractInformation(
        document
      );

    for (const text of information) {

      const parts =
        splitSentences(text);

      sentences.push(
        ...parts
      );

    }

  }


  return unique(
    sentences
  );

}


/*
=========================================================
SATZ AUS EINER INFORMATION ERZEUGEN
=========================================================
*/

function reformulate(sentence) {

  sentence =
    cleanText(sentence);


  if (!sentence) {
    return "";
  }


  const lower =
    sentence.charAt(0).toLowerCase() +
    sentence.slice(1);


  const templates = [

    `Dazu ist wichtig zu wissen: ${lower}.`,

    `Nach den vorliegenden Informationen gilt: ${lower}.`,

    `Die Daten zeigen, dass ${lower}.`,

    `Aus den verfügbaren Informationen lässt sich ableiten, dass ${lower}.`

  ];


  /*
    Einen deterministischen Index benutzen,
    damit gleiche Daten nicht bei jedem Request
    völlig zufällig reagieren.
  */

  let hash = 0;

  for (
    let i = 0;
    i < sentence.length;
    i++
  ) {

    hash =
      (
        hash * 31 +
        sentence.charCodeAt(i)
      ) >>> 0;

  }


  return templates[
    hash % templates.length
  ];

}


/*
=========================================================
NEUE ANTWORT GENERIEREN
=========================================================
*/

function generateAnswer(
  message,
  rankedDocuments
) {

  /*
    Nur die besten Treffer verwenden.
  */

  const relevant =
    rankedDocuments
      .filter(
        item => item.score > 0.05
      )
      .slice(0, 5)
      .map(
        item => item.document
      );


  if (!relevant.length) {

    return (
      "Ich finde in meinen Daten " +
      "keine ausreichenden Informationen " +
      "zu dieser Frage."
    );

  }


  const sentences =
    collectSentences(
      relevant
    );


  if (!sentences.length) {

    return (
      "Ich habe passende Daten gefunden, " +
      "kann daraus aber noch keine Antwort erzeugen."
    );

  }


  /*
    Maximal einige relevante Sätze benutzen.
  */

  const selected =
    sentences.slice(0, 4);


  /*
    Neue Antwort zusammenbauen.
  */

  const generated = [];


  generated.push(
    "Ich habe dazu Folgendes gefunden:"
  );


  for (
    const sentence
    of selected
  ) {

    generated.push(
      reformulate(
        sentence
      )
    );

  }


  /*
    Kleine Schlussformulierung
  */

  if (generated.length > 2) {

    generated.push(
      "Diese Antwort wurde aus den " +
      "relevanten Informationen meiner Datenbasis " +
      "zusammengestellt."
    );

  }


  return generated.join(" ");

}


module.exports = {
  generateAnswer
};
