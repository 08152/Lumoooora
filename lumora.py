import os
import re
import json
import math
import random
import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader


# ============================================================
# LUMORA
# Eigenes neuronales Sprachmodell
# Keine API / kein externes KI-Modell
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "DATEN"
MODEL_FILE = BASE_DIR / "model.pt"

# ============================================================
# MODELLGRÖSSE
# ============================================================

# Größer = mehr Parameter = mehr RAM/Rechenleistung
# Du kannst diese Werte später erhöhen.

D_MODEL = 256
N_HEADS = 8
N_LAYERS = 6
FFN_MULT = 4
DROPOUT = 0.10
MAX_SEQ_LEN = 256

# ============================================================
# TRAINING
# ============================================================

BATCH_SIZE = 16
EPOCHS = 20
LEARNING_RATE = 3e-4
WEIGHT_DECAY = 0.01
GRAD_CLIP = 1.0

# ============================================================
# GENERIERUNG
# ============================================================

TEMPERATURE = 0.75
TOP_K = 40
MAX_NEW_TOKENS = 220

# Mehrere Antworten erzeugen und danach die beste wählen.
CANDIDATES = 4

# ============================================================
# SPEZIELLE ZEICHEN
# ============================================================

USER_MARK = "\x01"
BOT_MARK = "\x02"
END_MARK = "\x03"

# ============================================================
# ZUFALL
# ============================================================

SEED = 42

random.seed(SEED)
torch.manual_seed(SEED)

if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)

DEVICE = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)

print(f"[LUMORA] Gerät: {DEVICE}")


# ============================================================
# TEXT BEREINIGEN
# ============================================================

def clean_text(text: str) -> str:
    text = str(text)

    text = text.replace("\r", " ")

    text = re.sub(
        r"[ \t]+",
        " ",
        text
    )

    text = re.sub(
        r"\n{3,}",
        "\n\n",
        text
    )

    return text.strip()


# ============================================================
# JSON
# ============================================================

QUESTION_KEYS = {
    "frage",
    "question",
    "prompt",
    "input",
    "anfrage",
    "message",
    "nachricht",
    "user"
}

ANSWER_KEYS = {
    "antwort",
    "answer",
    "response",
    "reply",
    "output",
    "ausgabe",
    "assistant",
    "bot"
}


def read_json_file(path: Path):

    try:

        with path.open(
            "r",
            encoding="utf-8"
        ) as f:

            return json.load(f)

    except Exception as error:

        print(
            f"[WARNUNG] {path}: {error}"
        )

        return None


def find_value(
    obj,
    keys
):

    if isinstance(obj, dict):

        for key, value in obj.items():

            if (
                str(key).lower()
                in keys
            ):

                if isinstance(
                    value,
                    (
                        str,
                        int,
                        float,
                        bool
                    )
                ):

                    return str(value)

        for value in obj.values():

            result = find_value(
                value,
                keys
            )

            if result is not None:
                return result

    elif isinstance(obj, list):

        for value in obj:

            result = find_value(
                value,
                keys
            )

            if result is not None:
                return result

    return None


# ============================================================
# FRAGE/ANTWORT-PAARE FINDEN
# ============================================================

def collect_pairs(
    obj,
    pairs
):

    if isinstance(obj, dict):

        question = find_value(
            obj,
            QUESTION_KEYS
        )

        answer = find_value(
            obj,
            ANSWER_KEYS
        )

        if question and answer:

            question = clean_text(
                question
            )

            answer = clean_text(
                answer
            )

            if question and answer:

                pairs.append(
                    (
                        question,
                        answer
                    )
                )

        for value in obj.values():

            collect_pairs(
                value,
                pairs
            )

    elif isinstance(obj, list):

        for value in obj:

            collect_pairs(
                value,
                pairs
            )


# ============================================================
# ALLE TEXTWERTE
# ============================================================

