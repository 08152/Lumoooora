const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");


/* =========================================================
   KONFIGURATION
   ========================================================= */

const PORT =
  process.env.PORT || 10000;

const ROOT =
  __dirname;

const DATA_DIR =
  path.join(ROOT, "DATEN");

const INDEX_FILE =
  path.join(ROOT, "index.html");


/* =========================================================
   STOPWORDS
   ========================================================= */

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


/* =========================================================
   SPEICHER
   ========================================================= */

let documents = [];
let idf = new Map();


/* =========================================================
   NORMALISIERUNG
   ========================================================= */

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


/* =========================================================
   TOKENIZER
   ========================================================= */

function tokenize(text) {

  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => word.length >= 2)
    .filter(word => !STOPWORDS.has(word));

}


/* =========================================================
   JSON FLACH MACHEN
   ========================================================= */

function flattenJson(value, prefix = "") {

  const result = [];

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {

    for (
      const [key, child]
      of Object.entries(value)
    ) {

      const next =
        prefix
          ? `${prefix}.${key}`
          : key;

      result.push(
        ...flattenJson(child, next)
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


/* =========================================================
   FELDER FINDEN
   ========================================================= */

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

  }

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


/* =========================================================
   ALLE JSON-DATEIEN FINDEN
   ========================================================= */

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
      entry.name
        .toLowerCase()
        .endsWith(".json")
    ) {

      files.push(fullPath);

    }

  }


  return files;

}


/* =========================================================
   DATENSATZ HINZUFÜGEN
   ========================================================= */

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
    Wenn eine Frage existiert,
    geben wir ihr mehr Gewicht.
  */

  if (question) {

    searchText =
      `${question} ${question} ${searchText}`;

  }


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

    tokens:
      tokenize(searchText),

    vector:
      new Map()

  });

}


/* =========================================================
   DATEN LADEN
   ========================================================= */

function loadData() {

  documents = [];

  const files =
    listJsonFiles(DATA_DIR);


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
        Jeder Eintrag wird ein eigener Datensatz.
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


  buildIdf();


  console.log(
    `[START] ${files.length} JSON-Datei(en) gefunden.`
  );

  console.log(
    `[START] ${documents.length} Datensatz/Datensätze geladen.`
  );

}


/* =========================================================
   IDF
   ========================================================= */

function buildIdf() {

  idf = new Map();

  const documentFrequency =
    new Map();


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
        (documentFrequency.get(token) || 0) + 1
      );

    }

  }


  const count =
    Math.max(
      documents.length,
      1
    );


  for (
    const [token, frequency]
    of documentFrequency
  ) {

    idf.set(
      token,
      Math.log(
        (1 + count) /
        (1 + frequency)
      ) + 1
    );

  }


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


/* =========================================================
   VEKTOR
   ========================================================= */

function vectorize(tokens) {

  if (!tokens.length) {
    return new Map();
  }


  const counts =
    new Map();


  for (
    const token
    of tokens
  ) {

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


/* =========================================================
   COSINE SIMILARITY
   ========================================================= */

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


  for (
    const value
    of a.values()
  ) {

    normA +=
      value * value;

  }


  for (
    const value
    of b.values()
  ) {

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


/* =========================================================
   ÄHNLICHKEIT
   ========================================================= */

function calculateSimilarity(
  query,
  queryTokens,
  document
) {

  const queryVector =
    vectorize(queryTokens);


  let score =
    cosineSimilarity(
      queryVector,
      document.vector
    );


  const normalizedQuery =
    normalizeText(query);


  const normalizedDocument =
    normalizeText(
      document.text
    );


  /*
    Exakte Frage
  */

  if (document.question) {

    const normalizedQuestion =
      normalizeText(
        document.question
      );


    if (
      normalizedQuestion ===
      normalizedQuery
    ) {

      score += 2;

    }

    else if (
      normalizedQuestion.includes(
        normalizedQuery
      ) ||
      normalizedQuery.includes(
        normalizedQuestion
      )
    ) {

      score += 0.7;

    }

  }


  /*
    Gesamten Text prüfen
  */

  if (
    normalizedQuery.length >= 4 &&
    normalizedDocument.includes(
      normalizedQuery
    )
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


  let common = 0;


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


  score +=
    common * 0.04;


  return score;

}


/* =========================================================
   ANTWORT
   ========================================================= */

function getAnswer(document) {

  /*
    Wenn ein Antwortfeld existiert,
    verwenden wir es.
  */

  if (document.answer) {

    return document.answer;

  }


  /*
    Falls kein Antwortfeld vorhanden ist,
    wird die komplette JSON-Struktur ausgegeben.
  */

  return JSON.stringify(
    document.data,
    null,
    2
  );

}


/* =========================================================
   SUCHE
   ========================================================= */

function search(
  message,
  clientTokens
) {

  let tokens;


  /*
    Tokenizer aus HTML übernehmen,
    sofern vorhanden.
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

  }

  else {

    tokens =
      tokenize(message);

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


/* =========================================================
   JSON ANTWORT
   ========================================================= */

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


/* =========================================================
   REQUEST BODY
   ========================================================= */

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
            1_000_000
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


/* =========================================================
   SERVER
   ========================================================= */

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
          Startseite
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
          Health Check
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
          KI API
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
                  "Keine JSON-Dateien in DATEN gefunden."
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


          const minimumScore =
            0.05;


          /*
            Kein passender Datensatz
          */

          if (
            !best ||
            best.score < minimumScore
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


          /*
            Die besten Treffer
          */

          const top =
            result.ranked
              .filter(
                item =>
                  item.score >=
                  Math.max(
                    minimumScore,
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
          404
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


/* =========================================================
   DATEN LADEN UND SERVER STARTEN
   ========================================================= */

loadData();


server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `[START] LUMORA läuft auf Port ${PORT}`
    );

    console.log(
      `[START] Datenordner: ${DATA_DIR}`
    );

  }
);
