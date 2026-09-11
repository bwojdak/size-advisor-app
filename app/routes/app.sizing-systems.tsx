import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Modal,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { useI18n, type Locale } from "../lib/i18n";
import {
  parseStoredExtraction,
  parseStructuredRows,
  describeExtraction,
  EXTRACTION_VERSION,
  type NormalizedSizeRow,
} from "../lib/size-advisor.server";
import {
  SizeGrid,
  rowsToGrid,
  gridToPayload,
  type GridRow,
  type GarmentCategory,
} from "../components/SizeGrid";

type Summary = ReturnType<typeof describeExtraction>;
type AttachedProduct = { id: string; title: string };
type SystemView = {
  id: string;
  name: string;
  parsedSizeData: string;
  customNotes: string;
  mapped: number;
  products: AttachedProduct[];
  /** Zweryfikowana siatka (jeśli sprzedawca ją zapisał) — do seedowania edytora. */
  structuredRows: NormalizedSizeRow[];
  /** Sugestia z ostatniej analizy AI — do przycisku "wypełnij z analizy". */
  suggestedRows: NormalizedSizeRow[];
  extraction:
    | { state: "ok"; summary: Summary }
    | { state: "error" }
    | { state: "pending" };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await loadShopSettings(session.shop);

  const systems = await db.sizingSystem.findMany({
    where: { shopId: settings.id },
    orderBy: { updatedAt: "desc" },
  });
  const mappedRules = await db.productRule.findMany({
    where: { shopId: settings.id, sizingSystemId: { not: null } },
    select: { productId: true, productTitle: true, sizingSystemId: true },
    orderBy: { productTitle: "asc" },
  });
  const productsBySystem = new Map<string, AttachedProduct[]>();
  for (const r of mappedRules) {
    const key = r.sizingSystemId as string;
    const arr = productsBySystem.get(key) ?? [];
    arr.push({ id: r.productId, title: r.productTitle ?? "" });
    productsBySystem.set(key, arr);
  }

  const views: SystemView[] = systems.map((s) => {
    let extraction: SystemView["extraction"] = { state: "pending" };
    if (s.extractionError) {
      extraction = { state: "error" };
    } else {
      const parsed =
        s.extractionVersion === EXTRACTION_VERSION
          ? parseStoredExtraction(s.extractionJson)
          : null;
      if (parsed) {
        extraction = { state: "ok", summary: describeExtraction(parsed) };
      }
    }
    const attached = productsBySystem.get(s.id) ?? [];
    return {
      id: s.id,
      name: s.name,
      parsedSizeData: s.parsedSizeData ?? "",
      customNotes: s.customNotes ?? "",
      mapped: attached.length,
      products: attached,
      structuredRows: parseStructuredRows(s.structuredSizeData) ?? [],
      suggestedRows: extraction.state === "ok" ? extraction.summary.rows : [],
      extraction,
    };
  });

  return { systems: views };
};

async function authFetch(url: string, body: unknown, locale: Locale) {
  const api = (window as unknown as { shopify?: { idToken: () => Promise<string> } })
    .shopify;
  const token = api ? await api.idToken() : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${url}?locale=${locale}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "");
  return json;
}

function toast(message: string, isError = false) {
  const api = (
    window as unknown as {
      shopify?: { toast?: { show: (m: string, o?: { isError?: boolean }) => void } };
    }
  ).shopify;
  api?.toast?.show(message, { isError });
}

