import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { planCaps } from "../lib/plans";

// Widżet czyta ten status przy każdym otwarciu strony — nie wolno go cache'ować,
// inaczej wyłączenie w panelu nie zadziała, dopóki cache nie wygaśnie.
const NO_CACHE = { headers: { "Cache-Control": "no-store, max-age=0" } };

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

    // Świeżo zainstalowana apka nie ma jeszcze wiersza ShopSettings — domyślnie
    // włączona (żeby przycisk pojawił się od razu), plan free.
    return data({
      enabled: settings ? settings.isEnabled : true,
      addToCart: caps.addToCartButton,
      poweredBy: !caps.removeBranding,
      fitPreference: Boolean(settings?.askFitPreference && caps.fitPreference),
      garmentMatch: Boolean(settings?.askGarmentMatch && caps.garmentMatch),
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
