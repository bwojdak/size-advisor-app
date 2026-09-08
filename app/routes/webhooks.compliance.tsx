import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Obowiązkowe webhooki zgodności Shopify (GDPR):
// customers/data_request, customers/redact, shop/redact.
// Aplikacja NIE przechowuje danych osobowych klienta (imię/e-mail/adres).
// AdvisorLog trzyma tylko parametry sylwetki podane przez kupującego oraz
// `orderId` — bez powiązania z tożsamością klienta.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic === "SHOP_REDACT") {
    // 48h po odinstalowaniu — usuń wszystkie dane sklepu.
    await db.session.deleteMany({ where: { shop } });
    // Kaskada usuwa ProductRule i AdvisorLog.
    await db.shopSettings.deleteMany({ where: { shop } });
    console.log(`[compliance] shop/redact — usunięto dane sklepu ${shop}`);
    return new Response();
  }

  if (topic === "CUSTOMERS_REDACT") {
    // Skasuj wpisy rekomendacji powiązane ze wskazanymi zamówieniami.
    const orderIds: string[] = (
      (payload as { orders_to_redact?: Array<number | string> }).orders_to_redact ?? []
    ).map((id) => String(id));

    if (orderIds.length) {
      const settings = await db.shopSettings.findUnique({ where: { shop } });
      if (settings) {
        const res = await db.advisorLog.deleteMany({
          where: { shopId: settings.id, orderId: { in: orderIds } },
        });
        console.log(
          `[compliance] customers/redact — ${shop}: usunięto ${res.count} wpisów dla zamówień ${orderIds.join(", ")}`,
        );
      }
    }
    return new Response();
  }

  if (topic === "CUSTOMERS_DATA_REQUEST") {
    // Nie przechowujemy danych osobowych klienta — nie ma czego zwrócić.
    console.log(
      `[compliance] customers/data_request — ${shop}: brak danych osobowych klienta w aplikacji`,
    );
    return new Response();
  }

  return new Response();
};
