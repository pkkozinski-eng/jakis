# Forex Signal Analyzer

Aplikacja webowa do analizy wykresów forex metodą **price action w stylu Nial Fullera**.
Użytkownik wgrywa screenshot wykresu (jedna para, jedna rama czasowa D1/H4/H1),
a aplikacja zwraca ocenę jakości sygnału **1–10**, jednoznaczny werdykt
**WCHODZĘ / NIE WCHODZĘ**, proponowany **SL/TP z R:R** oraz uzasadnienie po polsku.

> ⚠️ To narzędzie **wspiera decyzję** i **nie jest poradą inwestycyjną**. Ostateczna
> decyzja i odpowiedzialność należą do użytkownika. Każdy wynik zawiera disclaimer.

---

## Architektura — dwuwarstwowa (AI + reguły)

Kluczowe założenie: **nie ufamy ocenie „na oko" modelu**. Model wizyjny tylko *odczytuje*
obraz na dane strukturalne; końcowy wynik liczy **kod** wg sztywnych reguł → powtarzalność.

```
screenshot ─▶ [Warstwa 1: Claude Vision] ─▶ VisionAnalysis (JSON, wymuszony schemat)
                                                   │
                                                   ▼
             [Warstwa 2: reguły w kodzie]  ── compute_sltp()   → SL/TP/R:R
                                            ── validate()       → spójność (twarde błędy przerywają)
                                            ── compute_score()  → wynik 1–10 (normalizowany)
                                            ── get_fundamentals()→ makro/carry + blokada NFP
                                                   │
                                                   ▼
                                            AnalysisResult (sztywny JSON) ─▶ karta wyniku (UI)
```

* **Warstwa 1** (`app/vision.py`, `app/prompts.py`): Claude Vision + `tool_use` wymusza JSON
  zgodny ze schematem `VisionAnalysis`. Bez klucza API działa **tryb DEMO** (deterministyczny mock).
* **Warstwa 2** (`app/scoring.py`, `app/sltp.py`, `app/validation.py`, `app/fundamentals.py`):
  czysty, testowalny kod. Ten sam setup → ten sam wynik.

### Reguły scoringu (kalibrowalne bez zmiany promptu AI)

| Czynnik | Punkty |
|---|---|
| Zgodność z trendem głównym | 0–3 |
| Formacja na kluczowym poziomie S/R | 0–2 |
| Jakość / czystość formacji | 0–2 |
| Potwierdzenie multi-timeframe *(jeśli dostępne)* | 0–2 |
| R:R ≥ 1:2 | 0–1 |

Suma normalizowana do skali **1–10** względem stosowalnych czynników (gdy brak danych
multi-timeframe, maksimum = 8, a wynik i tak jest sprowadzany do skali 1–10, więc próg
**≥7** pozostaje spójny). Progi i wagi to stałe w `app/scoring.py` — łatwe do kalibracji.

### Warstwa fundamentalna / makro

`app/fundamentals.py` sprawdza aktualną sytuację fundamentalną pary:

* **różnicę stóp procentowych** (carry) obu walut,
* **nastawienie banków centralnych** (hawkish/dovish),
* **ostrzeżenie o wydarzeniu wysokiej wagi** (heurystyka NFP = pierwszy piątek miesiąca).

Fundamenty **nie zawyżają** technicznego score (to chroni powtarzalność) — mogą jedynie:
dodać ostrzeżenie o konflikcie technika↔makro **lub zablokować** wejście przed newsem
wysokiej wagi. Źródło danych: wbudowana tabela referencyjna (`static`) lub — gdy ustawisz
`FRED_API_KEY` — odświeżanie kluczowych stóp z **FRED** (`live`).

---

## Stack

* **Backend:** Python 3.11 · FastAPI · Pydantic v2 · SQLite (stdlib) · pytest
* **Frontend:** React 18 · Vite · TypeScript · Tailwind CSS
* **AI:** Anthropic Claude (model z widzeniem, konfigurowalny)

---

## Uruchomienie

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # uzupełnij ANTHROPIC_API_KEY (opcjonalnie)
uvicorn app.main:app --reload --port 8000
```

Bez klucza API backend startuje w **trybie DEMO** (mock odczytu) — pełny przepływ działa,
ale odczyt obrazu jest przykładowy. Dodaj `ANTHROPIC_API_KEY` w `backend/.env`, by włączyć
realny odczyt Claude Vision.

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxy /api → :8000)
```

### Testy (warstwa reguł)

```bash
cd backend
FSA_MOCK_MODE=1 pytest -q
```

---

## API

| Metoda | Ścieżka | Opis |
|---|---|---|
| `GET`  | `/api/health` | Status, tryb mock, model |
| `GET`  | `/api/config` | Domyślne pary, ramy, próg |
| `POST` | `/api/analyze` | `multipart`: `image`, `pair`, `timeframe` → wynik |
| `GET`  | `/api/history` | Lista zapisanych analiz |
| `GET`  | `/api/history/{id}` | Pełny wynik z historii |

Niespójne/niekompletne dane z warstwy 1 → **HTTP 422** z listą błędów (aplikacja nie zgaduje).

---

## Konfiguracja (zmienne środowiskowe)

Zobacz `backend/.env.example`. Najważniejsze:

* `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `FSA_MOCK_MODE`
* `FRED_API_KEY` — opcjonalne dane makro na żywo
* `FSA_ENTRY_THRESHOLD` (domyślnie 7), `FSA_MIN_RR` (2.0), `FSA_SL_BUFFER_PCT` (0.1)

---

## Zakres MVP i dalsze kroki

**W MVP:** upload 1 screenshotu + wybór pary/ramy, odczyt Claude Vision → JSON,
walidacja i scoring w kodzie, karta wyniku, lokalna historia (SQLite), warstwa makro.

**Świadomie odłożone:** multi-timeframe w jednym uploadzie, eksport do Excela,
feedback loop trafiony/nietrafiony, alerty.
