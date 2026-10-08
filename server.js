"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const {
  Tokenizer,
  normalizeText
} = require("./tokenizer");

const {
  generateAnswer
} = require("./generator");


/*
=========================================================
KONFIGURATION
=========================================================
*/

const PORT = process.env.PORT || 10000;

const ROOT = __dirname;

const DATA_DIR = path.join(ROOT, "DATEN");

const INDEX_FILE = path.join(ROOT, "index.html");


/*
=========================================================
TOKENIZER
=========================================================
*/

const tokenizer = new Tokenizer();


/*
=========================================================
DATENBANK
=========================================================
*/

let documents = [];

let idf = new Map();


/*
=========================================================
JSON IN TEXT UMWANDELN
=========================================================
*/

function flattenJson(value, prefix = "") {

  const result = [];


  /*
  Objekt
  */

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {

    for (
      const [key, child]
      of Object.entries(value)
    ) {

      const nextPrefix =
        prefix
          ? `${prefix}.${key}`
          : key;


      result.push(
        ...flattenJson(
          child,
          nextPrefix
        )
      );

    }

    return result;
  }


  /*
  Array
  */

  if (Array.isArray(value)) {

    value.forEach(
      (child, index) => {

        result.push(
          ...flattenJson(
            child,
            `${prefix}[${index}]`
          )
        );

      }
    );

    return result;
  }


  /*
  Einzelner Wert
  */

  result.push([
    prefix,
    String(value ?? "")
  ]);


  return result;
}


/*
=========================================================
FELD REKURSIV FINDEN
=========================================================
*/

function findFieldRecursive(
  record,
  names
) {

  if (
    !record ||
    typeof record !== "object"
  ) {

    return null;
  }


  const wanted =
    names.map(
      name =>
        String(name).toLowerCase()
    );


  /*
  Objekt
  */

  if (!Array.isArray(record)) {

    /*
    Erst direkte Felder prüfen
    */

    for (
      const [key, value]
      of Object.entries(record)
    ) {

      if (
        wanted.includes(
          String(key).toLowerCase()
        )
      ) {

        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {

          return String(value);

        }
      }
    }


    /*
    Danach verschachtelte Felder
    */

    for (
      const value
      of Object.values(record)
    ) {

      const found =
        findFieldRecursive(
          value,
          names
        );


      if (found !== null) {

        return found;

      }
    }

  }


  /*
  Array
  */

  else {

    for (
      const value
      of record
    ) {

      const found =
        findFieldRecursive(
          value,
          names
        );


      if (found !== null) {

        return found;

      }
    }
  }


  return null;
}


/*
=========================================================
FRAGE FINDEN
=========================================================
*/

function findQuestion(record) {

  return findFieldRecursive(
    record,
    [
      "frage",
      "question",
      "prompt",
      "input",
      "anfrage",
      "user",
      "message",
      "nachricht"
    ]
  );
}


/*
=========================================================
ANTWORT FINDEN
=========================================================
*/

function findAnswer(record) {

  return findFieldRecursive(
    record,
    [
      "antwort",
      "answer",
      "response",
      "reply",
      "ausgabe",
      "output",
      "text"
    ]
  );
}


/*
=========================================================
ALLE JSON-DATEIEN FINDEN
=========================================================
*/

function listJsonFiles(directory) {

  const files = [];


  if (!fs.existsSync(directory)) {

    return files;

  }


  const entries =
    fs.readdirSync(
      directory,
      {
        withFileTypes: true
      }
    );


  for (
    const entry
    of entries
  ) {

    const fullPath =
      path.join(
        directory,
        entry.name
      );


    /*
    Unterordner
    */

    if (entry.isDirectory()) {

      files.push(
        ...listJsonFiles(
          fullPath
        )
      );

      continue;
    }


    /*
    JSON-Datei
    */

    if (
      entry.isFile() &&
      entry.name
        .toLowerCase()
        .endsWith(".json")
    ) {

      files.push(
        fullPath
      );

    }
  }


  return files;
}


/*
=========================================================
DATENSATZ HINZUFÜGEN
=========================================================
*/

function addDocument(
  filePath,
  data,
  arrayIndex = null
) {

  /*
  Alle JSON-Werte auslesen
  */

  const fields =
    flattenJson(data);


  /*
  Frage finden
  */

  const question =
    findQuestion(data);


  /*
  Antwort finden
  */

  const answer =
    findAnswer(data);


  /*
  Suchtext bauen
  */

  let searchText =
    fields
      .map(
        ([, value]) => value
      )
      .join(" ");


  /*
  Wenn eine Frage vorhanden ist,
  wird sie stärker gewichtet.
  */

  if (question) {

    searchText =
      `${question} ${question} ${searchText}`;

  }


  /*
  TOKENIZER
  */

  const tokens =
    tokenizer.unique(
      tokenizer.tokenize(
        searchText
      )
    );


  /*
  Datensatz speichern
  */

  documents.push({

    file:
      path.relative(
        DATA_DIR,
        filePath
      ).replace(/\\/g, "/"),

    arrayIndex,

    data,

    fields,

    question,

    answer,

    text:
      searchText,

    tokens,

    vector:
      new Map()

  });

}


