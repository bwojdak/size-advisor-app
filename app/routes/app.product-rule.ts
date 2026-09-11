import { type ActionFunctionArgs } from "react-router";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { requestT } from "../lib/i18n";
import { loadShopSettings } from "../lib/shop-settings.server";
import { PLAN, planCaps } from "../lib/plans";
import {
  extractProductChart,
  getAIConfig,
  EXTRACTION_VERSION,
  parseStructuredRows,
} from "../lib/size-advisor.server";

const MAX_IMAGE_CHARS = 3_600_000;
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/;

type RuleRow = {
  id: string;
  productId: string;
  productTitle: string | null;
  parsedSizeData: string | null;
  customNotes: string | null;
  sizeChartImage: string | null;
};

// Jednorazowa analiza produktu przez AI. Robimy ją przy zapisie / na żądanie,
// żeby zapytania klientów nie wołały już modelu. Best-effort: gdy się nie uda,
// zapisujemy błąd i lecimy dalej — analiza dorobi się leniwie przy zapytaniu.
async function runExtraction(
  admin: AdminApiContext,
  rule: RuleRow,
  opts: {
    brandStyleNotes: string | null;
    language: string | null;
    sizeChartImageAI: boolean;
  },
): Promise<boolean> {
  const { provider, model } = getAIConfig();
  const apiKey =
    provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) return false;

  let productDescription: string | null = null;
  try {
    const resp = await admin.graphql(
      `#graphql
      query SizeAdvisorRuleProduct($id: ID!) {
        product(id: $id) { description }
      }`,
      { variables: { id: `gid://shopify/Product/${rule.productId}` } },
    );
    const gql = await resp.json();
    productDescription = gql?.data?.product?.description ?? null;
  } catch (e) {
    console.error("[product-rule] nie pobrano opisu produktu", e);
  }

  const useImage = opts.sizeChartImageAI && Boolean(rule.sizeChartImage);
  try {
    const { rawJson } = await extractProductChart(model, {
      productTitle: rule.productTitle || null,
      productDescription,
      brandStyleNotes: opts.brandStyleNotes,
      productSizeData: rule.parsedSizeData || null,
      productNotes: rule.customNotes || null,
      sizeChartImage: useImage ? rule.sizeChartImage : null,
      hasSizeChartImage: useImage,
      responseLanguage: opts.language === "en" ? "en" : "pl",
    });
    await db.productRule.update({
      where: { id: rule.id },
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
    console.error("[product-rule] analiza produktu nie powiodła się", e);
    await db.productRule.update({
      where: { id: rule.id },
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
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const t = requestT(request);

  const settings = await loadShopSettings(shop);
  const caps = planCaps(settings.plan);

  const form = (await request.json()) as {
    intent?: string;
    productId?: string;
    productTitle?: string;
    customNotes?: string;
    parsedSizeData?: string;
    structuredSizeData?: string | null;
    sizeChartImage?: string | null;
  };

  const productId = String(form.productId || "").replace(/\D/g, "");
  if (!productId) {
    return Response.json({ error: t("error.noProduct") }, { status: 400 });
  }

  if (form.intent === "delete") {
    await db.productRule.deleteMany({
      where: { shopId: settings.id, productId },
    });
    return Response.json({ success: true, deleted: true });
  }

  const extractOpts = {
    brandStyleNotes: settings.aiStyleNotes ?? null,
    language: settings.language ?? null,
    sizeChartImageAI: caps.sizeChartImageAI,
  };

  // Ponowna analiza istniejącej reguły bez zmiany jej treści.
  if (form.intent === "reanalyze") {
    const existing = await db.productRule.findUnique({
      where: { shopId_productId: { shopId: settings.id, productId } },
    });
    if (!existing) {
      return Response.json({ error: t("error.noProduct") }, { status: 404 });
    }
    const analyzed = await runExtraction(admin, existing, extractOpts);
    return Response.json({ success: true, analyzed });
  }

  // Limit liczby skonfigurowanych produktów wg planu (dotyczy tylko NOWYCH).
  const existing = await db.productRule.findUnique({
    where: { shopId_productId: { shopId: settings.id, productId } },
  });
  if (!existing) {
    const count = await db.productRule.count({ where: { shopId: settings.id } });
    if (count >= caps.productRuleLimit) {
      return Response.json(
        {
          error:
            caps.productRuleLimit === 0
              ? t("gate.locked_from", { plan: PLAN.STARTER })
              : t("gate.products_limit_reached", {
                  n: caps.productRuleLimit,
                  plan: settings.plan,
                }),
        },
        { status: 403 },
      );
    }
  }

  let sizeChartImage: string | null = form.sizeChartImage ?? null;
  if (sizeChartImage && !IMAGE_DATA_URL.test(sizeChartImage)) {
    sizeChartImage = null;
  }
  // Zdjęcie rozmiarówki tylko w planach z multimodalnym AI — inaczej ignorujemy.
  if (sizeChartImage && !caps.sizeChartImageAI) {
    return Response.json({ error: t("gate.image_locked") }, { status: 403 });
  }
  if (sizeChartImage && sizeChartImage.length > MAX_IMAGE_CHARS) {
    return Response.json({ error: t("error.imageTooLarge") }, { status: 400 });
  }

  const structuredRows = parseStructuredRows(form.structuredSizeData ?? null);
  const payload = {
    productTitle: String(form.productTitle || "").slice(0, 255),
    customNotes: String(form.customNotes || "").slice(0, 1500),
    parsedSizeData: String(form.parsedSizeData || "").slice(0, 3000),
    structuredSizeData: structuredRows ? JSON.stringify(structuredRows) : null,
    sizeChartImage,
  };

  const rule = await db.productRule.upsert({
    where: { shopId_productId: { shopId: settings.id, productId } },
    update: payload,
    create: { shopId: settings.id, productId, ...payload },
  });

  // Konfiguracja admina zastępuje leniwy cache analizy dla tego produktu.
  await db.productAnalysis.deleteMany({
    where: { shopId: settings.id, productId },
  });

  const analyzed = await runExtraction(admin, rule, extractOpts);

  return Response.json({ success: true, analyzed });
};
