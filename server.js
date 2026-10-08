"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const {
  Tokenizer,
  normalizeText,
  tokenize
} = require("./tokenizer");


/*
=========================================================
KONFIGURATION
=========================================================
*/

const PORT = process.env.PORT || 10000;

const ROOT = __dirname;

const DATA_DIR =
  path.join(ROOT, "DATEN");

const INDEX_FILE =
  path.join(ROOT, "index.html");


const tokenizer = new Tokenizer();

let documents = [];
let idf = new Map();


/*
=========================================================
JSON REKURSIV DURCHSUCHEN
=========================================================
*/

function flattenJson(value, prefix = "") {

  const result = [];

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {

    for (const [key, child] of Object.entries(value)) {

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


  if (Array.isArray(value)) {

    value.forEach((child, index) => {

      result.push(
        ...flattenJson(
          child,
          `${prefix}[${index}]`
        )
      );

    });

    return result;
  }


  result.push([
    prefix,
    String(value ?? "")
  ]);

  return result;
}


/*
=========================================================
FELD REKURSIV SUCHEN
=========================================================
*/

function findFieldRecursive(record, names) {

  if (
    !record ||
    typeof record !== "object"
  ) {
    return null;
  }

  const wanted =
    names.map(
      name => name.toLowerCase()
    );


  if (!Array.isArray(record)) {

    for (
      const [key, value]
      of Object.entries(record)
    ) {

      if (
        wanted.includes(
          String(key).toLowerCase()
        ) &&
        (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        )
      ) {

        return String(value);
      }
    }


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

  } else {

    for (const value of record) {

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
FRAGE / ANTWORT
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
ALLE JSON-DATEIEN LADEN
=========================================================
*/

function listJsonFiles(directory) {

  const files = [];

  if (!fs.existsSync(directory)) {
    return files;
  }


  for (
    const entry
    of fs.readdirSync(
      directory,
      { withFileTypes: true }
    )
  ) {

    const fullPath =
      path.join(
        directory,
        entry.name
      );


    if (entry.isDirectory()) {

      files.push(
        ...listJsonFiles(fullPath)
      );

    }

    else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".json")
    ) {

      files.push(fullPath);

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

  const fields =
    flattenJson(data);


  const question =
    findQuestion(data);


  const answer =
    findAnswer(data);


  let searchText =
    fields
      .map(
        ([, value]) => value
      )
      .join(" ");


  /*
    Frage doppelt gewichten
  */

  if (question) {

    searchText =
      `${question} ${question} ${searchText}`;
  }


  const tokens =
    tokenizer.unique(
      tokenizer.tokenize(
        searchText
      )
    );


  documents.push({

    file:
      path.relative(
        DATA_DIR,
        filePath
      ).replace(/\\/g, "/"),

    arrayIndex,

    data,

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
DATEN LADEN
=========================================================
*/

function loadData() {

  documents = [];

  const files =
    listJsonFiles(
      DATA_DIR
    );


  for (const file of files) {

    try {

      const raw =
        fs.readFileSync(
          file,
          "utf8"
        );


      const data =
        JSON.parse(raw);


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

      } else {

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


  for (const document of documents) {

    const unique =
      new Set(
        document.tokens
      );


    for (const token of unique) {

      documentFrequency.set(
        token,
        (documentFrequency.get(token) || 0) + 1
      );

    }
  }


  const documentCount =
    Math.max(
      documents.length,
      1
    );


  for (
    const [
      token,
      frequency
    ]
    of documentFrequency
  ) {

    idf.set(
      token,
      Math.log(
        (1 + documentCount) /
        (1 + frequency)
      ) + 1
    );
  }


  for (const document of documents) {

    document.vector =
      vectorize(
        document.tokens
      );

  }
}


/*
=========================================================
VEKTOR
=========================================================
*/

function vectorize(tokens) {

  if (!tokens.length) {
    return new Map();
  }


  const counts =
    new Map();


  for (const token of tokens) {

    counts.set(
      token,
      (counts.get(token) || 0) + 1
    );

  }


  const total =
    tokens.length;


  const vector =
    new Map();


  for (
    const [token, count]
    of counts
  ) {

    const tf =
      count / total;


    const weight =
      tf *
      (idf.get(token) || 1);


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

function cosineSimilarity(a, b) {

  if (!a.size || !b.size) {
    return 0;
  }


  let dot = 0;
  let normA = 0;
  let normB = 0;


  for (const value of a.values()) {

    normA +=
      value * value;

  }


  for (const value of b.values()) {

    normB +=
      value * value;

  }


  for (
    const [token, value]
    of a
  ) {

    dot +=
      value *
      (b.get(token) || 0);

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
ÄHNLICHKEIT
=========================================================
*/

function calculateSimilarity(
  message,
  queryTokens,
  document
) {

  const queryVector =
    vectorize(
      queryTokens
    );


  let score =
    cosineSimilarity(
      queryVector,
      document.vector
    );


  const query =
    normalizeText(
      message
    );


  const documentText =
    normalizeText(
      document.text
    );


  /*
    Exakte Frage
  */

  if (document.question) {

    const question =
      normalizeText(
        document.question
      );


    if (question === query) {

      score += 2;

    }

    else if (
      question.includes(query) ||
      query.includes(question)
    ) {

      score += 0.7;

    }
  }


  /*
    Exakter Text
  */

  if (
    query.length >= 4 &&
    documentText.includes(query)
  ) {

    score += 0.35;

  }


  /*
    Gemeinsame Token
  */

  const documentTokens =
    new Set(
      document.tokens
    );


  let common =
    0;


  for (const token of queryTokens) {

    if (
      documentTokens.has(token)
    ) {

      common++;

    }
  }


  score +=
    common * 0.04;


  return score;
}


/*
=========================================================
ANTWORT AUS DATEN
=========================================================
*/

function getAnswer(document) {

  if (document.answer) {

    return document.answer;

  }


  return JSON.stringify(
    document.data,
    null,
    2
  );
}


/*
=========================================================
SUCHEN
=========================================================
*/

function search(
  message,
  clientTokens
) {

  let tokens;


  /*
    Tokenizer aus dem Browser
    übernehmen.
  */

  if (
    Array.isArray(clientTokens) &&
    clientTokens.length > 0
  ) {

    tokens =
      clientTokens
        .map(String)
        .map(normalizeText)
        .filter(Boolean);

  } else {

    tokens =
      tokenizer.unique(
        tokenizer.tokenize(
          message
        )
      );
  }


  const ranked =
    documents
      .map(document => ({

        document,

        score:
          calculateSimilarity(
            message,
            tokens,
            document
          )

      }))
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
JSON SENDEN
=========================================================
*/

function sendJson(
  response,
  status,
  data
) {

  const body =
    JSON.stringify(data);


  response.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Content-Length":
        Buffer.byteLength(body)
    }
  );


  response.end(body);
}


/*
=========================================================
BODY LESEN
=========================================================
*/

function readBody(request) {

  return new Promise(
    (resolve, reject) => {

      let body = "";


      request.on(
        "data",
        chunk => {

          body += chunk;


          if (
            body.length >
            1000000
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
        () => resolve(body)
      );


      request.on(
        "error",
        reject
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
    async (request, response) => {

      try {

        const parsed =
          url.parse(
            request.url,
            true
          );


        /*
        ================================================
        INDEX.HTML
        ================================================
        */

        if (
          request.method === "GET" &&
          parsed.pathname === "/"
        ) {

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


          response.end(html);

          return;
        }


        /*
        ================================================
        HEALTH
        ================================================
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
                documents.length
            }
          );

          return;
        }


        /*
        ================================================
        CHAT
        ================================================
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


          try {

            payload =
              JSON.parse(raw);

          }

          catch {

            sendJson(
              response,
              400,
              {
                error:
                  "Ungültiges JSON."
              }
            );

            return;
          }


          const message =
            String(
              payload.message || ""
            ).trim();


          if (!message) {

            sendJson(
              response,
              400,
              {
                error:
                  "Keine Nachricht."
              }
            );

            return;
          }


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


          const result =
            search(
              message,
              payload.tokens
            );


          const best =
            result.ranked[0];


          const MINIMUM_SCORE =
            0.05;


          if (
            !best ||
            best.score < MINIMUM_SCORE
          ) {

            sendJson(
              response,
              200,
              {

                answer:
                  "Dazu habe ich in meinen DATEN keine passende Information gefunden.",

                matches: 0,

                documents:
                  documents.length,

                tokens:
                  result.tokens

              }
            );

            return;
          }


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
              .slice(0, 5);


          sendJson(
            response,
            200,
            {

              answer:
                getAnswer(
                  best.document
                ),

              matches:
                top.length,

              documents:
                documents.length,

              tokens:
                result.tokens,

              source:
                best.document.file,

              confidence:
                Number(
                  best.score.toFixed(4)
                ),

              alternatives:
                top.map(item => ({

                  file:
                    item.document.file,

                  score:
                    Number(
                      item.score.toFixed(4)
                    )

                }))

            }
          );


          return;
        }


        /*
        ================================================
        404
        ================================================
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

        console.error(error);


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
START
=========================================================
*/

loadData();


server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `[START] LUMORA läuft auf Port ${PORT}`
    );

    console.log(
      `[START] Tokenizer geladen.`
    );

    console.log(
      `[START] ${documents.length} Datensätze bereit.`
    );

  }
);
