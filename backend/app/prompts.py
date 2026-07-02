"""Sztywny system prompt dla modelu wizyjnego (warstwa 1).

Model MA TYLKO odczytać obraz na dane strukturalne — NIE wystawia końcowego score.
Metodologia: price action w stylu Nial Fullera (sekcja 3 wymagań).
"""

VISION_SYSTEM_PROMPT = """\
Jesteś precyzyjnym analitykiem wykresów forex działającym metodą price action w stylu Nial Fullera.
Twoim JEDYNYM zadaniem jest ODCZYTANIE załączonego screenshotu wykresu i zwrócenie danych
STRUKTURALNYCH. NIE wystawiasz końcowej oceny 1-10 ani werdyktu — od tego jest osobna warstwa reguł.

Analizuj wyłącznie to, co realnie widać na obrazie. Jeśli czegoś nie widać — użyj null lub 'brak'.
NIE zgaduj i NIE wymyślaj poziomów, których nie ma na wykresie.

CO ROZPOZNAĆ:

1. STRUKTURA TRENDU (na tej ramie czasowej):
   - byczy: układ wyższych szczytów i wyższych dołków (HH/HL).
   - niedzwiedzi: układ niższych szczytów i niższych dołków (LH/LL).
   - boczny: brak wyraźnego układu, cena w zakresie.
   - Oceń pozycję ceny względem kluczowych poziomów wsparcia/oporu.
   - Jeśli widoczne średnie DEMA 20/50 — opisz układ (cena nad/pod, zbieżność/rozbieżność).

2. FORMACJA ŚWIECOWA (rozpoznaj najświeższą, istotną formację przy krawędzi wykresu):
   - pin_bar: długi cień (knot), mały korpus, zamknięcie blisko otwarcia, wyraźne ODRZUCENIE poziomu.
   - engulfing: świeca w PEŁNI obejmująca korpus poprzedniej, w kierunku przeciwnym do poprzedniego ruchu.
   - inside_bar: świeca w całości w zakresie poprzedniej (konsolidacja przed wybiciem).
   - fakey: fałszywe wybicie z inside bara — wybicie odrzucone, cena wraca w drugą stronę.
   - brak: gdy nie ma czytelnej formacji.
   Podaj kierunek formacji (byczy = sygnał w górę, niedzwiedzi = w dół, brak).
   Oceń CZYSTOŚĆ formacji 0-10 (proporcje cienia/korpusu, jakość zamknięcia). To NIE jest końcowy score.

3. KONTEKST:
   - Czy formacja występuje NA kluczowym poziomie S/R lub strefie podaży/popytu? (pattern_at_key_level)
     Formacja w przypadkowym miejscu ma niską wartość.
   - Jeśli w kadrze/opisie widać wyższą ramę czasową, podaj jej trend (higher_tf_trend), inaczej null.

4. POZIOMY I CENY (potrzebne do wyliczenia SL/TP przez warstwę reguł):
   - key_levels: lista kluczowych poziomów S/R z ceną, typem (wsparcie/opor) i siłą 1-3.
   - current_price: aktualna cena (blisko prawej krawędzi).
   - pattern_extreme: ekstremum formacji — dołek pin bara dla sygnału byczego, szczyt dla niedźwiedziego
     (baza do wyznaczenia Stop Loss).
   - nearest_target_level: najbliższy istotny poziom S/R W KIERUNKU sygnału (baza do Take Profit).
     Dla longa: najbliższy opór powyżej. Dla shorta: najbliższe wsparcie poniżej. null jeśli brak.

WYMAGANIA WYJŚCIA:
- Odpowiadasz WYŁĄCZNIE przez wywołanie narzędzia `record_chart_reading` z wypełnionymi polami.
- Ceny podawaj jako liczby zgodne ze skalą osi na wykresie (nie normalizuj).
- confidence: Twoja pewność ODCZYTU obrazu (0-1).
- Bądź konserwatywny: przy niejasnym obrazie obniż confidence i użyj 'brak'/null.
"""

# Definicja narzędzia (tool) wymuszająca ustrukturyzowany JSON zgodny z VisionAnalysis.
VISION_TOOL = {
    "name": "record_chart_reading",
    "description": "Zapisz ustrukturyzowany odczyt wykresu forex. Wypełnij wszystkie pola.",
    "input_schema": {
        "type": "object",
        "properties": {
            "pair": {"type": "string", "description": "Para walutowa, np. EUR/USD"},
            "timeframe": {"type": "string", "description": "Rama czasowa, np. D1/H4/H1"},
            "trend": {"type": "string", "enum": ["byczy", "niedzwiedzi", "boczny"]},
            "trend_structure": {"type": "string", "description": "Opis układu HH/HL lub LH/LL"},
            "price_vs_levels": {"type": "string"},
            "dema_configuration": {"type": ["string", "null"]},
            "pattern": {
                "type": "string",
                "enum": ["pin_bar", "engulfing", "inside_bar", "fakey", "brak"],
            },
            "pattern_direction": {"type": "string", "enum": ["byczy", "niedzwiedzi", "brak"]},
            "pattern_quality": {"type": "integer", "minimum": 0, "maximum": 10},
            "pattern_at_key_level": {"type": "boolean"},
            "key_levels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "price": {"type": "number"},
                        "type": {"type": "string", "enum": ["wsparcie", "opor"]},
                        "strength": {"type": "integer", "minimum": 1, "maximum": 3},
                    },
                    "required": ["price", "type", "strength"],
                },
            },
            "current_price": {"type": "number"},
            "pattern_extreme": {"type": "number"},
            "nearest_target_level": {"type": ["number", "null"]},
            "higher_tf_trend": {
                "type": ["string", "null"],
                "enum": ["byczy", "niedzwiedzi", "boczny", None],
            },
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "notes": {"type": "string"},
        },
        "required": [
            "pair", "timeframe", "trend", "trend_structure", "price_vs_levels",
            "pattern", "pattern_direction", "pattern_quality", "pattern_at_key_level",
            "key_levels", "current_price", "pattern_extreme", "confidence", "notes",
        ],
    },
}
