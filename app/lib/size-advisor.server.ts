// Wspólna logika rekomendacji rozmiaru, używana przez publiczny endpoint
// (app/routes/api.recommend.ts) oraz tester w panelu (app/routes/app.test-prompt.ts).
//
// PODZIAŁ PRACY (hybryda):
//   1. Model AI  – TYLKO odczytuje tabelę wymiarów ze zdjęcia / tekstu, klasyfikuje
//      kategorię i luz kroju, szacuje obwody ciała klienta. Zero arytmetyki.
//   2. Kod (resolveSize) – deterministycznie wybiera rozmiar: okno luzu wg kroju,
//      lista kandydatów, remis rozstrzygany preferencją fasonu, korekta ze stylu
//      marki. Wynik jest powtarzalny (koniec „mrugania" M↔L).
//   3. Uzasadnienie – składane z szablonu (PL/EN) na prawdziwych liczbach.
//
// Provider wybiera `AI_PROVIDER` w .env: "openai" (OPENAI_API_KEY) albo "gemini".

import OpenAI from "openai";

export class AIQuotaError extends Error {
  constructor(message = "AI quota exceeded") {
    super(message);
    this.name = "AIQuotaError";
  }
}

export class AICallError extends Error {
  constructor(message = "AI call failed") {
    super(message);
    this.name = "AICallError";
  }
}

export type AIProvider = "openai" | "gemini";

export function getAIConfig(): { provider: AIProvider; model: string } {
  const provider: AIProvider =
    process.env.AI_PROVIDER === "openai" ? "openai" : "gemini";
  const model =
    provider === "gemini"
      ? process.env.GEMINI_MODEL || "gemini-3.6-flash"
      : process.env.OPENAI_MODEL || "gpt-4o-mini";
  return { provider, model };
}

export const SIZE_CHART_IMAGE_RE = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/;

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type FitPreference = "fitted" | "loose" | null;
export type GarmentCategory = "top" | "bottom" | "dress";
export type CutLooseness = "slim" | "regular" | "relaxed" | "oversize";

/** Jeden wiersz tabeli wymiarów po normalizacji (wszystkie obwody = PEŁNE, w cm). */
export type NormalizedSizeRow = {
  size: string;
  chest?: number | null; // obwód w klatce
  waist?: number | null; // obwód w pasie
  hip?: number | null; // obwód bioder
  length?: number | null; // długość tyłu (góra) / całkowita (dół)
  inseam?: number | null; // długość wewnętrzna nogawki (dół)
  legOpening?: number | null; // szerokość nogawki u dołu (dół) — tylko informacyjnie, nie wpływa na dobór rozmiaru
};

/** To, co model ma zwrócić – żadnych decyzji rozmiarowych. */
export type ChartExtraction = {
  rows: NormalizedSizeRow[];
  category: GarmentCategory;
  cut: CutLooseness;
  bodyChest: number | null;
  bodyWaist: number | null;
  bodyHip: number | null;
  korekta: -1 | 0 | 1;
  /** Dzianina / stretch (elastan, jersey, modal, dzianina) – może przylegać. */
  stretch: boolean;
  /** Pas na gumce / sznurku – obwód pasa nie ogranicza rozmiaru. */
  elasticWaist: boolean;
  /** Odzież wierzchnia (kurtka, płaszcz) – potrzebny luz na warstwy. */
  outerwear: boolean;
  /** „Model ma 184 cm i nosi rozmiar L" – wzorzec marki, jeśli podany w opisie. */
  modelHeight: number | null;
  modelSize: string | null;
  /** Zapasowy typ, gdy nie ma żadnej tabeli – wtedy model zgaduje sam. */
  fallbackSize: string | null;
  fallbackExplanation: string | null;
};

type PromptInput = {
  productTitle?: string | null;
  productDescription?: string | null;
  gender?: string | null;
  height?: number | string | null;
  weight?: number | string | null;
  bodyType?: string | null;
  brandStyleNotes?: string | null;
  productSizeData?: string | null;
  productNotes?: string | null;
  hasSizeChartImage?: boolean;
  fitPreference?: FitPreference;
  /** ISO 639-1 kod, w którym ma być zapasowe uzasadnienie modelu. */
  responseLanguage?: string | null;
  /** true → prompt tylko o produkcie (bez sylwetki klienta) — używany do
   *  jednorazowej analizy produktu przy konfiguracji przez admina. */
  omitShopper?: boolean;
};

const LANGUAGE_HINTS: Record<string, string> = {
  pl: "polskim",
  en: "angielskim (English)",
  de: "niemieckim (Deutsch)",
  fr: "francuskim (Français)",
  es: "hiszpańskim (Español)",
  it: "włoskim (Italiano)",
  nl: "niderlandzkim (Nederlands)",
  cs: "czeskim (Čeština)",
  uk: "ukraińskim (Українська)",
};

// ---------------------------------------------------------------------------
// Stałe decyzyjne (dostrajalne bez ruszania AI)
// ---------------------------------------------------------------------------

const CANON_SIZES = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "3XL",
  "4XL",
  "5XL",
];

/** Docelowy luz w OBWODZIE dla GÓRY (cm dodane do obwodu klatki) wg kroju.
 *  Dzianina/stretch może przylegać (slim schodzi poniżej zera); tkanina
 *  (koszula, denim) potrzebuje realnego luzu, żeby dało się ruszać i zapiąć. */
const EASE_TOP_STRETCH: Record<CutLooseness, [number, number]> = {
  slim: [-4, 6],
  regular: [6, 16],
  relaxed: [14, 30],
  oversize: [24, 48],
};
const EASE_TOP_WOVEN: Record<CutLooseness, [number, number]> = {
  slim: [4, 12],
  regular: [9, 20],
  relaxed: [16, 32],
  oversize: [24, 48],
};

/** Docelowy luz w OBWODZIE dla DOŁU (pas). Spodnie/jeansy siedzą na pasie – luz
 *  jest mały niezależnie od tego, jak „szeroki" jest krój (szerokość jest w
 *  nogawce, nie w pasie). Dresy z gumą są odrobinę bardziej wybaczające. */
const EASE_BOTTOM: Record<CutLooseness, [number, number]> = {
  slim: [-3, 2],
  regular: [-2, 5],
  relaxed: [-1, 9],
  oversize: [0, 14],
};

/** Tolerancja kandydata w trybie „po długości" (cm od celu). */
const TOP_LENGTH_TOL = 2;

/** Na ile wynik z ubrania referencyjnego może odbiegać od rozmiaru, który daje
 *  sam obwód ciała, zanim uznamy go za halucynację. Asymetrycznie: ubranie
 *  „luźniejsze niż sugeruje sylwetka" jest wiarygodne (preferencja, warstwy) do
 *  +2 rozmiarów; „ciaśniejsze" tylko do −1 — bo zbyt mały rozmiar to realne
 *  ryzyko, że klient go nie założy. */
const REF_MAX_LARGER = 2;
const REF_MAX_SMALLER = 1;