def collect_strings(
    obj,
    output
):

    if isinstance(obj, dict):

        for value in obj.values():

            collect_strings(
                value,
                output
            )

    elif isinstance(obj, list):

        for value in obj:

            collect_strings(
                value,
                output
            )

    elif isinstance(
        obj,
        (
            str,
            int,
            float,
            bool
        )
    ):

        text = clean_text(
            str(obj)
        )

        if text:

            output.append(
                text
            )


# ============================================================
# TRAININGSDATEN LADEN
# ============================================================

def load_training_data():

    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    pairs = []
    strings = []

    files = sorted(
        DATA_DIR.rglob("*.json")
    )

    for file in files:

        data = read_json_file(
            file
        )

        if data is None:
            continue

        collect_pairs(
            data,
            pairs
        )

        collect_strings(
            data,
            strings
        )

    # Duplikate entfernen

    unique_pairs = []
    seen_pairs = set()

    for question, answer in pairs:

        key = (
            question.lower(),
            answer.lower()
        )

        if key not in seen_pairs:

            seen_pairs.add(key)

            unique_pairs.append(
                (
                    question,
                    answer
                )
            )

    unique_strings = []
    seen_strings = set()

    for text in strings:

        if len(text.split()) < 3:
            continue

        key = text.lower()

        if key not in seen_strings:

            seen_strings.add(key)

            unique_strings.append(
                text
            )

    print(
        f"[DATEN] JSON-Dateien: {len(files)}"
    )

    print(
        f"[DATEN] Frage/Antwort-Paare: "
        f"{len(unique_pairs)}"
    )

    print(
        f"[DATEN] zusätzliche Texte: "
        f"{len(unique_strings)}"
    )

    return (
        unique_pairs,
        unique_strings
    )


# ============================================================
# ZEICHEN-TOKENIZER
# ============================================================

class CharTokenizer:

    def __init__(self):

        self.stoi = {}
        self.itos = []

    def fit(
        self,
        texts
    ):

        chars = set()

        for text in texts:

            chars.update(
                text
            )

        chars.update(
            [
                USER_MARK,
                BOT_MARK,
                END_MARK
            ]
        )

        ordered = [
            " ",
            "\n",
            USER_MARK,
            BOT_MARK,
            END_MARK
        ]

        ordered_set = set(
            ordered
        )

        remaining = sorted(
            c
            for c in chars
            if c not in ordered_set
        )

        self.itos = (
            ordered
            +
            remaining
        )

        self.stoi = {
            char: index
            for index, char
            in enumerate(self.itos)
        }

    def encode(
        self,
        text
    ):

        return [
            self.stoi[char]
            for char in text
            if char in self.stoi
        ]

    def decode(
        self,
        ids
    ):

        return "".join(
            self.itos[int(i)]
            for i in ids
        )

    @property
    def vocab_size(self):

        return len(
            self.itos
        )


# ============================================================
# CORPUS AUFBAUEN
# ============================================================

def build_corpus(
    pairs,
    texts
):

    chunks = []

    # Q/A als richtige Gespräche

    for question, answer in pairs:

        conversation = (
            USER_MARK
            + question
            + "\n"
            + BOT_MARK
            + answer
            + END_MARK
        )

        chunks.append(
            conversation
        )

    # Andere Texte als Sprachmaterial

    for text in texts:

        chunks.append(
            text
            + END_MARK
        )

    if not chunks:

        raise RuntimeError(
            "Keine Trainingsdaten in DATEN gefunden."
        )

    return "\n".join(
        chunks
    )


# ============================================================
# DATASET
# ============================================================

class LanguageDataset(
    Dataset
):

    def __init__(
        self,
        token_ids,
        sequence_length
    ):

        if len(token_ids) <= sequence_length:

            raise ValueError(
                "Zu wenig Trainingsdaten."
            )

        self.data = torch.tensor(
            token_ids,
            dtype=torch.long
        )

        self.sequence_length = (
            sequence_length
        )

    def __len__(self):

        return max(
            1,
            len(self.data)
            - self.sequence_length
        )

    def __getitem__(
        self,
        index
    ):

        x = self.data[
            index:
            index + self.sequence_length
        ]

        y = self.data[
            index + 1:
            index + self.sequence_length + 1
        ]

        return x, y


