# ⚽ Typer Premier League 2026/27

Kompletna, responsywna aplikacja webowa do typowania dokładnych wyników meczów
Premier League w sezonie **2026/27** (38 kolejek, 380 meczów). Działa na telefonie
i komputerze. Dane zapisywane są **trwale w bazie** — nie resetują się po
odświeżeniu strony ani zamknięciu przeglądarki, a użytkownik wraca na swoje konto
z dowolnego urządzenia.

![stack](https://img.shields.io/badge/Node.js-22-green) ![db](https://img.shields.io/badge/SQLite-trwały%20zapis-blue) ![license](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Spis treści
1. [Funkcje](#funkcje)
2. [System punktacji](#system-punktacji)
3. [Architektura i technologie](#architektura-i-technologie)
4. [Szybki start (lokalnie)](#szybki-start-lokalnie)
5. [Jak grać](#jak-grać)
6. [Panel administratora](#panel-administratora)
7. [Wdrożenie online — krok po kroku](#wdrożenie-online--krok-po-kroku)
8. [Automatyczne pobieranie wyników (API)](#automatyczne-pobieranie-wyników-api)
9. [Konfiguracja (zmienne środowiskowe)](#konfiguracja-zmienne-środowiskowe)
10. [Struktura projektu](#struktura-projektu)
11. [API — skrót](#api--skrót)

---

## Funkcje

- ✅ **Typowanie dokładnych wyników** wszystkich 380 meczów (38 kolejek).
- 🔒 **Blokada typów po pierwszym gwizdku** — typ można edytować tylko do momentu
  rozpoczęcia meczu. Typy innych graczy stają się widoczne dopiero po rozpoczęciu meczu.
- 🧮 **Automatyczne naliczanie punktów** po wprowadzeniu wyniku (kumulatywny system).
- 📊 **Tabela kolejki** — punkty graczy w danej kolejce, aktualizacja natychmiast po wpisaniu wyniku.
- 🏆 **Klasyfikacja generalna** (1.–38. kolejka) z pozycją, liczbą dokładnych wyników
  i trafionych rezultatów jako kryteriami remisowymi.
- 📅 **Terminarz** z datami i godzinami meczów każdej kolejki + wyniki historyczne.
- 🔗 **Dołączanie przez link zaproszenia** — nick + PIN, bez limitu graczy.
- ⚙️ **Panel administratora** — wyniki, korekty, przekładanie meczów, zaproszenia,
  usuwanie graczy, opcjonalne auto-pobieranie wyników.
- 📱 **Responsywny interfejs** (mobile-first) w barwach Premier League.
- 💾 **Trwały zapis w bazie danych** (SQLite; łatwo wymienić na Postgres/Supabase).

## System punktacji

Punkty za jeden mecz sumują się z poniższych składników (maks. **5 pkt**):

| Składnik | Punkty |
|---|---|
| Trafiony rezultat (wygrana gospodarzy / remis / wygrana gości) | **2 pkt** |
| Trafiona dokładna różnica bramek | **+1 pkt** |
| Trafiona liczba bramek gospodarzy | **+1 pkt** |
| Trafiona liczba bramek gości | **+1 pkt** |

Trafienie **dokładnego wyniku** daje automatycznie wszystkie składniki = **5 pkt**.

Przykłady (typ → wynik → punkty):

| Typ | Wynik | Punkty | Dlaczego |
|---|---|---|---|
| 2:1 | 2:1 | **5** | dokładny wynik |
| 3:2 | 2:1 | **3** | rezultat (2) + różnica (1) |
| 1:0 | 2:1 | **3** | rezultat (2) + różnica (1) |
| 2:1 | 2:0 | **3** | rezultat (2) + bramki gospodarza (1) |
| 1:1 | 2:2 | **3** | remis (2) + różnica 0 (1) |
| 1:1 | 1:1 | **5** | dokładny remis |
| 2:0 | 0:2 | **0** | pudło |

Logika punktacji jest pokryta testami — uruchom `npm test`.

## Architektura i technologie

- **Frontend:** czysty HTML/CSS/JS (bez frameworka, bez kroku budowania) — lekki,
  responsywny SPA serwowany z katalogu `public/`.
- **Backend:** Node.js + Express (`src/server.js`).
- **Baza danych:** SQLite przez `better-sqlite3` — cała warstwa dostępu do danych
  jest odizolowana w `src/db.js`, dzięki czemu przejście na PostgreSQL/Supabase
  sprowadza się do podmiany tego jednego modułu.
- **Logowanie:** uproszczone — nick + PIN (PIN hashowany `bcrypt`), token sesji
  podpisany HMAC-em i trzymany w `localStorage` (powrót na konto z każdego urządzenia).

## Szybki start (lokalnie)

Wymagany **Node.js 20+** (zalecany 22).

```bash
git clone <adres-repo>
cd jakis
npm install

# (opcjonalnie) ustaw własny login/PIN administratora:
export ADMIN_NICK=admin
export ADMIN_PIN=1234

npm start
```

Przy pierwszym uruchomieniu aplikacja automatycznie:
1. tworzy bazę i **generuje pełny terminarz 380 meczów**,
2. zakłada konto **administratora** (dane wypisane w konsoli),
3. tworzy **startowy link zaproszenia** (również w konsoli).

Otwórz **http://localhost:3000**. W konsoli zobaczysz m.in.:

```
>> Administrator: nick="admin"  PIN=1234
>> Link zaproszenia (token): 9RyUTFMkQLac
   Udostepnij: http://localhost:3000/?invite=9RyUTFMkQLac
```

> Uruchomienie developerskie z auto-restartem: `npm run dev`.

## Jak grać

1. Administrator udostępnia graczom **link z zaproszeniem** (`/?invite=TOKEN`).
2. Gracz otwiera link, wybiera **nick** i **PIN** (4–8 cyfr) i dołącza.
3. W zakładce **Kolejka** wpisuje typy (autozapis przy zmianie pola lub przycisk
   „Zapisz wszystkie typy"). Typy można edytować aż do pierwszego gwizdka meczu.
4. Po meczach administrator wprowadza wyniki — **punkty naliczają się automatycznie**.
5. Zakładki **Tabela** (kolejka) i **Klasyfikacja** (cały sezon) pokazują wyniki na żywo.

## Panel administratora

Zaloguj się na konto administratora → zakładka **Panel**:

- **Wyniki i terminarz** — wpisz wynik meczu i kliknij „Zapisz" (punkty przeliczą się
  natychmiast). „Przełóż / zmień wynik" pozwala zmienić datę meczu lub cofnąć wynik.
- **Linki zaproszeń** — generuj, kopiuj i dezaktywuj linki.
- **Gracze** — podgląd listy i usuwanie graczy.
- **Automatyczne wyniki** — opcjonalne pobieranie z football-data.org (patrz niżej).

## Wdrożenie online — krok po kroku

Aplikacja to serwer Node.js z **trwałym plikiem bazy**, więc najprościej wdrożyć ją
na hostingu z trwałym dyskiem. Poniżej najłatwiejsza droga (Render, darmowy plan).

### Wariant A — Render.com (zalecany, w repo jest `render.yaml`)

1. Wrzuć projekt na GitHub.
2. Wejdź na **https://render.com** → **New +** → **Blueprint**.
3. Wskaż swoje repozytorium — Render odczyta `render.yaml` i utworzy usługę
   z **trwałym dyskiem** zamontowanym pod `/data` (baza przetrwa restarty i deploye).
4. W ustawieniach usługi ustaw sekret **`ADMIN_PIN`** (własny PIN administratora).
5. Kliknij **Deploy**. Po chwili aplikacja działa pod adresem `https://twoja-nazwa.onrender.com`.
6. W logach usługi znajdź **link zaproszenia** i rozdaj go graczom.

### Wariant B — Railway / Fly.io / dowolny Docker (jest `Dockerfile`)

- **Railway:** New Project → Deploy from Repo → dodaj **Volume** zamontowany na `/data`
  i zmienną `DATABASE_FILE=/data/typer.db`.
- **Fly.io:** `fly launch` (wykryje Dockerfile) → `fly volumes create typer_data --size 1`
  → zamontuj wolumen na `/data` w `fly.toml` → `fly deploy`.
- **VPS z Dockerem:**
  ```bash
  docker build -t typer .
  docker run -d -p 80:3000 -v typer_data:/data \
    -e ADMIN_PIN=1234 typer
  ```

> ⚠️ **Vercel / Netlify (serverless)** nie utrzymują trwałego pliku SQLite między
> wywołaniami funkcji. Aby wdrożyć tam, przełącz bazę na **Supabase/PostgreSQL** —
> patrz sekcja niżej. Do klasycznego hostingu Node (Render/Railway/Fly/VPS) SQLite
> działa idealnie „z pudełka".

### Migracja na Supabase / PostgreSQL (dla wdrożeń serverless)

Cała logika bazodanowa jest zamknięta w `src/db.js`. Aby użyć Supabase:
1. Załóż darmowy projekt na **https://supabase.com** i skopiuj `DATABASE_URL`.
2. Odtwórz tabele (`players`, `matches`, `predictions`, `invites`, `meta`) w Postgresie
   — schemat jest w `src/db.js` (zamień `INTEGER PRIMARY KEY AUTOINCREMENT` na
   `SERIAL/IDENTITY`, `datetime('now')` na `now()`).
3. Przepisz funkcje eksportowane z `src/db.js` na zapytania przez `pg`/klient Supabase
   (sygnatury funkcji pozostają te same — reszta aplikacji nie wymaga zmian).

## Automatyczne pobieranie wyników (API)

Zamiast wpisywać wyniki ręcznie, można pobierać je z darmowego **football-data.org**:

1. Załóż darmowe konto na https://www.football-data.org/ i uzyskaj token API.
2. Ustaw zmienną środowiskową `FOOTBALL_DATA_TOKEN=twoj_token` i zrestartuj serwer.
3. W panelu admina użyj „Pobierz wyniki kolejki".

> Endpoint `POST /api/admin/fetch-results` w `src/server.js` zawiera gotowy szkielet
> pobierania (`competitions/PL/matches`). Wystarczy uzupełnić **mapowanie nazw drużyn**
> z API na nazwy w bazie (funkcja `fetch-results`) — nazwy klubów bywają zapisywane
> różnie (np. „Wolverhampton Wanderers FC" vs „Wolverhampton"). Bez tokena panel
> nadal działa w pełni w trybie ręcznym.

## Konfiguracja (zmienne środowiskowe)

Wszystkie są opcjonalne (patrz `.env.example`):

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3000` | Port serwera |
| `ADMIN_NICK` | `admin` | Nick konta administratora (tworzony przy 1. starcie) |
| `ADMIN_PIN` | losowy | PIN administratora (jeśli pusty — wypisany w konsoli) |
| `DATABASE_FILE` | `./data/typer.db` | Ścieżka pliku bazy (wskaż trwały dysk na produkcji) |
| `SESSION_SECRET` | generowany | Sekret podpisujący tokeny sesji |
| `FOOTBALL_DATA_TOKEN` | — | Token do auto-pobierania wyników (opcjonalny) |

## Struktura projektu

```
.
├── src/
│   ├── server.js      # Express: API + serwowanie frontendu
│   ├── db.js          # Warstwa bazy (SQLite) — łatwa do podmiany na Postgres
│   ├── scoring.js     # Silnik punktacji (pokryty testami)
│   ├── standings.js   # Klasyfikacja generalna i tabela kolejki
│   ├── fixtures.js    # Generator terminarza (380 meczów) + daty
│   ├── seed.js        # Inicjalizacja: terminarz, admin, zaproszenie
│   └── auth.js        # Tokeny sesji (HMAC) + middleware autoryzacji
├── public/
│   ├── index.html     # Struktura SPA
│   ├── styles.css     # Style (responsywne, mobile-first)
│   └── app.js         # Logika frontendu
├── test/
│   └── scoring.test.js
├── render.yaml        # Blueprint wdrożenia na Render
├── Dockerfile         # Obraz do wdrożeń kontenerowych
└── .env.example
```

## API — skrót

| Metoda | Ścieżka | Opis |
|---|---|---|
| POST | `/api/join` | Dołączenie przez zaproszenie (nick, pin, invite) |
| POST | `/api/login` | Logowanie (nick, pin) |
| GET | `/api/me` | Dane zalogowanego gracza |
| GET | `/api/rounds` | Lista kolejek ze statusem |
| GET | `/api/rounds/:n/matches` | Mecze kolejki + moje typy + typy innych (po starcie) |
| POST | `/api/predictions` | Zapis typu (tylko przed pierwszym gwizdkiem) |
| POST | `/api/predictions/bulk` | Zapis wielu typów naraz |
| GET | `/api/standings` | Klasyfikacja generalna |
| GET | `/api/rounds/:n/table` | Tabela kolejki |
| GET | `/api/schedule` | Terminarz całego sezonu |
| POST | `/api/admin/results` | (admin) wynik meczu |
| POST | `/api/admin/reschedule` | (admin) zmiana terminu meczu |
| GET/POST | `/api/admin/invites` | (admin) zaproszenia |
| GET/DELETE | `/api/admin/players[/:id]` | (admin) gracze |

---

### Uwaga o terminarzu i drużynach
Oficjalny terminarz PL 2026/27 nie jest jeszcze znany, więc aplikacja generuje
poprawny, kompletny terminarz dwurundowy (każdy z każdym, u siebie i na wyjeździe).
Domyślną listę 20 drużyn (`src/fixtures.js`) oraz daty i godziny meczów można dowolnie
edytować — daty także z poziomu panelu administratora („Przełóż mecz").

Licencja: MIT.