/** Docelowa długość wewnętrzna nogawki wg wzrostu (cm) – tylko jako remis-breaker. */
function inseamBand(h: number): [number, number] {
  if (h <= 165) return [73, 79];
  if (h <= 175) return [76, 82];
  if (h <= 183) return [79, 85];
  if (h <= 190) return [82, 88];
  return [85, 91];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function sizeIndex(size: string): number {
  const norm = size.toUpperCase().replace(/\s+/g, "");
  const i = CANON_SIZES.indexOf(norm);
  if (i !== -1) return i;
  // Rozmiary numeryczne (jeansy: 26, 28, 30, 30T…) nie są w CANON_SIZES —
  // bez tego wszystkie takie wiersze dostawały ten sam indeks (50), więc
  // Array.sort (stabilny) zostawiał je w kolejności wpisania w panelu, a nie
  // rosnącego rozmiaru. Cała reszta silnika (sąsiedzi, strażnik
  // monotoniczności, szukanie okna) zakłada rosnące sortowanie — więc
  // kolejność wpisania mogła po cichu psuć wynik dla numerycznie rozmiarowanych
  // produktów. Offset +100, żeby nigdy nie kolidować z indeksami liter (0-9).
  const numeric = parseInt(norm, 10);
  if (Number.isFinite(numeric)) return 100 + numeric;
  return 1000; // naprawdę nieznana etykieta — na koniec, stabilnie między sobą
}

// Zgrubne oszacowanie obwodów ciała – używane, gdy model nie poda sensownej liczby.
function estimateChest(
  h: number,
  w: number,
  gender: string,
  build: string,
): number {
  const female = gender === "female";
  const base = female ? 90 : 95.5;
  // „Waga należna" wg BMI ~23.5 (M) / 21.5 (K). Wcześniej wzór Broki (wzrost−100)
  // zawyżał ją u wysokich osób, przez co nadwyżka masy była niedoszacowana i
  // rozmiar spadał o jeden dla postawnych sylwetek. Stromszy współczynnik masy
  // (0.72) rozsuwa szczupłych i tęższych.
  const idealWeight = (female ? 21.5 : 23.5) * (h / 100) ** 2;
  const weightAdj = (w - idealWeight) * 0.72;
  const buildAdj =
    build === "slim" ? -3 : build === "athletic" ? 3 : build === "plus" ? 11 : 0;
  return clamp(base + weightAdj + buildAdj + (h - 175) * 0.28, 74, 152);
}

function estimateWaist(
  h: number,
  w: number,
  gender: string,
  build: string,
): number {
  const chest = estimateChest(h, w, gender, build);
  const drop = gender === "female" ? 18 : 16;
  // Sylwetka atletyczna = wyraźny V-taper: klatka w górę, ale pas mocno w dół.
  const buildAdj =
    build === "plus" ? 8 : build === "athletic" ? -4 : build === "slim" ? -2 : 0;
  return clamp(chest - drop + buildAdj, 56, 142);
}

/** Zgrubny rozmiar litery, gdy produkt NIE MA tabeli — deterministycznie z
 *  obwodu klatki/biustu (nie z „M" wyplutego przez model). Preferencja fasonu
 *  przesuwa o jeden krok. */
function estimateLetterSize(
  h: number,
  w: number,
  gender: string,
  build: string,
  fit: FitPreference,
  category: GarmentCategory,
  modelHeight?: number | null,
  modelSize?: string | null,
): string {
  // Wzorzec marki ("model 185 cm nosi M") to konkretna deklaracja DLA TEGO
  // PRODUKTU — silniejszy sygnał niż ogólne pasmo klatki z samego wzrostu/
  // wagi, nawet gdy produkt nie ma pełnej tabeli wymiarów (tylko ten jeden
  // fakt w opisie). Ta sama logika co kotwica na wzorcu w resolveSize
  // (patrz niżej), tylko po skali CANON_SIZES zamiast po wierszach tabeli.
  const normModelSize = modelSize?.toUpperCase().replace(/\s+/g, "");
  if (
    modelHeight &&
    modelHeight > 120 &&
    modelHeight < 220 &&
    normModelSize &&
    CANON_SIZES.includes(normModelSize)
  ) {
    const baseIdx = CANON_SIZES.indexOf(normModelSize);
    const HEIGHT_PER_SIZE = 12;
    const raw = (h - modelHeight) / HEIGHT_PER_SIZE;
    const step = raw >= 0 ? Math.round(raw) : -Math.round(-raw);
    let idx = clamp(baseIdx + step, 0, CANON_SIZES.length - 1);
    if (fit === "loose") idx += 1;
    idx = clamp(idx, CANON_SIZES.indexOf("XS"), CANON_SIZES.indexOf("XXL"));
    return CANON_SIZES[idx];
  }

  const chest = estimateChest(h, w, gender, build);
  // Górna granica pasma → etykieta (pełny obwód w cm).
  const bands = chestBands(gender);
  let label = "XXL";
  for (const [hi, s] of bands) {
    if (chest < hi) {
      label = s;
      break;
    }
  }
  let idx = CANON_SIZES.indexOf(label);
  if (idx < 0) idx = CANON_SIZES.indexOf("M");

  // Podłoga wzrostu dla GÓRY: tors długiej osoby wymaga minimum długości bez
  // względu na obwód — inaczej 198 cm szczupły dostawał „S" (crop).
  if (category !== "bottom") {
    const hFloor =
      h >= 197 ? "XL" : h >= 189 ? "L" : h >= 181 ? "M" : h >= 172 ? "S" : null;
    if (hFloor) idx = Math.max(idx, CANON_SIZES.indexOf(hFloor));
  }

  // Bez tabeli tylko „loose" przesuwa w górę — automatyczne schodzenie przy
  // „fitted" grozi za małym rozmiarem, którego klient nie założy (a osoba
  // preferująca fason dopasowany zwykle i tak jest w dolnej części pasma).
  if (fit === "loose") idx += 1;
  idx = clamp(idx, CANON_SIZES.indexOf("XS"), CANON_SIZES.indexOf("XXL"));
  return CANON_SIZES[idx];
}

/** Czy tabela wygląda na boxy/oversize po SAMYCH liczbach — bez płci, do
 *  klasyfikacji przy ekstrakcji (nie znamy jeszcze sylwetki). Najmniejszy
 *  rozmiar ma duży bezwzględny obwód klatki ORAZ jest szeroki i krótki
 *  (obwód:długość). Połówki obwodu (wszystkie < 78) najpierw ×2. */
function looksBoxyByMeasure(rows: NormalizedSizeRow[]): boolean {
  const withChest = rows.filter(
    (r): r is NormalizedSizeRow & { chest: number } =>
      typeof r.chest === "number" && r.chest > 0,
  );
  if (withChest.length < 2) return false;
  const half = withChest.every((r) => r.chest < 78);
  const smallest = withChest.reduce((a, b) => (a.chest <= b.chest ? a : b));
  const minChest = half ? smallest.chest * 2 : smallest.chest;
  const len = smallest.length;
  if (typeof len !== "number" || len <= 0) return false;
  return minChest >= 106 && minChest / len >= 1.58;
}

/** Te same pasma klatki co w `estimateLetterSize` — wspólne źródło. */
function chestBands(gender: string): Array<[number, string]> {
  return gender === "female"
    ? [[82, "XS"], [88, "S"], [94, "M"], [100, "L"], [108, "XL"], [116, "XXL"]]
    : [[86, "XS"], [94, "S"], [102, "M"], [110, "L"], [118, "XL"], [128, "XXL"]];
}

/** Suwak dopasowania, gdy rozmiar wyszedł z oszacowania (produkt bez tabeli):
 *  wartość reprezentatywna pasma = jego środek, a `scaleFrom` interpoluje po
 *  nich szacowany obwód klatki. Pinezka jedzie płynnie ze wzrostem i wagą. */
function estimateFitScale(
  chest: number,
  gender: string,
  size: string,
): FitScale | null {
  const bands = chestBands(gender);
  const pool = bands.map(([hi, label], i) => {
    const lo =
      i > 0
        ? bands[i - 1][0]
        : hi - (bands[i + 1] ? bands[i + 1][0] - hi : 8);
    return { label, v: (lo + hi) / 2 };
  });
  return scaleFrom(pool, chest, size);
}

// ---------------------------------------------------------------------------
// Prompt ekstrakcyjny (model NIE wybiera rozmiaru)
// ---------------------------------------------------------------------------

export function buildSizeAdvisorPrompt(input: PromptInput): string {
  const brandStyleNotes = input.brandStyleNotes?.trim();
  const brandStyleSection = brandStyleNotes
    ? `\nWYTYCZNE MARKI (uwzględnij przy polu "krojLuz" i "korektaRozmiaru"):\n"""\n${brandStyleNotes}\n"""\n`
    : "";

  const productSizeData = input.productSizeData?.trim();
  const productNotes = input.productNotes?.trim();
  const productSection = `${
    productSizeData
      ? `\nOFICJALNA TABELA WYMIARÓW (ŹRÓDŁO NADRZĘDNE — przepisz "tabela" WYŁĄCZNIE z niej):\n"""\n${productSizeData}\n"""\n`
      : ""
  }${
    productNotes
      ? `\nUWAGI DO PRODUKTU (uwzględnij przy "krojLuz" i "korektaRozmiaru"):\n"""\n${productNotes}\n"""\n`
      : ""
  }${
    input.hasSizeChartImage
      ? productSizeData
        ? `\nDołączono też ZDJĘCIE rozmiarówki, ale MASZ już tabelę tekstową powyżej — użyj zdjęcia tylko do uzupełnienia brakującego wymiaru, jeśli w tabeli tekstowej jest luka. Nie dodawaj rozmiarów, których nie ma w tabeli tekstowej.\n`
        : `\nDo wiadomości dołączono ZDJĘCIE rozmiarówki – odczytaj z niego wszystkie wymiary. Diagramy z zaznaczonymi strzałkami (np. "A"/"B" na rysunku ubrania + osobna tabelka z literami wymiarów) miej mocno na uwadze: NAJPIERW policz, ile rozmiarów (wierszy) jest w legendzie/tabelce z liczbami — Twoja odpowiedź MUSI mieć dokładnie tyle samo wierszy w "tabela", nawet skrajne, łatwe do pominięcia (np. XS na górze). Jeśli tekst w komórce jest zbyt mały/niewyraźny, by odczytać go z pewnością — wstaw null w tej komórce. NIE WOLNO wymyślać "ładnej", regularnej progresji (np. co równo +2 cm), żeby wypełnić lukę w odczycie – zmyślona liczba, która "wygląda sensownie", jest gorsza niż null, bo wygląda na prawdziwą, a nie jest.\n`
      : ""
  }`;

  const fitLine = input.fitPreference
    ? `\nKlient zaznaczył preferencję fasonu: ${
        input.fitPreference === "fitted" ? "bardziej dopasowany" : "luźniejszy"
      } (to rozstrzyga program, nie Ty).\n`
    : "";

  const langCode = (input.responseLanguage || "pl").toLowerCase().slice(0, 2);
  const langHint = LANGUAGE_HINTS[langCode] || `o kodzie ISO 639-1 "${langCode}"`;

  const shopperBlock = input.omitShopper
    ? "\n(Brak danych klienta — analizujesz sam produkt. Pole „obwod...Klienta” zostaw jako null.)\n"
    : `- Płeć: ${input.gender === "female" ? "kobieta" : "mężczyzna"}
- Wzrost: ${input.height} cm, waga: ${input.weight} kg
- Budowa: ${input.bodyType || "standard"}
${fitLine}`;

  return `
Jesteś ekspertem od rozmiarówek odzieży. Twoje ZADANIE: odczytać dane i je sklasyfikować.
NIE wybierasz rozmiaru – zrobi to program na podstawie Twoich danych.

DANE WEJŚCIOWE:
- Produkt: ${input.productTitle || "Odzież"}
- Opis/wymiary z karty produktu: ${input.productDescription || "brak"}
${shopperBlock}${brandStyleSection}${productSection}
ZWRÓĆ WYŁĄCZNIE czysty JSON (bez \`\`\`), dokładnie w tym kształcie:
{
  "tabela": [
    { "rozmiar": "S", "obwodKlatki": 130, "obwodPasa": null, "obwodBioder": null, "dlugosc": 68, "dlugoscNogawki": null, "szerokoscNogawki": null }
  ],
  "kategoria": "gora" | "dol" | "sukienka",
  "krojLuz": "obcisly" | "regularny" | "swobodny" | "oversize",
  "obwodKlatkiKlienta": 96,
  "obwodPasaKlienta": 82,
  "obwodBioderKlienta": 98,
  "korektaRozmiaru": 0,
  "dzianina": true,
  "pasNaGumce": false,
  "odziezWierzchnia": false,
  "modelWzrost": null,
  "modelRozmiar": null,
  "zapasowyRozmiar": null,
  "zapasoweUzasadnienie": ""
}

ZASADY:
- "tabela": przepisz KAŻDY rozmiar i KAŻDY wymiar z tabeli/zdjęcia/opisu — wliczając SKRAJNE kolumny/wiersze (najmniejszy i największy rozmiar, np. XS i XXL), które łatwo pominąć przy pobieżnym odczycie. Policz kolumny/wiersze w źródle i sprawdź, że masz tyle samo pozycji w "tabela", zanim odpowiesz. Klatkę/pas/biodra wpisuj DOKŁADNIE tak, jak są w źródle — NIE PRZELICZAJ ich sam: jeśli tabela podaje pomiar na płasko (pacha-pacha, "A", "1/2 klatki", "szerokość" — to najczęstsza konwencja na metkach), zostaw liczbę jak jest, program sam wykryje i znormalizuje. Nie mnóż przez 2. Do oceny "krojLuz" poniżej i tak w pamięci przelicz te liczby na pełny obwód (×2), żeby porównać z ciałem — ale w samym polu "tabela" mają zostać nieprzeliczone, takie jak w źródle. Brak wymiaru = null. Nie zgaduj wartości, których nie ma.
- "dlugoscNogawki" to WYŁĄCZNIE "Inseam" / "Inseam Length" / wewnętrzna długość nogawki (od krocza do dołu) — jeśli źródło ma kolumnę dokładnie o tym znaczeniu, ONA idzie tutaj. "dlugosc" to CAŁKOWITA długość ubrania podana WPROST jako jedna wartość (dla spodni: "Outseam"/"Length" — długość od pasa do dołu na zewnątrz; dla góry: od karku/ramienia do dołu). To DWA RÓŻNE wymiary — nie wpisuj tej samej kolumny do obu. Jeśli źródło NIE podaje całkowitej długości wprost, tylko osobne składowe (np. "Front Rise" + "Inseam"), NIE sumuj ich ani nie zgaduj — zostaw "dlugosc" jako null, "dlugoscNogawki" i tak masz z samego Inseam. Kolumny w rodzaju "Leg Opening" / "Hem Width" / "obwód nogawki u dołu" to SZEROKOŚĆ dołu nogawki, nie długość — idą do "szerokoscNogawki" (tylko dla spodni/jeansów/dresów/szortów), nie wciskaj ich do "dlugosc" ani "dlugoscNogawki" tylko dlatego, że nazwa też zawiera "nogawka"/"leg". Podaj ją DOKŁADNIE jak w źródle (bez przeliczania) — tak jak resztę wymiarów w "tabela".
- "obwodKlatki" NIE dotyczy spodni/jeansów/dresów/szortów/spódnic (kategoria "dol") — spodnie nie mają obwodu klatki. Zostaw "obwodKlatki": null dla całej tabeli w tej kategorii, NAWET jeśli w źródle jest jakaś inna liczba (np. "Front Rise"/wysokość stanu), której nie umiesz przypisać do żadnego innego pola — puste pole jest lepsze niż wpisanie tam przypadkowej wartości tylko dlatego, że "obwodKlatki" jest pierwsze w przykładzie. Analogicznie "obwodPasa"/"obwodBioder" zwykle nie dotyczą samej góry (t-shirt/koszula/bluza) — tylko dołu i sukienki.
- Jeśli NIE MA żadnych wymiarów (ani zdjęcia, ani tabeli, ani liczb w opisie): "tabela": [], a Ty sam oszacuj "zapasowyRozmiar" (XS–XXL) i krótkie "zapasoweUzasadnienie" (max 2 zdania, w języku ${langHint}) – jeśli wytyczne marki każą schodzić/podnosić rozmiar, uwzględnij to i wspomnij o tym. W przeciwnym razie zostaw je jako null / "".
- "kategoria": "dol" = spodnie, jeansy, dresy, szorty, spódnica. "gora" = t-shirt, koszula, bluza, hoodie, sweter, kurtka. "sukienka" = sukienka, kombinezon.
- "krojLuz": oceń PRZEDE WSZYSTKIM z wymiarów tabeli, nie z nazwy. Porównaj PEŁNY obwód klatki najmniejszego rozmiaru z typowym ciałem dla tej litery (mężczyzna: S≈94, M≈102, L≈110, XL≈118 cm; kobieta ~8 cm mniej) oraz proporcję obwód:długość. Zapas ≥15 cm nad ciałem przy najmniejszym rozmiarze lub szeroki i krótki krój (obwód:długość ≥ 1.6) = "oversize", NAWET gdy nazwa mówi „klasyczny/regular". Nazwa i opis to tylko słaba wskazówka. Wartości: "obcisly" (ubranie ciaśniejsze/równe ciału), "regularny" (~6–12 cm zapasu), "swobodny" (relaxed/loose/baggy, ~13–20 cm), "oversize" (boxy, drop shoulder, ≥20 cm lub bardzo szeroki krój).
- "obwod...Klienta": oszacuj z płci, wzrostu, wagi, budowy. Podaj liczby, nie null.
- "korektaRozmiaru": -1 jeśli marka/uwagi każą "brać mniejszy / rozmiarówka zawyżona / size down"; +1 przy "brać większy / zawężona"; inaczej 0.
- "dzianina": true jeśli materiał jest rozciągliwy (dzianina, jersey, elastan/spandex/lycra, modal, prążek, sweter). false dla tkaniny (denim/jeans, popelina, twill, gabardyna, len, płótno, "woven").
- "pasNaGumce": true jeśli pas jest elastyczny / na gumce / ze sznurkiem / ściągaczem (dresy, joggery). false dla sztywnego pasa z guzikiem (jeansy, chinosy, spodnie garniturowe).
- "odziezWierzchnia": true dla kurtki, płaszcza, parki, marynarki noszonej na wierzch. false dla t-shirtu, bluzy, koszuli.
- "modelWzrost" / "modelRozmiar": w opisie szukaj wzorca marki AKTYWNIE, w KAŻDEJ formie, nie tylko pełnego zdania — sklepy odzieżowe (zwłaszcza streetwear) najczęściej piszą to skrótowo, np. samym "Model 185/M" albo "Model: 188cm/L" na końcu opisu, bez słów "wzrost"/"nosi rozmiar". Rozpoznaj też warianty: "Model ma 184 cm i nosi rozmiar L", "wzrost modela: 190 cm, rozmiar: XL", "185cm / M". Liczba obok liter S/M/L/XL/XXL itd. w kontekście słowa "model" to prawie zawsze TO WŁAŚNIE, nawet bez dodatkowych słów. Jeśli naprawdę nie ma żadnej wzmianki o modelu — null.
`;
}

// ---------------------------------------------------------------------------
// Decyzja rozmiarowa – czysta funkcja, deterministyczna, testowalna
// ---------------------------------------------------------------------------

/** Wymiary ubrania, które klientowi leży idealnie — zmierzone NA PŁASKO, w cm.
 *  `chest`/`waist`/`hip` = szerokość pacha–pacha (pas / biodra); silnik mnoży je
 *  ×2, żeby porównać z pełnym obwodem w tabeli. `length`/`inseam` — jak są. */
export type RefMeasurements = {
  chest?: number;
  waist?: number;
  hip?: number;
  length?: number;
  inseam?: number;
};

type ResolveInput = {
  extraction: ChartExtraction;
  height: number;
  weight: number;
  gender: string;
  bodyType: string;
  fit: FitPreference;
  /** Korektę ze stylu marki stosujemy tylko, gdy realnie były notatki marki /
   *  produktu – inaczej model bywa nadgorliwy i przesuwa rozmiar bez powodu. */
  allowKorekta: boolean;
  /** Wymiary dobrze leżącego ubrania klienta — porównanie ubranie-do-ubrania
   *  na liczbach (bez AI). */
  referenceGarment?: { measurements: RefMeasurements } | null;
  /** Wewnętrzne: głębokość rekurencji strażnika monotoniczności (patrz koniec
   *  resolveSize). Nie ustawiać z zewnątrz. */
  guardDepth?: number;
};

export type ResolveResult = {
  size: string;
  mode: "chest" | "waist" | "length";
  chosenValue: number;
  /** Obwód ciała (klatka/pas) faktycznie użyty w decyzji – do uzasadnienia. */
  bodyPrimaryUsed: number;
  window: [number, number];
  candidates: string[];
  korektaApplied: -1 | 0 | 1;
  tieBrokenBy: "fit" | "build" | "midpoint" | "single" | null;
  /** true → rozmiar wyprowadzony z „model marki ma X cm i nosi Y". */
  anchoredToModel: boolean;
  modelRef: { height: number; size: string } | null;
  /** ustawione, gdy rozmiar wyszedł z porównania do ubrania referencyjnego. */
  matchedReference: { measurements: RefMeasurements } | null;
  /** Sąsiednie rozmiary z tabeli — do suwaka „ciaśniej ← Ty → luźniej". */
  neighborSmaller: string | null;
  neighborLarger: string | null;
  /** Suwak dopasowania dla widżetu — patrz `FitScale`. null, gdy nie da się
   *  policzyć (za mało wierszy z wymiarami, niemonotoniczna tabela). */
  fitScale: FitScale | null;
};

/** „Progress bar" dopasowania w widżecie. `labels` to 2–3 rozmiary w RÓWNO
 *  rozłożonych komórkach (etykiety trzymają się CIAŁA, nie rekomendacji, więc
 *  przy zmianie rozmiaru pinezka nie przeskakuje). `pos` ∈ [0.05, 0.95] to
 *  pozycja pinezki „Ty" wzdłuż toru — `target` (idealny wymiar dla sylwetki)
 *  interpolowany liniowo między środkami komórek, z ekstrapolacją poza końce.
 *  `recIndex` wskazuje rekomendowany rozmiar w `labels` (pogrubiony). */
export type FitScale = {
  labels: string[];
  pos: number;
  recIndex: number;
};

const normSize = (s: string) => s.toUpperCase().replace(/\s+/g, "");

/** Etykiety rozmiarów tuż obok wybranego (do suwaka w widżecie). */
function neighborLabels(
  rows: NormalizedSizeRow[],
  chosenSize: string,
): { neighborSmaller: string | null; neighborLarger: string | null } {
  const i = rows.findIndex((r) => normSize(r.size) === normSize(chosenSize));
  return {
    neighborSmaller: i > 0 ? normSize(rows[i - 1].size) : null,
    neighborLarger:
      i >= 0 && i < rows.length - 1 ? normSize(rows[i + 1].size) : null,
  };
}

/** Buduje `FitScale` = „progress bar" dopasowania.
 *
 *  1. `gIdx` — pozycja `value` w GLOBALNEJ skali indeksów rozmiarów (float),
 *     interpolowana liniowo między wartościami wierszy, z ekstrapolacją poza
 *     końce (może wyjść poza [0, len-1]).
 *  2. Okno 2–3 komórek wyśrodkowane na `round(gIdx)` — czyli na najbliższym
 *     CAŁYM rozmiarze względem sylwetki, NIE na rekomendacji. Dzięki temu przy
 *     zmianie rekomendacji (np. S→M o 1 cm) okno się nie przesuwa i pinezka
 *     jedzie płynnie — zmienia się tylko podświetlona komórka. Skok pojawia się
 *     dopiero, gdy sylwetka minie sam środek między dwoma rozmiarami.
 *  3. `pos` — pozycja pinezki: `gIdx` przeliczone na ułamek toru wg środków
 *     komórek okna, docięte do [0.03, 0.97]. */
function scaleFrom(
  pool: Array<{ label: string; v: number }>,
  value: number,
  recLabel: string,
): FitScale | null {
  const pts = pool.filter((x) => Number.isFinite(x.v) && x.v > 0);
  if (pts.length < 2 || !Number.isFinite(value)) return null;
  for (let i = 1; i < pts.length; i++) {
    if (!(pts[i].v > pts[i - 1].v)) return null; // niemonotoniczne → odpuść
  }

  const last = pts.length - 1;
  let gIdx: number;
  if (value <= pts[0].v) {
    const slope = pts[1].v - pts[0].v;
    gIdx = slope > 0 ? (value - pts[0].v) / slope : 0;
  } else if (value >= pts[last].v) {
    const slope = pts[last].v - pts[last - 1].v;
    gIdx = slope > 0 ? last - 1 + (value - pts[last - 1].v) / slope : last;
  } else {
    let k = 1;
    while (k < pts.length && value > pts[k].v) k++;
    gIdx = k - 1 + (value - pts[k - 1].v) / (pts[k].v - pts[k - 1].v);
  }

  const size = Math.min(3, pts.length);
  const start = clamp(Math.round(gIdx) - 1, 0, pts.length - size);
  const shown = pts.slice(start, start + size);
  const n = shown.length;

  let recIndex = shown.findIndex((x) => x.label === normSize(recLabel));
  if (recIndex < 0) {
    const recAll = pts.findIndex((x) => x.label === normSize(recLabel));
    recIndex = recAll >= 0 && recAll < start ? 0 : n - 1;
  }

  // Pinezka może stać blisko krawędzi rekomendowanej komórki, ale NIE wchodzić
  // w komórkę innego rozmiaru — inaczej „pasek na L, a napis M" wygląda na błąd.
  const pos = clamp(
    (gIdx - start + 0.5) / n,
    (recIndex + 0.12) / n,
    (recIndex + 0.88) / n,
  );

  return { labels: shown.map((x) => x.label), pos, recIndex };
}

export function resolveSize(input: ResolveInput): ResolveResult | null {
  const { extraction, height, weight, gender, bodyType, fit } = input;
  const allowKorekta = input.allowKorekta;
  let rows = [...extraction.rows]
    .filter((r) => r && typeof r.size === "string" && r.size.trim())
    .sort((a, b) => sizeIndex(a.size) - sizeIndex(b.size));
  if (rows.length < 2) return null; // brak sensownej tabeli → caller użyje fallbacku

  const category = extraction.category;
  const cut = extraction.cut;

  const useWaist = category === "bottom";
  let mode: "chest" | "waist" | "length" = useWaist ? "waist" : "chest";

  // Normalizacja połówek obwodu → pełny obwód, na CAŁEJ tabeli. W branży
  // klatka/pas/biodra w tabelach rozmiarów są NAJCZĘŚCIEJ podawane na płasko
  // (pacha–pacha, pas/biodra na płasko), a nie jako pełny obwód — dotyczy to
  // zarówno tabel przepisanych przez AI, jak i siatki wpisanej ręcznie przez
  // sprzedawcę (structuredSizeData), bo obie kończą jako `extraction.rows`.
  const isHalf = (key: "chest" | "waist" | "hip") => {
    const vals = rows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === "number" && v > 0);
    return vals.length >= 2 && vals.every((v) => v < 78);
  };
  const chestHalf = isHalf("chest");
  const waistHalf = isHalf("waist");
  const hipHalf = isHalf("hip");
  if (chestHalf || waistHalf || hipHalf) {
    rows = rows.map((r) => ({
      ...r,
      chest: chestHalf && r.chest ? r.chest * 2 : r.chest,
      waist: waistHalf && r.waist ? r.waist * 2 : r.waist,
      hip: hipHalf && r.hip ? r.hip * 2 : r.hip,
    }));
  }
  // Sanity: obwód klatki/pasa/bioder > ~135 cm dla NAJMNIEJSZEGO rozmiaru PO
  // TYM, jak sami go przed chwilą podwoiliśmy (isHalf wyżej) to prawie na
  // pewno oznacza, że wcale nie trzeba było podwajać — wartość była już
  // pełnym obwodem. Cofamy WYŁĄCZNIE własne podwojenie (`*Half` musi być
  // true dla tego wymiaru) — bez tego warunku ten sam próg 135cm fałszywie
  // "poprawiał" prawdziwe, nietknięte tabele specjalistycznych sklepów plus-
  // size, których NAJMNIEJSZY rozmiar (np. 3XL) sam w sobie ma >135cm klatki —
  // takich danych nigdy nie dotknęliśmy (isHalf ich nie podwoił, bo nie
  // wszystkie wartości były <78), więc nie ma tu niczego do cofania.
  const halfByKey = { chest: chestHalf, waist: waistHalf, hip: hipHalf };
  for (const key of ["chest", "waist", "hip"] as const) {
    if (!halfByKey[key]) continue;
    const vals = rows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === "number" && v > 0);
    if (vals.length >= 3 && Math.min(...vals) > 135) {
      rows = rows.map((r) => ({
        ...r,
        [key]: r[key] ? Math.round((r[key] as number) / 2) : r[key],
      }));
    }
  }

  // Wymiar wiążący: dół → pas, a jak w CAŁEJ tabeli nigdzie nie ma pasa (np.
  // spódnica opisana tylko obwodem bioder — biodra są wtedy realnym
  // ograniczeniem dopasowania, nie pas) → biodra zamiast niego. Decyzja jest
  // dla całej tabeli naraz (nie per wiersz), żeby nie mieszać wymiarów między
  // rozmiarami, gdy tylko część wierszy ma pas wypełniony. Sukienka → biust,
  // a jak brak, to biodra/talia (model bywa niekonsekwentny, w którym polu
  // zapisze obwód sukienki).
  const bottomHasWaist = rows.some(
    (r) => typeof r.waist === "number" && r.waist > 0,
  );
  const topHasChest = rows.some(
    (r) => typeof r.chest === "number" && r.chest > 0,
  );
  const primaryOf = (r: NormalizedSizeRow) =>
    useWaist
      ? bottomHasWaist
        ? r.waist
        : r.hip
      : category === "dress"
        ? (r.chest ?? r.hip ?? r.waist)
        : topHasChest
          ? r.chest
          : r.hip;
  const usable = rows.filter(
    (r) => typeof primaryOf(r) === "number" && (primaryOf(r) as number) > 0,
  );

  // Obwód ciała WYŁĄCZNIE z wzoru antropometrycznego. Szacunki modelu
  // (pole "obwod...Klienta") to zwykle stałe „średnie populacyjne" – bezużyteczne.
  const bodyPrimary = Math.round(
    useWaist
      ? estimateWaist(height, weight, gender, bodyType)
      : estimateChest(height, weight, gender, bodyType),
  );

  const easeTable = useWaist
    ? EASE_BOTTOM
    : extraction.stretch
      ? EASE_TOP_STRETCH
      : EASE_TOP_WOVEN;
  const outer = !useWaist && extraction.outerwear ? 5 : 0; // luz na warstwy
  const [easeLo, easeHi] = (easeTable[cut] ?? easeTable.regular).map(
    (v) => v + outer,
  ) as [number, number];

  // Wymiar „długościowy" do gradacji – bierzemy pierwszy z realnym rozrzutem
  // (model potrafi wpisać stałą wartość w kolumnę, której nie ma → bezużyteczna).
  const spread = (f: (r: NormalizedSizeRow) => number | null | undefined) => {
    const vals = rows
      .map(f)
      .filter((v): v is number => typeof v === "number" && v > 0);
    return vals.length >= 2 && new Set(vals).size >= 2
      ? Math.max(...vals) - Math.min(...vals)
      : 0;
  };
  const lengthPriority = useWaist
    ? [(r: NormalizedSizeRow) => r.inseam, (r: NormalizedSizeRow) => r.length]
    : [(r: NormalizedSizeRow) => r.length, (r: NormalizedSizeRow) => r.inseam];
  let lengthDimFn: ((r: NormalizedSizeRow) => number) | null = null;
  for (const f of lengthPriority) {
    if (spread(f) >= 2) {
      lengthDimFn = (r) => f(r) as number;
      break;
    }
  }

  // Wzorzec marki: „model ma 184 cm i nosi rozmiar L" – najsilniejszy sygnał,
  // działa dla każdej kategorii. Jeśli jest, kotwiczymy na nim.
  const modelRow =
    extraction.modelHeight &&
    extraction.modelHeight > 120 &&
    extraction.modelHeight < 220 &&
    extraction.modelSize
      ? rows.find(
          (r) =>
            r.size.toUpperCase().replace(/\s+/g, "") ===
            extraction.modelSize!.toUpperCase().replace(/\s+/g, ""),
        )
      : undefined;

  // --- Ubranie referencyjne klienta: wymiary ubrania, które leży idealnie ---
  // Porównanie UBRANIE-DO-UBRANIA na liczbach (bez AI). Dla każdego wymiaru,
  // który podał klient I który jest w tabeli, liczymy znormalizowany dystans do
  // każdego wiersza; wygrywa wiersz o najmniejszej średniej. Bramka
  // zdroworozsądkowa: wynik nie może odbiegać od rozmiaru z samej sylwetki
  // bardziej niż +REF_MAX_LARGER / −REF_MAX_SMALLER — inaczej odrzucamy i
  // lecimy dalej ścieżką obwodową.
  const refM = input.referenceGarment?.measurements;
  if (refM && rows.length >= 2) {
    const refDims: Array<{
      f: (r: NormalizedSizeRow) => number | null | undefined;
      v: number;
    }> = [];
    const addDim = (
      key: "chest" | "waist" | "hip" | "length" | "inseam",
      raw: number | undefined,
      double: boolean,
    ) => {
      const f = (r: NormalizedSizeRow) => r[key];
      if (typeof raw === "number" && raw > 0 && spread(f) >= 1) {
        refDims.push({ f, v: double ? raw * 2 : raw });
      }
    };
    // szerokość pacha–pacha → ×2 (tabela ma pełny obwód); długości bez zmian
    addDim("chest", refM.chest, true);
    addDim("waist", refM.waist, true);
    addDim("hip", refM.hip, true);
    addDim("length", refM.length, false);
    addDim("inseam", refM.inseam, false);

    if (refDims.length) {
      let bestIdx = -1;
      let bestScore = Infinity;
      rows.forEach((r, i) => {
        let sum = 0;
        let n = 0;
        for (const d of refDims) {
          const val = d.f(r);
          if (typeof val !== "number" || val <= 0) continue;
          sum += Math.abs(val - d.v) / Math.max(1, spread(d.f));
          n += 1;
        }
        if (n && sum / n < bestScore) {
          bestScore = sum / n;
          bestIdx = i;
        }
      });

      if (bestIdx >= 0) {
        // najbliższy rozmiar wg samego obwodu ciała — do bramki
        const centerEase = (easeLo + easeHi) / 2;
        const target = bodyPrimary + centerEase;
        let bodyIdx = bestIdx;
        let bestGap = Infinity;
        rows.forEach((r, i) => {
          const p = primaryOf(r);
          if (typeof p === "number" && p > 0 && Math.abs(p - target) < bestGap) {
            bestGap = Math.abs(p - target);
            bodyIdx = i;
          }
        });
        const delta = bestIdx - bodyIdx; // + = większy niż sugeruje sylwetka

        if (delta <= REF_MAX_LARGER && delta >= -REF_MAX_SMALLER) {
          let idx = bestIdx;
          let tie: ResolveResult["tieBrokenBy"] = "single";
          if (fit === "fitted" && idx > 0) {
            idx -= 1;
            tie = "fit";
          } else if (fit === "loose" && idx < rows.length - 1) {
            idx += 1;
            tie = "fit";
          }
          let chosen = rows[idx];
          let korektaApplied: -1 | 0 | 1 = 0;
          const k = extraction.korekta;
          if (allowKorekta && (k === -1 || k === 1)) {
            const ni = clamp(idx + k, 0, rows.length - 1);
            if (ni !== idx) {
              chosen = rows[ni];
              korektaApplied = k;
            }
          }
          const rv = (r: NormalizedSizeRow) =>
            (useWaist ? r.waist : (r.chest ?? r.hip ?? r.waist)) as number;
          return {
            size: normSize(chosen.size),
            mode: useWaist ? "waist" : "chest",
            chosenValue: Math.round(rv(chosen) || 0),
            bodyPrimaryUsed: Math.round(bodyPrimary),
            window: [0, 0],
            candidates: [normSize(rows[bestIdx].size)],
            korektaApplied,
            tieBrokenBy: tie,
            anchoredToModel: false,
            modelRef: null,
            matchedReference: { measurements: refM },
            ...neighborLabels(rows, chosen.size),
            fitScale: scaleFrom(
              rows.map((r) => ({ label: normSize(r.size), v: rv(r) })),
              target,
              chosen.size,
            ),
          };
        }
        console.warn(
          "[resolveSize] ubranie referencyjne odrzucone — kłóci się z sylwetką",
          { bestSize: rows[bestIdx].size, bodySize: rows[bodyIdx].size, delta },
        );
      }
    }
  }

  const smallestPrimary = usable.length
    ? Math.min(...usable.map((r) => primaryOf(r) as number))
    : Infinity;

  // „Strukturalnie boxy" — ocena z SAMYCH wymiarów tabeli, niezależnie od nazwy
  // produktu / systemu i od tego, co AI wpisało w `krojLuz`. Najmniejszy rozmiar
  // ma dużo więcej obwodu niż typowe ciało dla tej litery (≥15 cm zapasu) ORAZ
  // krój jest szeroki i krótki (obwód:długość ≥ 1.6). Wtedy o rozmiarze decyduje
  // długość vs wzrost, nie obwód — inaczej wysoka szczupła sylwetka dostaje za
  // mały rozmiar (klatka „pasuje", ale koszulka jest za krótka).
  const structurallyBoxy = (() => {
    if (
      category !== "top" ||
      useWaist ||
      lengthDimFn == null ||
      usable.length < 2
    ) {
      return false;
    }
    const bySize = [...usable].sort(
      (a, b) => (primaryOf(a) as number) - (primaryOf(b) as number),
    );
    const smallest = bySize[0];
    const chestS = primaryOf(smallest) as number;
    const lenS = lengthDimFn(smallest);
    if (!(chestS > 0) || !(lenS > 0)) return false;
    const band = chestBands(gender).find(
      ([, s]) => s === normSize(smallest.size),
    );
    if (!band) return false; // rozmiary liczbowe → zostaw istniejącą logikę
    return chestS - band[0] >= 15 && chestS / lenS >= 1.6;
  })();

  // Tryb „po długości" tylko dla GÓRY (nie sukienek – te zawsze po biuście,
  // długość to styl mini/midi, nie rozmiar). „Ukryty oversize" gdy najmniejszy
  // rozmiar jest ~2 rozmiary szerszy niż sylwetka albo tabela jest strukturalnie boxy.
  const topProportional =
    category === "top" &&
    (cut === "oversize" ||
      structurallyBoxy ||
      (usable.length >= 2 && smallestPrimary > bodyPrimary + 18)) &&
    lengthDimFn != null;
  // Dół z pasem na gumce gradujemy po DŁUGOŚCI nogawki tylko wtedy, gdy nogawka
  // faktycznie się różni między rozmiarami (≥5 cm rozrzutu). Inaczej (np. jersey
  // jorts, gdzie nogawka to 63–66 cm) lecimy ścieżką obwodową z zapasem na gumę.
  const lengthSpread = lengthDimFn ? spread(lengthDimFn) : 0;
  // Domysł "to pewnie guma" (bez flagi z AI) wolno włączyć TYLKO gdy pas w
  // tabeli faktycznie prawie się nie zmienia między rozmiarami (typowe dla
  // jednego rozmiaru gumy w kilku długościach) — inaczej klient, którego pas
  // po prostu przerasta CAŁĄ tabelę (np. jeansy 26–36, żaden rozmiar w ogóle
  // nie jest gumą), trafiał do trybu "po długości", który ignoruje pas i
  // potrafi wylosować dowolny z rozmiarów remisujących długością (nawet dużo
  // za mały) zamiast uczciwie zgłosić "największy dostępny" (patrz podłoga
  // obwodu niżej). Gdy pas realnie różnicuje rozmiary, wierzymy tylko
  // jawnej fladze `elasticWaist`.
  const waistSpreadForElasticGuess = useWaist ? spread(primaryOf) : 0;
  const bottomElastic =
    useWaist &&
    lengthDimFn != null &&
    (usable.length === 0
      ? // Zero danych o pasie w CAŁEJ tabeli (np. luźne szorty ze sznurkiem,
        // sklasyfikowane tylko przez "długość"/"długość nogawki") — długość
        // to jedyny sygnał, jaki w ogóle mamy, więc próg jest taki sam, jak
        // ten, którym w ogóle wybraliśmy `lengthDimFn` (≥2 cm rozrzutu) —
        // podnoszenie go do 5 miało sens tylko jako zabezpieczenie PRZED
        // odrzuceniem lepszej, obwodowej ścieżki, a takiej tu nie ma. Bez
        // tego cała (realna, kompletna) tabela była ignorowana na rzecz
        // ogólnego oszacowania z samego wzrostu/wagi.
        lengthSpread >= 2
      : lengthSpread >= 5 &&
        (extraction.elasticWaist ||
          (usable.length >= 2 &&
            waistSpreadForElasticGuess <= 10 &&
            usable.every((r) => (primaryOf(r) as number) < bodyPrimary - 3))));
  // Ogólny wentyl bezpieczeństwa NIEZALEŻNY od kategorii: gdy w CAŁEJ tabeli
  // nie ma żadnego wymiaru obwodowego (klatka/pas/biodra — cokolwiek, czego
  // szuka `primaryOf` dla tej kategorii), ale jest realna długość — lepiej
  // dobrać po długości niż zignorować kompletną tabelę i spaść na goły
  // szacunek z samego wzrostu/wagi (np. sukienka opisana tylko długością,
  // spódnica opisana tylko biodrami gdy akurat i tych brak). `topProportional`
  // i `bottomElastic` już to łapią dla swoich kategorii przy dodatkowych
  // warunkach (krój, elastyczność) — to jest wspólna siatka na resztę.
  const noPrimaryDataAtAll =
    usable.length === 0 && lengthDimFn != null && spread(lengthDimFn) >= 2;
  const proportional = topProportional || bottomElastic || noPrimaryDataAtAll;

  let candRows: NormalizedSizeRow[];
  let window: [number, number];
  let valueOf: (r: NormalizedSizeRow) => number;
  let target: number;
  // Wersja `target` bez zaokrąglenia — tylko do pozycji pinezki na suwaku, żeby
  // 1 cm wzrostu przesuwał ją odrobinę, a nie o krok (patrz tryb długościowy).
  let scaleTarget: number | undefined;
  let anchoredToModel = false;

  if (
    modelRow &&
    ((lengthDimFn && lengthDimFn(modelRow) > 0) ||
      (primaryOf(modelRow) ?? 0) > 0)
  ) {
    // --- Tryb: kotwica na wzorcu marki ---
    anchoredToModel = true;
    const gradeOnLength = Boolean(lengthDimFn && lengthDimFn(modelRow) > 0);
    valueOf =
      gradeOnLength && lengthDimFn
        ? lengthDimFn
        : (r) => primaryOf(r) as number;
    mode = gradeOnLength ? "length" : useWaist ? "waist" : "chest";
    const pool = rows.filter((r) => (valueOf(r) ?? 0) > 0);
    const baseIdx = pool.indexOf(modelRow);
    // Topy/bluzy gradują ~1 rozmiar na 10–12 cm wzrostu, nie na 6 — przy 6 cm
    // klient 5 cm wyższy od modela dostawał od razu rozmiar wyżej.
    const HEIGHT_PER_SIZE = 12;
    const raw = (height - extraction.modelHeight!) / HEIGHT_PER_SIZE;
    // Zaokrąglenie „połowa od zera" — inaczej Math.round(-0.5)=0 dawało lekki
    // bias w górę (klient dokładnie pół rozmiaru niższy od modela → rozmiar modela).
    const step = raw >= 0 ? Math.round(raw) : -Math.round(-raw);
    const idx = clamp(baseIdx + step, 0, pool.length - 1);
    target = valueOf(pool[idx]);
    window = [target - 1, target + 1];
    candRows = [pool[idx]];
    // Pinezka NIE może być przypięta do samej wartości wybranego rozmiaru
    // (dyskretnej) — inaczej przy progu kroku (np. dokładnie 6 cm od wzrostu
    // modela, gdzie zaokrąglenie .5 przeskakuje z 0 na 1) 1 cm wzrostu klienta
    // zmienia rekomendowany rozmiar bez ŻADNEGO wcześniejszego ostrzeżenia na
    // suwaku — pinezka po prostu teleportuje się do innej kratki. Ciągła
    // pozycja (interpolacja `raw` między sąsiednimi wierszami w `pool`)
    // sprawia, że pinezka PODJEŻDŻA pod krawędź, zanim rozmiar faktycznie
    // się zmieni — tak samo jak w trybie „po długości bez wzorca" niżej.
    const contIdx = clamp(baseIdx + raw, 0, pool.length - 1);
    const contLo = Math.floor(contIdx);
    const contHi = Math.min(contLo + 1, pool.length - 1);
    const contFrac = contIdx - contLo;
    scaleTarget =
      valueOf(pool[contLo]) +
      (valueOf(pool[contHi]) - valueOf(pool[contLo])) * contFrac;
    // Zawsze dołóż sąsiada po stronie, w którą „ciągnie" wzrost — żeby
    // „Dopasowany"/„Luźny" miało czym operować (wcześniej przy małym frac
    // preferencja fasonu była w tym trybie po cichu ignorowana).
    const frac = raw - step;
    if (frac > 0.08 && idx + 1 < pool.length) candRows.push(pool[idx + 1]);
    else if (frac < -0.08 && idx - 1 >= 0) candRows.unshift(pool[idx - 1]);
  } else if (proportional && lengthDimFn) {
    // --- Tryb: po długości vs wzrost (bez wzorca) ---
    mode = "length";
    valueOf = lengthDimFn;
    const pool = rows.filter((r) => (valueOf(r) ?? 0) > 0);
    const lens = pool.map(valueOf).sort((a, b) => a - b);
    const mid = (lens.length - 1) / 2;
    const median = (lens[Math.floor(mid)] + lens[Math.ceil(mid)]) / 2;
    // 0.25 cm docelowej długości na 1 cm wzrostu → ~1 rozmiar na 7–8 cm.
    // Wyżej (0.38) boxy topy skakały o rozmiar co ~4 cm wzrostu.
    scaleTarget = median + (height - 178) * 0.25;
    target = Math.round(scaleTarget);
    window = [target - TOP_LENGTH_TOL, target + TOP_LENGTH_TOL];
    candRows = pool.filter(
      (r) => valueOf(r) >= window[0] && valueOf(r) <= window[1],
    );
    if (candRows.length === 0) candRows = nearest(pool, valueOf, window);
  } else {
    // --- Tryb: po obwodzie + luz kroju ---
    // Pas na gumce / dzianina na dole: liczba w tabeli jest „na luźno" i sporo
    // mniejsza od ciała (materiał się naciąga). Porównujemy ciało do pasa
    // noszonego z lekkim naciągiem (÷1.10) i dajemy szersze okno.
    const elasticBottom =
      useWaist && (extraction.elasticWaist || extraction.stretch);
    const bodyEff = elasticBottom ? bodyPrimary / 1.15 : bodyPrimary;
    const [bLo, bHi] = elasticBottom ? [-6, 7] : [easeLo, easeHi];
    window = [bodyEff + bLo, bodyEff + bHi];
    target = (window[0] + window[1]) / 2;
    valueOf = (r) => primaryOf(r) as number;
    candRows = usable.filter(
      (r) => valueOf(r) >= window[0] && valueOf(r) <= window[1],
    );
    if (candRows.length === 0) {
      candRows = nearest(usable, valueOf, window);
    } else if (candRows.length === 1 && fit) {
      // Preferencja fasonu potrzebuje dwóch kandydatów. Gdy okno łapie tylko
      // jeden rozmiar, dobierz najbliższego sąsiada (o ile jest tuż przy oknie),
      // żeby „fitted"/„loose" miało czym operować.
      const near = nearest(usable, valueOf, window);
      if (near.length >= 2) candRows = near;
    }
  }

  if (candRows.length === 0) return null;

  // Kandydaci ZAWSZE rosnąco wg mierzonego wymiaru — „fitted"/„loose" przesuwają
  // o jeden krok pozycyjnie, a `nearest()` potrafi zwrócić ich w kolejności
  // odległości. (Sortujemy po `valueOf`, nie po etykiecie — działa też dla
  // rozmiarów liczbowych typu „32".)
  candRows = [...candRows].sort((a, b) => valueOf(a) - valueOf(b));

  let chosen = candRows[0];
  let tieBrokenBy: ResolveResult["tieBrokenBy"] =
    candRows.length === 1 ? "single" : null;

  if (candRows.length > 1) {
    // Wybór neutralny = najbliżej celu.
    const byDist = [...candRows].sort(
      (a, b) => Math.abs(valueOf(a) - target) - Math.abs(valueOf(b) - target),
    );
    const neutral = byDist[0];
    const nIdx = candRows.indexOf(neutral);

    if (fit === "fitted") {
      // O jeden mniejszy niż neutralny (nie skacz na skraj listy kandydatów).
      chosen = candRows[Math.max(0, nIdx - 1)];
      tieBrokenBy = nIdx > 0 ? "fit" : "midpoint";
    } else if (fit === "loose") {
      chosen = candRows[Math.min(candRows.length - 1, nIdx + 1)];
      tieBrokenBy = nIdx < candRows.length - 1 ? "fit" : "midpoint";
    } else {
      chosen = neutral;
      // Remis (≤0.5 cm) w kroju regular/relaxed dla GÓRY liczonej PO OBWODZIE →
      // wybierz większy: ciasno w klatce boli bardziej niż lekki nadmiar. NIE w
      // trybie długościowym (tam remis rozstrzygamy na mniejszy — dla oversize
      // to i tak zostaje „na luźno", a nie pakujemy drobnej sylwetki w większy).
      if (
        !useWaist &&
        mode !== "length" &&
        (cut === "regular" || cut === "relaxed") &&
        byDist[1] &&
        Math.abs(valueOf(byDist[1]) - target) -
          Math.abs(valueOf(byDist[0]) - target) <=
          0.5 &&
        valueOf(byDist[1]) > valueOf(byDist[0])
      ) {
        chosen = byDist[1];
      }
      tieBrokenBy = "midpoint";
    }

    // Nogawka jako fallback: gdy wybrany rozmiar nie trafia dobrze we wzrost,
    // a inny kandydat trafia lepiej. Odległość do pasma (nie samo "w paśmie
    // tak/nie") — inaczej `inseamBand` ma progi co konkretny wzrost (165, 175,
    // 183, 190 cm) i klient o 1 cm wyższy/niższy od takiego progu potrafił
    // dostać mniejszy rozmiar niż sąsiad (pasmo się przesuwało, a kandydat,
    // który jeszcze przed chwilą "łapał się" w paśmie, nagle przestawał —
    // mimo że jego nogawka wcale się nie zmieniła, tylko granica przeskoczyła).
    if (mode === "waist" && tieBrokenBy === "midpoint") {
      const [ilo, ihi] = inseamBand(height);
      const bandDist = (v: number) => (v < ilo ? ilo - v : v > ihi ? v - ihi : 0);
      if (typeof chosen.inseam === "number") {
        let best = chosen;
        let bestDist = bandDist(chosen.inseam);
        for (const r of candRows) {
          if (typeof r.inseam !== "number") continue;
          const d = bandDist(r.inseam);
          if (d < bestDist) {
            bestDist = d;
            best = r;
          }
        }
        chosen = best;
      }
    }
  }

  // Korekta ze stylu marki – przesunięcie po pełnej liście rozmiarów.
  let korektaApplied: -1 | 0 | 1 = 0;
  const k = extraction.korekta;
  if (allowKorekta && (k === -1 || k === 1)) {
    const ci = rows.findIndex((r) => r.size === chosen.size);
    const ni = clamp(ci + k, 0, rows.length - 1);
    if (ni !== ci) {
      chosen = rows[ni];
      korektaApplied = k;
    }
  }

  // Podłoga obwodu: wybrany rozmiar musi FIZYCZNIE się zapiąć / obwód klatki
  // musi mieć minimalny luz. Ratuje sytuacje, gdy kotwica/długość wskazały
  // rozmiar za wąski dla tej sylwetki (np. niski + masywny). Dla kroju
  // dopasowanego (slim/fitted) luz minimalny jest ujemny – ma przylegać.
  {
    const heavy = bodyType === "plus" ? 7 : bodyType === "athletic" ? 5 : 0;
    // Tęższa sylwetka (plus/athletic) potrzebuje dodatniego luzu nawet w kroju
    // dopasowanym — inaczej kotwica po wzroście wpycha ją w za mały rozmiar.
    const minEase =
      cut === "slim"
        ? -3 + Math.max(0, heavy)
        : cut === "regular"
          ? 3 + heavy
          : 2 + heavy; // relaxed / oversize – i tak jest luzu w nadmiarze
    const ci = rows.findIndex((r) => r.size === chosen.size);
    let floorMatched = false;
    for (let i = ci; i < rows.length; i++) {
      const r = rows[i];
      if (useWaist) {
        const w = r.waist;
        if (!w) break;
        // dzianina / guma rozciąga się ~30%; tkanina prawie wcale. Pas na
        // gumce/sznurku (dresy, joggery) rozciąga się NIEZALEŻNIE od kroju —
        // bez tego dresy z regularnym krojem, ale elastycznym pasem (a numer
        // w tabeli to pas na luzie, mały) prawie zawsze "nie mieściły się" wg
        // tej podłogi, mimo że korpus już poprawnie dobrał rozmiar wg wzorca
        // marki / długości — podłoga nadpisywała to na "największy dostępny",
        // ignorując że pas i tak się dopasuje.
        const give =
          cut === "relaxed" || cut === "oversize" || extraction.elasticWaist || extraction.stretch
            ? w * 0.3
            : Math.max(3, w * 0.05);
        if (w + give >= bodyPrimary) {
          chosen = r;
          floorMatched = true;
          break;
        }
      } else {
        const c = r.chest;
        if (!c) break;
        // Dzianina / elastan naciąga ~3 cm w klatce — rozmiar z lekko ujemnym
        // luzem przy takim materiale nadal siądzie (ale nie „wciskamy na siłę").
        const give = extraction.stretch ? 3 : 0;
        if (c + give >= bodyPrimary + minEase) {
          chosen = r;
          floorMatched = true;
          break;
        }
      }
      if (i === rows.length - 1) chosen = r; // nic nie pasuje → największy (tymczasowo)
    }
    // Tabela jest za mała dla tej sylwetki — żaden rozmiar fizycznie nie
    // starczy, wzięliśmy ostatni wiersz jako "najbliższy możliwy". Ale gdy
    // kilka rozmiarów wiąże się tym samym maksymalnym obwodem (zwykły i
    // "Tall" o tej samej talii, różniące się tylko nogawką — jak w tabeli
    // jeansów z tej sesji), wybór między nimi NIE powinien zależeć od
    // przypadkowej kolejności wpisania w panelu (poprzednio: `rows[rows
    // .length-1]` = cokolwiek admin wpisał jako ostatnie). Powinien trafić w
    // nogawkę pasującą do wzrostu — tak samo jak remis-breaker wyżej.
    if (!floorMatched && useWaist) {
      const maxWaist = Math.max(
        ...rows.map((r) => (typeof r.waist === "number" ? r.waist : -Infinity)),
      );
      const tied = rows.filter((r) => r.waist === maxWaist);
      if (tied.length > 1) {
        const [ilo, ihi] = inseamBand(height);
        const fit = tied.find(
          (r) =>
            typeof r.inseam === "number" && r.inseam >= ilo && r.inseam <= ihi,
        );
        if (fit) chosen = fit;
      }
    }
  }

  // --- Sito wiarygodności ---------------------------------------------------
  // Wynik oddalony o >2 stopnie rozmiaru od zgrubnego oczekiwania z SAMEGO ciała
  // to prawie na pewno błąd danych z tabeli (klatka wpisana jako pas, połówki
  // potraktowane jako pełne obwody, zła kategoria). Przycinamy do 2 stopni od
  // oczekiwania — ale tylko do rozmiaru, który realnie jest w tabeli. Dotyczy
  // rozmiarów literowych; przy liczbowych (jeansy) po prostu nie wchodzi.
  {
    const expIdx = CANON_SIZES.indexOf(
      estimateLetterSize(height, weight, gender, bodyType, null, category),
    );
    const chosenIdx = CANON_SIZES.indexOf(
      chosen.size.toUpperCase().replace(/\s+/g, ""),
    );
    if (expIdx >= 0 && chosenIdx >= 0 && Math.abs(chosenIdx - expIdx) > 2) {
      const targetIdx = expIdx + (chosenIdx > expIdx ? 2 : -2);
      let best = chosen;
      let bestGap = Infinity;
      for (const r of rows) {
        const ci = CANON_SIZES.indexOf(r.size.toUpperCase().replace(/\s+/g, ""));
        if (ci < 0) continue;
        const gap = Math.abs(ci - targetIdx);
        if (gap < bestGap) {
          bestGap = gap;
          best = r;
        }
      }
      if (best !== chosen) {
        console.warn(
          "[resolveSize] sito wiarygodności — wynik odjeżdża od sylwetki, przycięto",
          { from: chosen.size, to: best.size, expectedIdx: expIdx },
        );
        chosen = best;
      }
    }
  }

  // --- Strażnik monotoniczności wzrostu (tylko „dołki") -------------------
  // Usuwamy NIEMONOTONICZNOŚĆ: gdy przy tej samej wadze/budowie/fasonie
  // sylwetka 4 cm niższa I 4 cm wyższa dostają rozmiar NIE MNIEJSZY, a bieżąca
  // mniejszy — to artefakt granicy pasma / progu sita, nie realna zależność.
  // Podnosimy wtedy bieżący wybór do mniejszego z sąsiadów. Monotoniczny spadek
  // rozmiaru ze wzrostem (wyższy = szczuplejszy przy tej samej wadze) zostaje.
  {
    const depth = input.guardDepth ?? 0;
    if (depth === 0 && height - 4 >= 140 && height + 4 <= 230) {
      const lo = resolveSize({ ...input, height: height - 4, guardDepth: 1 });
      const hi = resolveSize({ ...input, height: height + 4, guardDepth: 1 });
      const iAt = (s: string | undefined) =>
        s ? rows.findIndex((r) => normSize(r.size) === normSize(s)) : -1;
      const iNow = iAt(chosen.size);
      const iLo = iAt(lo?.size);
      const iHi = iAt(hi?.size);
      if (iNow >= 0 && iLo >= 0 && iHi >= 0 && iNow < iLo && iNow < iHi) {
        const to = Math.min(iLo, iHi);
        console.warn(
          "[resolveSize] strażnik monotoniczności — dołek rozmiaru, podniesiono",
          { from: chosen.size, to: rows[to].size, height },
        );
        chosen = rows[to];
      }
    }
  }

  const finalPrimary = useWaist ? chosen.waist : chosen.chest;

  // Suwak dla widżetu: interpoluj `scaleTarget` (idealny wymiar dla sylwetki,
  // bez zaokrągleń) po wartościach wierszy tabeli w tym samym wymiarze, którym
  // grało `resolveSize`. Pinezka jedzie płynnie po całej skali.
  const fitScale = scaleFrom(
    rows.map((r) => ({ label: normSize(r.size), v: valueOf(r) })),
    scaleTarget ?? target,
    chosen.size,
  );

  return {
    size: chosen.size.toUpperCase().replace(/\s+/g, ""),
    mode,
    chosenValue: Math.round(
      (mode === "length" ? valueOf(chosen) : (finalPrimary as number)) || 0,
    ),
    bodyPrimaryUsed: Math.round(bodyPrimary),
    window: [Math.round(window[0]), Math.round(window[1])],
    candidates: candRows.map((r) => r.size.toUpperCase().replace(/\s+/g, "")),
    korektaApplied,
    tieBrokenBy,
    anchoredToModel,
    modelRef:
      anchoredToModel && extraction.modelHeight && extraction.modelSize
        ? { height: extraction.modelHeight, size: extraction.modelSize }
        : null,
    matchedReference: null,
    ...neighborLabels(rows, chosen.size),
    fitScale,
  };
}