/*
=========================================================
ALLE DATEN LADEN
=========================================================
*/

function loadData() {

  documents = [];


  if (!fs.existsSync(DATA_DIR)) {

    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true
      }
    );

    console.log(
      "[WARNUNG] DATEN-Ordner wurde erstellt."
    );

  }


  const files =
    listJsonFiles(
      DATA_DIR
    );


  /*
  Jede JSON-Datei laden
  */

  for (
    const file
    of files
  ) {

    try {

      const raw =
        fs.readFileSync(
          file,
          "utf8"
        );


      const data =
        JSON.parse(raw);


      /*
      JSON-Array:
      jeder Eintrag = eigener Datensatz
      */

      if (Array.isArray(data)) {

        data.forEach(
          (item, index) => {

            addDocument(
              file,
              item,
              index
            );

          }
        );

      }


      /*
      Normales JSON-Objekt
      */

      else {

        addDocument(
          file,
          data
        );

      }

    }


    catch (error) {

      console.error(
        `[JSON FEHLER] ${file}:`,
        error.message
      );

    }

  }


  /*
  IDF neu berechnen
  */

  buildIdf();


  console.log(
    `[START] ${files.length} JSON-Dateien gefunden.`
  );


  console.log(
    `[START] ${documents.length} Datensätze geladen.`
  );

}


/*
=========================================================
IDF BERECHNEN
=========================================================
*/

function buildIdf() {

  idf = new Map();


  const documentFrequency =
    new Map();


  /*
  Wie oft kommt jedes Token vor?
  */

  for (
    const document
    of documents
  ) {

    const unique =
      new Set(
        document.tokens
      );


    for (
      const token
      of unique
    ) {

      documentFrequency.set(
        token,
        (
          documentFrequency.get(token) || 0
        ) + 1
      );

    }

  }


  const documentCount =
    Math.max(
      documents.length,
      1
    );


  /*
  IDF
  */

  for (
    const [
      token,
      frequency
    ]
    of documentFrequency
  ) {

    const value =
      Math.log(
        (1 + documentCount) /
        (1 + frequency)
      ) + 1;


    idf.set(
      token,
      value
    );

  }


  /*
  Vektoren vorberechnen
  */

  for (
    const document
    of documents
  ) {

    document.vector =
      vectorize(
        document.tokens
      );

  }

}


/*
=========================================================
TOKEN-VEKTOR
=========================================================
*/

function vectorize(tokens) {

  if (
    !tokens ||
    tokens.length === 0
  ) {

    return new Map();

  }


  const counts =
    new Map();


  /*
  Anzahl jedes Tokens
  */

  for (
    const token
    of tokens
  ) {

    counts.set(
      token,
      (
        counts.get(token) || 0
      ) + 1
    );

  }


  const total =
    tokens.length;


  const vector =
    new Map();


  /*
  TF-IDF
  */

  for (
    const [
      token,
      count
    ]
    of counts
  ) {

    const tf =
      count / total;


    const tokenIdf =
      idf.get(token) || 1;


    const weight =
      tf * tokenIdf;


    vector.set(
      token,
      weight
    );

  }


  return vector;
}


/*
=========================================================
COSINE SIMILARITY
=========================================================
*/

function cosineSimilarity(
  a,
  b
) {

  if (
    !a.size ||
    !b.size
  ) {

    return 0;

  }


  let dot = 0;

  let normA = 0;

  let normB = 0;


  /*
  Norm A
  */

  for (
    const value
    of a.values()
  ) {

    normA +=
      value * value;

  }


  /*
  Norm B
  */

  for (
    const value
    of b.values()
  ) {

    normB +=
      value * value;

  }


  /*
  Skalarprodukt
  */

  for (
    const [
      token,
      value
    ]
    of a
  ) {

    dot +=
      value *
      (
        b.get(token) || 0
      );

  }


  if (
    normA === 0 ||
    normB === 0
  ) {

    return 0;

  }


  return (
    dot /
    (
      Math.sqrt(normA) *
      Math.sqrt(normB)
    )
  );

}


/*
=========================================================
ÄHNLICHKEIT BERECHNEN
=========================================================
*/