# ============================================================
# NEURONALES MODELL
# ============================================================

class LumoraTransformer(
    nn.Module
):

    def __init__(
        self,
        vocab_size,
        d_model=D_MODEL,
        n_heads=N_HEADS,
        n_layers=N_LAYERS,
        ffn_mult=FFN_MULT,
        dropout=DROPOUT,
        max_seq_len=MAX_SEQ_LEN
    ):

        super().__init__()

        if d_model % n_heads != 0:

            raise ValueError(
                "D_MODEL muss durch N_HEADS teilbar sein."
            )

        self.vocab_size = vocab_size
        self.d_model = d_model
        self.max_seq_len = max_seq_len

        # Wörter/Zeichen -> Vektoren

        self.token_embedding = nn.Embedding(
            vocab_size,
            d_model
        )

        # Position des Zeichens

        self.position_embedding = nn.Embedding(
            max_seq_len,
            d_model
        )

        # Transformer-Neuronenblock

        layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_model * ffn_mult,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True
        )

        self.transformer = nn.TransformerEncoder(
            layer,
            num_layers=n_layers,
            norm=nn.LayerNorm(d_model)
        )

        # Ausgabe

        self.output = nn.Linear(
            d_model,
            vocab_size,
            bias=False
        )

        # Gemeinsame Gewichte
        self.output.weight = (
            self.token_embedding.weight
        )

        self.dropout = nn.Dropout(
            dropout
        )

        self.apply(
            self._init_weights
        )

    @staticmethod
    def _init_weights(
        module
    ):

        if isinstance(
            module,
            nn.Embedding
        ):

            nn.init.normal_(
                module.weight,
                mean=0.0,
                std=0.02
            )

        elif isinstance(
            module,
            nn.Linear
        ):

            if module.bias is not None:

                nn.init.zeros_(
                    module.bias
                )

    def forward(
        self,
        x
    ):

        batch_size, sequence_length = (
            x.shape
        )

        if sequence_length > self.max_seq_len:

            raise ValueError(
                "Sequenz zu lang."
            )

        positions = torch.arange(
            sequence_length,
            device=x.device
        ).unsqueeze(0)

        h = (
            self.token_embedding(x)
            *
            math.sqrt(
                self.d_model
            )
        )

        h = (
            h
            +
            self.position_embedding(
                positions
            )
        )

        h = self.dropout(h)

        # Causal Mask:
        # Das Modell darf die Zukunft nicht sehen.

        mask = torch.triu(
            torch.ones(
                sequence_length,
                sequence_length,
                device=x.device,
                dtype=torch.bool
            ),
            diagonal=1
        )

        h = self.transformer(
            h,
            mask=mask
        )

        logits = self.output(
            h
        )

        return logits


# ============================================================
# CHECKPOINT
# ============================================================

def save_checkpoint(
    model,
    tokenizer,
    optimizer,
    epoch,
    loss
):

    checkpoint = {

        "model_state_dict":
            model.state_dict(),

        "optimizer_state_dict":
            optimizer.state_dict(),

        "epoch":
            epoch,

        "loss":
            float(loss),

        "tokenizer":
            tokenizer.itos,

        "config": {

            "d_model":
                D_MODEL,

            "n_heads":
                N_HEADS,

            "n_layers":
                N_LAYERS,

            "ffn_mult":
                FFN_MULT,

            "dropout":
                DROPOUT,

            "max_seq_len":
                MAX_SEQ_LEN
        }
    }

    torch.save(
        checkpoint,
        MODEL_FILE
    )


# ============================================================
# TRAINING
# ============================================================

