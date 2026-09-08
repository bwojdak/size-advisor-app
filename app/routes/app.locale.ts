import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { requestT } from "../lib/i18n";

const ALLOWED = new Set(["auto", "pl", "en"]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = requestT(request);

  const body = (await request.json()) as { language?: unknown };
  const language = String(body.language || "auto");
  if (!ALLOWED.has(language)) {
    return Response.json({ error: t("error.status", { status: 400 }) }, { status: 400 });
  }

  const settings = await loadShopSettings(session.shop);
  const updated = await db.shopSettings.update({
    where: { id: settings.id },
    data: { language },
  });

  return Response.json({ success: true, language: updated.language });
};