function calculateSimilarity(
  message,
  queryTokens,
  document
) {

  /*
  Nachricht vektorisieren
  */

  const queryVector =
    vectorize(
      queryTokens
    );


  /*
  Grundwert
  */

  let score =
    cosineSimilarity(
      queryVector,
      document.vector
    );


  /*
  Normalisierte Texte
  */

  const query =
    normalizeText(
      message
    );


  const documentText =
    normalizeText(
      document.text
    );


  /*
  -------------------------------------------------------
  EXAKTE FRAGE
  -------------------------------------------------------
  */

  if (document.question) {

    const question =
      normalizeText(
        document.question
      );


    /*
    Vollkommen gleiche Frage
    */

    if (
      question === query
    ) {

      score += 2.0;

    }


    /*
    Frage enthält Nachricht
    */

    else if (
      question.includes(query) ||
      query.includes(question)
    ) {

      score += 0.7;

    }

  }


  /*
  -------------------------------------------------------
  GANZER TEXT
  -------------------------------------------------------
  */

  if (
    query.length >= 4 &&
    documentText.includes(query)
  ) {

    score += 0.35;

  }


  /*
  -------------------------------------------------------
  GEMEINSAME TOKEN
  -------------------------------------------------------
  */

  const documentTokens =
    new Set(
      document.tokens
    );


  let common =
    0;


  for (
    const token
    of queryTokens
  ) {

    if (
      documentTokens.has(token)
    ) {

      common++;

    }

  }


  /*
  Jedes gemeinsame Token gibt
  einen kleinen Zusatzwert.
  */

  score +=
    common * 0.04;


  return score;

}


/*
=========================================================
DATENBANK DURCHSUCHEN
=========================================================
*/

function search(
  message,
  clientTokens
) {

  let tokens;


  /*
  Tokens aus dem Browser übernehmen,
  wenn sie vorhanden sind.
  */

  if (
    Array.isArray(clientTokens) &&
    clientTokens.length > 0
  ) {

    tokens =
      clientTokens
        .map(String)
        .map(
          normalizeText
        )
        .filter(Boolean);

  }


  /*
  Sonst Tokenizer direkt benutzen.
  */

  else {

    tokens =
      tokenizer.unique(
        tokenizer.tokenize(
          message
        )
      );

  }


  /*
  JEDEN Datensatz bewerten
  */

  const ranked =
    documents
      .map(
        document => ({

          document,

          score:
            calculateSimilarity(
              message,
              tokens,
              document
            )

        })
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );


  return {

    tokens,

    ranked

  };

}


/*
=========================================================
JSON AN CLIENT SENDEN
=========================================================
*/

function sendJson(
  response,
  status,
  data
) {

  const body =
    JSON.stringify(
      data
    );


  response.writeHead(
    status,
    {

      "Content-Type":
        "application/json; charset=utf-8",

      "Content-Length":
        Buffer.byteLength(
          body
        )

    }
  );


  response.end(
    body
  );

}


/*
=========================================================
REQUEST BODY LESEN
=========================================================
*/

function readBody(
  request
) {

  return new Promise(
    (resolve, reject) => {

      let body = "";


      request.on(
        "data",
        chunk => {

          body += chunk;


          /*
          Maximal 1 MB
          */

          if (
            body.length > 1000000
          ) {

            reject(
              new Error(
                "Nachricht zu groß."
              )
            );


            request.destroy();

          }

        }
      );


      request.on(
        "end",
        () => {

          resolve(
            body
          );

        }
      );


      request.on(
        "error",
        error => {

          reject(
            error
          );

        }
      );

    }
  );

}


/*
=========================================================
HTTP SERVER
=========================================================
*/

