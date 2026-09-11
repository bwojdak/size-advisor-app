import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { planCaps } from "../lib/plans";
import {
  parseStoredExtraction,
  applyStructuredRows,
  emptyExtraction,
  EXTRACTION_VERSION,
  type NormalizedSizeRow,
} from "../lib/size-advisor.server";

// Widżet czyta ten status przy każdym otwarciu strony — nie wolno go cache'ować,
// inaczej wyłączenie w panelu nie zadziała, dopóki cache nie wygaśnie.
const NO_CACHE = { headers: { "Cache-Control": "no-store, max-age=0" } };

const GARMENT_DIM_KEYS = ["chest", "waist", "hip", "length", "inseam"] as const;

// Które wymiary mają sens dla kategorii produktu — musi zostać w sync z
// `DIMS_BY_CATEGORY` w app/components/SizeGrid.tsx (tam samo dla panelu).
// Koszulka (top) nie pyta o pas/biodra/nogawkę, nawet jeśli w zapisanej
// tabeli zalągł się stary, uśpiony wpis z błędnej analizy AI.
const DIMS_BY_CATEGORY: Record<string, readonly string[]> = {
  top: ["chest", "length"],
  bottom: ["waist", "hip", "inseam", "length"],
  dress: ["chest", "waist", "length"],
};

/** Które wymiary ma tabela produktu — do pól ubrania referencyjnego w widżecie
 *  (pytamy TYLKO o to, co tabela faktycznie zawiera I co pasuje do kategorii).
 *  Wymaga ≥2 wierszy z wartością i realnego rozrzutu (≥1 cm) — jak `spread()`
 *  w silniku. */
function garmentDimsOf(rows: NormalizedSizeRow[], category: string): string[] {
  const allowed = DIMS_BY_CATEGORY[category] ?? GARMENT_DIM_KEYS;
  return GARMENT_DIM_KEYS.filter((key) => {
    if (!allowed.includes(key)) return false;
    const vals = rows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === "number" && v > 0);
    return vals.length >= 2 && Math.max(...vals) - Math.min(...vals) >= 1;
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return data(
      { enabled: false, addToCart: false, poweredBy: true, fitPreference: false },
      NO_CACHE,
    );
  }

  try {
    const settings = await db.shopSettings.findUnique({
      where: { shop: session.shop },
    });

    const caps = planCaps(settings?.plan);
    const garmentMatch = Boolean(settings?.askGarmentMatch && caps.garmentMatch);

    // Wymiary, o które widżet może zapytać dla TEGO produktu (pola ubrania
    // referencyjnego) — tylko gdy funkcja włączona i mamy jakąkolwiek tabelę.
    let garmentDims: string[] = [];
    const productId = new URL(request.url).searchParams
      .get("productId")
      ?.replace(/\D/g, "");
    if (garmentMatch && settings && productId) {
      const productRule = await db.productRule.findUnique({
        where: { shopId_productId: { shopId: settings.id, productId } },
        select: {
          extractionJson: true,
          extractionVersion: true,
          structuredSizeData: true,
          sizingSystemId: true,
        },
      });
      const sizingSystem = productRule?.sizingSystemId
        ? await db.sizingSystem.findUnique({
            where: { id: productRule.sizingSystemId },
            select: {
              extractionJson: true,
              extractionVersion: true,
              structuredSizeData: true,
            },
          })
        : null;
      const chartJson = sizingSystem
        ? sizingSystem.extractionJson
        : productRule?.extractionJson;
      const chartVersion = sizingSystem
        ? sizingSystem.extractionVersion
        : productRule?.extractionVersion;
      const chartStructured = sizingSystem
        ? sizingSystem.structuredSizeData
        : productRule?.structuredSizeData;
      if (chartStructured || (chartJson && chartVersion === EXTRACTION_VERSION)) {
        const base =
          chartJson && chartVersion === EXTRACTION_VERSION
            ? parseStoredExtraction(chartJson)
            : null;
        const extraction = applyStructuredRows(base ?? emptyExtraction(), chartStructured);
        garmentDims = garmentDimsOf(extraction.rows, extraction.category);
      }
    }

    // Świeżo zainstalowana apka nie ma jeszcze wiersza ShopSettings — domyślnie
    // włączona (żeby przycisk pojawił się od razu), plan free.
    return data({
      enabled: settings ? settings.isEnabled : true,
      addToCart: caps.addToCartButton,
      poweredBy: !caps.removeBranding,
      fitPreference: Boolean(settings?.askFitPreference && caps.fitPreference),
      garmentMatch,
      // Puste = ta tabela nie ma z czym porównać ubranie referencyjne (brak
      // tabeli, albo produkt nieodzieżowy) → widżet chowa sekcję.
      garmentDims,
      // „Mój rozmiar: X" bez ponownego wypełniania — auto-przeliczenie dla
      // nowych produktów tylko na planach z tą funkcją (patrz planCaps).
      autoSize: caps.autoSize,
      // Efektywny domyślny język widżetu: wybór admina dla widżetu, a przy
      // "auto" — język ustawiony dla aplikacji (ten sam, którego api.recommend
      // używa dla odpowiedzi na planach bez wielojęzyczności). Dzięki temu
      // etykiety i tekst rekomendacji są w tym samym języku.
      widgetLang:
        settings?.widgetLanguage === "pl" || settings?.widgetLanguage === "en"
          ? settings.widgetLanguage
          : settings?.language === "pl" || settings?.language === "en"
            ? settings.language
            : "auto",
      // Kupujący może przełączać język w widżecie tylko na planie z wielojęzycznością.
      langSwitch: caps.multilingual,
      customCss:
        caps.customCss && settings?.widgetCustomCss
          ? settings.widgetCustomCss
          : "",
    }, NO_CACHE);
  } catch (error) {
    console.error("Status Endpoint Error:", error);
    return data(
      { enabled: false, addToCart: false, poweredBy: true, fitPreference: false },
      NO_CACHE,
    );
  }
};
