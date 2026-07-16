# cTrader MCP — analiza wykresów live w Claude

Serwer **MCP (Model Context Protocol)**, który łączy Claude z **cTrader (Open API)**,
żeby Claude mógł na żywo pobierać notowania i świece (OHLC) i analizować wykresy.

Serwer wystawia trzy narzędzia MCP:

| Narzędzie | Opis |
|-----------|------|
| `ctrader_list_symbols` | Lista instrumentów dostępnych na koncie (z opcjonalnym filtrem, np. `EUR`, `US30`, `BTC`). |
| `ctrader_get_candles`  | Świece OHLC dla symbolu i interwału (M1…MN1) + podsumowanie (zmiana, high/low, SMA20/50). Zawiera aktualnie formującą się świecę. |
| `ctrader_get_quote`    | Aktualny live bid/ask/spread (strumień z cTrader). |

Konfiguracja połączenia dla Claude jest już w repo w pliku [`.mcp.json`](.mcp.json)
(`http://127.0.0.1:9876/mcp/`).

> **Ważne:** serwer musi działać na **tym samym komputerze** co Claude Code,
> bo `.mcp.json` wskazuje na `127.0.0.1`.

---

## Wymagania

- Node.js 20+ (testowane na Node 22)
- Konto cTrader (demo lub live) u brokera wspierającego Open API
- Aplikacja Open API utworzona na <https://openapi.ctrader.com/>

---

## 1. Instalacja

```bash
npm install
```

## 2. Utwórz aplikację cTrader Open API

1. Wejdź na <https://openapi.ctrader.com/> i zaloguj się.
2. Utwórz nową aplikację — dostaniesz **Client ID** i **Client Secret**.
3. W ustawieniach aplikacji dodaj **Redirect URI**: `http://localhost:5033/`
   (musi być dokładnie taki sam jak `OAUTH_REDIRECT_PORT` w `.env`).

## 3. Konfiguracja `.env`

```bash
cp .env.example .env
```

Uzupełnij `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET` oraz wybierz środowisko
`CTRADER_ENV=demo` lub `live`.

## 4. Pobierz access token i ID konta

```bash
npm run oauth
```

Skrypt wypisze URL — otwórz go w przeglądarce, zaloguj się i autoryzuj aplikację.
Po przekierowaniu z powrotem w terminalu pojawi się:

- `CTRADER_ACCESS_TOKEN=...` — wklej do `.env`
- lista kont z `ctidTraderAccountId` — wybierz właściwe (demo/live) i wpisz jako
  `CTRADER_ACCOUNT_ID` w `.env`

## 5. Uruchom serwer MCP

```bash
npm start
```

Powinieneś zobaczyć:

```
[ctrader-mcp] MCP server listening on http://127.0.0.1:9876/mcp/
[ctrader-mcp] connected and authenticated with cTrader Open API
```

Sprawdzenie, że żyje:

```bash
curl http://127.0.0.1:9876/health
# {"status":"ok","server":"ctrader-mcp"}
```

## 6. Połącz z Claude

Ponieważ `.mcp.json` jest w katalogu projektu, Claude Code wykryje serwer
`ctrader` automatycznie po uruchomieniu sesji w tym repo (potwierdź zaufanie do
serwera MCP, jeśli pojawi się pytanie). Sprawdź status komendą `/mcp`.

Teraz możesz poprosić Claude np.:

> *„Pokaż i przeanalizuj ostatnie 200 świec EURUSD na M15”*
> *„Jaki jest aktualny spread na XAUUSD?”*
> *„Porównaj trend US30 na H1 i H4”*

---

## Skrypty

| Komenda | Działanie |
|---------|-----------|
| `npm start` | Uruchom serwer MCP (tsx, bez kompilacji). |
| `npm run dev` | Serwer w trybie watch (restart przy zmianach). |
| `npm run oauth` | Pobranie access tokena i listy kont przez OAuth. |
| `npm run build` | Kompilacja TypeScript do `dist/`. |
| `npm run serve` | Uruchomienie skompilowanej wersji z `dist/`. |

---

## Jak to działa

- Połączenie z cTrader idzie przez protokół Open API (protobuf po TLS,
  `demo.ctraderapi.com` / `live.ctraderapi.com` port `5035`) z użyciem biblioteki
  [`@reiryoku/ctrader-layer`](https://www.npmjs.com/package/@reiryoku/ctrader-layer).
- Serwer utrzymuje jedno połączenie, wysyła heartbeat co 20 s i **automatycznie
  wznawia połączenie** (z backoffem) oraz odnawia subskrypcje po zerwaniu.
- Ceny z Open API są skalowane ×100000 — serwer przelicza je na realne wartości.
- Transport MCP: **Streamable HTTP** (`@modelcontextprotocol/sdk`) na
  `127.0.0.1:9876/mcp/`.

## Uwagi

- **Access token wygasa** (`expiresIn` w wyniku OAuth). Gdy przestanie działać,
  uruchom `npm run oauth` ponownie i zaktualizuj `.env`.
- Live bid/ask pojawia się tylko przy otwartym rynku dla danego instrumentu —
  poza godzinami handlu `ctrader_get_quote` może zgłosić brak notowań.
- Serwer jest tylko do **odczytu danych rynkowych** — nie składa zleceń.
