import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { requestT } from "../lib/i18n";
import { loadShopSettings } from "../lib/shop-settings.server";
import {
  extractProductChart,
  getAIConfig,
  EXTRACTION_VERSION,
} from "../lib/size-advisor.server";

type SystemRow = {
  id: string;
  name: string;
  parsedSizeData: string | null;
  customNotes: string | null;
};

// Analiza AI systemu rozmiarów. Bez opisu produktu (system nie jest przypięty
// do jednego produktu) — czytamy wyłącznie z wklejonej tabeli i notatek.
async function runSystemExtraction(
  system: SystemRow,
  opts: { brandStyleNotes: string | null; language: string | null },
): Promise<boolean> {
  const { provider, model } = getAIConfig();
  const apiKey =
    provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) return false;

  try {
    const { rawJson } = await extractProductChart(model, {
      productTitle: system.name || null,
      productDescription: null,
      brandStyleNotes: opts.brandStyleNotes,
      productSizeData: system.parsedSizeData || null,
      productNotes: system.customNotes || null,
      sizeChartImage: null,
      hasSizeChartImage: false,
      responseLanguage: opts.language === "en" ? "en" : "pl",
    });
    await db.sizingSystem.update({
      where: { id: system.id },
      data: {
        extractionJson: JSON.stringify(rawJson),
        extractionAt: new Date(),
        extractionModel: model,
        extractionVersion: EXTRACTION_VERSION,
        extractionError: null,
      },
    });
    return true;
  } catch (e) {
    console.error("[sizing-system] analiza nie powiodła się", e);
    await db.sizingSystem.update({
      where: { id: system.id },
      data: {
        extractionJson: null,
        extractionError: e instanceof Error ? e.message : "unknown",
        extractionVersion: null,
      },
    });
    return false;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = requestT(request);
  const settings = await loadShopSettings(session.shop);

  const form = (await request.json()) as {
    intent?: string;
    id?: string;
    name?: string;
    customNotes?: string;
    parsedSizeData?: string;
  };

  const extractOpts = {
    brandStyleNotes: settings.aiStyleNotes ?? null,
    language: settings.language ?? null,
  };

  if (form.intent === "delete") {
    if (!form.id) return Response.json({ error: t("error.status", { status: 400 }) }, { status: 400 });
    // Zerwij przypisania i usuń system.
    await db.productRule.updateMany({
      where: { shopId: settings.id, sizingSystemId: form.id },
      data: { sizingSystemId: null },
    });
    await db.sizingSystem.deleteMany({ where: { id: form.id, shopId: settings.id } });
    return Response.json({ success: true, deleted: true });
  }

  if (form.intent === "reanalyze") {
    const existing = form.id
      ? await db.sizingSystem.findFirst({
          where: { id: form.id, shopId: settings.id },
        })
      : null;
    if (!existing) {
      return Response.json({ error: t("error.status", { status: 404 }) }, { status: 404 });
    }
    const analyzed = await runSystemExtraction(existing, extractOpts);
    return Response.json({ success: true, analyzed });
  }

  const name = String(form.name || "").trim().slice(0, 80);
  if (!name) {
    return Response.json({ error: t("sizingSystems.error.name") }, { status: 400 });
  }
  const payload = {
    name,
    customNotes: String(form.customNotes || "").slice(0, 1500),
    parsedSizeData: String(form.parsedSizeData || "").slice(0, 3000),
  };

  // Kolizja nazwy z innym systemem tego sklepu.
  const clash = await db.sizingSystem.findFirst({
    where: {
      shopId: settings.id,
      name,
      ...(form.id ? { NOT: { id: form.id } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    return Response.json({ error: t("sizingSystems.error.dupe") }, { status: 409 });
  }

  const system = form.id
    ? await db.sizingSystem.update({
        where: { id: form.id },
        data: payload,
      })
    : await db.sizingSystem.create({
        data: { shopId: settings.id, ...payload },
      });

  const analyzed = await runSystemExtraction(system, extractOpts);
  return Response.json({ success: true, id: system.id, analyzed });
};