// ---------------------------------------------------------------------------
// Automatyczny test spójności tabeli — bateria sylwetek przez resolveSize
// ---------------------------------------------------------------------------

export type ConsistencyIssue = {
  axis: "height" | "weight";
  gender: "male" | "female";
  build: string;
  /** Punkt bezpośrednio PRZED spadkiem i sam spadek, do czytelnego komunikatu. */
  from: { point: number; size: string };
  to: { point: number; size: string };
};

// Gęste bez obaw o koszt/czas — to czysta funkcja bez AI, cała bateria to
// ~250 wywołań resolveSize, rzędu pojedynczych milisekund łącznie.
const CONSISTENCY_HEIGHTS = Array.from({ length: 12 }, (_, i) => 150 + i * 5); // 150..205
const CONSISTENCY_WEIGHTS = Array.from({ length: 17 }, (_, i) => 50 + i * 5); // 50..130
const CONSISTENCY_BUILDS = ["slim", "standard", "athletic", "plus"];
const CONSISTENCY_GENDERS = ["male", "female"] as const;
// Przybliżone typowe BMI per budowa — przy zamiataniu WZROSTU waga musi rosnąć
// razem z nim proporcjonalnie (stałe BMI), inaczej np. 150cm + jedna uniwersalna
// „stała" waga 80kg dla mężczyzny to fizjologicznie sprzeczne wejście (BMI ~36
// przy budowie „szczupła") i estymator/klamry (74–152cm) reagują na to
// niemonotonicznie — fałszywy alarm o niespójności tabeli, nie prawdziwy błąd.
const CONSISTENCY_BMI_BY_BUILD: Record<string, number> = {
  slim: 19.5,
  standard: 23,
  athletic: 24.5,
  plus: 29,
};
const CONSISTENCY_FIXED_HEIGHT: Record<string, number> = { male: 178, female: 165 };

