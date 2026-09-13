import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Locale = "pl" | "en";
export const SUPPORTED_LOCALES: Locale[] = ["pl", "en"];
export const DEFAULT_LOCALE: Locale = "en";

/** "pl-PL" -> "pl"; unknown -> null */
export function normalizeLocale(raw: string | null | undefined): Locale | null {
  if (!raw) return null;
  const base = raw.toLowerCase().split("-")[0];
  return (SUPPORTED_LOCALES as string[]).includes(base) ? (base as Locale) : null;
}

/**
 * `setting` is ShopSettings.language: "auto" (inherit from Shopify) or an
 * explicit locale that overrides. `shopifyLocale` comes from the embedded-app
 * `?locale=` param / session.locale.
 */
export function resolveLocale(
  setting: string | null | undefined,
  shopifyLocale: string | null | undefined,
): Locale {
  if (setting && setting !== "auto") {
    const forced = normalizeLocale(setting);
    if (forced) return forced;
  }
  return normalizeLocale(shopifyLocale) ?? DEFAULT_LOCALE;
}

export function shopifyLocaleFromRequest(request: Request): string | null {
  return new URL(request.url).searchParams.get("locale");
}

type Vars = Record<string, string | number>;

const messages: Record<Locale, Record<string, string>> = {
  pl: {
    "nav.panel": "Panel",
    "nav.analytics": "Analityka",
    "nav.products": "Produkty",
    "nav.sizingSystems": "Systemy rozmiarów",
    "nav.plans": "Plan",
    "nav.settings": "Ustawienia",

    "sizingSystems.title": "Systemy rozmiarów",
    "sizingSystems.subtitle":
      "Jedna rozmiarówka współdzielona przez wiele produktów — zdefiniuj raz, przypnij produkty jednym kliknięciem.",
    "sizingSystems.new": "Nowy system",
    "sizingSystems.newTitle": "Nowy system rozmiarów",
    "sizingSystems.editTitle": "Edytuj system rozmiarów",
    "sizingSystems.empty":
      "Brak systemów. Utwórz np. „Standardowe t-shirty” i przypnij do niego wszystkie t-shirty naraz.",
    "sizingSystems.edit": "Edytuj",
    "sizingSystems.delete": "Usuń",
    "sizingSystems.addProducts": "Przypnij produkty",
    "sizingSystems.mappedCount": "Przypięte produkty: {n}",
    "sizingSystems.mapped": "Przypięto {n} produktów",
    "sizingSystems.unmapped": "Odpięto „{title}” (wrócił do własnej konfiguracji)",
    "sizingSystems.confirmDelete":
      "Usunąć system „{name}”? Odepnie się od {n} produktów (wrócą do własnej konfiguracji).",
    "sizingSystems.nameLabel": "Nazwa systemu",
    "sizingSystems.namePlaceholder": "np. Standardowe t-shirty",
    "products.mappedSystem.editHint":
      "Ten produkt korzysta z tabeli wymiarów systemu „{name}” — tabelę, notatki i zdjęcie edytuje się tam, nie tutaj.",
    "products.mappedSystem.editLink": "Przejdź do Systemów rozmiarów",
    "grid.title": "Zweryfikowana tabela rozmiarów",
    "grid.help":
      "Wpisz dokładne wymiary per rozmiar — to nadpisuje odczyt AI i eliminuje pomyłki w tabeli (np. pomylony obwód z połową obwodu). Klatkę/pas/biodra możesz podać na płasko (pacha–pacha, tak jak zwykle jest na metce) albo jako pełny obwód — rozpoznamy automatycznie po wielkości liczb, nie musisz przeliczać. Kolumny to zamknięta lista standardowych punktów pomiarowych branży odzieżowej — dodawaj/usuwaj wg produktu. Zostaw puste pole, jeśli wymiar nie dotyczy.",
    "grid.examplePrefix": "np.",
    "grid.col.size": "Rozmiar",
    "grid.col.chest": "Klatka",
    "grid.col.waist": "Pas",
    "grid.col.hip": "Biodra",
    "grid.col.length": "Długość",
    "grid.col.inseam": "Nogawka",
    "grid.col.legOpening": "Szerokość nogawki (dół)",
    "grid.addRow": "+ Dodaj rozmiar",
    "grid.removeRow": "Usuń rozmiar",
    "grid.addMeasurement": "+ Dodaj rodzaj pomiaru",
    "grid.removeCol": "Usuń kolumnę: {name}",
    "grid.unusualCols":
      "{names} zwykle nie dotyczy kategorii „{category}” — sprawdź, czy to zamierzone.",
    "grid.incompleteCols": "Brakuje wartości: {details}.",
    "grid.flatCols":
      "{names}: ta sama wartość dla każdego rozmiaru — prawdziwe tabele producentów prawie zawsze mają jakiś rozrzut, sprawdź czy to na pewno poprawne dane.",
    "grid.prefillFromAi": "Wypełnij z ostatniej analizy AI",
    "grid.verifyToast":
      "Wypełniono danymi z analizy AI — sprawdź liczby przed zapisem, AI mogło się pomylić.",
    "grid.verifiedBadge": "Zweryfikowana tabela rozmiarów",
    "consistency.title": "Test spójności tabeli",
    "consistency.checking": "Sprawdzanie na sylwetkach testowych…",
    "consistency.ok": "Spójna na {n} przetestowanych sylwetkach.",
    "consistency.issues": "{n} niespójności — sprawdź te miejsca w tabeli:",
    "consistency.issue":
      "{axis} {from}→{to} ({gender}, {build}): rozmiar spada z {fromSize} na {toSize}",
    "consistency.axis.height": "wzrost",
    "consistency.axis.weight": "waga",
    "consistency.gender.male": "mężczyzna",
    "consistency.gender.female": "kobieta",
    "consistency.build.slim": "szczupła",
    "consistency.build.standard": "standardowa",
    "consistency.build.athletic": "atletyczna",
    "consistency.build.plus": "masywna",
    "sizingSystems.notesLabel": "Notatki dla AI (opcjonalnie)",
    "sizingSystems.notesHelp":
      "Krój, materiał, korekty rozmiaru (np. „rozmiarówka zaniżona — brać większy”) — liczby i tak biorą się z siatki wyżej, to pole pomaga tylko sklasyfikować produkt.",
    "sizingSystems.notesPlaceholder":
      "np. rozmiarówka zaniżona — brać większy rozmiar",
    "sizingSystems.error.name": "Podaj nazwę systemu.",
    "sizingSystems.error.dupe": "System o tej nazwie już istnieje.",
    "sizingSystems.pickerLabel": "System rozmiarów",
    "sizingSystems.pickerNone": "Własna tabela produktu",
    "sizingSystems.usingSystem": "Używa systemu: {name}",
    "sizingSystems.attachedList": "Przypięte produkty",
    "sizingSystems.noneAttached": "Brak przypiętych produktów.",
    "sizingSystems.moreAttached": "+{n} więcej",

    "analytics.title": "Analityka",
    "analytics.subtitle": "Jak rekomendacje sprawdzają się w Twoim sklepie",
    "analytics.range": "Zakres: ostatnie {days} dni",
    "analytics.range.all": "Zakres: cała dostępna historia",
    "analytics.csv": "Eksportuj zestawienie (CSV)",
    "analytics.csv.error": "Nie udało się pobrać pliku. Spróbuj ponownie.",
    "analytics.empty": "Brak danych w tym zakresie.",
    "analytics.funnel.title": "Od rekomendacji do zakupu",
    "analytics.funnel.recs": "Rekomendacje",
    "analytics.funnel.recsNote": "łącznie z trafieniami w cache (nie zużywają limitu z planu)",
    "analytics.funnel.cart": "Dodano rozmiar do koszyka",
    "analytics.funnel.bought": "Kupiono",
    "analytics.funnel.note":
      "„Kupiono” liczy się wyłącznie, gdy klient użył widżetu, dodał polecany rozmiar do koszyka i sfinalizował zamówienie — to realne zdarzenie, nie szacunek.",
    "analytics.rate.ofRecs": "{pct}% rekomendacji",
    "analytics.rate.ofCart": "{pct}% dodań do koszyka",
    "analytics.time.title": "Rekomendacje w czasie (30 dni)",
    "analytics.sizes.title": "Polecane rozmiary",
    "analytics.sizes.allProducts": "Wszystkie produkty",
    "analytics.profile.title": "Profil klientów",
    "analytics.profile.gender": "Płeć",
    "analytics.profile.body": "Budowa ciała",
    "analytics.gender.unknown": "Nieokreślona",
    "analytics.body.other": "Inna",
    "analytics.top.title": "Najczęściej dobierane produkty",
    "analytics.top.col.recs": "Rekomendacje",
    "analytics.top.col.cart": "Do koszyka",
    "analytics.top.col.bought": "Zakupy",
    "analytics.purchases.title": "Ostatnie zakupy z rekomendacji",
    "analytics.purchases.col.date": "Data",
    "analytics.purchases.col.size": "Rozmiar",
    "analytics.returns.rate.title": "Zwroty zamówień z rekomendacji",
    "analytics.returns.rate.body":
      "Zmierzone: {n} z {m} zakupów z polecanym rozmiarem zostało zwróconych.",
    "analytics.returns.avoided.title": "Szacowane uniknięte zwroty",
    "analytics.returns.avoided.body":
      "Zamówienia z rekomendacji zwracane w {widget}% vs Twój ogólny {base}%. Różnica × liczba zakupów = szacunek zwrotów, które nie wystąpiły.",
    "analytics.returns.avoided.needsBaseline":
      "Podaj swój ogólny wskaźnik zwrotów w Ustawieniach, żeby zobaczyć szacunek unikniętych zwrotów.",
    "analytics.returns.avoided.needsBaselineLink": "Przejdź do Ustawień",
    "analytics.revenue.title": "Przychód z rekomendacji",
    "analytics.revenue.body":
      "Suma wartości zamówień, w których klient kupił polecany rozmiar (z widżetu).",
    "analytics.revenue.empty":
      "Brak jeszcze zamówień przypisanych do rekomendacji w tym okresie.",
    "analytics.locked.body":
      "Ścieżka konwersji, zakupy z rekomendacji i szacunek zwrotów są dostępne od planu Starter. Statystyki użycia widzisz poniżej.",

    "plans.title": "Plan i limity",
    "plans.subtitle": "Wybierz miesięczny limit rekomendacji AI dla swojego sklepu",
    "plans.usage": "Wykorzystano {used} z {limit} rekomendacji w tym miesiącu",
    "plans.usage.cacheNote":
      "Nie liczy trafień w cache (np. „Mój rozmiar” na kolejnym produkcie dla tej samej sylwetki) — te są darmowe i nie zużywają limitu. Dlatego liczba rekomendacji w Analityce bywa wyższa niż tutaj.",
    "plans.current": "Obecny plan",
    "plans.recommendations": "{n} rekomendacji / mies.",
    "plans.free_price": "Za darmo",
    "plans.price_month": "${amount} / mies.",
    "plans.trial": "7 dni za darmo",
    "plans.select": "Wybierz",
    "plans.downgrade": "Przejdź na Free",
    "plans.yourPlan": "Twój aktualny plan",
    "plans.billingUnavailable":
      "Nie udało się połączyć z rozliczeniami Shopify — pokazujemy dane z ostatniego zapisu. Odśwież stronę za chwilę.",
    "plans.downgrade.confirmTitle": "Przejść na plan Free?",
    "plans.downgrade.confirmBody":
      "Twoja subskrypcja zostanie anulowana. Stracisz funkcje płatnego planu — wyższy limit rekomendacji, analitykę konwersji, głębszą historię, zdjęcia rozmiarówek. Możesz wrócić na płatny plan w każdej chwili.",
    "plans.test_notice": "Tryb testowy — karta nie zostanie obciążona.",
    "plans.renews": "Odnawia się {date}",
    "plans.interval.monthly": "Miesięcznie",
    "plans.interval.annual": "Rocznie",
    "plans.billed_annually": "${amount} / rok",
    "plans.save_annual": "2 miesiące gratis",
    "common.cancel": "Anuluj",
    "common.moreActions": "Więcej czynności",
    "plans.includes_prev": "Wszystko z planu {plan}, plus:",
    "plans.paidShared.title": "Każdy płatny plan (Starter, Growth, Pro) zawiera:",
    "plans.paidShared.note":
      "Plany płatne różnią się WYŁĄCZNIE miesięcznym limitem rekomendacji — im wyższy plan, tym więcej rekomendacji, wszystkie funkcje takie same.",
    "plans.feat.rec": "{n} rekomendacji / mies.",
    "plans.feat.brand_style": "Styl marki dla AI",
    "plans.feat.theme_customize": "Teksty i wygląd widżetu w edytorze motywu",
    "plans.feat.history_recent": "5 ostatnich zapytań",
    "plans.feat.extraction_review":
      "Podgląd i korekta tego, co AI odczytała z rozmiarówki",
    "plans.feat.add_to_cart": "Przycisk „Dodaj do koszyka” w widżecie",
    "plans.feat.products_limited": "Konfiguracja do {n} produktów",
    "plans.feat.products_unlimited": "Konfiguracja produktów bez limitu",
    "plans.feat.tester": "Tester promptu w panelu",
    "plans.feat.history_days": "Historia zapytań: {n} dni",
    "plans.feat.history_year": "Historia zapytań: 12 miesięcy",
    "plans.feat.size_image": "Zdjęcie rozmiarówki czytane przez AI",
    "plans.feat.analytics": "Analityka konwersji i ocalonych zwrotów",
    "plans.feat.no_branding": "Widżet bez znaku „Size Advisor”",
    "plans.feat.csv": "Eksport historii do CSV",
    "plans.feat.revenue": "Przychód przypisany do rekomendacji",
    "plans.feat.custom_css": "Własny CSS widżetu",
    "plans.feat.bulk_import": "Masowy import rozmiarówek z CSV",
    "plans.feat.fit_pref": "Pytanie o preferencję dopasowania w widżecie",
    "plans.feat.garment_match": "Dopasowanie po pomiarach ubrania klienta, które dobrze leży",
    "plans.feat.auto_size": "„Mój rozmiar: X” — kupujący podaje wymiary raz, widzi rozmiar na każdym produkcie",

    "gate.see_plans": "Zobacz plany",
    "gate.upgrade": "Ulepsz swój plan",
    "gate.locked_from": "Dostępne od planu {plan}.",
    "gate.products_title": "Konfiguracja per-produkt",
    "gate.products_limit_reached":
      "Osiągnięto limit {n} produktów w planie {plan}. Zmień plan, aby dodać więcej.",
    "gate.image_locked": "Zdjęcie rozmiarówki czytane przez AI jest dostępne od planu Starter.",
    "gate.analytics_title": "Analityka konwersji",
    "gate.tester_locked": "Tester promptu jest dostępny od planu Starter.",
    "gate.csv_locked": "Eksport CSV jest dostępny od planu Starter.",

    "index.subtitle": "Inteligentny asystent doboru rozmiaru na kartach produktów",
    "setup.title": "Zacznij tutaj",
    "setup.desc": "Dwa kroki, żeby asystent rozmiaru pojawił się na kartach produktów.",
    "setup.step1.done": "Asystent jest włączony",
    "setup.step1.todo": "Włącz asystenta — przycisk w prawym górnym rogu tej strony",
    "setup.step2.title": "Dodaj widżet do motywu",
    "setup.step2.desc":
      "Otwórz edytor motywu, wejdź na szablon karty produktu i dodaj blok aplikacji „Size Advisor Button” w miejscu, w którym ma się pojawić.",
    "setup.step2.cta": "Otwórz edytor motywu",
    "setup.step3.title": "Dostrój (opcjonalnie)",
    "setup.step3.desc":
      "W zakładkach Ustawienia i Produkty dodaj styl marki oraz rozmiarówki wybranych produktów.",
    "setup.dismiss": "Ukryj tę wskazówkę",
    "index.action.enable": "Aktywuj asystenta",
    "index.action.disable": "Wyłącz na sklepie",
    "index.card.recommendations.title": "Rekomendacje w tym miesiącu",
    "index.card.recommendations.plan": "Plan {plan} ({used} / {limit})",
    "index.card.purchases.title": "Zakupy z rekomendacji",
    "index.card.purchases.tooltip":
      "Potwierdzone zakupy, w których klient dodał do koszyka rozmiar z rekomendacji. Szacowana redukcja zwrotów (~30% tych zakupów) to założenie modelowe, nie wartość zmierzona w Twoim sklepie.",
    "index.card.purchases.helpAria": "Skąd ta liczba?",
    "index.card.purchases.sub": "{cart} dodań do koszyka · szac. −{returns} zwrotów",
    "index.card.status.title": "Status aplikacji",
    "index.card.status.active": "Aktywny",
    "index.card.status.inactive": "Wyłączony",
    "index.card.status.visible": "Widoczny dla klientów",
    "index.card.status.hidden": "Ukryty",
    "index.queries.title.recent": "Ostatnie zapytania kupujących",
    "index.queries.title.month": "Zapytania kupujących w tym miesiącu",
    "index.queries.count": "W tym miesiącu: {n} · historia decyzji modelu",
    "index.queries.showAll": "Pokaż historię",
    "index.queries.showRecent": "Pokaż tylko ostatnie",
    "index.queries.csv": "Eksport CSV",
    "index.queries.col.product": "Produkt",
    "index.queries.col.customer": "Profil klienta",
    "index.queries.col.recommendation": "Rekomendacja",
    "index.queries.col.date": "Data",
    "index.queries.productFallback": "Produkt ze sklepu",
    "index.queries.addedToCart": "Dodano do koszyka",
    "index.queries.empty": "Brak zapytań w historii.",
    "index.resource.singular": "rekomendacja",
    "index.resource.plural": "rekomendacje",
    "index.limit.title": "Twój limit",
    "index.limit.monthly": "Miesięczna pula",
    "index.limit.renew": "Licznik zeruje się co miesiąc.",
    "index.limit.upgrade": "Zmień plan",

    "products.title": "Konfiguracja produktów",
    "products.subtitle":
      "Dodaj dla wybranych produktów wskazówki i rozmiarówki, z których AI skorzysta przy rekomendacji",
    "products.addProduct": "Dodaj produkt",
    "products.configured.title": "Skonfigurowane produkty",
    "products.configured.desc":
      "Produkty bez własnej konfiguracji korzystają z ogólnego stylu marki i opisu produktu.",
    "products.empty": "Nie skonfigurowano jeszcze żadnego produktu.",
    "products.addFirst": "Dodaj pierwszy produkt",
    "products.resource.singular": "produkt",
    "products.resource.plural": "produkty",
    "products.item.aria": "Konfiguruj {title}",
    "products.item.fallback": "Produkt {id}",
    "products.badge.notes": "Notatki AI",
    "products.badge.sizeTable": "Tabela wymiarów",
    "products.badge.image": "Zdjęcie rozmiarówki",
    "products.badge.system": "System: {name}",
    "products.badge.empty": "Pusta konfiguracja",
    "products.badge.inactive": "Produkt nieaktywny",
    "products.aside.title": "Jak to działa",
    "products.aside.intro": "Przy każdej rekomendacji dla danego produktu AI dostaje dodatkowo:",
    "products.aside.notes": "swobodny opis, np. „ten model ma wąski krój”.",
    "products.aside.sizeTable": "konkretne wartości, których AI użyje zamiast zgadywać z opisu.",
    "products.aside.image": "pomaga AI przy analizie (krój, kategoria) i podpowiada liczby do siatki — nie zastępuje jej.",
    "products.modal.titleFallback": "Konfiguracja produktu",
    "products.modal.save": "Zapisz",
    "products.modal.delete": "Usuń konfigurację",
    "products.field.notes.label": "Notatki dla AI (opcjonalnie)",
    "products.field.notes.help":
      "Krój, materiał, korekty rozmiaru (np. „rozmiarówka zaniżona — brać większy”) — liczby i tak biorą się z siatki wyżej, to pole pomaga tylko sklasyfikować produkt (raz, przy zapisie).",
    "products.field.notes.placeholder":
      "np. Ten model ma wąski krój w ramionach — przy budowie atletycznej proponuj rozmiar większy.",
    "products.field.sizeText.label": "Opis dla AI (opcjonalnie)",
    "products.field.sizeText.help":
      "Liczby bierzemy z siatki powyżej — to pole służy tylko do rozpoznania kroju, materiału i kategorii przez AI. Możesz wkleić oryginalną tabelę z metki jako podpowiedź albo zostawić puste.",
    "products.field.sizeText.placeholder":
      "S — obwód klatki 96–101 cm, długość 68 cm\nM — obwód klatki 102–107 cm, długość 70 cm\nL — obwód klatki 108–113 cm, długość 72 cm",
    "products.field.image.label": "Zdjęcie rozmiarówki",
    "products.field.image.remove": "Usuń zdjęcie",
    "products.field.image.previewAlt": "Podgląd rozmiarówki",
    "products.field.image.dropTitle": "Dodaj zdjęcie",
    "products.field.image.dropHint": "PNG, JPG lub WEBP, do 2,5 MB",
    "products.field.image.note": "Używane tylko przy analizie AI (pierwsza konfiguracja albo „Przeanalizuj ponownie” powyżej) — pomaga rozpoznać krój i podpowiada liczby do siatki wymiarów. Nie nadpisuje już zapisanej siatki.",
    "products.error.tooLarge": "Plik jest za duży — maks. 2,5 MB.",
    "products.error.saveFailed": "Nie udało się zapisać.",
    "products.error.deleteFailed": "Nie udało się usunąć.",
    "products.saved": "Zapisano konfigurację produktu",
    "products.deleted": "Usunięto konfigurację produktu",

    "products.extraction.title": "Co zrozumiała AI",
    "products.extraction.reanalyze": "Przeanalizuj ponownie",
    "products.extraction.reanalyzed": "Produkt przeanalizowany ponownie",
    "products.extraction.reanalyzeFailed": "Nie udało się przeanalizować teraz",
    "products.extraction.help":
      "Analiza robiona raz przy zapisie i używana przy każdym zapytaniu bez wołania modelu. Zmień tabelę / opis i zapisz, albo kliknij „Przeanalizuj ponownie”.",
    "products.extraction.pending":
      "Brak zapisanej analizy — dorobi się automatycznie przy pierwszym zapytaniu klienta.",
    "products.extraction.errorLine":
      "Ostatnia analiza się nie powiodła — do czasu poprawnej analiza dzieje się przy zapytaniu. Kliknij „Przeanalizuj ponownie”.",
    "products.extraction.cat.top": "Góra",
    "products.extraction.cat.bottom": "Dół",
    "products.extraction.cat.dress": "Sukienka",
    "products.extraction.cut.slim": "Krój obcisły",
    "products.extraction.cut.regular": "Krój regularny",
    "products.extraction.cut.relaxed": "Krój swobodny",
    "products.extraction.cut.oversize": "Krój oversize",
    "products.extraction.rows": "{n} rozmiarów z wymiarami",
    "products.extraction.noRows": "Bez tabeli wymiarów",
    "products.extraction.stretch": "Dzianina / stretch",
    "products.extraction.woven": "Tkanina",
    "products.extraction.elastic": "Pas na gumce",
    "products.extraction.rigidWaist": "Sztywny pas",
    "products.extraction.outerwear": "Odzież wierzchnia",
    "products.extraction.korekta": "Korekta rozmiaru {n}",
    "products.extraction.modelAnchor": "Wzorzec: model {h} cm nosi {s}",
    "products.extraction.dq.title": "Uzupełnij dane, żeby dobór był dokładniejszy:",
    "products.extraction.dq.too_few_rows":
      "Brak tabeli rozmiarów — wklej wymiary w cm dla każdego rozmiaru (inaczej rozmiar jest tylko szacowany ze wzrostu i wagi).",
    "products.extraction.dq.no_measurements":
      "Wykryto tylko etykiety rozmiarów bez centymetrów — wklej obwody / długości w cm, żeby dobór nie był zgadywany.",
    "products.extraction.dq.bottom_no_waist":
      "Brak obwodu pasa dla dołu — dodaj „pas” (a najlepiej też „biodra”) w cm dla każdego rozmiaru. Bez tego rozmiar jest dobierany po wzroście/długości i może nie trafiać dla tęższych sylwetek.",
    "products.extraction.dq.top_no_chest":
      "Brak obwodu klatki — dodaj „klatka” (lub „szerokość”) w cm dla każdego rozmiaru. Bez tego dobór idzie po długości/wzroście i waga klienta prawie nie wpływa na wynik.",

    "products.import.button": "Importuj CSV",
    "products.import.template": "Pobierz szablon CSV",
    "products.import.done": "Zaimportowano rozmiarówki dla {n} produktów",
    "products.search.label": "Szukaj produktu",
    "products.search.placeholder": "Szukaj po nazwie produktu…",
    "products.search.none": "Brak produktów pasujących do filtrów.",
    "products.category.label": "Kategoria",
    "products.category.all": "Wszystkie kategorie",
    "import.empty": "Pusty plik CSV.",
    "import.badHeader":
      "Nagłówek CSV musi zawierać kolumny „product_id” i „size” (lub „rozmiar”).",
    "import.noRows": "Nie znaleziono żadnych poprawnych wierszy z wymiarami.",

    "settings.title": "Ustawienia zaawansowane",
    "settings.subtitle": "Sterowanie tym, jak AI dobiera rozmiary w całym sklepie",
    "settings.brand.title": "Styl marki dla AI (opcjonalne)",
    "settings.brand.desc":
      "Opisz jednym–dwoma zdaniami, jak generalnie krojone są Wasze produkty. AI weźmie to pod uwagę przy każdej rekomendacji w sklepie (o ile produkt nie ma własnej konfiguracji).",
    "settings.brand.label": "Styl marki",
    "settings.brand.placeholder":
      "np. Nasze bluzy i koszulki mają krój oversize — zalecamy o pół do jednego rozmiaru mniej.",
    "settings.brand.save": "Zapisz",
    "settings.brand.saved": "Zapisano",
    "settings.css.title": "Własny CSS widżetu",
    "settings.css.desc":
      "Dokleja Twoje reguły CSS do widżetu na sklepie — możesz nadpisać dowolny styl. Selektory zaczynają się od klas typu .sa-root, .size-advisor-trigger, .sa-pill-btn.",
    "settings.css.placeholder":
      ".size-advisor-trigger { border-radius: 0; text-transform: none; }\n.sa-pill-btn.active { background: #b91c1c; border-color: #b91c1c; }",
    "settings.css.ref.toggle": "Lista klas widżetu",
    "settings.css.classes":
      ".sa-root                     — kontener całego widżetu\n" +
      ".size-advisor-trigger        — przycisk otwierający okno\n" +
      ".size-advisor-modal          — przyciemnione tło okna\n" +
      ".size-advisor-modal-content  — białe okno (popup)\n" +
      ".size-advisor-title / -desc  — nagłówek i opis w oknie\n" +
      ".sa-label                    — etykiety pól (Płeć, Wzrost…)\n" +
      ".sa-pill-group               — grupa pigułek wyboru\n" +
      ".sa-pill-btn                 — pojedyncza pigułka\n" +
      ".sa-pill-btn.active          — wybrana pigułka\n" +
      ".sa-input-col input          — pola wzrost / waga\n" +
      "#get-recommendation-btn      — przycisk „Oblicz rozmiar”\n" +
      ".sa-result                   — ramka wyniku\n" +
      ".sa-result--ok / --err / --loading — stany wyniku\n" +
      ".sa-result-size              — polecany rozmiar (duży tekst)\n" +
      ".sa-result-why               — uzasadnienie AI\n" +
      ".sa-add-to-cart              — przycisk „Dodaj do koszyka”\n" +
      ".sa-powered-by               — znak „Size Advisor”\n\n" +
      "Twój CSS doklejany jest na końcu — dodaj !important, jeśli reguła nie działa.",
    "settings.fitPref.title": "Preferencja dopasowania w widżecie",
    "settings.fitPref.desc":
      "Dodaje w widżecie jedno opcjonalne pytanie („Dopasowany / Klasyczny / Luźny”). AI używa go tylko przy rozstrzyganiu między dwoma rozmiarami — nie nadpisuje tabeli wymiarów.",
    "settings.fitPref.toggle": "Pytaj klienta o preferencję dopasowania",

    "settings.garment.title": "Dopasuj do ubrania, które klient ma",
    "settings.garment.desc":
      "Dodaje w widżecie opcjonalne, rozwijane pole: klient podaje wymiary (na płasko, w cm) ubrania tego samego typu, które leży na nim idealnie. Silnik porównuje te liczby z tabelą produktu (bez AI, bez zgadywania marek) i wskazuje najbardziej podobny rozmiar. Pole pyta tylko o wymiary, które produkt faktycznie ma w tabeli. Plan Growth i wyższy.",
    "settings.garment.toggle": "Pytaj klienta o dobrze leżące ubranie",

    "settings.returnRate.title": "Twój ogólny wskaźnik zwrotów",
    "settings.returnRate.desc":
      "Podaj procent zamówień, które zwykle wracają do Ciebie (z całego sklepu, nie tylko z rekomendacji). Dzięki temu w analityce policzymy szacowaną liczbę zwrotów, których uniknięto — porównując zamówienia z rekomendacją do tego poziomu. Zostaw puste, jeśli nie wiesz. Plan Growth i wyższy.",
    "settings.returnRate.label": "Wskaźnik zwrotów",

    "settings.widgetLang.desc":
      "Domyślnie widżet dziedziczy język sklepu. Możesz go tu wymusić na stałe.",
    "settings.widgetLang.label": "Język widżetu w sklepie",
    "settings.widgetLang.auto": "Automatycznie (jak sklep)",
    "settings.widgetLang.shopperOn":
      "Kupujący widzi też małą ikonę 🌐 i może przełączyć język widżetu (PL / ENG) — dostępne w Twoim planie.",
    "settings.widgetLang.shopperOff":
      "Przełącznik języka dla kupującego (ikona 🌐 PL / ENG w widżecie) jest dostępny od planu Growth.",

    "settings.language.title": "Język panelu",
    "settings.language.desc":
      "Automatycznie = zgodnie z językiem panelu Shopify. Ręczny wybór nadpisuje to ustawienie.",
    "settings.language.label": "Język panelu aplikacji",
    "settings.language.auto": "Automatycznie (jak Shopify)",
    "settings.language.pl": "Polski",
    "settings.language.en": "English",
    "settings.tester.title": "Przetestuj prompt asystenta",
    "settings.tester.desc":
      "Wysyła prawdziwe zapytanie do modelu z aktualnym stylem marki. Nie zużywa miesięcznej puli i nie trafia do historii zapytań.",
    "settings.tester.height": "Wzrost (cm)",
    "settings.tester.weight": "Waga (kg)",
    "settings.tester.gender": "Płeć",
    "settings.tester.body": "Budowa ciała",
    "settings.gender.male": "Mężczyzna",
    "settings.gender.female": "Kobieta",
    "settings.body.slim": "Szczupła",
    "settings.body.standard": "Standardowa",
    "settings.body.athletic": "Atletyczna",
    "settings.body.plus": "Masywna",
    "settings.tester.fit": "Preferencja dopasowania",
    "settings.tester.fit.none": "Brak (neutralnie)",
    "settings.tester.fit.fitted": "Dopasowany",
    "settings.tester.fit.regular": "Klasyczny",
    "settings.tester.fit.loose": "Luźny",
    "settings.tester.product": "Produkt do testu",
    "settings.tester.pickProduct": "Wybierz produkt",
    "settings.tester.changeProduct": "Zmień produkt",
    "settings.tester.clearProduct": "Wyczyść",
    "settings.tester.noProduct": "brak — test na generycznej odzieży",
    "settings.tester.testedOn": "Produkt: {product}",
    "settings.tester.testedGeneric": "Test bez produktu (generyczna odzież)",
    "settings.tester.withChart": "użyto tabeli wymiarów produktu",
    "settings.tester.noChart": "brak tabeli wymiarów dla produktu",
    "settings.tester.viaSystem": "z systemu rozmiarów: {name}",
    "settings.tester.fitScale": "Suwak: {scale} — pinezka na {pct}%",
    "settings.tester.fitScale.none": "Suwak: brak danych wymiarowych (pinezka na środku)",
    "settings.tester.run": "Uruchom test",
    "settings.tester.resultSize": "Rekomendowany rozmiar: {size}",
    "settings.tester.usedBrand": "Uwzględniono notatki o marce z Ustawień.",
    "settings.tester.noBrand":
      "Notatki o marce (Ustawienia) są puste — nie wpłynęły na wynik.",
    "settings.tester.ref": "Ubranie referencyjne (opcjonalnie)",
    "settings.tester.refWidth": "Szerokość na płasko, cm (klatka/pas)",
    "settings.tester.refLength": "Długość, cm",
    "settings.tester.refHint":
      "Symuluje klienta, który podał wymiary dobrze leżącego ubrania tego samego typu (na płasko, w cm). Zostaw puste, aby pominąć.",
    "settings.error.saveFailed": "Nie udało się zapisać.",
    "settings.error.testFailed": "Nie udało się wykonać testu.",

    "error.status": "Błąd (status {status}).",
    "error.noProduct": "Nie wybrano produktu.",
    "error.imageTooLarge": "Zdjęcie jest za duże (maks. ok. 2,5 MB).",
    "error.noApiKey": "Brak klucza GEMINI_API_KEY po stronie serwera.",
    "error.missingHeightWeight": "Podaj wzrost i wagę.",
    "error.quotaExhausted": "Limit zapytań do modelu AI został wyczerpany. Spróbuj później.",
    "error.testFailed": "Nie udało się wykonać testu. Spróbuj ponownie.",
  },
  en: {
    "nav.panel": "Dashboard",
    "nav.analytics": "Analytics",
    "nav.products": "Products",
    "nav.sizingSystems": "Sizing systems",
    "nav.plans": "Plan",
    "nav.settings": "Settings",

    "sizingSystems.title": "Sizing systems",
    "sizingSystems.subtitle":
      "One size chart shared by many products — define it once, attach products in a click.",
    "sizingSystems.new": "New system",
    "sizingSystems.newTitle": "New sizing system",
    "sizingSystems.editTitle": "Edit sizing system",
    "sizingSystems.empty":
      "No systems yet. Create e.g. \"Standard t-shirts\" and attach all your tees to it at once.",
    "sizingSystems.edit": "Edit",
    "sizingSystems.delete": "Delete",
    "sizingSystems.addProducts": "Attach products",
    "sizingSystems.mappedCount": "Attached products: {n}",
    "sizingSystems.mapped": "Attached {n} products",
    "sizingSystems.unmapped": "Detached \"{title}\" (back to its own config)",
    "sizingSystems.confirmDelete":
      "Delete the \"{name}\" system? It will detach from {n} products (they go back to their own config).",
    "sizingSystems.nameLabel": "System name",
    "sizingSystems.namePlaceholder": "e.g. Standard t-shirts",
    "products.mappedSystem.editHint":
      "This product uses the “{name}” sizing system's table — edit the table, notes, and image there, not here.",
    "products.mappedSystem.editLink": "Go to Sizing systems",
    "grid.title": "Verified size table",
    "grid.help":
      "Type exact measurements per size — this overrides the AI's reading of the chart and removes parsing mistakes (e.g. a full measurement mistaken for a half one). Chest/waist/hip can be given laid flat (armpit-to-armpit, the way it's usually printed on the tag) or as a full circumference — we detect which one automatically from the size of the numbers, no need to convert. The columns are a closed list of standard apparel-industry measurement points — add/remove per product. Leave a field blank where it doesn't apply.",
    "grid.examplePrefix": "e.g.",
    "grid.col.size": "Size",
    "grid.col.chest": "Chest",
    "grid.col.waist": "Waist",
    "grid.col.hip": "Hip",
    "grid.col.length": "Length",
    "grid.col.inseam": "Inseam",
    "grid.col.legOpening": "Leg opening (hem width)",
    "grid.addRow": "+ Add size",
    "grid.removeRow": "Remove size",
    "grid.addMeasurement": "+ Add measurement type",
    "grid.removeCol": "Remove column: {name}",
    "grid.unusualCols":
      "{names} doesn't usually apply to the “{category}” category — check this is intentional.",
    "grid.incompleteCols": "Missing values: {details}.",
    "grid.flatCols":
      "{names}: the same value for every size — real manufacturer charts almost always vary, double-check this data is actually correct.",
    "grid.prefillFromAi": "Fill from the latest AI analysis",
    "grid.verifyToast":
      "Filled from the AI analysis — check the numbers before saving, the AI may have gotten something wrong.",
    "grid.verifiedBadge": "Verified size table",
    "consistency.title": "Table consistency check",
    "consistency.checking": "Checking against test body profiles…",
    "consistency.ok": "Consistent across {n} tested body profiles.",
    "consistency.issues": "{n} inconsistencies found — check these spots in the table:",
    "consistency.issue":
      "{axis} {from}→{to} ({gender}, {build}): size drops from {fromSize} to {toSize}",
    "consistency.axis.height": "height",
    "consistency.axis.weight": "weight",
    "consistency.gender.male": "male",
    "consistency.gender.female": "female",
    "consistency.build.slim": "slim",
    "consistency.build.standard": "standard",
    "consistency.build.athletic": "athletic",
    "consistency.build.plus": "plus-size",
    "sizingSystems.notesLabel": "Notes for the AI (optional)",
    "sizingSystems.notesHelp":
      "Cut, material, size adjustments (e.g. “runs small — size up”) — the numbers still come from the grid above, this field only helps classify the product.",
    "sizingSystems.notesPlaceholder": "e.g. runs small — size up",
    "sizingSystems.error.name": "Enter a system name.",
    "sizingSystems.error.dupe": "A system with that name already exists.",
    "sizingSystems.pickerLabel": "Sizing system",
    "sizingSystems.pickerNone": "Product's own chart",
    "sizingSystems.usingSystem": "Uses system: {name}",
    "sizingSystems.attachedList": "Attached products",
    "sizingSystems.noneAttached": "No products attached yet.",
    "sizingSystems.moreAttached": "+{n} more",

    "analytics.title": "Analytics",
    "analytics.subtitle": "How recommendations are performing in your store",
    "analytics.range": "Range: last {days} days",
    "analytics.range.all": "Range: all available history",
    "analytics.csv": "Export summary (CSV)",
    "analytics.csv.error": "Could not download the file. Please try again.",
    "analytics.empty": "No data in this range yet.",
    "analytics.funnel.title": "From recommendation to purchase",
    "analytics.funnel.recs": "Recommendations",
    "analytics.funnel.recsNote": "includes cache hits (don't use up the plan's limit)",
    "analytics.funnel.cart": "Added size to cart",
    "analytics.funnel.bought": "Purchased",
    "analytics.funnel.note":
      "“Purchased” counts only when the shopper used the widget, added the recommended size to cart, and completed checkout — a real event, not an estimate.",
    "analytics.rate.ofRecs": "{pct}% of recommendations",
    "analytics.rate.ofCart": "{pct}% of add-to-carts",
    "analytics.time.title": "Recommendations over time (30 days)",
    "analytics.sizes.title": "Recommended sizes",
    "analytics.sizes.allProducts": "All products",
    "analytics.profile.title": "Shopper profile",
    "analytics.profile.gender": "Gender",
    "analytics.profile.body": "Body type",
    "analytics.gender.unknown": "Unspecified",
    "analytics.body.other": "Other",
    "analytics.top.title": "Most-advised products",
    "analytics.top.col.recs": "Recommendations",
    "analytics.top.col.cart": "To cart",
    "analytics.top.col.bought": "Purchases",
    "analytics.purchases.title": "Recent purchases from recommendations",
    "analytics.purchases.col.date": "Date",
    "analytics.purchases.col.size": "Size",
    "analytics.returns.rate.title": "Returns on recommendation orders",
    "analytics.returns.rate.body":
      "Measured: {n} of {m} purchases with the recommended size were returned.",
    "analytics.returns.avoided.title": "Estimated returns avoided",
    "analytics.returns.avoided.body":
      "Recommendation orders returned at {widget}% vs your overall {base}%. The gap × purchases = estimate of returns that did not happen.",
    "analytics.returns.avoided.needsBaseline":
      "Enter your overall return rate in Settings to see an estimate of avoided returns.",
    "analytics.returns.avoided.needsBaselineLink": "Go to Settings",
    "analytics.revenue.title": "Revenue from recommendations",
    "analytics.revenue.body":
      "Total value of orders where the shopper bought the recommended size (via the widget).",
    "analytics.revenue.empty":
      "No orders attributed to recommendations in this range yet.",
    "analytics.locked.body":
      "The conversion funnel, purchases from recommendations and the returns estimate are available on the Starter plan. Usage stats are shown below.",

    "plans.title": "Plan & limits",
    "plans.subtitle": "Choose the monthly AI recommendation limit for your store",
    "plans.usage": "Used {used} of {limit} recommendations this month",
    "plans.usage.cacheNote":
      "Doesn't count cache hits (e.g. “My size” on another product for the same body) — those are free and don't use up the limit. That's why the recommendation count in Analytics can be higher than here.",
    "plans.current": "Current plan",
    "plans.recommendations": "{n} recommendations / mo",
    "plans.free_price": "Free",
    "plans.price_month": "${amount} / mo",
    "plans.trial": "7-day free trial",
    "plans.select": "Choose",
    "plans.downgrade": "Switch to Free",
    "plans.yourPlan": "Your current plan",
    "plans.billingUnavailable":
      "Couldn't reach Shopify billing — showing your last saved data. Refresh the page in a moment.",
    "plans.downgrade.confirmTitle": "Switch to the Free plan?",
    "plans.downgrade.confirmBody":
      "Your subscription will be cancelled. You'll lose paid features — the higher recommendation limit, conversion analytics, deeper history, size-chart images. You can resubscribe any time.",
    "plans.test_notice": "Test mode — your card will not be charged.",
    "plans.renews": "Renews {date}",
    "plans.interval.monthly": "Monthly",
    "plans.interval.annual": "Annual",
    "plans.billed_annually": "${amount} / yr",
    "plans.save_annual": "2 months free",
    "common.cancel": "Cancel",
    "common.moreActions": "More actions",
    "plans.includes_prev": "Everything in {plan}, plus:",
    "plans.paidShared.title": "Every paid plan (Starter, Growth, Pro) includes:",
    "plans.paidShared.note":
      "Paid plans differ ONLY in their monthly recommendation limit — the higher the plan, the more recommendations, every feature is the same.",
    "plans.feat.rec": "{n} recommendations / mo",
    "plans.feat.brand_style": "Brand fit for the AI",
    "plans.feat.theme_customize": "Widget text & styling in the theme editor",
    "plans.feat.history_recent": "Last 5 queries",
    "plans.feat.extraction_review":
      "Review & correct what the AI read from the size chart",
    "plans.feat.add_to_cart": "“Add to cart” button in the widget",
    "plans.feat.products_limited": "Per-product config for up to {n} products",
    "plans.feat.products_unlimited": "Unlimited per-product config",
    "plans.feat.tester": "Prompt tester in the admin",
    "plans.feat.history_days": "Query history: {n} days",
    "plans.feat.history_year": "Query history: 12 months",
    "plans.feat.size_image": "Size-chart image read by the AI",
    "plans.feat.analytics": "Conversion & saved-returns analytics",
    "plans.feat.no_branding": "No “Size Advisor” mark in the widget",
    "plans.feat.csv": "Query history CSV export",
    "plans.feat.revenue": "Revenue attributed to recommendations",
    "plans.feat.custom_css": "Custom widget CSS",
    "plans.feat.bulk_import": "Bulk size-chart import (CSV)",
    "plans.feat.fit_pref": "Fit-preference question in the widget",
    "plans.feat.garment_match": "Matches from the measurements of a garment the shopper says fits well",
    "plans.feat.auto_size": "“My size: X” — shopper enters measurements once, sees their size on every product",

    "gate.see_plans": "See plans",
    "gate.upgrade": "Upgrade your plan",
    "gate.locked_from": "Available on the {plan} plan.",
    "gate.products_title": "Per-product configuration",
    "gate.products_limit_reached":
      "Reached the {n}-product limit on the {plan} plan. Upgrade to add more.",
    "gate.image_locked": "Size-chart image read by the AI is available on the Starter plan.",
    "gate.analytics_title": "Conversion analytics",
    "gate.tester_locked": "The prompt tester is available on the Starter plan.",
    "gate.csv_locked": "CSV export is available on the Starter plan.",

    "index.subtitle": "Smart size recommendation assistant on product pages",
    "setup.title": "Get started",
    "setup.desc": "Two quick steps to show the size assistant on your product pages.",
    "setup.step1.done": "Assistant is enabled",
    "setup.step1.todo": "Enable the assistant — button in the top-right of this page",
    "setup.step2.title": "Add the widget to your theme",
    "setup.step2.desc":
      "Open the theme editor, go to a product template, and add the “Size Advisor Button” app block where you want it to appear.",
    "setup.step2.cta": "Open theme editor",
    "setup.step3.title": "Fine-tune (optional)",
    "setup.step3.desc":
      "Add brand fit notes and per-product size charts under Settings and Products.",
    "setup.dismiss": "Dismiss this tip",
    "index.action.enable": "Activate assistant",
    "index.action.disable": "Disable on storefront",
    "index.card.recommendations.title": "Recommendations this month",
    "index.card.recommendations.plan": "{plan} plan ({used} / {limit})",
    "index.card.purchases.title": "Purchases from recommendations",
    "index.card.purchases.tooltip":
      "Confirmed purchases where the customer added a recommended size to cart. The estimated return reduction (~30% of these purchases) is a modeling assumption, not a value measured in your store.",
    "index.card.purchases.helpAria": "Where does this number come from?",
    "index.card.purchases.sub": "{cart} added to cart · est. −{returns} returns",
    "index.card.status.title": "App status",
    "index.card.status.active": "Active",
    "index.card.status.inactive": "Disabled",
    "index.card.status.visible": "Visible to customers",
    "index.card.status.hidden": "Hidden",
    "index.queries.title.recent": "Recent shopper queries",
    "index.queries.title.month": "Shopper queries this month",
    "index.queries.count": "This month: {n} · model decision history",
    "index.queries.showAll": "Show history",
    "index.queries.showRecent": "Show recent only",
    "index.queries.csv": "CSV export",
    "index.queries.col.product": "Product",
    "index.queries.col.customer": "Customer profile",
    "index.queries.col.recommendation": "Recommendation",
    "index.queries.col.date": "Date",
    "index.queries.productFallback": "Store product",
    "index.queries.addedToCart": "Added to cart",
    "index.queries.empty": "No queries in history yet.",
    "index.resource.singular": "recommendation",
    "index.resource.plural": "recommendations",
    "index.limit.title": "Your limit",
    "index.limit.monthly": "Monthly quota",
    "index.limit.renew": "The counter resets every month.",
    "index.limit.upgrade": "Change plan",

    "products.title": "Product configuration",
    "products.subtitle":
      "Add per-product hints and size charts that the AI will use when recommending sizes",
    "products.addProduct": "Add product",
    "products.configured.title": "Configured products",
    "products.configured.desc":
      "Products without their own configuration use the general brand style and the product description.",
    "products.empty": "No products configured yet.",
    "products.addFirst": "Add your first product",
    "products.resource.singular": "product",
    "products.resource.plural": "products",
    "products.item.aria": "Configure {title}",
    "products.item.fallback": "Product {id}",
    "products.badge.notes": "AI notes",
    "products.badge.sizeTable": "Size chart",
    "products.badge.image": "Size chart image",
    "products.badge.system": "System: {name}",
    "products.badge.empty": "Empty configuration",
    "products.badge.inactive": "Product inactive",
    "products.aside.title": "How it works",
    "products.aside.intro": "For every recommendation for this product the AI also receives:",
    "products.aside.notes": "free-text description, e.g. “this model runs narrow”.",
    "products.aside.sizeTable": "concrete values the AI uses instead of guessing from the description.",
    "products.aside.image": "helps the AI analysis (cut, category) and suggests numbers for the grid — doesn't replace it.",
    "products.modal.titleFallback": "Product configuration",
    "products.modal.save": "Save",
    "products.modal.delete": "Delete configuration",
    "products.field.notes.label": "Notes for the AI (optional)",
    "products.field.notes.help":
      "Cut, material, sizing corrections (e.g. \"runs small — size up\") — numbers still come from the grid above, this field only helps classify the product (once, on save).",
    "products.field.notes.placeholder":
      "e.g. This model runs narrow in the shoulders — for athletic builds suggest one size up.",
    "products.field.sizeText.label": "Description for the AI (optional)",
    "products.field.sizeText.help":
      "Numbers come from the grid above — this field is only used to help the AI recognise the cut, material and category. Paste the original chart from the label as a hint, or leave it blank.",
    "products.field.sizeText.placeholder":
      "S — chest 96–101 cm, length 68 cm\nM — chest 102–107 cm, length 70 cm\nL — chest 108–113 cm, length 72 cm",
    "products.field.image.label": "Size chart image",
    "products.field.image.remove": "Remove image",
    "products.field.image.previewAlt": "Size chart preview",
    "products.field.image.dropTitle": "Add image",
    "products.field.image.dropHint": "PNG, JPG or WEBP, up to 2.5 MB",
    "products.field.image.note": "Only used for AI analysis (first-time setup or “Re-analyze” above) — helps recognize the cut and suggests numbers for the measurement grid. It never overrides a grid you've already saved.",
    "products.error.tooLarge": "File is too large — max 2.5 MB.",
    "products.error.saveFailed": "Could not save.",
    "products.error.deleteFailed": "Could not delete.",
    "products.saved": "Product configuration saved",
    "products.deleted": "Product configuration removed",

    "products.extraction.title": "What the AI understood",
    "products.extraction.reanalyze": "Re-analyze",
    "products.extraction.reanalyzed": "Product re-analyzed",
    "products.extraction.reanalyzeFailed": "Could not analyze right now",
    "products.extraction.help":
      "Analyzed once on save and reused on every request without calling the model. Change the chart / description and save, or hit “Re-analyze”.",
    "products.extraction.pending":
      "No stored analysis yet — it will be built automatically on the first shopper request.",
    "products.extraction.errorLine":
      "The last analysis failed — until it succeeds, analysis runs per request. Hit “Re-analyze”.",
    "products.extraction.cat.top": "Top",
    "products.extraction.cat.bottom": "Bottom",
    "products.extraction.cat.dress": "Dress",
    "products.extraction.cut.slim": "Slim fit",
    "products.extraction.cut.regular": "Regular fit",
    "products.extraction.cut.relaxed": "Relaxed fit",
    "products.extraction.cut.oversize": "Oversize fit",
    "products.extraction.rows": "{n} sizes with measurements",
    "products.extraction.noRows": "No measurement table",
    "products.extraction.stretch": "Knit / stretch",
    "products.extraction.woven": "Woven",
    "products.extraction.elastic": "Elastic waist",
    "products.extraction.rigidWaist": "Rigid waistband",
    "products.extraction.outerwear": "Outerwear",
    "products.extraction.korekta": "Size adjustment {n}",
    "products.extraction.modelAnchor": "Reference: model {h} cm wears {s}",
    "products.extraction.dq.title": "Add data for a more accurate fit:",
    "products.extraction.dq.too_few_rows":
      "No size chart — paste per-size measurements in cm (otherwise the size is only estimated from height and weight).",
    "products.extraction.dq.no_measurements":
      "Only size labels detected, no centimetres — paste circumferences / lengths in cm so the pick isn't guessed.",
    "products.extraction.dq.bottom_no_waist":
      "No waist measurement for a bottom — add \"waist\" (ideally \"hip\" too) in cm per size. Without it the size is picked by height/length and can miss for larger builds.",
    "products.extraction.dq.top_no_chest":
      "No chest measurement — add \"chest\" (or \"width\") in cm per size. Without it the pick goes by length/height and the shopper's weight barely affects the result.",

    "products.import.button": "Import CSV",
    "products.import.template": "Download CSV template",
    "products.import.done": "Imported size charts for {n} products",
    "products.search.label": "Search products",
    "products.search.placeholder": "Search by product name…",
    "products.search.none": "No products match the filters.",
    "products.category.label": "Category",
    "products.category.all": "All categories",
    "import.empty": "Empty CSV file.",
    "import.badHeader":
      "The CSV header must include a “product_id” and a “size” column.",
    "import.noRows": "No valid rows with measurements were found.",

    "settings.title": "Advanced settings",
    "settings.subtitle": "Control how the AI picks sizes across the whole store",
    "settings.brand.title": "Brand fit for the AI (optional)",
    "settings.brand.desc":
      "Describe in one or two sentences how your products are generally cut. The AI takes this into account on every recommendation in the store (unless the product has its own configuration).",
    "settings.brand.label": "Brand fit",
    "settings.brand.placeholder":
      "e.g. Our hoodies and tees have an oversized fit — we recommend going half to one size down.",
    "settings.brand.save": "Save",
    "settings.brand.saved": "Saved",
    "settings.css.title": "Custom widget CSS",
    "settings.css.desc":
      "Appends your CSS rules to the storefront widget — override any style. Selectors start with classes like .sa-root, .size-advisor-trigger, .sa-pill-btn.",
    "settings.css.placeholder":
      ".size-advisor-trigger { border-radius: 0; text-transform: none; }\n.sa-pill-btn.active { background: #b91c1c; border-color: #b91c1c; }",
    "settings.css.ref.toggle": "Widget class list",
    "settings.css.classes":
      ".sa-root                     — the whole widget wrapper\n" +
      ".size-advisor-trigger        — the button that opens the popup\n" +
      ".size-advisor-modal          — the dimmed popup backdrop\n" +
      ".size-advisor-modal-content  — the white popup box\n" +
      ".size-advisor-title / -desc  — popup heading and description\n" +
      ".sa-label                    — field labels (Gender, Height…)\n" +
      ".sa-pill-group               — a group of choice pills\n" +
      ".sa-pill-btn                 — a single pill\n" +
      ".sa-pill-btn.active          — the selected pill\n" +
      ".sa-input-col input          — the height / weight inputs\n" +
      "#get-recommendation-btn      — the “Calculate size” button\n" +
      ".sa-result                   — the result box\n" +
      ".sa-result--ok / --err / --loading — result states\n" +
      ".sa-result-size              — recommended size (large text)\n" +
      ".sa-result-why               — the AI explanation\n" +
      ".sa-add-to-cart              — the “Add to cart” button\n" +
      ".sa-powered-by               — the “Size Advisor” mark\n\n" +
      "Your CSS is appended last — add !important if a rule doesn’t take effect.",
    "settings.fitPref.title": "Fit preference in the widget",
    "settings.fitPref.desc":
      "Adds one optional question to the widget (“Fitted / Regular / Loose”). The AI only uses it to break a tie between two sizes — it never overrides the size chart.",
    "settings.fitPref.toggle": "Ask the shopper for a fit preference",

    "settings.garment.title": "Match a garment the shopper owns",
    "settings.garment.desc":
      "Adds an optional, collapsible field in the widget: the shopper enters flat measurements (in cm) of a garment of the same type that fits them perfectly. The engine compares those numbers against this product's chart directly (no AI, no brand guessing) and picks the closest size. Only asks for measurements this product's chart actually has. Growth plan and up.",
    "settings.garment.toggle": "Ask the shopper for a well-fitting garment",

    "settings.returnRate.title": "Your overall return rate",
    "settings.returnRate.desc":
      "Enter the percentage of orders that normally come back to you (store-wide, not just recommendation orders). Analytics then estimates how many returns were avoided — comparing recommendation orders against this baseline. Leave blank if you don't know. Growth plan and up.",
    "settings.returnRate.label": "Return rate",

    "settings.widgetLang.desc":
      "By default the widget inherits the store language. You can pin it here.",
    "settings.widgetLang.label": "Widget language in the storefront",
    "settings.widgetLang.auto": "Automatic (match store)",
    "settings.widgetLang.shopperOn":
      "Shoppers also see a small 🌐 icon and can switch the widget language (PL / ENG) — included in your plan.",
    "settings.widgetLang.shopperOff":
      "The shopper-facing language switch (🌐 PL / ENG icon in the widget) is available from the Growth plan.",

    "settings.language.title": "Panel language",
    "settings.language.desc":
      "Automatic = follows your Shopify admin language. A manual choice overrides it.",
    "settings.language.label": "App panel language",
    "settings.language.auto": "Automatic (match Shopify)",
    "settings.language.pl": "Polski",
    "settings.language.en": "English",
    "settings.tester.title": "Test the assistant prompt",
    "settings.tester.desc":
      "Sends a real request to the model with the current brand fit. Does not use the monthly quota and is not logged in query history.",
    "settings.tester.height": "Height (cm)",
    "settings.tester.weight": "Weight (kg)",
    "settings.tester.gender": "Gender",
    "settings.tester.body": "Body type",
    "settings.gender.male": "Male",
    "settings.gender.female": "Female",
    "settings.body.slim": "Slim",
    "settings.body.standard": "Standard",
    "settings.body.athletic": "Athletic",
    "settings.body.plus": "Plus",
    "settings.tester.fit": "Fit preference",
    "settings.tester.fit.none": "None (neutral)",
    "settings.tester.fit.fitted": "Fitted",
    "settings.tester.fit.regular": "Regular",
    "settings.tester.fit.loose": "Loose",
    "settings.tester.product": "Test product",
    "settings.tester.pickProduct": "Pick a product",
    "settings.tester.changeProduct": "Change product",
    "settings.tester.clearProduct": "Clear",
    "settings.tester.noProduct": "none — testing generic clothing",
    "settings.tester.testedOn": "Product: {product}",
    "settings.tester.testedGeneric": "Tested without a product (generic clothing)",
    "settings.tester.withChart": "used the product size chart",
    "settings.tester.noChart": "no size chart for the product",
    "settings.tester.viaSystem": "via sizing system: {name}",
    "settings.tester.fitScale": "Fit scale: {scale} — pin at {pct}%",
    "settings.tester.fitScale.none": "Fit scale: no measurement data (pin centred)",
    "settings.tester.run": "Run test",
    "settings.tester.resultSize": "Recommended size: {size}",
    "settings.tester.usedBrand": "Brand style notes from Settings were applied.",
    "settings.tester.noBrand":
      "Brand style notes (Settings) are empty — they didn't affect the result.",
    "settings.tester.ref": "Reference garment (optional)",
    "settings.tester.refWidth": "Flat width, cm (chest/waist)",
    "settings.tester.refLength": "Length, cm",
    "settings.tester.refHint":
      "Simulates a shopper who gave the flat measurements (in cm) of a well-fitting garment of the same type. Leave blank to skip.",
    "settings.error.saveFailed": "Could not save.",
    "settings.error.testFailed": "Could not run the test.",

    "error.status": "Error (status {status}).",
    "error.noProduct": "No product selected.",
    "error.imageTooLarge": "Image is too large (max ~2.5 MB).",
    "error.noApiKey": "GEMINI_API_KEY is missing on the server.",
    "error.missingHeightWeight": "Enter height and weight.",
    "error.quotaExhausted": "The AI model request quota is exhausted. Try again later.",
    "error.testFailed": "Could not run the test. Try again.",
  },
};

function interpolate(str: string, vars?: Vars): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function translate(locale: Locale, key: string, vars?: Vars): string {
  const table = messages[locale] ?? messages[DEFAULT_LOCALE];
  const raw = table[key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  return interpolate(raw, vars);
}

export type TFunction = (key: string, vars?: Vars) => string;

/** For resource routes: read the locale the client appended as `?locale=`. */
export function requestT(request: Request): TFunction {
  const locale =
    normalizeLocale(new URL(request.url).searchParams.get("locale")) ?? DEFAULT_LOCALE;
  return (key, vars) => translate(locale, key, vars);
}

const I18nContext = createContext<{ locale: Locale; t: TFunction }>({
  locale: DEFAULT_LOCALE,
  t: (key) => translate(DEFAULT_LOCALE, key),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, t: (key: string, vars?: Vars) => translate(locale, key, vars) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
