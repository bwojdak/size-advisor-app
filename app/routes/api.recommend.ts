import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  buildSizeAdvisorPrompt,
  callAI,
  decideSize,
  parseStoredExtraction,
  EXTRACTION_VERSION,
  getAIConfig,
  AIQuotaError,
  type FitScale,
} from "../lib/size-advisor.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { planCaps } from "../lib/plans";

// In-memory cache of identical recommendations. The free Gemini tier allows very
// few calls/day, so repeated queries (re-tests, returning shoppers) reuse a
// previous answer instead of spending quota. Each request still gets its own
// AdvisorLog row and still counts against the shop's monthly limit.
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const CACHE_MAX = 500;

// Po tylu dniach odświeżamy analizę produktu niekonfigurowanego przez admina
// (ProductAnalysis) — łapie edycje opisu w Shopify bez webhooka.
const ANALYSIS_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const recommendationCache = new Map<
  string,
  {
    size: string;
    explanation: string;
    detail: string;
    nbSmaller: string | null;
    nbLarger: string | null;
    fitScale: FitScale | null;
    source: "chart" | "estimate";
    ts: number;
  }
>();

function getCachedRecommendation(key: string) {
  const hit = recommendationCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    recommendationCache.delete(key);
    return null;
  }
  return hit;
}

function setCachedRecommendation(
  key: string,
  size: string,
  explanation: string,
  detail: string,
  nbSmaller: string | null,
  nbLarger: string | null,
  fitScale: FitScale | null,
  source: "chart" | "estimate",
) {
  if (recommendationCache.size >= CACHE_MAX) {
    const oldest = recommendationCache.keys().next().value;
    if (oldest !== undefined) recommendationCache.delete(oldest);
  }
  recommendationCache.set(key, {
    size,
    explanation,
    detail,
    nbSmaller,
    nbLarger,
    fitScale,
    source,
    ts: Date.now(),
  });
}

// --- Ochrona przed spamem: limit zapytań per sklep+IP (in-memory, best-effort).
// Nie chroni per instancja po skalowaniu, ale odbija oczywiste nadużycia zanim
// dotkną limitu miesięcznego sklepu, analityki i rachunku za AI.
const RATE_BURST_MS = 15_000;
const RATE_BURST_MAX = 6; // maks. tyle w 15 s (szybkie klikanie)
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_WINDOW_MAX = 40; // maks. tyle w 10 min
const rateBuckets = new Map<string, number[]>();

function clientKey(request: Request, shop: string): string {
  const xff = request.headers.get("x-forwarded-for") || "";
  const ip =
    xff.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "noip";
  return `${shop}|${ip}`;
}