/** Ile sylwetek faktycznie sprawdza jeden `checkConsistency` — do pokazania
 *  w panelu ("spójna na X przetestowanych sylwetkach"), żeby ta liczba nie
 *  była osobną, mogącą się rozjechać stałą po stronie UI. */
export const CONSISTENCY_PROFILE_COUNT =
  (CONSISTENCY_HEIGHTS.length + CONSISTENCY_WEIGHTS.length) *
  CONSISTENCY_BUILDS.length *
  CONSISTENCY_GENDERS.length;
// Ile spadków pokazujemy per (oś, płeć, budowa) — pierwszy zwykle wystarcza,
// żeby admin wiedział, gdzie szukać w tabeli; więcej to już szum.
const CONSISTENCY_MAX_PER_SWEEP = 1;

/** Testuje zweryfikowaną tabelę na baterii reprezentatywnych sylwetek (bez
 *  AI, sama matematyka silnika) i łapie klasę błędów niewidocznych przy
 *  patrzeniu na same liczby w tabeli: przy rosnącym wzroście/wadze rozmiar
 *  NIGDY nie powinien się cofnąć. Jeśli się cofa, to sygnał realnego
 *  problemu w danych (literówka, pomylona kolumna, brakujący wiersz) —
 *  dokładnie tej klasy bugów, które w tej sesji za każdym razem znajdowaliśmy
 *  ręcznie, próbując różnych wzrostów na jednym konkretnym produkcie.
 *  Uruchamiane przy każdym zapisie tabeli (produktu lub systemu). */
