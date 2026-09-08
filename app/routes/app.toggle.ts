import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await loadShopSettings(session.shop);

  const body = (await request.json()) as { isEnabled?: unknown };
  const updated = await db.shopSettings.update({
    where: { id: settings.id },
    data: { isEnabled: Boolean(body.isEnabled) },
  });

  return Response.json({ success: true, isEnabled: updated.isEnabled });
};