def train():

    pairs, texts = (
        load_training_data()
    )

    corpus = build_corpus(
        pairs,
        texts
    )

    tokenizer = CharTokenizer()

    tokenizer.fit(
        [corpus]
    )

    token_ids = tokenizer.encode(
        corpus
    )

    print(
        f"[TOKENIZER] Vokabular: "
        f"{tokenizer.vocab_size}"
    )

    print(
        f"[TRAINING] Zeichen-Tokens: "
        f"{len(token_ids)}"
    )

    if (
        len(token_ids)
        <=
        MAX_SEQ_LEN + 1
    ):

        raise RuntimeError(
            f"Zu wenig Daten. "
            f"Mindestens {MAX_SEQ_LEN + 2} Tokens nötig."
        )

    dataset = LanguageDataset(
        token_ids,
        MAX_SEQ_LEN
    )

    loader = DataLoader(
        dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        drop_last=True,
        num_workers=0,
        pin_memory=(
            DEVICE.type == "cuda"
        )
    )

    model = LumoraTransformer(
        tokenizer.vocab_size
    ).to(
        DEVICE
    )

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY,
        betas=(0.9, 0.95)
    )

    total_steps = max(
        1,
        EPOCHS * len(loader)
    )

    scheduler = (
        torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer,
            T_max=total_steps,
            eta_min=LEARNING_RATE * 0.1
        )
    )

    parameter_count = sum(
        p.numel()
        for p in model.parameters()
    )

    print(
        f"[MODELL] Parameter: "
        f"{parameter_count:,}"
    )

    model.train()

    step = 0

    for epoch in range(
        1,
        EPOCHS + 1
    ):

        total_loss = 0.0
        batches = 0

        for x, y in loader:

            x = x.to(
                DEVICE,
                non_blocking=True
            )

            y = y.to(
                DEVICE,
                non_blocking=True
            )

            optimizer.zero_grad(
                set_to_none=True
            )

            logits = model(x)

            loss = F.cross_entropy(
                logits.reshape(
                    -1,
                    tokenizer.vocab_size
                ),
                y.reshape(-1)
            )

            loss.backward()

            torch.nn.utils.clip_grad_norm_(
                model.parameters(),
                GRAD_CLIP
            )

            optimizer.step()
            scheduler.step()

            total_loss += (
                loss.item()
            )

            batches += 1
            step += 1

            if step % 50 == 0:

                print(
                    f"[TRAIN] Schritt {step} "
                    f"| Epoch {epoch}/{EPOCHS} "
                    f"| Loss {loss.item():.4f}"
                )

        average_loss = (
            total_loss
            /
            max(
                1,
                batches
            )
        )

        save_checkpoint(
            model,
            tokenizer,
            optimizer,
            epoch,
            average_loss
        )

        print(
            f"[EPOCH] {epoch}/{EPOCHS} "
            f"| Loss {average_loss:.4f} "
            f"| model.pt gespeichert"
        )

    print()
    print("[TRAINING] FERTIG")
    print(
        f"[MODEL] {MODEL_FILE}"
    )


# ============================================================
# MODELL LADEN
# ============================================================

def load_model():

    if not MODEL_FILE.exists():

        raise FileNotFoundError(
            f"{MODEL_FILE} existiert nicht.\n"
            f"Zuerst ausführen:\n"
            f"python {Path(__file__).name} train"
        )

    checkpoint = torch.load(
        MODEL_FILE,
        map_location=DEVICE
    )

    tokenizer = CharTokenizer()

    tokenizer.itos = (
        checkpoint["tokenizer"]
    )

    tokenizer.stoi = {
        char: index
        for index, char
        in enumerate(
            tokenizer.itos
        )
    }

    config = (
        checkpoint["config"]
    )

    model = LumoraTransformer(
        vocab_size=len(
            tokenizer.itos
        ),
        d_model=config["d_model"],
        n_heads=config["n_heads"],
        n_layers=config["n_layers"],
        ffn_mult=config["ffn_mult"],
        dropout=config["dropout"],
        max_seq_len=config["max_seq_len"]
    ).to(
        DEVICE
    )

    model.load_state_dict(
        checkpoint[
            "model_state_dict"
        ]
    )

    model.eval()

    print(
        "[MODEL] Modell geladen"
    )

    return (
        model,
        tokenizer
    )