export function checkConsistency(extraction: ChartExtraction): ConsistencyIssue[] {
  if (extraction.rows.length < 2) return [];
  const issues: ConsistencyIssue[] = [];

  const sweep = (
    axis: "height" | "weight",
    gender: "male" | "female",
    build: string,
    points: number[],
    run: (v: number) => ResolveResult | null,
  ) => {
    let prev: { point: number; idx: number; size: string } | null = null;
    let found = 0;
    for (const point of points) {
      if (found >= CONSISTENCY_MAX_PER_SWEEP) break;
      const res = run(point);
      if (!res) {
        prev = null; // brak dopasowania przerywa ciągłość porównania, nie licz jako spadek
        continue;
      }
      const idx = sizeIndex(res.size);
      if (prev && idx < prev.idx) {
        issues.push({
          axis,
          gender,
          build,
          from: { point: prev.point, size: prev.size },
          to: { point, size: res.size },
        });
        found += 1;
      }
      prev = { point, idx, size: res.size };
    }
  };

  for (const gender of CONSISTENCY_GENDERS) {
    for (const build of CONSISTENCY_BUILDS) {
      sweep("height", gender, build, CONSISTENCY_HEIGHTS, (height) =>
        resolveSize({
          extraction,
          height,
          // Waga skalowana ze wzrostem przy stałym BMI (patrz komentarz przy
          // CONSISTENCY_BMI_BY_BUILD) — izoluje efekt SAMEGO wzrostu zamiast
          // mieszać go z fizjologicznie niespójną, uniwersalną wagą.
          weight: Math.round(CONSISTENCY_BMI_BY_BUILD[build] * (height / 100) ** 2),
          gender,
          bodyType: build,
          fit: null,
          allowKorekta: false,
        }),
      );
      sweep("weight", gender, build, CONSISTENCY_WEIGHTS, (weight) =>
        resolveSize({
          extraction,
          height: CONSISTENCY_FIXED_HEIGHT[gender],
          weight,
          gender,
          bodyType: build,
          fit: null,
          allowKorekta: false,
        }),
      );
    }
  }

  return issues;
}

