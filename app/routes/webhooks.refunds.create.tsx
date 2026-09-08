import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Zwrot / refund na zamówieniu. Jeśli zamówienie było przypisane do rekomendacji
// (webhook orders/create wpisał `orderId` na AdvisorLog), oznaczamy je jako
// zwrócone — do liczenia realnego wskaźnika zwrotów w Analityce.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  if (topic !== "REFUNDS_CREATE") {
    return new Response();
  }

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    return new Response();
  }

  const p = payload as { order_id?: number | string };
  const orderId = String(p.order_id ?? "");
  if (!orderId) {
    return new Response();
  }

  const result = await db.advisorLog.updateMany({
    where: {
      shopId: settings.id,
      orderId,
      purchased: true,
      returned: false,
    },
    data: { returned: true, returnedAt: new Date() },
  });

  if (result.count > 0) {
    console.log(
      `[refunds/create] ${shop} zamówienie ${orderId}: oznaczono ${result.count} rekomendacji jako zwrócone.`,
    );
  }

  return new Response();
};