/** true = wolno; false = przekroczono limit. */
function allowRequest(key: string): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  const burst = hits.filter((t) => now - t < RATE_BURST_MS).length;
  if (burst >= RATE_BURST_MAX || hits.length >= RATE_WINDOW_MAX) {
    rateBuckets.set(key, hits); // zapisz przycięte, nie dokładaj trafienia
    return false;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) {
        rateBuckets.delete(k);
      }
    }
  }
  return true;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  // Waliduje podpis app proxy (HMAC). Rzuca 400 przy złym podpisie —
  // wywołanie poza try, żeby ten Response nie został połknięty przez catch.
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return data({ error: "Sklep nie jest połączony z aplikacją." }, { status: 401 });
  }
  const shop = session.shop;

  if (!allowRequest(clientKey(request, shop))) {
    return data(
      { error: "Zbyt wiele zapytań. Odczekaj chwilę i spróbuj ponownie." },
      { status: 429 },
    );
  }

  try {
    const rawText = await request.text();
    let parsed: Record<string, unknown>;
    try {
      const j = JSON.parse(rawText || "{}");
      parsed = j && typeof j === "object" ? (j as Record<string, unknown>) : {};
    } catch {
      return data({ error: "Nieprawidłowe dane żądania." }, { status: 400 });
    }
    const gender = String(parsed.gender ?? "").slice(0, 20) || null;
    const bodyType = String(parsed.bodyType ?? "").slice(0, 20) || null;
    const locale = parsed.locale;
    const fitPreference = parsed.fitPreference;
    const refBrand = parsed.refBrand;
    const refSize = parsed.refSize;
    const productId = parsed.productId;

    // Wzrost / waga: twarda walidacja liczbowa po stronie serwera. Widżet pilnuje
    // węższego zakresu w UI (140–215 cm / 40–180 kg), ale request można podrobić.
    const height = Number(parsed.height);
    const weight = Number(parsed.weight);
    if (
      !Number.isFinite(height) ||
      !Number.isFinite(weight) ||
      height < 120 ||
      height > 230 ||
      weight < 30 ||
      weight > 250
    ) {
      return data({ error: "Podaj poprawny wzrost i wagę." }, { status: 400 });
    }

    // Pola tekstowe produktu z widżetu — przycięte, żeby nie rozdmuchać promptu
    // ani nie zapchać bazy spreparowanym żądaniem.
    const productTitle = String(parsed.productTitle ?? "").slice(0, 300);
    const productDescription = String(parsed.productDescription ?? "").slice(0, 2000);

    const numericProductId = String(productId ?? "").replace(/\D/g, "");

    // Preferencja dopasowania z widżetu (opcjonalna). Rozstrzyga ją kod w
    // resolveSize() jako remis-breaker między dwoma pasującymi rozmiarami.
    const fit: "fitted" | "loose" | null =
      fitPreference === "fitted" || fitPreference === "loose"
        ? fitPreference
        : null;

    const settings = await loadShopSettings(shop);
    const caps = planCaps(settings.plan);

    // Ubranie referencyjne „mam Nike L, leży idealnie" — tylko gdy plan i sklep
    // to włączają.
    const refBrandS = String(refBrand ?? "").trim().slice(0, 40);
    const refSizeS = String(refSize ?? "").trim().slice(0, 16);
    const referenceGarment =
      caps.garmentMatch && settings.askGarmentMatch && refBrandS && refSizeS
        ? { brand: refBrandS, size: refSizeS }
        : null;

    // Plan bez wielojęzyczności → odpowiedź AI zawsze w jednym języku sklepu.
    const requestedLocale =
      String(locale ?? "").toLowerCase().match(/^[a-z]{2}/)?.[0] || "pl";
    const shopLang = ["pl", "en"].includes(settings.language ?? "")
      ? (settings.language as string)
      : "pl";
    const responseLocale = caps.multilingual ? requestedLocale : shopLang;
    // Komunikaty widoczne dla kupującego — w języku odpowiedzi.
    const en = responseLocale === "en";
    const pick = (plMsg: string, enMsg: string) => (en ? enMsg : plMsg);

    if (!settings.isEnabled) {
      return data(
        {
          error: pick(
            "Asystent rozmiaru jest obecnie wyłączony.",
            "The size assistant is currently turned off.",
          ),
        },
        { status: 403 },
      );
    }

    if (settings.requestsUsed >= settings.monthlyLimit) {
      console.warn(
        `[recommend] limit wyczerpany ${shop} (${settings.requestsUsed}/${settings.monthlyLimit})`,
      );
      return data(
        {
          error: pick(
            "Asystent rozmiaru jest chwilowo niedostępny. Spróbuj później lub skorzystaj z tabeli rozmiarów przy produkcie.",
            "The size assistant is temporarily unavailable. Please try later or use the product's size chart.",
          ),
        },
        { status: 503 },
      );
    }

    const { provider, model } = getAIConfig();
    const apiKey =
      provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error(`Brak klucza API dla providera "${provider}".`);
      return data({ error: "Błąd konfiguracji klucza API po stronie serwera." }, { status: 500 });
    }

    const brandStyleNotes = settings.aiStyleNotes?.trim() || null;

    const productRule = numericProductId
      ? await db.productRule.findUnique({
          where: {
            shopId_productId: { shopId: settings.id, productId: numericProductId },
          },
        })
      : null;

    // Produkt zmapowany na współdzielony system rozmiarów → tabela i analiza
    // biorą się z systemu, nie z reguły produktu.
    const sizingSystem = productRule?.sizingSystemId
      ? await db.sizingSystem.findUnique({
          where: { id: productRule.sizingSystemId },
        })
      : null;
    const chartJson = sizingSystem
      ? sizingSystem.extractionJson
      : (productRule?.extractionJson ?? null);
    const chartVersion = sizingSystem
      ? sizingSystem.extractionVersion
      : productRule?.extractionVersion;
    const chartSizeData = sizingSystem
      ? sizingSystem.parsedSizeData
      : (productRule?.parsedSizeData ?? null);
    const chartNotes = sizingSystem
      ? sizingSystem.customNotes
      : (productRule?.customNotes ?? null);

    // Cache analizy dla produktów, których admin nie skonfigurował ręcznie.
    const productAnalysis =
      numericProductId && !productRule
        ? await db.productAnalysis.findUnique({
            where: {
              shopId_productId: { shopId: settings.id, productId: numericProductId },
            },
          })
        : null;

    const cacheKey = JSON.stringify({
      shop,
      provider,
      model,
      plan: settings.plan,
      locale: responseLocale,
      gender: gender || "unknown",
      height: Number(height),
      weight: Number(weight),
      bodyType: bodyType || "standard",
      fit: fit || "",
      ref: referenceGarment
        ? `${referenceGarment.brand}|${referenceGarment.size}`
        : "",
      productTitle: productTitle || "",
      productDescription: productDescription || "",
      brandStyleNotes: brandStyleNotes || "",
      productRuleUpdatedAt: productRule?.updatedAt?.toISOString() || "",
      sizingSystemUpdatedAt: sizingSystem?.updatedAt?.toISOString() || "",
    });

    let finalSize: string;
    let finalExplanation: string;
    let finalDetail: string;
    let finalNbSmaller: string | null = null;
    let finalNbLarger: string | null = null;
    let finalFitScale: FitScale | null = null;
    let finalSource: "chart" | "estimate" = "estimate";

    const decision = {
      height,
      weight,
      gender,
      bodyType,
      fit,
      locale: responseLocale,
      allowKorekta: Boolean(brandStyleNotes || chartNotes?.trim()),
      referenceGarment,
    };

    const cached = getCachedRecommendation(cacheKey);
    if (cached) {
      finalSize = cached.size;
      finalExplanation = cached.explanation;
      finalDetail = cached.detail;
      finalNbSmaller = cached.nbSmaller;
      finalNbLarger = cached.nbLarger;
      finalFitScale = cached.fitScale;
      finalSource = cached.source;
    } else if (
      // Gotowa analiza produktu z konfiguracji → decyzja bez wołania AI.
      // Pomijamy, gdy klient podał ubranie referencyjne (potrzebny świeży
      // „refRozmiarWTabeli”) albo gdy zmieniła się wersja logiki ekstrakcji.
      !referenceGarment &&
      chartJson &&
      chartVersion === EXTRACTION_VERSION &&
      parseStoredExtraction(chartJson)
    ) {
      const stored = parseStoredExtraction(chartJson)!;
      const decided = decideSize(stored, decision);
      finalSize = decided.size;
      finalExplanation = decided.explanation;
      finalDetail = decided.explanationDetail;
      finalNbSmaller = decided.neighborSmaller;
      finalNbLarger = decided.neighborLarger;
      finalFitScale = decided.fitScale;
      finalSource = decided.source;
      setCachedRecommendation(
        cacheKey,
        finalSize,
        finalExplanation,
        finalDetail,
        finalNbSmaller,
        finalNbLarger,
        finalFitScale,
        finalSource,
      );
    } else if (
      // Cache analizy produktu niekonfigurowanego → decyzja bez wołania AI.
      !referenceGarment &&
      productAnalysis &&
      productAnalysis.extractionVersion === EXTRACTION_VERSION &&
      Date.now() - productAnalysis.analyzedAt.getTime() < ANALYSIS_TTL_MS &&
      parseStoredExtraction(productAnalysis.extractionJson)
    ) {
      const stored = parseStoredExtraction(productAnalysis.extractionJson)!;
      const decided = decideSize(stored, decision);
      finalSize = decided.size;
      finalExplanation = decided.explanation;
      finalDetail = decided.explanationDetail;
      finalNbSmaller = decided.neighborSmaller;
      finalNbLarger = decided.neighborLarger;
      finalFitScale = decided.fitScale;
      finalSource = decided.source;
      setCachedRecommendation(
        cacheKey,
        finalSize,
        finalExplanation,
        finalDetail,
        finalNbSmaller,
        finalNbLarger,
        finalFitScale,
        finalSource,
      );
    } else {
      // Zdjęcie rozmiarówki tylko w planach z multimodalnym AI i tylko dla
      // produktu z własną tabelą (system rozmiarów jest tekstowy).
      const useImage =
        caps.sizeChartImageAI &&
        !sizingSystem &&
        Boolean(productRule?.sizeChartImage);

      const prompt = buildSizeAdvisorPrompt({
        productTitle: sizingSystem ? "" : productTitle,
        productDescription: sizingSystem ? "" : productDescription,
        gender,
        height,
        weight,
        bodyType,
        brandStyleNotes,
        productSizeData: chartSizeData,
        productNotes: chartNotes,
        hasSizeChartImage: useImage,
        fitPreference: fit,
        referenceGarment,
        responseLanguage: responseLocale,
      });

      let result;
      try {
        result = await callAI({
          model,
          prompt,
          sizeChartImage: useImage ? productRule?.sizeChartImage : null,
          decision,
        });
      } catch (err) {
        if (err instanceof AIQuotaError) {
          return data(
            {
              error: pick(
                "Asystent rozmiaru jest chwilowo przeciążony. Spróbuj za chwilę lub skorzystaj z tabeli rozmiarów przy produkcie.",
                "The size assistant is briefly overloaded. Please try again shortly or use the product's size chart.",
              ),
            },
            { status: 503 },
          );
        }
        return data(
          {
            error: pick(
              "Nie udało się teraz dobrać rozmiaru. Spróbuj ponownie później.",
              "Couldn't work out a size right now. Please try again later.",
            ),
          },
          { status: 502 },
        );
      }

      console.log("[recommend] AI", {
        shop,
        productId: numericProductId || null,
        model,
        promptTokens: result.promptTokenCount,
        outputTokens: result.candidatesTokenCount,
      });

      finalSize = result.size;
      finalExplanation = result.explanation;
      finalDetail = result.explanationDetail;
      finalNbSmaller = result.neighborSmaller;
      finalNbLarger = result.neighborLarger;
      finalFitScale = result.fitScale;
      finalSource = result.source;
      setCachedRecommendation(
        cacheKey,
        finalSize,
        finalExplanation,
        finalDetail,
        finalNbSmaller,
        finalNbLarger,
        finalFitScale,
        finalSource,
      );

      // Zapisz świeżą analizę produktu, żeby kolejne zapytania (tego i innych
      // klientów) nie wołały już modelu. Nie zapisujemy, gdy w prompt weszło
      // ubranie referencyjne klienta — JSON byłby „skażony”.
      // Produkt skonfigurowany przez admina → na regule; inaczej → do cache
      // ProductAnalysis (osobne od limitu planu i listy w panelu).
      if (!referenceGarment) {
        try {
          if (sizingSystem) {
            await db.sizingSystem.update({
              where: { id: sizingSystem.id },
              data: {
                extractionJson: JSON.stringify(result.rawJson),
                extractionAt: new Date(),
                extractionModel: model,
                extractionVersion: EXTRACTION_VERSION,
                extractionError: null,
              },
            });
          } else if (productRule) {
            await db.productRule.update({
              where: { id: productRule.id },
              data: {
                extractionJson: JSON.stringify(result.rawJson),
                extractionAt: new Date(),
                extractionModel: model,
                extractionVersion: EXTRACTION_VERSION,
                extractionError: null,
              },
            });
          } else if (numericProductId) {
            await db.productAnalysis.upsert({
              where: {
                shopId_productId: {
                  shopId: settings.id,
                  productId: numericProductId,
                },
              },
              create: {
                shopId: settings.id,
                productId: numericProductId,
                extractionJson: JSON.stringify(result.rawJson),
                extractionModel: model,
                extractionVersion: EXTRACTION_VERSION,
              },
              update: {
                extractionJson: JSON.stringify(result.rawJson),
                extractionModel: model,
                extractionVersion: EXTRACTION_VERSION,
                analyzedAt: new Date(),
              },
            });
          }
        } catch (e) {
          console.error("[recommend] nie zapisano analizy produktu", e);
        }
      }
    }

    const log = await db.advisorLog.create({
      data: {
        shopId: settings.id,
        productTitle: productTitle || "Odzież",
        customerHeight: Number(height),
        customerWeight: Number(weight),
        customerGender: gender || "unknown",
        bodyType: bodyType || "standard",
        recommendedSize: finalSize,
      },
    });

    // Trafienie w cache (ta sama sylwetka + produkt) nie kosztuje AI ani realnego
    // obliczenia — nie liczymy go do miesięcznego limitu. Dzięki temu funkcja
    // „Mój rozmiar" (przeglądanie znanych już produktów) nie zjada limitu sklepu.
    if (!cached) {
      await db.shopSettings.update({
        where: { id: settings.id },
        data: { requestsUsed: { increment: 1 } },
      });
    }

    return data({
      logId: log.id,
      size: finalSize,
      explanation: finalExplanation,
      explanationDetail: finalDetail,
      neighborSmaller: finalNbSmaller,
      neighborLarger: finalNbLarger,
      fitScale: finalFitScale,
      // "chart" = policzone z prawdziwej tabeli/analizy produktu; "estimate" =
      // zgrubny szacunek z samej sylwetki (brak rozmiarówki / produkt nieodzieżowy).
      source: finalSource,
    });
  } catch (error) {
    console.error("Endpoint Handler Error:", error);
    return data({ error: "Błąd przetwarzania rekomendacji." }, { status: 500 });
  }
};