function nearest(
  pool: NormalizedSizeRow[],
  valueOf: (r: NormalizedSizeRow) => number,
  [lo, hi]: [number, number],
): NormalizedSizeRow[] {
  if (pool.length === 0) return [];
  const withDist = pool
    .map((r) => {
      const v = valueOf(r);
      return { r, d: v < lo ? lo - v : v > hi ? v - hi : 0 };
    })
    .sort((a, b) => a.d - b.d);
  const best = withDist[0].d;
  return withDist
    .filter((x) => x.d <= best + 2)
    .slice(0, 2)
    .map((x) => x.r);
}

// ---------------------------------------------------------------------------
// Uzasadnienie z szablonu (PL/EN; inne języki → EN)
// ---------------------------------------------------------------------------

const CUT_LABEL: Record<string, Record<CutLooseness, string>> = {
  pl: { slim: "obcisły", regular: "regularny", relaxed: "swobodny", oversize: "oversize" },
  en: { slim: "slim", regular: "regular", relaxed: "relaxed", oversize: "oversize" },
};

// Przyjazna etykieta kroju do jednozdaniowego nagłówka dla kupującego.
const CUT_HEADLINE: Record<string, Record<CutLooseness, string>> = {
  pl: {
    slim: "dopasowane",
    regular: "klasyczne",
    relaxed: "swobodne",
    oversize: "luźne (oversize)",
  },
  en: { slim: "a fitted", regular: "a regular", relaxed: "a relaxed", oversize: "an oversized" },
};

export type Explanation = {
  /** Jedno pewne zdanie dla kupującego — bez centymetrów i żargonu. */
  headline: string;
  /** Pełne uzasadnienie na liczbach — za „Dlaczego ten rozmiar?" / dla testera. */
  detail: string;
};

