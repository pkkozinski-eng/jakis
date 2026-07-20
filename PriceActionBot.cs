using System;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    // ============================================================================
    //  PriceActionBot – cBot dla cTrader (cAlgo)
    //  Strategia price action w stylu Nial Fuller na interwale M5.
    //  Sygnały: pin bar + inside bar, filtrowane trendem H1 (EMA)
    //  oraz kontekstem poziomów support/resistance.
    //  Zarządzanie ryzykiem: stały % kapitału, dynamiczna wielkość pozycji,
    //  auto-compounding (liczenie od aktualnego salda), limit dziennego DD.
    // ============================================================================

    // AccessRights.None – bot nie potrzebuje dostępu do systemu plików ani sieci.
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class PriceActionBot : Robot
    {
        // ----------------------------------------------------------------------
        //  PARAMETRY (widoczne i edytowalne w UI cTrader)
        // ----------------------------------------------------------------------

        // Procent kapitału ryzykowany na pojedynczą transakcję (np. 1 = 1%).
        [Parameter("Risk Percent (%)", DefaultValue = 1.0, MinValue = 0.1, MaxValue = 100.0, Step = 0.1, Group = "Ryzyko")]
        public double RiskPercent { get; set; }

        // Stosunek zysku do ryzyka (TP = RiskReward * odległość do SL).
        [Parameter("Risk : Reward", DefaultValue = 2.0, MinValue = 0.5, MaxValue = 10.0, Step = 0.1, Group = "Ryzyko")]
        public double RiskReward { get; set; }

        // Bufor w pipsach dodawany za ekstremum świecy sygnałowej przy ustawianiu SL.
        [Parameter("SL Buffer (pips)", DefaultValue = 2.0, MinValue = 0.0, MaxValue = 50.0, Step = 0.5, Group = "Ryzyko")]
        public double SlBufferPips { get; set; }

        // Maksymalny dzienny drawdown (%) – po przekroczeniu bot nie otwiera pozycji do końca dnia.
        [Parameter("Max Daily Drawdown (%)", DefaultValue = 5.0, MinValue = 0.5, MaxValue = 100.0, Step = 0.5, Group = "Ryzyko")]
        public double MaxDailyDrawdownPercent { get; set; }

        // Okres EMA na wyższym interwale (H1) używanej jako filtr trendu.
        [Parameter("EMA Period (H1)", DefaultValue = 50, MinValue = 5, MaxValue = 400, Group = "Sygnał")]
        public int EmaPeriod { get; set; }

        // Liczba świec wstecz do wyznaczenia kluczowych poziomów support/resistance.
        [Parameter("Level Lookback (bars)", DefaultValue = 20, MinValue = 5, MaxValue = 300, Group = "Sygnał")]
        public int LevelLookback { get; set; }

        // Minimalny stosunek długości knota do korpusu, aby uznać świecę za pin bar.
        [Parameter("Pin Bar Wick Ratio", DefaultValue = 2.0, MinValue = 1.0, MaxValue = 10.0, Step = 0.1, Group = "Sygnał")]
        public double PinBarWickRatio { get; set; }

        // Docelowa wartość konta (equity). Po jej osiągnięciu bot przestaje otwierać nowe pozycje.
        [Parameter("Target Equity", DefaultValue = 1000000, MinValue = 1, Group = "Cel")]
        public double TargetEquity { get; set; }

        // ----------------------------------------------------------------------
        //  POLA WEWNĘTRZNE
        // ----------------------------------------------------------------------

        private const string BotLabel = "PriceActionBot";   // etykieta identyfikująca zlecenia bota

        private Bars _h1Bars;                                // świece interwału H1 (filtr trendu)
        private ExponentialMovingAverage _emaH1;            // EMA na H1

        private DateTime _currentDay;                        // aktualny dzień handlowy (do resetu limitu DD)
        private double _dayStartEquity;                      // equity na początku dnia (baza dla limitu DD)
        private bool _tradingBlockedToday;                   // czy handel zablokowany do końca dnia

        // ----------------------------------------------------------------------
        //  START
        // ----------------------------------------------------------------------
        protected override void OnStart()
        {
            // Pobieramy świece H1 i budujemy na nich EMA – to nasz filtr trendu wyższego rzędu.
            _h1Bars = MarketData.GetBars(TimeFrame.Hour);
            _emaH1 = Indicators.ExponentialMovingAverage(_h1Bars.ClosePrices, EmaPeriod);

            // Inicjalizacja licznika dnia i bazy do liczenia dziennego drawdownu.
            _currentDay = Server.Time.Date;
            _dayStartEquity = Account.Equity;
            _tradingBlockedToday = false;

            Print("PriceActionBot uruchomiony. Symbol: {0}, TF: {1}, Balance: {2:F2} {3}",
                SymbolName, TimeFrame, Account.Balance, Account.Asset.Name);
        }

        // ----------------------------------------------------------------------
        //  GŁÓWNA LOGIKA – wywoływana na zamknięcie każdej świecy M5
        //  (OnBar, nie OnTick – zgodnie z wymaganiami)
        // ----------------------------------------------------------------------
        protected override void OnBar()
        {
            // 1) Obsługa zmiany dnia i limitu dziennego drawdownu.
            HandleNewDayAndDrawdown();
            if (_tradingBlockedToday)
                return; // przekroczono dzienny limit strat – nie otwieramy nic do jutra

            // 2) Warunki blokujące otwieranie nowych pozycji.
            if (Account.Equity >= TargetEquity)
            {
                Print("Cel equity osiągnięty ({0:F2} >= {1:F2}). Bot nie otwiera nowych pozycji.",
                    Account.Equity, TargetEquity);
                return;
            }

            // Reguła: tylko jedna otwarta pozycja na raz + żadnych wiszących zleceń bota.
            if (CountBotPositions() > 0 || CountBotPendingOrders() > 0)
                return;

            // 3) Sprawdzamy, czy mamy wystarczająco danych historycznych.
            if (Bars.Count < LevelLookback + 3 || _h1Bars.Count < EmaPeriod + 2)
                return;

            // 4) Wyznaczamy kierunek trendu na H1 (filtr EMA).
            //    Cena zamknięcia ostatniej zamkniętej świecy H1 vs EMA.
            double h1Close = _h1Bars.ClosePrices.Last(1);
            double h1Ema = _emaH1.Result.Last(1);
            bool trendUp = h1Close > h1Ema;     // cena nad EMA(H1) => tylko longi
            bool trendDown = h1Close < h1Ema;   // cena pod EMA(H1) => tylko shorty

            // 5) Wyznaczamy kluczowe poziomy support/resistance z ostatnich N świec.
            //    (pomijamy świecę sygnałową Last(1), liczymy od Last(2) w tył)
            double support = double.MaxValue;
            double resistance = double.MinValue;
            for (int k = 2; k <= LevelLookback + 1; k++)
            {
                var b = Bars.Last(k);
                if (b.Low < support) support = b.Low;
                if (b.High > resistance) resistance = b.High;
            }
            // Strefa tolerancji przy poziomie = 15% szerokości zakresu N świec.
            double zoneTolerance = (resistance - support) * 0.15;

            // 6) Świeca sygnałowa (ostatnia zamknięta) i świeca-matka (poprzednia).
            var signal = Bars.Last(1);
            var mother = Bars.Last(2);

            // 7) Detekcja formacji na świecy sygnałowej.
            bool bullishPin = IsBullishPinBar(signal);
            bool bearishPin = IsBearishPinBar(signal);
            bool insideBar = IsInsideBar(signal, mother);

            // 8) Kontekst: sygnał musi wystąpić przy odbiciu od poziomu.
            //    Long – świeca dotyka strefy supportu; Short – dotyka strefy oporu.
            bool atSupport = signal.Low <= support + zoneTolerance;
            bool atResistance = signal.High >= resistance - zoneTolerance;

            // ------------------------------------------------------------------
            //  DECYZJE WEJŚCIA
            // ------------------------------------------------------------------

            // --- LONG: pin bar byczy, przy supporcie, zgodny z trendem H1 ---
            if (trendUp && bullishPin && atSupport)
            {
                double slPrice = signal.Low - SlBufferPips * Symbol.PipSize;
                Print("SYGNAŁ LONG (Pin Bar) @ support {0:F5}. SL@{1:F5}", support, slPrice);
                OpenMarketTrade(TradeType.Buy, slPrice);
                return;
            }

            // --- SHORT: pin bar niedźwiedzi, przy oporze, zgodny z trendem H1 ---
            if (trendDown && bearishPin && atResistance)
            {
                double slPrice = signal.High + SlBufferPips * Symbol.PipSize;
                Print("SYGNAŁ SHORT (Pin Bar) @ resistance {0:F5}. SL@{1:F5}", resistance, slPrice);
                OpenMarketTrade(TradeType.Sell, slPrice);
                return;
            }

            // --- INSIDE BAR: wejście na wybicie ekstremum świecy-matki ---
            //     Zlecenie oczekujące Stop; kierunek zgodny z trendem H1 i poziomem.
            if (insideBar)
            {
                if (trendUp && atSupport)
                {
                    // wejście powyżej maksimum matki, SL za minimum matki
                    double entry = mother.High + SlBufferPips * Symbol.PipSize;
                    double slPrice = mother.Low - SlBufferPips * Symbol.PipSize;
                    Print("SYGNAŁ LONG (Inside Bar) – stop @ {0:F5}, SL@{1:F5}", entry, slPrice);
                    PlaceStopTrade(TradeType.Buy, entry, slPrice);
                    return;
                }
                if (trendDown && atResistance)
                {
                    // wejście poniżej minimum matki, SL za maksimum matki
                    double entry = mother.Low - SlBufferPips * Symbol.PipSize;
                    double slPrice = mother.High + SlBufferPips * Symbol.PipSize;
                    Print("SYGNAŁ SHORT (Inside Bar) – stop @ {0:F5}, SL@{1:F5}", entry, slPrice);
                    PlaceStopTrade(TradeType.Sell, entry, slPrice);
                    return;
                }
            }
        }

        // ----------------------------------------------------------------------
        //  ZARZĄDZANIE DNIEM I LIMITEM DZIENNEGO DRAWDOWNU
        // ----------------------------------------------------------------------
        private void HandleNewDayAndDrawdown()
        {
            // Nowy dzień => reset bazy equity i odblokowanie handlu.
            if (Server.Time.Date != _currentDay)
            {
                _currentDay = Server.Time.Date;
                _dayStartEquity = Account.Equity;
                _tradingBlockedToday = false;
                Print("Nowy dzień handlowy. Equity startowe: {0:F2}", _dayStartEquity);
            }

            // Wyliczenie bieżącego dziennego drawdownu jako % spadku equity względem początku dnia.
            if (_dayStartEquity > 0)
            {
                double ddPercent = (_dayStartEquity - Account.Equity) / _dayStartEquity * 100.0;
                if (ddPercent >= MaxDailyDrawdownPercent && !_tradingBlockedToday)
                {
                    _tradingBlockedToday = true;
                    Print("STOP: przekroczono dzienny limit drawdownu ({0:F2}% >= {1:F2}%). Handel wstrzymany do jutra.",
                        ddPercent, MaxDailyDrawdownPercent);
                }
            }
        }

        // ----------------------------------------------------------------------
        //  DETEKCJA FORMACJI
        // ----------------------------------------------------------------------

        // Byczy pin bar: długi dolny knot, korpus w górnej 1/3 świecy.
        private bool IsBullishPinBar(Bar bar)
        {
            double range = bar.High - bar.Low;
            if (range <= 0) return false;

            double body = Math.Abs(bar.Close - bar.Open);
            double bodySafe = Math.Max(body, Symbol.PipSize * 0.1); // zabezpieczenie przed dzieleniem przez 0
            double lowerWick = Math.Min(bar.Open, bar.Close) - bar.Low;
            double upperWick = bar.High - Math.Max(bar.Open, bar.Close);

            // Warunki: dolny knot >= ratio * korpus, korpus w górnej 1/3, mały górny knot.
            bool longLowerWick = lowerWick >= PinBarWickRatio * bodySafe;
            bool bodyInUpperThird = Math.Min(bar.Open, bar.Close) >= bar.Low + range * (2.0 / 3.0);
            bool smallUpperWick = upperWick <= body; // górny knot nie dłuższy niż korpus

            return longLowerWick && bodyInUpperThird && smallUpperWick;
        }

        // Niedźwiedzi pin bar: długi górny knot, korpus w dolnej 1/3 świecy.
        private bool IsBearishPinBar(Bar bar)
        {
            double range = bar.High - bar.Low;
            if (range <= 0) return false;

            double body = Math.Abs(bar.Close - bar.Open);
            double bodySafe = Math.Max(body, Symbol.PipSize * 0.1);
            double lowerWick = Math.Min(bar.Open, bar.Close) - bar.Low;
            double upperWick = bar.High - Math.Max(bar.Open, bar.Close);

            bool longUpperWick = upperWick >= PinBarWickRatio * bodySafe;
            bool bodyInLowerThird = Math.Max(bar.Open, bar.Close) <= bar.Low + range * (1.0 / 3.0);
            bool smallLowerWick = lowerWick <= body;

            return longUpperWick && bodyInLowerThird && smallLowerWick;
        }

        // Inside bar: świeca w pełni objęta zakresem świecy-matki.
        private bool IsInsideBar(Bar bar, Bar mother)
        {
            return bar.High <= mother.High && bar.Low >= mother.Low;
        }

        // ----------------------------------------------------------------------
        //  WYKONANIE ZLECEŃ + OBLICZANIE WOLUMENU (auto-compounding)
        // ----------------------------------------------------------------------

        // Otwarcie pozycji rynkowej z dynamicznym wolumenem, SL i TP.
        private void OpenMarketTrade(TradeType type, double slPrice)
        {
            // Cena wejścia zależna od kierunku (Ask dla kupna, Bid dla sprzedaży).
            double entryPrice = type == TradeType.Buy ? Symbol.Ask : Symbol.Bid;

            // Odległość SL w pipsach (zawsze dodatnia).
            double slPips = Math.Abs(entryPrice - slPrice) / Symbol.PipSize;
            if (slPips <= 0)
            {
                Print("Odrzucono: zerowa odległość SL.");
                return;
            }

            double tpPips = slPips * RiskReward;

            // Wolumen liczony od AKTUALNEGO salda => automatyczne składanie kapitału.
            double volume = CalculatePositionVolume(slPips);
            if (volume <= 0)
                return; // powód wypisany w CalculatePositionVolume

            var result = ExecuteMarketOrder(type, SymbolName, volume, BotLabel, slPips, tpPips);
            if (result.IsSuccessful)
                Print("OTWARTO {0} vol={1} SLpips={2:F1} TPpips={3:F1} Balance={4:F2}",
                    type, volume, slPips, tpPips, Account.Balance);
            else
                Print("Błąd otwarcia pozycji: {0}", result.Error);
        }

        // Złożenie zlecenia oczekującego Stop (dla inside bara – wybicie ekstremum matki).
        private void PlaceStopTrade(TradeType type, double entryPrice, double slPrice)
        {
            double slPips = Math.Abs(entryPrice - slPrice) / Symbol.PipSize;
            if (slPips <= 0)
            {
                Print("Odrzucono zlecenie stop: zerowa odległość SL.");
                return;
            }

            double tpPips = slPips * RiskReward;

            double volume = CalculatePositionVolume(slPips);
            if (volume <= 0)
                return;

            // Zlecenie ważne przez ograniczony czas – aby nie zostało w rynku po utracie kontekstu.
            var expiry = Server.Time.AddHours(2);
            var result = PlaceStopOrder(type, SymbolName, volume, entryPrice, BotLabel, slPips, tpPips, expiry);
            if (result.IsSuccessful)
                Print("ZŁOŻONO STOP {0} vol={1} entry={2:F5} SLpips={3:F1} TPpips={4:F1}",
                    type, volume, entryPrice, slPips, tpPips);
            else
                Print("Błąd złożenia zlecenia stop: {0}", result.Error);
        }

        // Obliczenie wolumenu w jednostkach na podstawie ryzyka i odległości SL.
        private double CalculatePositionVolume(double slPips)
        {
            // Kwota ryzyka = procent AKTUALNEGO salda (auto-compounding).
            double riskAmount = Account.Balance * RiskPercent / 100.0;

            // Wartość jednego pipsa dla 1 jednostki wolumenu (w walucie konta).
            double pipValuePerUnit = Symbol.PipValue;
            if (pipValuePerUnit <= 0)
            {
                Print("Odrzucono: nieprawidłowa wartość PipValue.");
                return 0;
            }

            // Surowy wolumen = ryzyko / (odległość SL w pipsach * wartość pipsa na jednostkę).
            double rawVolume = riskAmount / (slPips * pipValuePerUnit);

            // Normalizacja do dozwolonego kroku wolumenu (zaokrąglenie w dół).
            double volume = Symbol.NormalizeVolumeInUnits(rawVolume, RoundingMode.Down);

            // Zabezpieczenie: za mały kapitał na minimalny wolumen.
            if (volume < Symbol.VolumeInUnitsMin)
            {
                Print("Odrzucono: obliczony wolumen ({0}) < minimalny ({1}). Za mały kapitał na to ryzyko/SL.",
                    volume, Symbol.VolumeInUnitsMin);
                return 0;
            }

            // Zabezpieczenie: nie przekraczaj maksymalnego wolumenu symbolu.
            if (volume > Symbol.VolumeInUnitsMax)
                volume = Symbol.VolumeInUnitsMax;

            return volume;
        }

        // ----------------------------------------------------------------------
        //  POMOCNICZE – liczenie pozycji i zleceń bota
        // ----------------------------------------------------------------------
        private int CountBotPositions()
        {
            int count = 0;
            foreach (var p in Positions)
                if (p.Label == BotLabel && p.SymbolName == SymbolName)
                    count++;
            return count;
        }

        private int CountBotPendingOrders()
        {
            int count = 0;
            foreach (var o in PendingOrders)
                if (o.Label == BotLabel && o.SymbolName == SymbolName)
                    count++;
            return count;
        }

        // ----------------------------------------------------------------------
        //  STOP
        // ----------------------------------------------------------------------
        protected override void OnStop()
        {
            Print("PriceActionBot zatrzymany. Balance: {0:F2}, Equity: {1:F2}",
                Account.Balance, Account.Equity);
        }
    }
}
