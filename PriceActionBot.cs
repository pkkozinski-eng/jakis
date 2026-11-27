using System;
using System.Collections.Generic;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    // ============================================================================
    //  PriceActionBot – cBot dla cTrader (cAlgo)
    //  Strategia: wybicie zakresu azjatyckiego na otwarciu Londynu (M5).
    //   - zakres azjatycki = max/min świec od 00:00 do 08:00 CE(S)T,
    //   - okno wejść 08:00–11:00 CE(S)T,
    //   - sygnał: pierwsze zamknięcie świecy M5 poza zakresem (+ bufor),
    //     poprzednia świeca zamknięta jeszcze w zakresie,
    //   - opcjonalny filtr trendu H1 (EMA) – grać tylko z trendem (Fuller),
    //   - filtr szerokości zakresu (za wąski / za szeroki = brak handlu),
    //   - SL za przeciwną krawędzią zakresu (albo za jego środkiem), TP = R:R,
    //   - max 1 wejście w każdym kierunku na parę dziennie.
    //
    //  OCHRONA FTMO (konto 10 000 USD):
    //   - dzienny limit straty (domyślnie 3% kapitału początkowego), liczony jak
    //     w FTMO: od salda z początku dnia (północ czasu CE(S)T), z otwartymi
    //     pozycjami (equity); po jego osiągnięciu bot zamyka pozycje, usuwa
    //     zlecenia oczekujące i blokuje handel do następnego dnia,
    //   - całkowity limit straty (FTMO 10%) z buforem bezpieczeństwa; po jego
    //     osiągnięciu bot zamyka wszystko i zatrzymuje się na stałe,
    //   - stałe ryzyko na transakcję (domyślnie 0,5%, twardy limit 1%;
    //     XAUUSD max 0,25%),
    //   - kontrola przed wejściem: transakcja nie zostanie otwarta, jeśli jej
    //     ryzyko (SL) mogłoby przebić limit dzienny lub całkowity,
    //   - tylko EURUSD, GBPUSD (+ opcjonalnie XAUUSD),
    //   - max 1 otwarta pozycja na całym koncie (wszystkie instancje bota)
    //     i max 2 transakcje dziennie łącznie ze wszystkich par.
    // ============================================================================

    // Strefa czasowa CE(S)T – FTMO resetuje dzienny limit o północy czasu praskiego.
    // AccessRights.None – bot nie potrzebuje dostępu do systemu plików ani sieci.
    [Robot(TimeZone = TimeZones.CentralEuropeanStandardTime, AccessRights = AccessRights.None)]
    public class PriceActionBot : Robot
    {
        // ----------------------------------------------------------------------
        //  PARAMETRY (widoczne i edytowalne w UI cTrader)
        // ----------------------------------------------------------------------

        // Procent kapitału ryzykowany na pojedynczą transakcję. Twardy limit 1%.
        [Parameter("Risk Percent (%)", DefaultValue = 0.5, MinValue = 0.1, MaxValue = 1.0, Step = 0.05, Group = "Ryzyko")]
        public double RiskPercent { get; set; }

        // Stosunek zysku do ryzyka (TP = RiskReward * odległość do SL).
        [Parameter("Risk : Reward", DefaultValue = 2.0, MinValue = 0.5, MaxValue = 10.0, Step = 0.1, Group = "Ryzyko")]
        public double RiskReward { get; set; }

        // Bufor w pipsach dodawany za ekstremum świecy sygnałowej przy ustawianiu SL.
        [Parameter("SL Buffer (pips)", DefaultValue = 2.0, MinValue = 0.0, MaxValue = 50.0, Step = 0.5, Group = "Ryzyko")]
        public double SlBufferPips { get; set; }

        // Kapitał początkowy konta FTMO – baza dla limitów dziennego i całkowitego.
        [Parameter("Initial Balance", DefaultValue = 10000, MinValue = 100, Group = "FTMO")]
        public double InitialBalance { get; set; }

        // Dzienny limit straty w % kapitału początkowego (FTMO: 5%, zasada projektu: 3%).
        [Parameter("Daily Loss Limit (%)", DefaultValue = 3.0, MinValue = 0.5, MaxValue = 5.0, Step = 0.1, Group = "FTMO")]
        public double DailyLossLimitPercent { get; set; }

        // Całkowity limit straty w % kapitału początkowego (FTMO: 10%).
        [Parameter("Max Total Loss (%)", DefaultValue = 10.0, MinValue = 1.0, MaxValue = 10.0, Step = 0.5, Group = "FTMO")]
        public double MaxTotalLossPercent { get; set; }

        // Bufor bezpieczeństwa dla limitu całkowitego: bot reaguje przy (limit - bufor),
        // żeby poślizg przy zamykaniu nie przebił twardej granicy FTMO.
        [Parameter("Total Loss Buffer (%)", DefaultValue = 1.0, MinValue = 0.0, MaxValue = 5.0, Step = 0.1, Group = "FTMO")]
        public double TotalLossBufferPercent { get; set; }

        // Maksymalna liczba transakcji dziennie (łącznie wszystkie pary).
        [Parameter("Max Trades Per Day", DefaultValue = 2, MinValue = 1, MaxValue = 10, Group = "FTMO")]
        public int MaxTradesPerDay { get; set; }

        // Złoto dopuszczone dopiero po osobnym backteście.
        [Parameter("Allow XAUUSD", DefaultValue = false, Group = "FTMO")]
        public bool AllowGold { get; set; }

        // Godziny w czasie CE(S)T (czas polski = czas FTMO).
        [Parameter("Asian Range Start (h)", DefaultValue = 0, MinValue = 0, MaxValue = 23, Group = "Wybicie")]
        public int AsianStartHour { get; set; }

        [Parameter("Asian Range End (h)", DefaultValue = 8, MinValue = 1, MaxValue = 23, Group = "Wybicie")]
        public int AsianEndHour { get; set; }

        [Parameter("Trade Window Start (h)", DefaultValue = 8, MinValue = 0, MaxValue = 23, Group = "Wybicie")]
        public int TradeStartHour { get; set; }

        [Parameter("Trade Window End (h)", DefaultValue = 11, MinValue = 1, MaxValue = 24, Group = "Wybicie")]
        public int TradeEndHour { get; set; }

        // Ile pipsów za krawędzią zakresu musi zamknąć się świeca, żeby uznać wybicie.
        [Parameter("Breakout Buffer (pips)", DefaultValue = 1.0, MinValue = 0.0, MaxValue = 50.0, Step = 0.5, Group = "Wybicie")]
        public double BreakoutBufferPips { get; set; }

        // Za wąski zakres = szum, za szeroki = ruch już się odbył / za duży SL.
        [Parameter("Min Range (pips)", DefaultValue = 10, MinValue = 0, MaxValue = 1000, Group = "Wybicie")]
        public double MinRangePips { get; set; }

        [Parameter("Max Range (pips)", DefaultValue = 50, MinValue = 1, MaxValue = 5000, Group = "Wybicie")]
        public double MaxRangePips { get; set; }

        // SL za środkiem zakresu zamiast za przeciwną krawędzią (mniejszy SL, częstsze wybicia SL).
        [Parameter("SL at Range Middle", DefaultValue = false, Group = "Wybicie")]
        public bool SlAtMidRange { get; set; }

        // Filtr trendu H1: long tylko nad EMA, short tylko pod EMA.
        [Parameter("Use H1 Trend Filter", DefaultValue = true, Group = "Wybicie")]
        public bool UseTrendFilter { get; set; }

        // Okres EMA na wyższym interwale (H1) używanej jako filtr trendu.
        [Parameter("EMA Period (H1)", DefaultValue = 50, MinValue = 5, MaxValue = 400, Group = "Wybicie")]
        public int EmaPeriod { get; set; }

        // Docelowa wartość konta (equity). Po jej osiągnięciu bot przestaje otwierać nowe pozycje.
        [Parameter("Target Equity", DefaultValue = 1000000, MinValue = 1, Group = "Cel")]
        public double TargetEquity { get; set; }

        // ----------------------------------------------------------------------
        //  POLA WEWNĘTRZNE
        // ----------------------------------------------------------------------

        private const string BotLabel = "PriceActionBot";   // etykieta identyfikująca zlecenia bota
        private const double GoldMaxRiskPercent = 0.25;      // max ryzyko na XAUUSD

        private Bars _h1Bars;                                // świece interwału H1 (filtr trendu)
        private ExponentialMovingAverage _emaH1;            // EMA na H1

        private DateTime _currentDay;                        // aktualny dzień handlowy (CE(S)T)
        private double _dayStartBalance;                     // saldo na początku dnia (baza limitu dziennego)
        private bool _tradingBlockedToday;                   // handel zablokowany do następnego dnia
        private bool _totalLimitHit;                         // osiągnięto limit całkowity – koniec handlu

        private DateTime _rangeDay = DateTime.MinValue;      // dzień, dla którego policzono zakres
        private bool _rangeValid;                            // zakres policzony i przeszedł filtry
        private double _asianHigh;                           // maksimum zakresu azjatyckiego
        private double _asianLow;                            // minimum zakresu azjatyckiego

        // ----------------------------------------------------------------------
        //  START
        // ----------------------------------------------------------------------
        protected override void OnStart()
        {
            // Dozwolone instrumenty – na innych symbolach bot się nie uruchamia.
            if (!IsAllowedSymbol())
            {
                Print("STOP: symbol {0} nie jest dozwolony (tylko EURUSD, GBPUSD{1}).",
                    SymbolName, AllowGold ? ", XAUUSD" : "; XAUUSD wyłączony parametrem");
                Stop();
                return;
            }

            if (TimeFrame != TimeFrame.Minute5)
                Print("UWAGA: bot projektowany na M5, uruchomiony na {0}.", TimeFrame);

            // Pobieramy świece H1 i budujemy na nich EMA – to nasz filtr trendu wyższego rzędu.
            _h1Bars = MarketData.GetBars(TimeFrame.Hour);
            _emaH1 = Indicators.ExponentialMovingAverage(_h1Bars.ClosePrices, EmaPeriod);

            // Baza dnia odtwarzana z historii – restart bota w trakcie dnia
            // nie „zeruje” już poniesionych strat.
            StartNewDay(Server.Time.Date);

            Print("PriceActionBot uruchomiony. Symbol: {0}, TF: {1}, Balance: {2:F2} {3}, ryzyko/transakcję: {4:F2}%",
                SymbolName, TimeFrame, Account.Balance, Account.Asset.Name, EffectiveRiskPercent());
            Print("FTMO: limit dzienny {0:F2}% ({1:F2}), limit całkowity {2:F2}% (bot reaguje przy {3:F2}%), max {4} transakcji/dzień.",
                DailyLossLimitPercent, DailyLossLimitAmount(), MaxTotalLossPercent,
                MaxTotalLossPercent - TotalLossBufferPercent, MaxTradesPerDay);

            CheckRiskLimits();
        }

        // ----------------------------------------------------------------------
        //  OCHRONA NA KAŻDYM TICKU – tylko kontrola limitów (zamykanie pozycji),
        //  nowe wejścia nadal wyłącznie w OnBar.
        // ----------------------------------------------------------------------
        protected override void OnTick()
        {
            CheckRiskLimits();
        }

        // ----------------------------------------------------------------------
        //  GŁÓWNA LOGIKA – wywoływana na zamknięcie każdej świecy M5
        // ----------------------------------------------------------------------
        protected override void OnBar()
        {
            // 1) Limity FTMO (zmiana dnia, limit dzienny, limit całkowity).
            CheckRiskLimits();
            if (_tradingBlockedToday || _totalLimitHit)
                return;

            // 2) Warunki blokujące otwieranie nowych pozycji.
            if (Account.Equity >= TargetEquity)
            {
                Print("Cel equity osiągnięty ({0:F2} >= {1:F2}). Bot nie otwiera nowych pozycji.",
                    Account.Equity, TargetEquity);
                return;
            }

            // Max 1 otwarta pozycja / zlecenie na CAŁYM koncie (wszystkie pary).
            // To też realizuje zasadę korelacji: przy sygnale na GBPUSD i EURUSD
            // w tym samym kierunku wejdzie tylko pierwszy.
            if (CountBotPositions() > 0 || CountBotPendingOrders() > 0)
                return;

            // Max N transakcji dziennie łącznie.
            if (CountTradesToday() >= MaxTradesPerDay)
                return;

            // 3) Okno wejść (np. 08:00–11:00 CE(S)T).
            int hour = Server.Time.Hour;
            if (hour < TradeStartHour || hour >= TradeEndHour)
                return;

            // 4) Zakres azjatycki na dziś (liczony raz dziennie, po jego zamknięciu).
            UpdateAsianRange();
            if (!_rangeValid)
                return;

            if (Bars.Count < 3)
                return;

            // 5) Świeca sygnałowa (ostatnia zamknięta) i poprzednia.
            var signal = Bars.Last(1);
            var prev = Bars.Last(2);
            double buffer = BreakoutBufferPips * Symbol.PipSize;

            // Świeże wybicie: sygnałowa zamyka się poza zakresem, poprzednia jeszcze w nim.
            bool breakUp = signal.Close > _asianHigh + buffer && prev.Close <= _asianHigh + buffer;
            bool breakDown = signal.Close < _asianLow - buffer && prev.Close >= _asianLow - buffer;
            if (!breakUp && !breakDown)
                return;

            // 6) Filtr trendu H1 (Fuller: grać z trendem wyższego interwału).
            if (UseTrendFilter)
            {
                if (_h1Bars.Count < EmaPeriod + 2)
                    return;
                double h1Close = _h1Bars.ClosePrices.Last(1);
                double h1Ema = _emaH1.Result.Last(1);
                if (breakUp && h1Close <= h1Ema)
                {
                    Print("Wybicie w górę odrzucone: H1 pod EMA({0}).", EmaPeriod);
                    return;
                }
                if (breakDown && h1Close >= h1Ema)
                {
                    Print("Wybicie w dół odrzucone: H1 nad EMA({0}).", EmaPeriod);
                    return;
                }
            }

            // 7) Max 1 wejście w danym kierunku na tej parze dziennie.
            var type = breakUp ? TradeType.Buy : TradeType.Sell;
            if (DirectionTradedToday(type))
                return;

            // 8) SL za przeciwną krawędzią zakresu (lub za środkiem), TP = R:R.
            double slBuffer = SlBufferPips * Symbol.PipSize;
            double mid = (_asianHigh + _asianLow) / 2.0;
            double slPrice = breakUp
                ? (SlAtMidRange ? mid : _asianLow) - slBuffer
                : (SlAtMidRange ? mid : _asianHigh) + slBuffer;

            Print("SYGNAŁ {0}: wybicie zakresu azjatyckiego {1:F5}–{2:F5}, zamknięcie {3:F5}, SL@{4:F5}",
                breakUp ? "LONG" : "SHORT", _asianLow, _asianHigh, signal.Close, slPrice);
            OpenMarketTrade(type, slPrice);
        }

        // ----------------------------------------------------------------------
        //  ZAKRES AZJATYCKI
        // ----------------------------------------------------------------------
        private void UpdateAsianRange()
        {
            DateTime today = Server.Time.Date;
            if (_rangeDay == today)
                return;

            DateTime from = today.AddHours(AsianStartHour);
            DateTime to = today.AddHours(AsianEndHour);
            if (Server.Time < to)
                return; // zakres jeszcze się nie zamknął

            _rangeDay = today;
            _rangeValid = false;

            double high = double.MinValue;
            double low = double.MaxValue;
            int count = 0;
            for (int i = Bars.Count - 1; i >= 0; i--)
            {
                var bar = Bars[i];
                if (bar.OpenTime < from)
                    break;
                if (bar.OpenTime >= to)
                    continue;
                if (bar.High > high) high = bar.High;
                if (bar.Low < low) low = bar.Low;
                count++;
            }

            if (count == 0)
            {
                Print("Brak świec w zakresie azjatyckim {0:HH:mm}–{1:HH:mm} – dziś bez handlu.", from, to);
                return;
            }

            double rangePips = (high - low) / Symbol.PipSize;
            if (rangePips < MinRangePips || rangePips > MaxRangePips)
            {
                Print("Zakres azjatycki {0:F1} pips poza filtrem {1}–{2} – dziś bez handlu.",
                    rangePips, MinRangePips, MaxRangePips);
                return;
            }

            _asianHigh = high;
            _asianLow = low;
            _rangeValid = true;
            Print("Zakres azjatycki {0:yyyy-MM-dd}: {1:F5}–{2:F5} ({3:F1} pips).", today, low, high, rangePips);
        }

        // Czy bot otworzył już dziś transakcję w tym kierunku na tej parze.
        private bool DirectionTradedToday(TradeType type)
        {
            foreach (var t in History)
                if (t.Label == BotLabel && t.SymbolName == SymbolName && t.TradeType == type && t.EntryTime >= _currentDay)
                    return true;
            foreach (var p in Positions)
                if (p.Label == BotLabel && p.SymbolName == SymbolName && p.TradeType == type && p.EntryTime >= _currentDay)
                    return true;
            return false;
        }

        // ----------------------------------------------------------------------
        //  OCHRONA FTMO – LIMIT DZIENNY I CAŁKOWITY
        // ----------------------------------------------------------------------

        // Kwota dziennego limitu straty (np. 3% z 10 000 = 300 USD).
        private double DailyLossLimitAmount()
        {
            return InitialBalance * DailyLossLimitPercent / 100.0;
        }

        // Equity, poniżej którego bot zamyka wszystko na stałe (np. 10 000 * (1 - 9%) = 9 100).
        private double TotalLossFloor()
        {
            double effectivePercent = Math.Max(0.0, MaxTotalLossPercent - TotalLossBufferPercent);
            return InitialBalance * (1.0 - effectivePercent / 100.0);
        }

        // Equity, poniżej którego bot zamyka wszystko do końca dnia.
        private double DailyLossFloor()
        {
            return _dayStartBalance - DailyLossLimitAmount();
        }

        // Nowy dzień (północ CE(S)T): saldo z początku dnia odtwarzamy z historii,
        // żeby restart bota w trakcie dnia nie kasował dziennych strat.
        private void StartNewDay(DateTime day)
        {
            _currentDay = day;
            _tradingBlockedToday = false;

            double closedTodayNet = 0;
            foreach (var t in History)
                if (t.ClosingTime >= day)
                    closedTodayNet += t.NetProfit;

            _dayStartBalance = Account.Balance - closedTodayNet;

            Print("Dzień handlowy {0:yyyy-MM-dd}. Saldo startowe: {1:F2}, dzienny próg equity: {2:F2}",
                day, _dayStartBalance, DailyLossFloor());
        }

        // Sprawdzenie limitów – wywoływane na każdym ticku i barze.
        private void CheckRiskLimits()
        {
            if (_totalLimitHit)
                return;

            if (Server.Time.Date != _currentDay)
                StartNewDay(Server.Time.Date);

            double equity = Account.Equity;

            // Limit całkowity – zamykamy wszystko i zatrzymujemy bota na stałe.
            if (equity <= TotalLossFloor())
            {
                _totalLimitHit = true;
                Print("STOP CAŁKOWITY: equity {0:F2} <= {1:F2} (limit {2:F2}% - bufor {3:F2}%). Zamykam wszystko i zatrzymuję bota.",
                    equity, TotalLossFloor(), MaxTotalLossPercent, TotalLossBufferPercent);
                CloseAllBotExposure();
                Stop();
                return;
            }

            // Limit dzienny – zamykamy wszystko i blokujemy do następnego dnia.
            if (!_tradingBlockedToday && equity <= DailyLossFloor())
            {
                _tradingBlockedToday = true;
                Print("STOP DZIENNY: equity {0:F2} <= {1:F2} (saldo startowe {2:F2} - {3:F2}%). Zamykam pozycje, handel wstrzymany do jutra.",
                    equity, DailyLossFloor(), _dayStartBalance, DailyLossLimitPercent);
                CloseAllBotExposure();
            }
        }

        // Czy transakcja z danym ryzykiem (kwota do SL) zmieści się w limitach.
        private bool RiskFitsLimits(double riskAmount)
        {
            double equityAtSl = Account.Equity - riskAmount;

            if (equityAtSl <= DailyLossFloor())
            {
                Print("Odrzucono: SL ({0:F2}) przebiłby limit dzienny (equity przy SL {1:F2} <= {2:F2}).",
                    riskAmount, equityAtSl, DailyLossFloor());
                return false;
            }
            if (equityAtSl <= TotalLossFloor())
            {
                Print("Odrzucono: SL ({0:F2}) przebiłby limit całkowity (equity przy SL {1:F2} <= {2:F2}).",
                    riskAmount, equityAtSl, TotalLossFloor());
                return false;
            }
            return true;
        }

        // Zamknięcie wszystkich pozycji i usunięcie zleceń oczekujących bota (wszystkie pary).
        private void CloseAllBotExposure()
        {
            foreach (var o in new List<PendingOrder>(PendingOrders))
                if (o.Label == BotLabel)
                    CancelPendingOrder(o);

            foreach (var p in new List<Position>(Positions))
                if (p.Label == BotLabel)
                    ClosePosition(p);
        }

        // ----------------------------------------------------------------------
        //  INSTRUMENTY I RYZYKO
        // ----------------------------------------------------------------------

        private bool IsGold()
        {
            return SymbolName.ToUpperInvariant().Contains("XAUUSD");
        }

        private bool IsAllowedSymbol()
        {
            string s = SymbolName.ToUpperInvariant();
            if (s.Contains("EURUSD") || s.Contains("GBPUSD"))
                return true;
            return AllowGold && IsGold();
        }

        // Ryzyko na transakcję z uwzględnieniem limitu dla złota.
        private double EffectiveRiskPercent()
        {
            return IsGold() ? Math.Min(RiskPercent, GoldMaxRiskPercent) : RiskPercent;
        }

        // ----------------------------------------------------------------------
        //  WYKONANIE ZLECEŃ + OBLICZANIE WOLUMENU
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

        // Obliczenie wolumenu w jednostkach na podstawie stałego ryzyka i odległości SL.
        private double CalculatePositionVolume(double slPips)
        {
            // Kwota ryzyka = stały % AKTUALNEGO salda (dla złota max 0,25%).
            double riskAmount = Account.Balance * EffectiveRiskPercent() / 100.0;

            // Wartość jednego pipsa dla 1 jednostki wolumenu (w walucie konta).
            double pipValuePerUnit = Symbol.PipValue;
            if (pipValuePerUnit <= 0)
            {
                Print("Odrzucono: nieprawidłowa wartość PipValue.");
                return 0;
            }

            // Surowy wolumen = ryzyko / (odległość SL w pipsach * wartość pipsa na jednostkę).
            double rawVolume = riskAmount / (slPips * pipValuePerUnit);

            // Normalizacja do dozwolonego kroku wolumenu (zaokrąglenie w dół – ryzyko nigdy nie rośnie).
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

            // Faktyczne ryzyko po zaokrągleniu – musi zmieścić się w limitach FTMO.
            double actualRisk = volume * slPips * pipValuePerUnit;
            if (!RiskFitsLimits(actualRisk))
                return 0;

            return volume;
        }

        // ----------------------------------------------------------------------
        //  POMOCNICZE – liczenie pozycji, zleceń i transakcji bota (wszystkie pary)
        // ----------------------------------------------------------------------
        private int CountBotPositions()
        {
            int count = 0;
            foreach (var p in Positions)
                if (p.Label == BotLabel)
                    count++;
            return count;
        }

        private int CountBotPendingOrders()
        {
            int count = 0;
            foreach (var o in PendingOrders)
                if (o.Label == BotLabel)
                    count++;
            return count;
        }

        // Liczba transakcji otwartych dzisiaj (zamknięte z historii + nadal otwarte).
        private int CountTradesToday()
        {
            var ids = new HashSet<int>();
            foreach (var t in History)
                if (t.Label == BotLabel && t.EntryTime >= _currentDay)
                    ids.Add(t.PositionId);
            foreach (var p in Positions)
                if (p.Label == BotLabel && p.EntryTime >= _currentDay)
                    ids.Add(p.Id);
            return ids.Count;
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