# ============================================================
# EINE ANTWORT ERZEUGEN
# ============================================================

@torch.no_grad()
def generate_one(
    model,
    tokenizer,
    prompt
):

    ids = tokenizer.encode(
        prompt
    )

    if not ids:
        return ""

    generated = ids[
        -model.max_seq_len:
    ]

    for _ in range(
        MAX_NEW_TOKENS
    ):

        x = torch.tensor(
            [
                generated[
                    -model.max_seq_len:
                ]
            ],
            dtype=torch.long,
            device=DEVICE
        )

        logits = model(x)

        next_logits = (
            logits[
                0,
                -1
            ]
            .float()
        )

        temperature = max(
            0.1,
            TEMPERATURE
        )

        next_logits = (
            next_logits
            /
            temperature
        )

        # Top-K

        if (
            TOP_K
            and
            TOP_K < next_logits.numel()
        ):

            values, _ = torch.topk(
                next_logits,
                TOP_K
            )

            minimum = values[-1]

            next_logits[
                next_logits < minimum
            ] = -float("inf")

        probabilities = F.softmax(
            next_logits,
            dim=-1
        )

        next_id = torch.multinomial(
            probabilities,
            1
        ).item()

        generated.append(
            next_id
        )

        text = tokenizer.decode(
            generated
        )

        if END_MARK in text:

            break

        # Falls LUMORA plötzlich einen neuen
        # Benutzerblock erzeugen will:
        if USER_MARK in text[
            text.find(BOT_MARK) + 1:
        ]:

            break

    result = tokenizer.decode(
        generated
    )

    # Nur Antwort nach BOT_MARK

    if BOT_MARK in result:

        result = result.split(
            BOT_MARK,
            1
        )[1]

    # Ende abschneiden

    if END_MARK in result:

        result = result.split(
            END_MARK,
            1
        )[0]

    result = result.replace(
        USER_MARK,
        ""
    )

    result = result.strip()

    return result


# ============================================================
# ANTWORT BEWERTEN
# ============================================================

@torch.no_grad()
def score_answer(
    model,
    tokenizer,
    prompt,
    answer
):

    full = (
        prompt
        +
        answer
    )

    ids = tokenizer.encode(
        full
    )

    prompt_ids = tokenizer.encode(
        prompt
    )

    if len(ids) < 2:
        return -float("inf")

    if len(prompt_ids) >= len(ids):
        return -float("inf")

    ids = ids[
        -model.max_seq_len:
    ]

    x = torch.tensor(
        [ids[:-1]],
        dtype=torch.long,
        device=DEVICE
    )

    y = torch.tensor(
        [ids[1:]],
        dtype=torch.long,
        device=DEVICE
    )

    logits = model(x)

    log_probs = F.log_softmax(
        logits,
        dim=-1
    )

    token_scores = (
        log_probs
        .gather(
            2,
            y.unsqueeze(-1)
        )
        .squeeze(-1)
    )

    count = min(
        len(answer),
        token_scores.shape[1]
    )

    if count <= 0:
        return -float("inf")

    chosen = token_scores[
        0,
        -count:
    ]

    return float(
        chosen.mean().item()
    )


# ============================================================
# WIEDERHOLUNGEN ERKENNEN
# ============================================================