function buildExplanation(
  localeRaw: string | null | undefined,
  r: ResolveResult,
  ctx: {
    height: number;
    cut: CutLooseness;
    bodyPrimaryLabel: number;
    fit: FitPreference;
    /** Klient podał ubranie referencyjne, ale nie dało się go użyć (nieznana
     *  marka / niepewny model / wynik sprzeczny z obwodem). */
    referenceUnused?: boolean;
  },
): Explanation {
  const locale =
    (localeRaw || "pl").toLowerCase().slice(0, 2) === "pl" ? "pl" : "en";
  const cut = CUT_LABEL[locale][ctx.cut] ?? ctx.cut;
  const cutHead = CUT_HEADLINE[locale][ctx.cut] ?? cut;
  const [lo, hi] = r.window;
  const parts: string[] = [];

  const headline =
    r.matchedReference
      ? locale === "pl"
        ? `Rozmiar ${r.size} — leży podobnie jak ubranie, które u Ciebie pasuje.`
        : `Size ${r.size} — fits like the garment that already works for you.`
      : r.anchoredToModel
        ? locale === "pl"
          ? `Rozmiar ${r.size} — dobrany do Twojego wzrostu wg wzorca marki.`
          : `Size ${r.size} — matched to your height from the brand's reference.`
        : locale === "pl"
          ? `Rozmiar ${r.size} — ${cutHead} dopasowanie.`
          : `Size ${r.size} — ${cutHead} fit.`;

  if (locale === "pl") {
    if (r.matchedReference) {
      parts.push(
        `Rozmiar ${r.size} — dobrany tak, by leżał jak podane przez Ciebie, dobrze leżące ubranie (porównaliśmy wymiary ubranie-do-ubrania).`,
      );
    } else if (r.anchoredToModel && r.modelRef) {
      parts.push(
        `Rozmiar ${r.size} wg wzorca marki: model ${r.modelRef.height} cm nosi ${r.modelRef.size}, skorygowano o Twój wzrost ${ctx.height} cm.`,
      );
    } else if (r.mode === "length") {
      if (r.chosenValue >= lo && r.chosenValue <= hi) {
        parts.push(
          `Rozmiar ${r.size}: długość ${r.chosenValue} cm mieści się w zakresie ${lo}–${hi} cm zalecanym przy wzroście ${ctx.height} cm dla kroju ${cut}.`,
        );
      } else {
        parts.push(
          `Rozmiar ${r.size}: to najbliższy dostępny rozmiar. Zalecana długość przy wzroście ${ctx.height} cm dla kroju ${cut} to ${lo}–${hi} cm, a ten rozmiar ma ${r.chosenValue} cm.`,
        );
      }
    } else {
      const where = r.mode === "waist" ? "w pasie" : "w klatce";
      parts.push(
        `Rozmiar ${r.size}: obwód ${where} ${r.chosenValue} cm przy Twoim ok. ${Math.round(ctx.bodyPrimaryLabel)} cm daje luz właściwy dla kroju ${cut}.`,
      );
    }
    if (r.tieBrokenBy === "fit") {
      parts.push(
        ctx.fit === "loose"
          ? "Wybrano większy z dwóch pasujących rozmiarów zgodnie z preferencją luźniejszego fasonu."
          : "Wybrano mniejszy z dwóch pasujących rozmiarów zgodnie z preferencją dopasowanego fasonu.",
      );
    } else if (r.tieBrokenBy === "build") {
      parts.push(
        "Przy Twojej budowie wybrano większy z pasujących rozmiarów dla wygody.",
      );
    }
    if (r.korektaApplied === -1)
      parts.push("Zeszliśmy o rozmiar zgodnie z wytycznymi marki.");
    if (r.korektaApplied === 1)
      parts.push("Podnieśliśmy o rozmiar zgodnie z wytycznymi marki.");
    if (ctx.referenceUnused && !r.matchedReference)
      parts.push(
        "Nie mieliśmy pewnych danych dla podanego ubrania, więc rozmiar policzyliśmy z Twoich wymiarów.",
      );
  } else {
    if (r.matchedReference) {
      parts.push(
        `Size ${r.size} — chosen to fit like the well-fitting garment you gave us (we compared measurements garment-to-garment).`,
      );
    } else if (r.anchoredToModel && r.modelRef) {
      parts.push(
        `Size ${r.size} from the brand reference: a ${r.modelRef.height} cm model wears ${r.modelRef.size}, adjusted for your height of ${ctx.height} cm.`,
      );
    } else if (r.mode === "length") {
      if (r.chosenValue >= lo && r.chosenValue <= hi) {
        parts.push(
          `Size ${r.size}: length ${r.chosenValue} cm is within the ${lo}–${hi} cm range recommended for a height of ${ctx.height} cm in a ${cut} fit.`,
        );
      } else {
        parts.push(
          `Size ${r.size}: this is the closest available size. The recommended length for a height of ${ctx.height} cm in a ${cut} fit is ${lo}–${hi} cm; this size is ${r.chosenValue} cm.`,
        );
      }
    } else {
      const where = r.mode === "waist" ? "waist" : "chest";
      parts.push(
        `Size ${r.size}: ${where} ${r.chosenValue} cm over your ~${Math.round(ctx.bodyPrimaryLabel)} cm gives the ease expected for a ${cut} fit.`,
      );
    }
    if (r.tieBrokenBy === "fit") {
      parts.push(
        ctx.fit === "loose"
          ? "Picked the larger of two fitting sizes for the looser fit you selected."
          : "Picked the smaller of two fitting sizes for the closer fit you selected.",
      );
    } else if (r.tieBrokenBy === "build") {
      parts.push(
        "Given your build, the larger of the fitting sizes was chosen for comfort.",
      );
    }
    if (r.korektaApplied === -1)
      parts.push("Sized down one step per the brand's guidance.");
    if (r.korektaApplied === 1)
      parts.push("Sized up one step per the brand's guidance.");
    if (ctx.referenceUnused && !r.matchedReference)
      parts.push(
        "We didn't have reliable data for the garment you entered, so the size was calculated from your measurements.",
      );
  }

  return { headline, detail: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Wywołanie modelu
// ---------------------------------------------------------------------------

export type AICallInput = {
  model: string;
  prompt: string;
  sizeChartImage?: string | null;
  /** Zweryfikowana siatka wymiarów sprzedawcy (JSON). Gdy podana, nadpisuje
   *  wiersze z ekstrakcji AI — model służy tylko do klasyfikacji. */
  structuredSizeData?: string | null;
  decision: {
    height: number | string;
    weight: number | string;
    gender?: string | null;
    bodyType?: string | null;
    fit?: FitPreference;
    locale?: string | null;
    /** true → wolno zastosować korektę rozmiaru ze stylu marki / notatek. */
    allowKorekta?: boolean;
    /** Dobrze leżące ubranie referencyjne podane przez klienta. */
    referenceGarment?: { measurements: RefMeasurements } | null;
  };
};

export type AICallResult = {
  size: string;
  /** Jedno zdanie dla kupującego (bez centymetrów i żargonu). */
  explanation: string;
  /** Pełne uzasadnienie na liczbach — za „Dlaczego ten rozmiar?" / dla testera. */
  explanationDetail: string;
  /** "chart" = rozmiar policzony z tabeli; "estimate" = model zgadł (brak tabeli). */
  source: "chart" | "estimate";
  /** Sąsiednie rozmiary — do suwaka „ciaśniej ← Ty → luźniej" w widżecie. */
  neighborSmaller: string | null;
  neighborLarger: string | null;
  /** Suwak dopasowania dla widżetu — patrz `FitScale`. */
  fitScale: FitScale | null;
  attachedImage: boolean;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  /** Surowy JSON modelu (ekstrakcja produktu) — do zapisania na ProductRule i
   *  ponownego użycia bez wołania AI. Puste, gdy w prompt weszło ubranie
   *  referencyjne klienta (wtedy JSON jest „skażony” i nie zapisujemy go). */
  rawJson: Record<string, unknown>;
};

function parseModelJson(raw: string): Record<string, unknown> {
  const cleaned = (raw || "{}").replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new AICallError("invalid JSON from model");
  }
}

function num(v: unknown): number | null {
  const n =
    typeof v === "string"
      ? parseFloat(v.replace(",", "."))
      : typeof v === "number"
        ? v
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseExtraction(json: Record<string, unknown>): ChartExtraction {
  const rawRows = Array.isArray(json.tabela) ? (json.tabela as unknown[]) : [];
  const rows: NormalizedSizeRow[] = rawRows
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const size = String(o.rozmiar ?? o.size ?? "").trim();
      if (!size) return null;
      return {
        size,
        chest: num(o.obwodKlatki ?? o.chest),
        waist: num(o.obwodPasa ?? o.waist),
        hip: num(o.obwodBioder ?? o.hip),
        length: num(o.dlugosc ?? o.length),
        inseam: num(o.dlugoscNogawki ?? o.inseam),
        legOpening: num(o.szerokoscNogawki ?? o.legOpening),
      } as NormalizedSizeRow;
    })
    .filter((r): r is NormalizedSizeRow => r !== null);

  const kat = String(json.kategoria ?? "").toLowerCase();
  const category: GarmentCategory =
    kat === "dol" || kat === "bottom"
      ? "bottom"
      : kat === "sukienka" || kat === "dress"
        ? "dress"
        : "top";

  const luz = String(json.krojLuz ?? json.cut ?? "").toLowerCase();
  let cut: CutLooseness =
    luz === "obcisly" || luz === "slim"
      ? "slim"
      : luz === "swobodny" || luz === "relaxed" || luz === "loose"
        ? "relaxed"
        : luz === "oversize" || luz === "boxy"
          ? "oversize"
          : "regular";
  // Nadpisanie z SAMYCH liczb: jeśli AI dało slim/regular, a tabela jest jawnie
  // szeroka i krótka (boxy) — traktuj jako oversize. Spójne z gradingiem po
  // długości w resolveSize i z tym, co widzi sprzedawca w panelu.
  if ((cut === "slim" || cut === "regular") && category === "top" && looksBoxyByMeasure(rows)) {
    cut = "oversize";
  }

  const korRaw = Number(json.korektaRozmiaru ?? json.korekta ?? 0);
  const korekta: -1 | 0 | 1 = korRaw <= -1 ? -1 : korRaw >= 1 ? 1 : 0;

  const bool = (v: unknown, dflt: boolean) =>
    typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : dflt;

  const mSize =
    typeof json.modelRozmiar === "string" && json.modelRozmiar.trim()
      ? json.modelRozmiar.trim()
      : null;

  return {
    rows,
    category,
    cut,
    bodyChest: num(json.obwodKlatkiKlienta ?? json.bodyChest),
    bodyWaist: num(json.obwodPasaKlienta ?? json.bodyWaist),
    bodyHip: num(json.obwodBioderKlienta ?? json.bodyHip),
    korekta,
    stretch: bool(json.dzianina ?? json.stretch, true),
    elasticWaist: bool(json.pasNaGumce ?? json.elasticWaist, false),
    outerwear: bool(json.odziezWierzchnia ?? json.outerwear, false),
    modelHeight: num(json.modelWzrost ?? json.modelHeight),
    modelSize: mSize,
    fallbackSize:
      typeof json.zapasowyRozmiar === "string" && json.zapasowyRozmiar.trim()
        ? json.zapasowyRozmiar.trim()
        : null,
    fallbackExplanation:
      typeof json.zapasoweUzasadnienie === "string"
        ? json.zapasoweUzasadnienie.trim()
        : null,
  };
}

// Wersja logiki ekstrakcji/klasyfikacji. Bump = zapisane ekstrakcje na
// ProductRule uznajemy za nieaktualne i przeliczamy leniwie przy zapytaniu.
export const EXTRACTION_VERSION = 1;

/** Czysta decyzja rozmiaru z gotowej ekstrakcji — bez wołania AI.
 *  Używane, gdy produkt ma już zapisaną analizę (config-time). */
export function decideSize(
  extraction: ChartExtraction,
  d: AICallInput["decision"],
): Omit<AICallResult, "attachedImage" | "promptTokenCount" | "candidatesTokenCount" | "rawJson"> {
  const height = Number(d.height) || 0;
  const weight = Number(d.weight) || 0;
  const gender = (d.gender as string) || "male";
  const bodyType = (d.bodyType as string) || "standard";
  const fit: FitPreference =
    d.fit === "fitted" || d.fit === "loose" ? d.fit : null;

  const resolved =
    height > 0
      ? resolveSize({
          extraction,
          height,
          weight,
          gender,
          bodyType,
          fit,
          allowKorekta: d.allowKorekta === true,
          referenceGarment: d.referenceGarment ?? null,
        })
      : null;

  if (resolved) {
    const { headline, detail } = buildExplanation(d.locale, resolved, {
      height,
      cut: extraction.cut,
      bodyPrimaryLabel: resolved.bodyPrimaryUsed,
      fit,
      referenceUnused:
        Boolean(d.referenceGarment) && !resolved.matchedReference,
    });
    return {
      size: resolved.size,
      explanation: headline,
      explanationDetail: detail,
      source: "chart",
      neighborSmaller: resolved.neighborSmaller,
      neighborLarger: resolved.neighborLarger,
      fitScale: resolved.fitScale,
    };
  }

  // Brak tabeli → rozmiar liczymy deterministycznie z obwodu ciała (model przy
  // braku tabeli i tak zawsze zgaduje „M"). Nagłówek krótki, szczegóły uczciwe.
  let size =
    height > 0
      ? estimateLetterSize(
          height,
          weight,
          gender,
          bodyType,
          fit,
          extraction.category,
          extraction.modelHeight,
          extraction.modelSize,
        )
      : (extraction.fallbackSize || "M").toUpperCase().replace(/\s+/g, "");

  // Strażnik monotoniczności (tylko „dołki", jak w resolveSize): jeśli sylwetka
  // 4 cm niższa i 4 cm wyższa dają rozmiar nie mniejszy, a bieżąca mniejszy —
  // podnieś do mniejszego z sąsiadów.
  if (height - 4 >= 140) {
    const args = [
      weight,
      gender,
      bodyType,
      fit,
      extraction.category,
      extraction.modelHeight,
      extraction.modelSize,
    ] as const;
    const lo = estimateLetterSize(height - 4, ...args);
    const hi = estimateLetterSize(height + 4, ...args);
    if (sizeIndex(size) < sizeIndex(lo) && sizeIndex(size) < sizeIndex(hi)) {
      size = sizeIndex(lo) <= sizeIndex(hi) ? lo : hi;
    }
  }

  // Jeśli model zwrócił choćby same etykiety rozmiarów (bez wymiarów), nie
  // wychodzimy poza ten zakres — inaczej padało „3XL" dla produktu, który
  // kończy się na XL.
  const labelIdxs = extraction.rows
    .map((r) => CANON_SIZES.indexOf(r.size.toUpperCase().replace(/\s+/g, "")))
    .filter((i) => i >= 0);
  if (labelIdxs.length >= 2) {
    const lo = Math.min(...labelIdxs);
    const hi = Math.max(...labelIdxs);
    let si = CANON_SIZES.indexOf(size);
    if (si < 0) si = CANON_SIZES.indexOf("M");
    size = CANON_SIZES[clamp(si, lo, hi)];
  }
  // Sąsiedzi po kanonicznej drabinie, przycięci do zakresu etykiet z tabeli.
  const rangeLo = labelIdxs.length >= 2 ? Math.min(...labelIdxs) : 0;
  const rangeHi =
    labelIdxs.length >= 2 ? Math.max(...labelIdxs) : CANON_SIZES.length - 1;
  const sIdx = CANON_SIZES.indexOf(size);
  const estSmaller =
    sIdx > rangeLo && sIdx > 0 ? CANON_SIZES[sIdx - 1] : null;
  const estLarger =
    sIdx >= 0 && sIdx < rangeHi && sIdx < CANON_SIZES.length - 1
      ? CANON_SIZES[sIdx + 1]
      : null;
  const isPl = (d.locale || "pl").toLowerCase().slice(0, 2) === "pl";
  // Ten sam wzorzec marki, który anchoruje kotwicę w resolveSize (gdy jest
  // tabela), działa też tutaj — więc opis ma być uczciwy o TYM, co faktycznie
  // zdecydowało: wzrost modela z opisu, nie ogólne pasmo z wagi/budowy.
  const normModelSize = extraction.modelSize?.toUpperCase().replace(/\s+/g, "");
  const usedModelAnchor = Boolean(
    height > 0 &&
      extraction.modelHeight &&
      extraction.modelHeight > 120 &&
      extraction.modelHeight < 220 &&
      normModelSize &&
      CANON_SIZES.includes(normModelSize),
  );
  const headline = isPl
    ? `Rozmiar ${size} — oszacowany na podstawie Twoich wymiarów.`
    : `Size ${size} — estimated from your measurements.`;
  const detail = usedModelAnchor
    ? isPl
      ? `Ten produkt nie ma tabeli wymiarów, ale opis podaje wzorzec marki: model ${extraction.modelHeight} cm nosi ${extraction.modelSize}. Skorygowaliśmy to o Twój wzrost (${Math.round(height)} cm)${fit === "loose" ? " i preferencję luźniejszego fasonu" : ""} — stąd ${size}. Dla pewności sprawdź rozmiarówkę przy produkcie.`
      : `This product has no size chart, but its description gives a brand reference: a ${extraction.modelHeight} cm model wears ${extraction.modelSize}. We adjusted that for your height (${Math.round(height)} cm)${fit === "loose" ? " and your looser fit preference" : ""} — hence ${size}. Please double-check the product's own size guide.`
    : isPl
      ? `Ten produkt nie ma tabeli rozmiarów, więc rozmiar ${size} oszacowaliśmy z Twojego wzrostu (${Math.round(height)} cm), wagi (${Math.round(weight)} kg) i budowy${fit === "loose" ? " oraz preferencji luźniejszego fasonu" : ""}. Dla pewności sprawdź rozmiarówkę przy produkcie.`
      : `This product has no size chart, so size ${size} is estimated from your height (${Math.round(height)} cm), weight (${Math.round(weight)} kg) and build${fit === "loose" ? ", plus your looser fit preference" : ""}. Please double-check the product's own size guide.`;
  return {
    size,
    explanation: headline,
    explanationDetail: height > 0 ? detail : headline,
    source: "estimate",
    neighborSmaller: estSmaller,
    neighborLarger: estLarger,
    // Bez tabeli: suwak z pasm obwodu klatki (zmienia się ze wzrostem i wagą).
    // null tylko gdy brak wzrostu albo rozmiar spoza pasm literowych.
    fitScale:
      height > 0
        ? estimateFitScale(
            estimateChest(height, weight, gender, bodyType),
            gender,
            size,
          )
        : null,
  };
}

