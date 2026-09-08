import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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

  try {
    const rawText = await request.text();
    const { logId } = JSON.parse(rawText || "{}");

    if (!logId || typeof logId !== "string") {
      return data({ error: "Brak identyfikatora rekomendacji." }, { status: 400 });
    }

    const settings = await db.shopSettings.findUnique({ where: { shop: session.shop } });
    if (!settings) {
      return data({ error: "Sklep nie jest skonfigurowany." }, { status: 400 });
    }

    // Only flip logs that belong to this shop and haven't been counted yet,
    // so repeated clicks / retries can't inflate the number.
    const result = await db.advisorLog.updateMany({
      where: { id: logId, shopId: settings.id, addedToCart: false },
      data: { addedToCart: true },
    });

    return data({ success: true, counted: result.count > 0 });
  } catch (error) {
    console.error("Accept Endpoint Error:", error);
    return data({ error: "Błąd zapisu zdarzenia." }, { status: 500 });
  }
};