function ExtractionSummary({ view }: { view: SystemView }) {
  const { t } = useI18n();
  const e = view.extraction;
  if (e.state === "error") {
    return (
      <Text as="span" variant="bodySm" tone="critical">
        {t("products.extraction.errorLine")}
      </Text>
    );
  }
  if (e.state === "pending") {
    return (
      <Text as="span" variant="bodySm" tone="subdued">
        {t("products.extraction.pending")}
      </Text>
    );
  }
  const s = e.summary;
  return (
    <BlockStack gap="150">
      <InlineStack gap="150" wrap>
        {view.structuredRows.length > 0 ? (
          <Badge tone="success">{t("grid.verifiedBadge")}</Badge>
        ) : null}
        <Badge tone="info">{t(`products.extraction.cat.${s.category}`)}</Badge>
        <Badge tone="info">{t(`products.extraction.cut.${s.cut}`)}</Badge>
        <Badge tone={s.hasMeasurements ? "success" : undefined}>
          {s.hasMeasurements
            ? t("products.extraction.rows", { n: s.rowCount })
            : t("products.extraction.noRows")}
        </Badge>
        <Badge>
          {s.stretch
            ? t("products.extraction.stretch")
            : t("products.extraction.woven")}
        </Badge>
        {s.elasticWaist && s.category === "bottom" ? (
          <Badge>{t("products.extraction.elastic")}</Badge>
        ) : null}
        {s.category === "bottom" && !s.elasticWaist ? (
          <Badge>{t("products.extraction.rigidWaist")}</Badge>
        ) : null}
        {s.modelAnchor ? (
          <Badge tone="info">
            {t("products.extraction.modelAnchor", {
              h: s.modelAnchor.height,
              s: s.modelAnchor.size,
            })}
          </Badge>
        ) : null}
      </InlineStack>
      {s.sizes.length ? (
        <Text as="span" variant="bodyXs" tone="subdued">
          {s.sizes.join(" · ")}
        </Text>
      ) : null}
      {s.dataQuality.length ? (
        <Box padding="200" background="bg-surface-caution" borderRadius="100">
          <BlockStack gap="050">
            <Text as="span" variant="bodyXs" fontWeight="medium">
              {t("products.extraction.dq.title")}
            </Text>
            {s.dataQuality.map((code) => (
              <Text key={code} as="span" variant="bodyXs" tone="caution">
                {t(`products.extraction.dq.${code}`)}
              </Text>
            ))}
          </BlockStack>
        </Box>
      ) : null}
    </BlockStack>
  );
}

type Editing =
  | {
      id: string | null;
      name: string;
      parsedSizeData: string;
      customNotes: string;
      gridRows: GridRow[];
      suggestedRows: GridRow[];
      category: GarmentCategory | null;
    }
  | null;