/** Wspólne złożenie: model → ekstrakcja → decyzja kodu → uzasadnienie. */
export async function callAI(input: AICallInput): Promise<AICallResult> {
  const raw =
    getAIConfig().provider === "gemini"
      ? await callGeminiRaw(input)
      : await callOpenAIRaw(input);

  const extraction = applyStructuredRows(
    parseExtraction(raw.json),
    input.structuredSizeData,
  );
  const decided = decideSize(extraction, input.decision);

  return {
    ...decided,
    attachedImage: raw.attachedImage,
    promptTokenCount: raw.promptTokenCount,
    candidatesTokenCount: raw.candidatesTokenCount,
    rawJson: raw.json,
  };
}

// ---------------------------------------------------------------------------
// Jednorazowa analiza produktu (config-time) — odczyt tabeli + klasyfikacja
// bez danych klienta. Wynik zapisujemy na ProductRule i używamy potem bez AI.
// ---------------------------------------------------------------------------

export type ExtractProductInput = {
  productTitle?: string | null;
  productDescription?: string | null;
  brandStyleNotes?: string | null;
  productSizeData?: string | null;
  productNotes?: string | null;
  sizeChartImage?: string | null;
  hasSizeChartImage?: boolean;
  responseLanguage?: string | null;
};

export type ExtractProductResult = {
  extraction: ChartExtraction;
  rawJson: Record<string, unknown>;
  attachedImage: boolean;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
};

export async function extractProductChart(
  model: string,
  input: ExtractProductInput,
): Promise<ExtractProductResult> {
  const prompt = buildSizeAdvisorPrompt({
    productTitle: input.productTitle,
    productDescription: input.productDescription,
    brandStyleNotes: input.brandStyleNotes,
    productSizeData: input.productSizeData,
    productNotes: input.productNotes,
    hasSizeChartImage: input.hasSizeChartImage,
    responseLanguage: input.responseLanguage,
    omitShopper: true,
  });

  const raw =
    getAIConfig().provider === "gemini"
      ? await callGeminiRaw({ model, prompt, sizeChartImage: input.sizeChartImage })
      : await callOpenAIRaw({ model, prompt, sizeChartImage: input.sizeChartImage });

  return {
    extraction: parseExtraction(raw.json),
    rawJson: raw.json,
    attachedImage: raw.attachedImage,
    promptTokenCount: raw.promptTokenCount,
    candidatesTokenCount: raw.candidatesTokenCount,
  };
}

/** Odtwarza ChartExtraction z JSON-a zapisanego na ProductRule.extractionJson. */
export function parseStoredExtraction(json: string | null | undefined): ChartExtraction | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object") return null;
    return parseExtraction(obj as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Parsuje zweryfikowaną przez sprzedawcę siatkę wymiarów (JSON z panelu).
 *  Zwraca uporządkowane wiersze albo null, gdy nie ma sensownych danych. */
export function parseStructuredRows(
  json: string | null | undefined,
): NormalizedSizeRow[] | null {
  if (!json) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  // Przecinek jako separator dziesiętny (PL/EU) — zabezpieczenie server-side
  // na wypadek starszych zapisanych danych sprzed poprawki w SizeGrid, albo
  // innej ścieżki zapisu (import CSV), która nie przechodzi przez UI siatki.
  const num = (v: unknown) => {
    const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
    return Number.isFinite(n) && n > 0 && n < 400 ? Math.round(n * 10) / 10 : null;
  };
  const rows: NormalizedSizeRow[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const size = String(o.size ?? o.rozmiar ?? "").trim();
    if (!size) continue;
    const row: NormalizedSizeRow = {
      size,
      chest: num(o.chest),
      waist: num(o.waist),
      hip: num(o.hip),
      length: num(o.length),
      inseam: num(o.inseam),
      legOpening: num(o.legOpening),
    };
    if (row.chest || row.waist || row.hip || row.length || row.inseam || row.legOpening) {
      rows.push(row);
    }
  }
  return rows.length >= 2 ? rows : null;
}

/** Zamienia zweryfikowaną siatkę z powrotem na tekstową tabelę do promptu
 *  ekstrakcyjnego (pole `productSizeData` w `buildSizeAdvisorPrompt`) — żeby
 *  AI miało czym ocenić "krojLuz" (patrz prompt: "oceń PRZEDE WSZYSTKIM z
 *  wymiarów tabeli, nie z nazwy"), zamiast zgadywać wyłącznie z nazwy
 *  produktu/systemu, gdy nie ma zdjęcia ani notatek. AI i tak nie decyduje o
 *  rozmiarze — jego "tabela" w odpowiedzi jest ignorowana, bo `resolveSize`
 *  dostaje liczby z tej samej siatki przez `applyStructuredRows`. */
export function structuredRowsAsPromptText(rows: NormalizedSizeRow[]): string {
  return rows
    .map((r) => {
      const dims: string[] = [];
      if (r.chest != null) dims.push(`klatka ${r.chest}`);
      if (r.waist != null) dims.push(`pas ${r.waist}`);
      if (r.hip != null) dims.push(`biodra ${r.hip}`);
      if (r.length != null) dims.push(`długość ${r.length}`);
      if (r.inseam != null) dims.push(`nogawka ${r.inseam}`);
      if (r.legOpening != null) dims.push(`szerokość nogawki u dołu ${r.legOpening}`);
      return `Rozmiar ${r.size}: ${dims.join(", ")}`;
    })
    .join("\n");
}

/** Domyślna ekstrakcja (regular / góra, brak wierszy) — baza klasyfikacji, gdy
 *  jest siatka sprzedawcy, ale nie ma zapisanej analizy AI. */
export const emptyExtraction = (): ChartExtraction =>
  parseExtraction({});

/** Gdy sprzedawca zweryfikował siatkę wymiarów — to ona jest źródłem wierszy;
 *  z ekstrakcji AI zostaje tylko klasyfikacja (krój, dzianina, kategoria...). */
export function applyStructuredRows(
  extraction: ChartExtraction,
  structuredJson: string | null | undefined,
): ChartExtraction {
  const rows = parseStructuredRows(structuredJson);
  return rows ? { ...extraction, rows } : extraction;
}

/** Zwięzły, czytelny dla admina opis tego, co model zrozumiał z produktu. */
export function describeExtraction(e: ChartExtraction): {
  category: GarmentCategory;
  cut: CutLooseness;
  rowCount: number;
  sizes: string[];
  /** Surowe wiersze z ostatniej analizy AI — sugestia startowa dla edytowalnej
   *  siatki wymiarów w panelu (patrz `structuredSizeData` / `SizeGrid`). */
  rows: NormalizedSizeRow[];
  stretch: boolean;
  elasticWaist: boolean;
  outerwear: boolean;
  korekta: -1 | 0 | 1;
  modelAnchor: { height: number; size: string } | null;
  hasMeasurements: boolean;
  /** Braki w danych wejściowych, przez które silnik dobiera „na oko" —
   *  pokazywane merchantowi w panelu, żeby uzupełnił tabelę. */
  dataQuality: Array<
    "too_few_rows" | "no_measurements" | "bottom_no_waist" | "top_no_chest"
  >;
} {
  const rows = e.rows;
  const hasChest = rows.some((r) => r.chest != null);
  const hasWaist = rows.some((r) => r.waist != null);
  const hasHip = rows.some((r) => r.hip != null);
  const hasLen = rows.some((r) => r.length != null || r.inseam != null);
  const primaryOk =
    e.category === "bottom" ? hasWaist || hasHip : hasChest;

  const dataQuality: Array<
    "too_few_rows" | "no_measurements" | "bottom_no_waist" | "top_no_chest"
  > = [];
  if (rows.length < 2) {
    dataQuality.push("too_few_rows");
  } else if (!hasChest && !hasWaist && !hasHip && !hasLen) {
    dataQuality.push("no_measurements");
  } else if (!primaryOk) {
    dataQuality.push(
      e.category === "bottom" ? "bottom_no_waist" : "top_no_chest",
    );
  }

  return {
    category: e.category,
    cut: e.cut,
    rowCount: rows.length,
    sizes: rows.map((r) => r.size),
    rows,
    stretch: e.stretch,
    elasticWaist: e.elasticWaist,
    outerwear: e.outerwear,
    korekta: e.korekta,
    modelAnchor:
      e.modelHeight && e.modelSize
        ? { height: e.modelHeight, size: e.modelSize }
        : null,
    hasMeasurements: hasChest || hasWaist || hasHip || hasLen,
    dataQuality,
  };
}

type RawModelResult = {
  json: Record<string, unknown>;
  attachedImage: boolean;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
};

/** Raw funkcje modelu potrzebują tylko modelu, promptu i (opcjonalnie) zdjęcia. */
type RawModelInput = {
  model: string;
  prompt: string;
  sizeChartImage?: string | null;
};

async function callOpenAIRaw(input: RawModelInput): Promise<RawModelResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AICallError("OPENAI_API_KEY not set");

  const client = new OpenAI({ apiKey });
  const imageMatch = input.sizeChartImage?.match(SIZE_CHART_IMAGE_RE);

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: input.prompt },
  ];
  if (imageMatch && input.sizeChartImage) {
    // "high" – tabela rozmiarów bywa drobna; w niskiej rozdzielczości model myli
    // wartości większych rozmiarów. To jest jedyne zadanie modelu, więc warto.
    content.push({
      type: "image_url",
      image_url: { url: input.sizeChartImage, detail: "high" },
    });
  }

  try {
    const resp = await client.chat.completions.create({
      model: input.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    });
    return {
      json: parseModelJson(resp.choices[0]?.message?.content ?? "{}"),
      attachedImage: Boolean(imageMatch),
      promptTokenCount: resp.usage?.prompt_tokens ?? null,
      candidatesTokenCount: resp.usage?.completion_tokens ?? null,
    };
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      console.error("OpenAI API Error:", err.status, err.message);
      if (err.status === 429 || err.status === 503) throw new AIQuotaError();
      throw new AICallError(`status ${err.status}`);
    }
    throw err;
  }
}

async function callGeminiRaw(input: RawModelInput): Promise<RawModelResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AICallError("GEMINI_API_KEY not set");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${apiKey}`;

  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  const imageMatch = input.sizeChartImage?.match(SIZE_CHART_IMAGE_RE);
  if (imageMatch) {
    parts.push({ inline_data: { mime_type: imageMatch[1], data: imageMatch[2] } });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0,
        topP: 0,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Google AI HTTP Error:", response.status, errorText);
    if (response.status === 429 || response.status === 503) throw new AIQuotaError();
    throw new AICallError(`status ${response.status}`);
  }

  const body = await response.json();
  return {
    json: parseModelJson(body.candidates?.[0]?.content?.parts?.[0]?.text || "{}"),
    attachedImage: Boolean(imageMatch),
    promptTokenCount: body.usageMetadata?.promptTokenCount ?? null,
    candidatesTokenCount: body.usageMetadata?.candidatesTokenCount ?? null,
  };
}
