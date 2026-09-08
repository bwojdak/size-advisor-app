import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await loadShopSettings(session.shop);

  const body = (await request.json()) as { aiStyleNotes?: unknown };
  const aiStyleNotes = String(body.aiStyleNotes || "").slice(0, 500);

  const updated = await db.shopSettings.update({
    where: { id: settings.id },
    data: { aiStyleNotes },
  });

  // Styl marki wpływa na klasyfikację kroju i korektę rozmiaru, więc zmiana
  // unieważnia zapisane analizy produktów — przeliczą się leniwie.
  if ((settings.aiStyleNotes ?? "") !== aiStyleNotes) {
    await db.productRule.updateMany({
      where: { shopId: settings.id },
      data: { extractionJson: null, extractionVersion: null, extractionError: null },
    });
    await db.productAnalysis.deleteMany({ where: { shopId: settings.id } });
  }

  return Response.json({ success: true, aiStyleNotes: updated.aiStyleNotes });
};
