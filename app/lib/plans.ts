// Czyste dane planów — bez importów server-only, więc bezpieczne do użycia
// w komponentach tras (klient) i w `shopify.server.ts` (serwer).

export const PLAN = {
  FREE: "free",
  STARTER: "Starter",
  GROWTH: "Growth",
  PRO: "Pro",
} as const;

export type PlanName = (typeof PLAN)[keyof typeof PLAN];

/** Płatne plany — do `billing.check` / `billing.request`. */
export const PAID_PLANS = [PLAN.STARTER, PLAN.GROWTH, PLAN.PRO] as const;

/** Cena miesięczna (USD). */
export const PLAN_PRICE: Record<string, number> = {
  [PLAN.STARTER]: 9.99,
  [PLAN.GROWTH]: 24.99,
  [PLAN.PRO]: 59.99,
};

/** Cena roczna (USD) — 10× miesięczna, czyli 2 miesiące gratis (~17% taniej). */
export const PLAN_PRICE_ANNUAL: Record<string, number> = {
  [PLAN.STARTER]: Math.round(PLAN_PRICE[PLAN.STARTER] * 10 * 100) / 100,
  [PLAN.GROWTH]: Math.round(PLAN_PRICE[PLAN.GROWTH] * 10 * 100) / 100,
  [PLAN.PRO]: Math.round(PLAN_PRICE[PLAN.PRO] * 10 * 100) / 100,
};

export type BillingInterval = "monthly" | "annual";

export const TRIAL_DAYS = 7;

/** Sentinel dla „bez limitu" (serializuje się do JSON-a, w odróżnieniu od Infinity). */
export const UNLIMITED = 1_000_000;

export type PlanCapabilities = {
  /** Miesięczny limit rekomendacji AI. */
  monthlyLimit: number;
  /** Przycisk „Dodaj do koszyka" w widżecie storefront. */
  addToCartButton: boolean;
  /** Maks. liczba produktów z własną konfiguracją (UNLIMITED = bez limitu). */
  productRuleLimit: number;
  /** Zdjęcie rozmiarówki czytane przez multimodalne AI. */
  sizeChartImageAI: boolean;
  /** Odpowiedź AI w języku sklepu (inaczej wymuszony jeden język). */
  multilingual: boolean;
  /** Analityka konwersji + „ocalonych zwrotów". */
  conversionAnalytics: boolean;
  /** Głębokość historii zapytań w dniach (0 = tylko 5 ostatnich). */
  historyDays: number;
  /** Eksport historii do CSV. */
  csvExport: boolean;
  /** Ukrycie znaku „Size Advisor" w stopce widżetu. */
  removeBranding: boolean;
  /** Tester promptu w panelu. */
  promptTester: boolean;
  /** Sprzedawca może włączyć w widżecie pytanie o preferencję dopasowania. */
  fitPreference: boolean;
  /** Własny CSS wstrzykiwany do widżetu na sklepie. */
  customCss: boolean;
  /** Masowy import rozmiarówek z CSV. */
  bulkImport: boolean;
  /** Widżet: pytanie „mam dobrze leżące ubranie marki X rozmiar Y". */
  garmentMatch: boolean;
  /** Widżet: po jednorazowym podaniu wymiarów kupujący widzi „Mój rozmiar: X"
   *  na każdym produkcie bez ponownego wypełniania (auto-przeliczenie). */
  autoSize: boolean;
};

// Płatne plany różnią się TYLKO wolumenem (monthlyLimit, patrz cena w
// PLAN_PRICE) — wszystkie funkcje są identyczne na Starterze, Growth i Pro.
// Decyzja świadoma: mniej "który plan ma X" (mniej miejsc na błędy
// bramkowania — patrz commit 1ad9c17, gdzie dwie takie niespójności
// znalazły się same), cena wprost odzwierciedla koszt AI (skaluje się z
// wolumenem, nie z tym, czy ktoś używa custom CSS). Free zostaje jako
// świadomie ograniczony driver instalacji w App Store (i tak nie płaci, ale
// generuje instalacje/recenzje) — ma odblokowane tyle produktów, żeby
// zweryfikować REALNĄ jakość na 1-2 produktach przed zakupem, a nie kupować
// w ciemno.
const PAID_TIER_CAPS: Omit<PlanCapabilities, "monthlyLimit"> = {
  addToCartButton: true,
  productRuleLimit: UNLIMITED,
  sizeChartImageAI: true,
  multilingual: true,
  conversionAnalytics: true,
  historyDays: 365,
  csvExport: true,
  removeBranding: true,
  promptTester: true,
  fitPreference: true,
  customCss: true,
  bulkImport: true,
  garmentMatch: true,
  autoSize: true,
};

export const PLAN_CAPS: Record<string, PlanCapabilities> = {
  [PLAN.FREE]: {
    monthlyLimit: 150,
    addToCartButton: false,
    productRuleLimit: 2,
    sizeChartImageAI: false,
    multilingual: true, // widżet + odpowiedź AI po PL/EN, przełącznik dla klienta — na każdym planie
    conversionAnalytics: false,
    historyDays: 0,
    csvExport: false,
    removeBranding: false,
    promptTester: false,
    fitPreference: false,
    customCss: false,
    bulkImport: false,
    garmentMatch: false,
    autoSize: false,
  },
  [PLAN.STARTER]: { monthlyLimit: 500, ...PAID_TIER_CAPS },
  [PLAN.GROWTH]: { monthlyLimit: 3000, ...PAID_TIER_CAPS },
  [PLAN.PRO]: { monthlyLimit: 15000, ...PAID_TIER_CAPS },
};

/** Miesięczny limit rekomendacji na plan (skrót — źródłem prawdy jest PLAN_CAPS). */
export const PLAN_LIMITS: Record<string, number> = Object.fromEntries(
  Object.entries(PLAN_CAPS).map(([k, v]) => [k, v.monthlyLimit]),
);

export function planCaps(plan: string | null | undefined): PlanCapabilities {
  return PLAN_CAPS[plan ?? PLAN.FREE] ?? PLAN_CAPS[PLAN.FREE];
}

/**
 * Klucze i18n z listą wyróżników do wyświetlenia na kartach planów.
 * Płatne plany renderujemy jako „wszystko z {niższy}, plus:" — a skoro
 * Starter/Growth/Pro mają teraz IDENTYCZNE funkcje (patrz PAID_TIER_CAPS),
 * Growth i Pro nie dodają nic poza wyższym miesięcznym limitem: cała ich
 * lista to właśnie ten jeden wiersz.
 */
export const PLAN_FEATURES: Record<string, string[]> = {
  [PLAN.FREE]: [
    "plans.feat.rec",
    "plans.feat.products_limited",
    "plans.feat.extraction_review",
    "plans.feat.brand_style",
    "plans.feat.theme_customize",
    "plans.feat.history_recent",
  ],
  [PLAN.STARTER]: [
    "plans.feat.rec",
    "plans.feat.add_to_cart",
    "plans.feat.products_unlimited",
    "plans.feat.size_image",
    "plans.feat.analytics",
    "plans.feat.revenue",
    "plans.feat.fit_pref",
    "plans.feat.garment_match",
    "plans.feat.auto_size",
    "plans.feat.custom_css",
    "plans.feat.no_branding",
    "plans.feat.history_year",
    "plans.feat.bulk_import",
    "plans.feat.csv",
    "plans.feat.tester",
  ],
  [PLAN.GROWTH]: ["plans.feat.rec"],
  [PLAN.PRO]: ["plans.feat.rec"],
};
