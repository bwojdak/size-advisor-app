import { type ChangeEvent, useCallback, useMemo, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRevalidator } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  DropZone,
  InlineStack,
  Layout,
  Modal,
  Page,
  ResourceItem,
  ResourceList,
  Select,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { PLAN, planCaps, UNLIMITED } from "../lib/plans";
import { useI18n, type Locale } from "../lib/i18n";
import { LockedFeature } from "../components/LockedFeature";
import {
  parseStoredExtraction,
  describeExtraction,
  EXTRACTION_VERSION,
} from "../lib/size-advisor.server";

type ExtractionInfo =
  | { state: "ok"; at: string | null; summary: ReturnType<typeof describeExtraction> }
  | { state: "error"; message: string }
  | { state: "pending" };

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;

function toast(message: string, isError = false) {
  const api = (
    window as unknown as {
      shopify?: { toast?: { show: (m: string, o?: { isError?: boolean }) => void } };
    }
  ).shopify;
  api?.toast?.show(message, { isError });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await loadShopSettings(session.shop);
  const caps = planCaps(settings.plan);

  const rules = await db.productRule.findMany({
    where: { shopId: settings.id },
    orderBy: { updatedAt: "desc" },
  });

  const sizingSystems = await db.sizingSystem.findMany({
    where: { shopId: settings.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const products: Record<
    string,
    { title: string; image: string | null; status: string | null }
  > = {};

  if (rules.length) {
    const ids = rules.map((r) => `gid://shopify/Product/${r.productId}`);
    const resp = await admin.graphql(
      `#graphql
      query SizeAdvisorRuleProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            status
            featuredImage { url }
          }
        }
      }`,
      { variables: { ids } },
    );
    const body = await resp.json();
    for (const node of body?.data?.nodes ?? []) {
      if (!node?.id) continue;
      const numericId = String(node.id).split("/").pop() as string;
      products[numericId] = {
        title: node.title,
        image: node.featuredImage?.url ?? null,
        status: node.status ?? null,
      };
    }
  }

  const extractions: Record<string, ExtractionInfo> = {};
  for (const r of rules) {
    if (r.extractionError) {
      extractions[r.productId] = { state: "error", message: r.extractionError };
      continue;
    }
    const parsed =
      r.extractionVersion === EXTRACTION_VERSION
        ? parseStoredExtraction(r.extractionJson)
        : null;
    extractions[r.productId] = parsed
      ? {
          state: "ok",
          at: r.extractionAt ? r.extractionAt.toISOString() : null,
          summary: describeExtraction(parsed),
        }
      : { state: "pending" };
  }

  return {
    rules,
    products,
    extractions,
    sizingSystems,
    plan: settings.plan,
    productLimit: caps.productRuleLimit,
    sizeChartImageAI: caps.sizeChartImageAI,
    bulkImport: caps.bulkImport,
  };
};

type Editing = { productId: string; title: string } | null;

async function submitRule(body: Record<string, unknown>, locale: Locale) {
  const api = (window as unknown as { shopify?: { idToken: () => Promise<string> } }).shopify;
  const token = api ? await api.idToken() : null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/app/product-rule?locale=${locale}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || "");
  }
  return json;
}

export default function ProductsConfig() {
  const {
    rules,
    products,
    extractions,
    sizingSystems,
    plan,
    productLimit,
    sizeChartImageAI,
    bulkImport,
  } = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const revalidator = useRevalidator();
  const [reanalyzing, setReanalyzing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const onImportClick = () => {
    if (!bulkImport) {
      toast(t("gate.locked_from", { plan: "Pro" }), true);
      return;
    }
    fileInputRef.current?.click();
  };

  const onTemplateClick = async () => {
    if (!bulkImport) {
      toast(t("gate.locked_from", { plan: "Pro" }), true);
      return;
    }
    setTemplateBusy(true);
    try {
      const api = (
        window as unknown as { shopify?: { idToken: () => Promise<string> } }
      ).shopify;
      const token = api ? await api.idToken() : null;
      const res = await fetch(`/app/product-rule-template?locale=${locale}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `size-advisor-import-template-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(
        err instanceof Error && err.message
          ? err.message
          : t("products.error.saveFailed"),
        true,
      );
    } finally {
      setTemplateBusy(false);
    }
  };

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const csv = await file.text();
      const api = (
        window as unknown as { shopify?: { idToken: () => Promise<string> } }
      ).shopify;
      const token = api ? await api.idToken() : null;
      const res = await fetch(`/app/product-rule-import?locale=${locale}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ csv }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || t("products.error.saveFailed"));
      toast(t("products.import.done", { n: json.count ?? 0 }));
      revalidator.revalidate();
    } catch (err) {
      toast(
        err instanceof Error && err.message
          ? err.message
          : t("products.error.saveFailed"),
        true,
      );
    } finally {
      setImporting(false);
    }
  };

  const [editing, setEditing] = useState<Editing>(null);
  const [notes, setNotes] = useState("");
  const [sizeText, setSizeText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rulesById = useMemo(
    () => new Map(rules.map((r) => [r.productId, r])),
    [rules],
  );

  const [search, setSearch] = useState("");
  const titleOf = useCallback(
    (r: (typeof rules)[number]) =>
      products[r.productId]?.title ||
      r.productTitle ||
      t("products.item.fallback", { id: r.productId }),
    [products, t],
  );
  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) =>
        titleOf(r).toLowerCase().includes(q) || r.productId.includes(q),
    );
  }, [rules, search, titleOf]);

  const openEditor = useCallback(
    (productId: string, title: string) => {
      const existing = rulesById.get(productId);
      setEditing({ productId, title });
      setNotes(existing?.customNotes || "");
      setSizeText(existing?.parsedSizeData || "");
      setImage(existing?.sizeChartImage || null);
      setImageError(null);
      setActionError(null);
    },
    [rulesById],
  );

  const openPicker = useCallback(async () => {
    const api = (window as unknown as {
      shopify?: {
        resourcePicker: (opts: {
          type: string;
          action?: string;
          multiple?: boolean;
        }) => Promise<Array<{ id: string; title: string }> | undefined>;
      };
    }).shopify;
    if (!api?.resourcePicker) return;

    const selection = await api.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
    });
    const picked = selection?.[0];
    if (!picked) return;

    const numericId = String(picked.id).split("/").pop() as string;
    openEditor(numericId, picked.title);
  }, [openEditor]);

  const handleDrop = useCallback(
    (_files: File[], accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      if (file.size > MAX_IMAGE_BYTES) {
        setImageError(t("products.error.tooLarge"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setImage(String(reader.result));
        setImageError(null);
      };
      reader.readAsDataURL(file);
    },
    [t],
  );

  const save = useCallback(async () => {
    if (!editing) return;
    setBusy("save");
    setActionError(null);
    try {
      await submitRule(
        {
          intent: "save",
          productId: editing.productId,
          productTitle: editing.title,
          customNotes: notes,
          parsedSizeData: sizeText,
          sizeChartImage: image,
        },
        locale,
      );
      setEditing(null);
      toast(t("products.saved"));
      revalidator.revalidate();
    } catch (err) {
      setActionError(
        err instanceof Error && err.message ? err.message : t("products.error.saveFailed"),
      );
    } finally {
      setBusy(null);
    }
  }, [editing, notes, sizeText, image, revalidator, locale, t]);

  const removeRule = useCallback(async () => {
    if (!editing) return;
    setBusy("delete");
    setActionError(null);
    try {
      await submitRule({ intent: "delete", productId: editing.productId }, locale);
      setEditing(null);
      toast(t("products.deleted"));
      revalidator.revalidate();
    } catch (err) {
      setActionError(
        err instanceof Error && err.message ? err.message : t("products.error.deleteFailed"),
      );
    } finally {
      setBusy(null);
    }
  }, [editing, revalidator, locale, t]);

  const reanalyze = useCallback(async () => {
    if (!editing) return;
    setReanalyzing(true);
    setActionError(null);
    try {
      const res = await submitRule(
        { intent: "reanalyze", productId: editing.productId },
        locale,
      );
      toast(
        res?.analyzed ? t("products.extraction.reanalyzed") : t("products.extraction.reanalyzeFailed"),
        !res?.analyzed,
      );
      revalidator.revalidate();
    } catch (err) {
      setActionError(
        err instanceof Error && err.message
          ? err.message
          : t("products.extraction.reanalyzeFailed"),
      );
    } finally {
      setReanalyzing(false);
    }
  }, [editing, locale, revalidator, t]);

  const currentSystemId =
    editing && rulesById.get(editing.productId)?.sizingSystemId
      ? (rulesById.get(editing.productId)!.sizingSystemId as string)
      : "";

  const mapToSystem = useCallback(
    async (systemId: string) => {
      if (!editing) return;
      setBusy("save");
      setActionError(null);
      try {
        const api = (
          window as unknown as { shopify?: { idToken: () => Promise<string> } }
        ).shopify;
        const token = api ? await api.idToken() : null;
        const res = await fetch(`/app/product-map?locale=${locale}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            products: [{ id: editing.productId, title: editing.title }],
            sizingSystemId: systemId || null,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "");
        setEditing(null);
        toast(t("products.saved"));
        revalidator.revalidate();
      } catch (err) {
        setActionError(
          err instanceof Error && err.message
            ? err.message
            : t("products.error.saveFailed"),
        );
      } finally {
        setBusy(null);
      }
    },
    [editing, locale, revalidator, t],
  );

  const isNewRule = editing !== null && !rulesById.has(editing.productId);
  const ruleEmpty = !notes.trim() && !sizeText.trim() && !image;
  const editingExtraction =
    editing && rulesById.has(editing.productId)
      ? extractions[editing.productId]
      : undefined;

  const atLimit = rules.length >= productLimit;
  const limitLabel =
    productLimit >= UNLIMITED
      ? null
      : `${rules.length} / ${productLimit}`;

  const locked = productLimit === 0;

  const mainLayout = (
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {t("products.configured.title")}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("products.configured.desc")}
                  </Text>
                </BlockStack>
                {limitLabel ? (
                  <Badge tone={atLimit ? "warning" : undefined}>{limitLabel}</Badge>
                ) : null}
              </InlineStack>
            </Box>
            {atLimit ? (
              <Box paddingInline="400" paddingBlockStart="300">
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("gate.products_limit_reached", { n: productLimit, plan })}{" "}
                  <Link to="/app/plans" style={{ fontWeight: 600 }}>
                    {t("gate.see_plans")}
                  </Link>
                </Text>
              </Box>
            ) : null}

            {rules.length === 0 ? (
              <Box padding="600">
                <BlockStack gap="300" inlineAlign="center">
                  <Text as="p" tone="subdued" alignment="center">
                    {t("products.empty")}
                  </Text>
                  <Button variant="primary" onClick={openPicker}>
                    {t("products.addFirst")}
                  </Button>
                </BlockStack>
              </Box>
            ) : (
              <>
                <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                  <TextField
                    label={t("products.search.label")}
                    labelHidden
                    placeholder={t("products.search.placeholder")}
                    value={search}
                    onChange={setSearch}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearch("")}
                  />
                </Box>
                {filteredRules.length === 0 ? (
                  <Box padding="500">
                    <Text as="p" tone="subdued" alignment="center">
                      {t("products.search.none")}
                    </Text>
                  </Box>
                ) : (
              <ResourceList
                resourceName={{
                  singular: t("products.resource.singular"),
                  plural: t("products.resource.plural"),
                }}
                items={filteredRules}
                renderItem={(rule) => {
                  const product = products[rule.productId];
                  const title =
                    product?.title ||
                    rule.productTitle ||
                    t("products.item.fallback", { id: rule.productId });
                  return (
                    <ResourceItem
                      id={rule.productId}
                      accessibilityLabel={t("products.item.aria", { title })}
                      onClick={() => openEditor(rule.productId, title)}
                      media={
                        product?.image ? (
                          <Thumbnail source={product.image} alt={title} size="small" />
                        ) : undefined
                      }
                    >
                      <BlockStack gap="150">
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          {title}
                        </Text>
                        <InlineStack gap="150">
                          {rule.customNotes ? (
                            <Badge tone="info">{t("products.badge.notes")}</Badge>
                          ) : null}
                          {rule.parsedSizeData ? (
                            <Badge tone="info">{t("products.badge.sizeTable")}</Badge>
                          ) : null}
                          {rule.sizeChartImage ? (
                            <Badge tone="info">{t("products.badge.image")}</Badge>
                          ) : null}
                          {!rule.customNotes &&
                          !rule.parsedSizeData &&
                          !rule.sizeChartImage ? (
                            <Badge>{t("products.badge.empty")}</Badge>
                          ) : null}
                          {product?.status && product.status !== "ACTIVE" ? (
                            <Badge tone="warning">{t("products.badge.inactive")}</Badge>
                          ) : null}
                        </InlineStack>
                      </BlockStack>
                    </ResourceItem>
                  );
                }}
              />
                )}
              </>
            )}
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("products.aside.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("products.aside.intro")}
              </Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  <b>{t("products.field.notes.label")}</b> — {t("products.aside.notes")}
                </Text>
                <Text as="p" variant="bodySm">
                  <b>{t("products.badge.sizeTable")}</b> — {t("products.aside.sizeTable")}
                </Text>
                <Text as="p" variant="bodySm">
                  <b>{t("products.field.image.label")}</b> — {t("products.aside.image")}
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
  );

  return (
    <Page
      title={t("products.title")}
      subtitle={t("products.subtitle")}
      primaryAction={{
        content: t("products.addProduct"),
        onAction: openPicker,
        disabled: atLimit || locked,
      }}
      actionGroups={
        locked
          ? undefined
          : [
              {
                title: t("common.moreActions"),
                actions: [
                  {
                    content: t("products.import.template"),
                    onAction: onTemplateClick,
                    disabled: templateBusy,
                  },
                  {
                    content: t("products.import.button"),
                    onAction: onImportClick,
                    disabled: importing,
                  },
                ],
              },
            ]
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={onImportFile}
      />
      {locked ? (
        <LockedFeature note={t("gate.locked_from", { plan: PLAN.STARTER })}>
          {mainLayout}
        </LockedFeature>
      ) : (
        mainLayout
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.title ?? t("products.modal.titleFallback")}
        primaryAction={{
          content: t("products.modal.save"),
          onAction: save,
          loading: busy === "save",
          disabled:
            busy === "delete" ||
            Boolean(currentSystemId) ||
            (isNewRule && ruleEmpty),
        }}
        secondaryActions={
          rulesById.has(editing?.productId ?? "")
            ? [
                {
                  content: t("products.modal.delete"),
                  destructive: true,
                  onAction: removeRule,
                  loading: busy === "delete",
                  disabled: busy === "save",
                },
              ]
            : undefined
        }
      >
        <Modal.Section>
          <BlockStack gap="400">
            {actionError ? (
              <Text as="p" tone="critical" variant="bodySm">
                {actionError}
              </Text>
            ) : null}

            {sizingSystems.length > 0 ? (
              <Select
                label={t("sizingSystems.pickerLabel")}
                options={[
                  { label: t("sizingSystems.pickerNone"), value: "" },
                  ...sizingSystems.map((s) => ({ label: s.name, value: s.id })),
                ]}
                value={currentSystemId}
                onChange={mapToSystem}
                disabled={busy !== null}
                helpText={
                  currentSystemId
                    ? t("sizingSystems.usingSystem", {
                        name:
                          sizingSystems.find((s) => s.id === currentSystemId)
                            ?.name ?? "",
                      })
                    : undefined
                }
              />
            ) : null}

            {currentSystemId ? null : editingExtraction ? (
              <Box
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
                borderColor="border"
                borderWidth="025"
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd" fontWeight="medium">
                      {t("products.extraction.title")}
                    </Text>
                    <Button
                      variant="plain"
                      size="slim"
                      onClick={reanalyze}
                      loading={reanalyzing}
                    >
                      {t("products.extraction.reanalyze")}
                    </Button>
                  </InlineStack>

                  {editingExtraction.state === "ok" ? (
                    <BlockStack gap="150">
                      <InlineStack gap="150" wrap>
                        <Badge tone="info">
                          {t(
                            `products.extraction.cat.${editingExtraction.summary.category}`,
                          )}
                        </Badge>
                        <Badge tone="info">
                          {t(
                            `products.extraction.cut.${editingExtraction.summary.cut}`,
                          )}
                        </Badge>
                        <Badge
                          tone={
                            editingExtraction.summary.hasMeasurements
                              ? "success"
                              : "warning"
                          }
                        >
                          {editingExtraction.summary.hasMeasurements
                            ? t("products.extraction.rows", {
                                n: editingExtraction.summary.rowCount,
                              })
                            : t("products.extraction.noRows")}
                        </Badge>
                        <Badge>
                          {editingExtraction.summary.stretch
                            ? t("products.extraction.stretch")
                            : t("products.extraction.woven")}
                        </Badge>
                        {editingExtraction.summary.category === "bottom" ? (
                          <Badge>
                            {editingExtraction.summary.elasticWaist
                              ? t("products.extraction.elastic")
                              : t("products.extraction.rigidWaist")}
                          </Badge>
                        ) : null}
                        {editingExtraction.summary.outerwear ? (
                          <Badge>{t("products.extraction.outerwear")}</Badge>
                        ) : null}
                        {editingExtraction.summary.korekta !== 0 ? (
                          <Badge tone="attention">
                            {t("products.extraction.korekta", {
                              n:
                                editingExtraction.summary.korekta > 0
                                  ? "+1"
                                  : "−1",
                            })}
                          </Badge>
                        ) : null}
                        {editingExtraction.summary.modelAnchor ? (
                          <Badge tone="info">
                            {t("products.extraction.modelAnchor", {
                              h: editingExtraction.summary.modelAnchor.height,
                              s: editingExtraction.summary.modelAnchor.size,
                            })}
                          </Badge>
                        ) : null}
                      </InlineStack>
                      {editingExtraction.summary.sizes.length ? (
                        <Text as="span" variant="bodyXs" tone="subdued">
                          {editingExtraction.summary.sizes.join(" · ")}
                        </Text>
                      ) : null}
                      {editingExtraction.summary.dataQuality.length ? (
                        <Box
                          padding="200"
                          background="bg-surface-caution"
                          borderRadius="100"
                        >
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyXs" fontWeight="medium">
                              {t("products.extraction.dq.title")}
                            </Text>
                            {editingExtraction.summary.dataQuality.map((code) => (
                              <Text
                                key={code}
                                as="span"
                                variant="bodyXs"
                                tone="caution"
                              >
                                {t(`products.extraction.dq.${code}`)}
                              </Text>
                            ))}
                          </BlockStack>
                        </Box>
                      ) : null}
                      <Text as="span" variant="bodyXs" tone="subdued">
                        {t("products.extraction.help")}
                      </Text>
                    </BlockStack>
                  ) : editingExtraction.state === "error" ? (
                    <Text as="span" variant="bodySm" tone="critical">
                      {t("products.extraction.errorLine")}
                    </Text>
                  ) : (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("products.extraction.pending")}
                    </Text>
                  )}
                </BlockStack>
              </Box>
            ) : null}

            {currentSystemId ? (
              <Text as="p" tone="subdued" variant="bodySm">
                {t("sizingSystems.chartHelp")}
              </Text>
            ) : (
            <>
            <TextField
              label={t("products.field.notes.label")}
              value={notes}
              onChange={setNotes}
              multiline={4}
              autoComplete="off"
              maxLength={1500}
              showCharacterCount
              helpText={t("products.field.notes.help")}
              placeholder={t("products.field.notes.placeholder")}
            />

            <TextField
              label={t("products.field.sizeText.label")}
              value={sizeText}
              onChange={setSizeText}
              multiline={6}
              autoComplete="off"
              maxLength={3000}
              showCharacterCount
              helpText={t("products.field.sizeText.help")}
              placeholder={t("products.field.sizeText.placeholder")}
            />

            <BlockStack gap="200">
              <Text as="span" variant="bodyMd" fontWeight="medium">
                {t("products.field.image.label")}
              </Text>
              {!sizeChartImageAI ? (
                <LockedFeature note={t("gate.image_locked")}>
                  <DropZone
                    accept="image/png,image/jpeg,image/webp"
                    type="image"
                    allowMultiple={false}
                    onDrop={() => {}}
                  >
                    <DropZone.FileUpload
                      actionTitle={t("products.field.image.dropTitle")}
                      actionHint={t("products.field.image.dropHint")}
                    />
                  </DropZone>
                </LockedFeature>
              ) : image ? (
                <InlineStack gap="400" blockAlign="center">
                  <Thumbnail
                    source={image}
                    alt={t("products.field.image.previewAlt")}
                    size="large"
                  />
                  <Button variant="plain" tone="critical" onClick={() => setImage(null)}>
                    {t("products.field.image.remove")}
                  </Button>
                </InlineStack>
              ) : (
                <DropZone
                  accept="image/png,image/jpeg,image/webp"
                  type="image"
                  allowMultiple={false}
                  onDrop={handleDrop}
                >
                  <DropZone.FileUpload
                    actionTitle={t("products.field.image.dropTitle")}
                    actionHint={t("products.field.image.dropHint")}
                  />
                </DropZone>
              )}
              {sizeChartImageAI ? (
                imageError ? (
                  <Text as="span" tone="critical" variant="bodyXs">
                    {imageError}
                  </Text>
                ) : (
                  <Text as="span" tone="subdued" variant="bodyXs">
                    {t("products.field.image.note")}
                  </Text>
                )
              ) : null}
            </BlockStack>
            </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