const server =
  http.createServer(
    async (
      request,
      response
    ) => {

      try {

        const parsed =
          url.parse(
            request.url,
            true
          );


        /*
        =================================================
        STARTSEITE
        =================================================
        */

        if (
          request.method === "GET" &&
          parsed.pathname === "/"
        ) {

          if (
            !fs.existsSync(
              INDEX_FILE
            )
          ) {

            response.writeHead(
              404,
              {
                "Content-Type":
                  "text/plain; charset=utf-8"
              }
            );


            response.end(
              "index.html fehlt."
            );


            return;

          }


          const html =
            fs.readFileSync(
              INDEX_FILE
            );


          response.writeHead(
            200,
            {

              "Content-Type":
                "text/html; charset=utf-8"

            }
          );


          response.end(
            html
          );


          return;

        }


        /*
        =================================================
        HEALTH CHECK
        =================================================
        */

        if (
          request.method === "GET" &&
          parsed.pathname === "/api/health"
        ) {

          sendJson(
            response,
            200,
            {

              ok: true,

              documents:
                documents.length,

              dataFolder:
                "DATEN",

              tokenizer:
                "aktiv"

            }
          );


          return;

        }


        /*
        =================================================
        NEU LADEN
        =================================================
        */

        if (
          request.method === "POST" &&
          parsed.pathname === "/api/reload"
        ) {

          loadData();


          sendJson(
            response,
            200,
            {

              ok: true,

              documents:
                documents.length,

              message:
                "Daten neu geladen."

            }
          );


          return;

        }


        /*
        =================================================
        CHAT API
        =================================================
        */

        if (
          request.method === "POST" &&
          parsed.pathname === "/api/chat"
        ) {

          const raw =
            await readBody(
              request
            );


          let payload;


          /*
          JSON des Requests lesen
          */

          try {

            payload =
              JSON.parse(
                raw
              );

          }


          catch {

            sendJson(
              response,
              400,
              {

                error:
                  "Ungültiges Request-JSON."

              }
            );


            return;

          }


          /*
          Nachricht
          */

          const message =
            String(
              payload.message || ""
            ).trim();


          /*
          Keine Nachricht
          */

          if (!message) {

            sendJson(
              response,
              400,
              {

                error:
                  "Keine Nachricht übergeben."

              }
            );


            return;

          }


          /*
          Keine Daten
          */

          if (
            documents.length === 0
          ) {

            sendJson(
              response,
              503,
              {

                error:
                  "Keine JSON-Dateien im Ordner DATEN gefunden."

              }
            );


            return;

          }


          /*
          =================================================
          SUCHE
          =================================================
          */

          const result =
            search(
              message,
              payload.tokens
            );


          /*
          Bester Treffer
          */

          const best =
            result.ranked[0];


          /*
          Mindestwert
          */

          const MINIMUM_SCORE =
            0.05;


          /*
          =================================================
          KEIN TREFFER
          =================================================
          */

          if (
            !best ||
            best.score < MINIMUM_SCORE
          ) {

            sendJson(
              response,
              200,
              {

                answer:
                  "Dazu habe ich in meiner Datenbasis keine ausreichenden Informationen gefunden.",

                matches:
                  0,

                documents:
                  documents.length,

                tokens:
                  result.tokens,

                confidence:
                  0

              }
            );


            return;

          }


          /*
          =================================================
          RELEVANTE TREFFER
          =================================================
          */

          const top =
            result.ranked
              .filter(
                item =>
                  item.score >=
                  Math.max(
                    MINIMUM_SCORE,
                    best.score * 0.6
                  )
              )
              .slice(
                0,
                5
              );


          /*
          =================================================
          NEUE ANTWORT GENERIEREN
          =================================================

          generator.js bekommt die relevanten
          Datensätze und erstellt daraus eine neue Antwort.
          */

          let answer;


          try {

            answer =
              generateAnswer(
                message,
                top
              );

          }


          catch (error) {

            console.error(
              "[GENERATOR FEHLER]",
              error
            );


            answer =
              "Ich habe passende Informationen gefunden, konnte daraus aber keine Antwort erzeugen.";

          }


          /*
          =================================================
          ANTWORT
          =================================================
          */

          sendJson(
            response,
            200,
            {

              answer,

              matches:
                top.length,

              documents:
                documents.length,

              /*
              DAS sind jetzt die echten Tokens.
              Keine Stopwords werden entfernt.
              */

              tokens:
                result.tokens,

              source:
                best.document.file,

              confidence:
                Number(
                  best.score.toFixed(4)
                ),

              alternatives:
                top.map(
                  item => ({

                    file:
                      item.document.file,

                    score:
                      Number(
                        item.score.toFixed(4)
                      )

                  })
                )

            }
          );


          return;

        }


        /*
        =================================================
        404
        =================================================
        */

        response.writeHead(
          404,
          {

            "Content-Type":
              "text/plain; charset=utf-8"

          }
        );


        response.end(
          "Nicht gefunden."
        );

      }


      catch (error) {

        console.error(
          "[SERVER FEHLER]",
          error
        );


        sendJson(
          response,
          500,
          {

            error:
              "Interner Serverfehler."

          }
        );

      }

    }
  );


/*
=========================================================
DATEN LADEN
=========================================================
*/

loadData();


/*
=========================================================
SERVER STARTEN
=========================================================
*/

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "=========================================="
    );

    console.log(
      "LUMORA gestartet"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `JSON-Daten: ${documents.length}`
    );

    console.log(
      "Tokenizer: aktiv"
    );

    console.log(
      "Generator: aktiv"
    );

    console.log(
      "=========================================="
    );

  }
);