export default function SizingSystemsPage() {
  const { systems } = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const revalidator = useRevalidator();

  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openNew = () =>
    setEditing({
      id: null,
      name: "",
      parsedSizeData: "",
      customNotes: "",
      gridRows: [],
      suggestedRows: [],
      category: null,
    });
  const openEdit = (s: SystemView) => {
    const suggestedRows = rowsToGrid(s.suggestedRows);
    setEditing({
      id: s.id,
      name: s.name,
      parsedSizeData: s.parsedSizeData,
      customNotes: s.customNotes,
      gridRows: s.structuredRows.length
        ? rowsToGrid(s.structuredRows)
        : suggestedRows,
      suggestedRows,
      category: s.extraction.state === "ok" ? s.extraction.summary.category : null,
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await authFetch(
        "/app/sizing-system",
        {
          id: editing.id ?? undefined,
          name: editing.name,
          parsedSizeData: editing.parsedSizeData,
          customNotes: editing.customNotes,
          structuredSizeData: gridToPayload(editing.gridRows),
        },
        locale,
      );
      toast(t("settings.brand.saved"));
      setEditing(null);
      revalidator.revalidate();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("settings.error.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const reanalyze = async (id: string) => {
    setBusyId(id);
    try {
      const r = await authFetch(
        "/app/sizing-system",
        { intent: "reanalyze", id },
        locale,
      );
      toast(
        r?.analyzed
          ? t("products.extraction.reanalyzed")
          : t("products.extraction.reanalyzeFailed"),
        !r?.analyzed,
      );
      revalidator.revalidate();
    } catch {
      toast(t("products.extraction.reanalyzeFailed"), true);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (s: SystemView) => {
    if (
      !window.confirm(
        t("sizingSystems.confirmDelete", { name: s.name, n: s.mapped }),
      )
    )
      return;
    setBusyId(s.id);
    try {
      await authFetch("/app/sizing-system", { intent: "delete", id: s.id }, locale);
      toast(t("settings.brand.saved"));
      revalidator.revalidate();
    } catch {
      toast(t("settings.error.saveFailed"), true);
    } finally {
      setBusyId(null);
    }
  };

  const addProducts = async (s: SystemView) => {
    const api = (
      window as unknown as {
        shopify?: {
          resourcePicker: (opts: {
            type: string;
            multiple?: boolean;
          }) => Promise<Array<{ id: string; title: string }> | undefined>;
        };
      }
    ).shopify;
    if (!api?.resourcePicker) return;
    const sel = await api.resourcePicker({ type: "product", multiple: true });
    if (!sel?.length) return;
    setBusyId(s.id);
    try {
      const r = await authFetch(
        "/app/product-map",
        {
          sizingSystemId: s.id,
          products: sel.map((p) => ({
            id: String(p.id).split("/").pop(),
            title: p.title,
          })),
        },
        locale,
      );
      toast(t("sizingSystems.mapped", { n: r?.mapped ?? sel.length }));
      revalidator.revalidate();
    } catch (err) {
      toast(
        err instanceof Error && err.message
          ? err.message
          : t("settings.error.saveFailed"),
        true,
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Page
      title={t("sizingSystems.title")}
      subtitle={t("sizingSystems.subtitle")}
      primaryAction={{ content: t("sizingSystems.new"), onAction: openNew }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {systems.length === 0 ? (
              <Card>
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    {t("sizingSystems.empty")}
                  </Text>
                  <InlineStack>
                    <Button variant="primary" onClick={openNew}>
                      {t("sizingSystems.new")}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            ) : (
              systems.map((s) => (
                <Card key={s.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="050">
                        <Text as="h2" variant="headingMd">
                          {s.name}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("sizingSystems.mappedCount", { n: s.mapped })}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200" wrap>
                        <Button
                          size="slim"
                          onClick={() => addProducts(s)}
                          loading={busyId === s.id}
                        >
                          {t("sizingSystems.addProducts")}
                        </Button>
                        <Button size="slim" onClick={() => openEdit(s)}>
                          {t("sizingSystems.edit")}
                        </Button>
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() => reanalyze(s.id)}
                          loading={busyId === s.id}
                        >
                          {t("products.extraction.reanalyze")}
                        </Button>
                        <Button
                          size="slim"
                          variant="plain"
                          tone="critical"
                          onClick={() => remove(s)}
                        >
                          {t("sizingSystems.delete")}
                        </Button>
                      </InlineStack>
                    </InlineStack>
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <ExtractionSummary view={s} />
                    </Box>
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="150">
                        <Text as="span" variant="bodySm" fontWeight="medium">
                          {t("sizingSystems.attachedList")}
                        </Text>
                        {s.products.length === 0 ? (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {t("sizingSystems.noneAttached")}
                          </Text>
                        ) : (
                          <InlineStack gap="150" wrap>
                            {s.products.slice(0, 12).map((p) => (
                              <Badge key={p.id}>
                                {p.title || `#${p.id}`}
                              </Badge>
                            ))}
                            {s.products.length > 12 ? (
                              <Text
                                as="span"
                                variant="bodySm"
                                tone="subdued"
                              >
                                {t("sizingSystems.moreAttached", {
                                  n: s.products.length - 12,
                                })}
                              </Text>
                            ) : null}
                          </InlineStack>
                        )}
                      </BlockStack>
                    </Box>
                  </BlockStack>
                </Card>
              ))
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing?.id ? t("sizingSystems.editTitle") : t("sizingSystems.newTitle")
        }
        primaryAction={{
          content: t("settings.brand.save"),
          onAction: save,
          loading: saving,
          disabled: !editing?.name.trim(),
        }}
        secondaryActions={[
          { content: t("common.cancel"), onAction: () => setEditing(null) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label={t("sizingSystems.nameLabel")}
              value={editing?.name ?? ""}
              onChange={(v) =>
                setEditing((e) => (e ? { ...e, name: v } : e))
              }
              autoComplete="off"
              maxLength={80}
              placeholder={t("sizingSystems.namePlaceholder")}
            />
            <BlockStack gap="150">
              <SizeGrid
                rows={editing?.gridRows ?? []}
                onChange={(rows) =>
                  setEditing((e) => (e ? { ...e, gridRows: rows } : e))
                }
                category={editing?.category ?? null}
              />
              {editing?.suggestedRows.length ? (
                <InlineStack>
                  <Button
                    size="slim"
                    variant="plain"
                    onClick={() =>
                      setEditing((e) =>
                        e ? { ...e, gridRows: e.suggestedRows } : e,
                      )
                    }
                  >
                    {t("grid.prefillFromAi")}
                  </Button>
                </InlineStack>
              ) : null}
            </BlockStack>
            <TextField
              label={t("sizingSystems.notesLabel")}
              value={editing?.customNotes ?? ""}
              onChange={(v) =>
                setEditing((e) => (e ? { ...e, customNotes: v } : e))
              }
              multiline={4}
              autoComplete="off"
              maxLength={1500}
              helpText={t("sizingSystems.notesHelp")}
              placeholder={t("sizingSystems.notesPlaceholder")}
            />
            {error ? (
              <Text as="p" tone="critical" variant="bodySm">
                {error}
              </Text>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
