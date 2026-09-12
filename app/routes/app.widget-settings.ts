import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { PLAN, planCaps } from "../lib/plans";
import { requestT } from "../lib/i18n";

// Zapis ustawień widżetu sterowanych z panelu (na razie: pytanie o preferencję
// dopasowania). Wołane fetch-em z tokenem App Bridge z app.settings.tsx.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = requestT(request);

  const settings = await loadShopSettings(session.shop);
  const caps = planCaps(settings.plan);

  const body = (await request.json()) as {
    askFitPreference?: boolean;
    askGarmentMatch?: boolean;
    widgetLanguage?: string;
    widgetCustomCss?: string;
    baselineReturnRate?: number | string | null;
  };

  const data: {
    askFitPreference?: boolean;
    askGarmentMatch?: boolean;
    widgetLanguage?: string;
    widgetCustomCss?: string | null;
    baselineReturnRate?: number | null;
  } = {};

  if (typeof body.askFitPreference === "boolean") {
    if (body.askFitPreference && !caps.fitPreference) {
      return Response.json(
        { error: t("gate.locked_from", { plan: PLAN.STARTER }) },
        { status: 403 },
      );
    }
    data.askFitPreference = body.askFitPreference;
  }

  if (typeof body.askGarmentMatch === "boolean") {
    if (body.askGarmentMatch && !caps.garmentMatch) {
      return Response.json(
        { error: t("gate.locked_from", { plan: PLAN.STARTER }) },
        { status: 403 },
      );
    }
    data.askGarmentMatch = body.askGarmentMatch;
  }

  if (typeof body.widgetLanguage === "string") {
    const lang = body.widgetLanguage.toLowerCase();
    if (!["auto", "pl", "en"].includes(lang)) {
      return Response.json({ error: t("error.status", { status: 400 }) }, { status: 400 });
    }
    data.widgetLanguage = lang;
  }

  if (typeof body.widgetCustomCss === "string") {
    if (!caps.customCss) {
      return Response.json(
        { error: t("gate.locked_from", { plan: PLAN.STARTER }) },
        { status: 403 },
      );
    }
    // Wstrzykiwane do <style> na storefroncie przez textContent (bez parsowania
    // HTML), więc znaczniki nie zadziałają — ale i tak je usuwamy, a dodatkowo
    // blokujemy wektory czysto-CSS: @import (ładowanie zdalne), expression()
    // (stary IE) i url(javascript:) .
    const css = body.widgetCustomCss
      .slice(0, 8000)
      .replace(/<\/?(script|\/?style)/gi, "")
      .replace(/@import\b/gi, "/* blocked */")
      .replace(/\bexpression\s*\(/gi, "blocked(")
      .replace(/url\(\s*(['"]?)\s*javascript:/gi, "url($1");
    data.widgetCustomCss = css.trim() || null;
  }

  if (body.baselineReturnRate !== undefined) {
    if (!caps.conversionAnalytics) {
      return Response.json(
        { error: t("gate.locked_from", { plan: PLAN.STARTER }) },
        { status: 403 },
      );
    }
    // Merchant wpisuje procent (0–100). Trzymamy jako ułamek 0–1; puste = null.
    const raw =
      body.baselineReturnRate === null || body.baselineReturnRate === ""
        ? null
        : Number(body.baselineReturnRate);
    data.baselineReturnRate =
      raw != null && Number.isFinite(raw) && raw > 0 && raw <= 100
        ? Math.round((raw / 100) * 1000) / 1000
        : null;
  }

  const updated = await db.shopSettings.update({
    where: { id: settings.id },
    data,
  });

  return Response.json({
    success: true,
    askFitPreference: updated.askFitPreference,
    askGarmentMatch: updated.askGarmentMatch,
    widgetLanguage: updated.widgetLanguage,
    widgetCustomCss: updated.widgetCustomCss ?? "",
    baselineReturnRate: updated.baselineReturnRate,
  });
};