def repetition_penalty(
    text
):

    words = re.findall(
        r"\b\w+\b",
        text.lower(),
        flags=re.UNICODE
    )

    if len(words) < 4:
        return 0.0

    trigrams = []

    for i in range(
        len(words) - 2
    ):

        trigrams.append(
            tuple(
                words[
                    i:i + 3
                ]
            )
        )

    duplicates = (
        len(trigrams)
        -
        len(set(trigrams))
    )

    return (
        duplicates
        * 0.5
    )


# ============================================================
# BESTE VON MEHREREN ANTWORTEN
# ============================================================

def generate_answer(
    model,
    tokenizer,
    message,
    history
):

    context = ""

    for user_text, bot_text in (
        history[-4:]
    ):

        context += (
            USER_MARK
            + clean_text(
                user_text
            )
            + "\n"
            + BOT_MARK
            + clean_text(
                bot_text
            )
            + END_MARK
            + "\n"
        )

    context += (
        USER_MARK
        + clean_text(
            message
        )
        + "\n"
        + BOT_MARK
    )

    # Kontext begrenzen

    context_ids = tokenizer.encode(
        context
    )

    context_ids = context_ids[
        -model.max_seq_len:
    ]

    context = tokenizer.decode(
        context_ids
    )

    candidates = []

    for _ in range(
        CANDIDATES
    ):

        answer = generate_one(
            model,
            tokenizer,
            context
        )

        if not answer:
            continue

        probability = score_answer(
            model,
            tokenizer,
            context,
            answer
        )

        penalty = (
            repetition_penalty(
                answer
            )
        )

        final_score = (
            probability
            -
            penalty
        )

        candidates.append(
            (
                final_score,
                answer
            )
        )

    if not candidates:

        return (
            "Ich konnte gerade "
            "keine Antwort erzeugen."
        )

    candidates.sort(
        key=lambda item: item[0],
        reverse=True
    )

    return candidates[0][1]


# ============================================================
# CHAT
# ============================================================

def chat():

    model, tokenizer = (
        load_model()
    )

    history = []

    print()
    print("=" * 50)
    print("LUMORA")
    print("Eigenes neuronales Sprachmodell")
    print("Keine API")
    print("=" * 50)
    print("Schreibe 'exit' zum Beenden.")
    print()

    while True:

        try:

            message = input(
                "Du: "
            ).strip()

        except (
            EOFError,
            KeyboardInterrupt
        ):

            print()
            break

        if not message:
            continue

        if message.lower() in {
            "exit",
            "quit",
            "beenden"
        }:

            break

        answer = generate_answer(
            model,
            tokenizer,
            message,
            history
        )

        print(
            "LUMORA:",
            answer
        )

        history.append(
            (
                message,
                answer
            )
        )

        history = history[-6:]


# ============================================================
# INFO
# ============================================================

def info():

    pairs, texts = (
        load_training_data()
    )

    print()
    print("=" * 50)
    print("LUMORA INFO")
    print("=" * 50)

    print(
        f"Gerät:          {DEVICE}"
    )

    print(
        f"model.pt:       {MODEL_FILE.exists()}"
    )

    print(
        f"Q/A-Paare:      {len(pairs)}"
    )

    print(
        f"Texte:          {len(texts)}"
    )

    print(
        f"D_MODEL:        {D_MODEL}"
    )

    print(
        f"N_HEADS:        {N_HEADS}"
    )

    print(
        f"N_LAYERS:       {N_LAYERS}"
    )

    print(
        f"SEQ-LÄNGE:      {MAX_SEQ_LEN}"
    )

    print("=" * 50)


# ============================================================
# START
# ============================================================

def main():

    command = (
        sys.argv[1].lower()
        if len(sys.argv) > 1
        else "chat"
    )

    if command == "train":

        train()

    elif command == "chat":

        chat()

    elif command == "info":

        info()

    else:

        print(
            "Verwendung:"
        )

        print(
            "python lumora.py train"
        )

        print(
            "python lumora.py chat"
        )

        print(
            "python lumora.py info"
        )


if __name__ == "__main__":

    main()
