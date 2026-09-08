import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  IndexTable,
  InlineGrid,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { planCaps } from "../lib/plans";
import { useI18n } from "../lib/i18n";
import { LockedFeature } from "../components/LockedFeature";

const CHART_DAYS = 30;
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await loadShopSettings(session.shop);
  const caps = planCaps(settings.plan);

  const windowDays = caps.historyDays > 0 ? caps.historyDays : 400;
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const rows = await db.advisorLog.findMany({
    where: { shopId: settings.id, createdAt: { gte: since } },
    select: {
      createdAt: true,
      productTitle: true,
      recommendedSize: true,
      customerGender: true,
      bodyType: true,
      addedToCart: true,
      purchased: true,
      purchasedAt: true,
      orderTotal: true,
      orderCurrency: true,
      returned: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20000,
  });

  const total = rows.length;
  const addedToCart = rows.filter((r) => r.addedToCart).length;
  const purchased = rows.filter((r) => r.purchased).length;
  const returned = rows.filter((r) => r.returned).length;
  // Realny wskaźnik zwrotów na zamówieniach z rekomendacji (0–1).
  const widgetReturnRate = purchased > 0 ? returned / purchased : null;
  // Ogólny wskaźnik zwrotów sklepu podany przez merchanta (0–1) — do liczenia
  // „unikniętych zwrotów". Bez niego pokazujemy tylko realny odsetek.
  const baselineReturnRate =
    typeof settings.baselineReturnRate === "number" &&
    settings.baselineReturnRate > 0 &&
    settings.baselineReturnRate <= 1
      ? settings.baselineReturnRate
      : null;
  const avoidedReturns =
    baselineReturnRate != null && widgetReturnRate != null
      ? Math.max(
          0,
          Math.round(purchased * (baselineReturnRate - widgetReturnRate)),
        )
      : null;

  // Przychód przypisany — suma wartości zamówień z zakupem polecanego rozmiaru,
  // rozbita po walucie (zwykle jedna na sklep).
  const revByCcy = new Map<string, number>();
  for (const r of rows) {
    if (r.purchased && typeof r.orderTotal === "number" && r.orderTotal > 0) {
      const c = r.orderCurrency || "USD";
      revByCcy.set(c, (revByCcy.get(c) ?? 0) + r.orderTotal);
    }
  }
  const revenue = [...revByCcy.entries()].map(([currency, amount]) => ({
    currency,
    amount: Math.round(amount * 100) / 100,
  }));

  // Recommendations per day, last CHART_DAYS — anchored to UTC calendar dates so
  // it matches how logs are bucketed (`toISOString`), including today.
  const DAY_MS = 86_400_000;
  const todayUTC = new Date(
    new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
  ).getTime();
  const perDayMap = new Map<string, number>();
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    perDayMap.set(
      new Date(todayUTC - i * DAY_MS).toISOString().slice(0, 10),
      0,
    );
  }
  for (const r of rows) {
    const k = new Date(r.createdAt).toISOString().slice(0, 10);
    if (perDayMap.has(k)) perDayMap.set(k, (perDayMap.get(k) ?? 0) + 1);
  }
  const perDay = [...perDayMap].map(([date, value]) => ({ date, value }));

  // Recommended size distribution per product (aggregated → small; the client
  // filters and re-sums by the selected product).
  const byProduct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const p = r.productTitle || "—";
    const s = (r.recommendedSize || "?").toUpperCase();
    let inner = byProduct.get(p);
    if (!inner) {
      inner = new Map();
      byProduct.set(p, inner);
    }
    inner.set(s, (inner.get(s) ?? 0) + 1);
  }
  const sizeAgg: { product: string; size: string; count: number }[] = [];
  for (const [product, inner] of byProduct) {
    for (const [size, count] of inner) {
      sizeAgg.push({ product, size, count });
    }
  }

  const tally = (values: (string | null)[], keys: string[]) => {
    const m = new Map<string, number>();
    for (const v of values) {
      const lv = (v || "").toLowerCase();
      const k = keys.includes(lv) ? lv : "other";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([key, value]) => ({ key, value }));
  };
  const gender = tally(rows.map((r) => r.customerGender), ["male", "female"]);
  const body = tally(rows.map((r) => r.bodyType), [
    "slim",
    "standard",
    "athletic",
    "plus",
  ]);

  // Top products by recommendation volume.
  const prodMap = new Map<
    string,
    { n: number; added: number; purchased: number }
  >();
  for (const r of rows) {
    const key = r.productTitle || "—";
    const e = prodMap.get(key) ?? { n: 0, added: 0, purchased: 0 };
    e.n += 1;
    if (r.addedToCart) e.added += 1;
    if (r.purchased) e.purchased += 1;
    prodMap.set(key, e);
  }
  const topProducts = [...prodMap.entries()]
    .map(([title, v]) => ({ title, ...v }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  const recentPurchases = rows
    .filter((r) => r.purchased)
    .sort(
      (a, b) =>
        +new Date(b.purchasedAt ?? b.createdAt) -
        +new Date(a.purchasedAt ?? a.createdAt),
    )
    .slice(0, 10)
    .map((r) => ({
      date: (r.purchasedAt ?? r.createdAt).toISOString(),
      title: r.productTitle || "—",
      size: r.recommendedSize,
    }));

  return {
    conv: caps.conversionAnalytics,
    csvExport: caps.csvExport,
    windowDays: caps.historyDays > 0 ? caps.historyDays : null,
    total,
    addedToCart,
    purchased,
    returned,
    widgetReturnRate,
    baselineReturnRate,
    avoidedReturns,
    revenue,
    perDay,
    sizeAgg,
    gender,
    body,
    topProducts,
    recentPurchases,
  };
};

const sizeCmp = (a: string, b: string) => {
  const ia = SIZE_ORDER.indexOf(a);
  const ib = SIZE_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
};

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <BlockStack gap="100">
      <Text as="h3" variant="headingSm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="headingLg" fontWeight="bold">
        {value}
      </Text>
      {sub ? (
        <Text as="span" variant="bodyXs" tone="subdued">
          {sub}
        </Text>
      ) : null}
    </BlockStack>
  );
}

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return null;
  return (
    <BlockStack gap="200">
      {items.map((i) => (
        <div
          key={i.label}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(80px, 32%) 1fr auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <Text as="span" variant="bodySm" truncate>
            {i.label}
          </Text>
          <div
            style={{
              background: "var(--p-color-bg-surface-secondary, #f1f2f3)",
              borderRadius: 4,
              height: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${(i.value / max) * 100}%`,
                background: "var(--p-color-bg-fill-brand, #303030)",
                height: "100%",
              }}
            />
          </div>
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {i.value}
          </Text>
        </div>
      ))}
    </BlockStack>
  );
}

function DayChart({
  items,
  unitLabel,
}: {
  items: { date: string; value: number }[];
  unitLabel: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  const [hover, setHover] = useState<{ date: string; value: number } | null>(
    null,
  );
  return (
    <BlockStack gap="150">
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          height: 96,
          width: "100%",
          paddingBottom: 1,
          borderBottom: "1px solid var(--p-color-border, #e1e1e1)",
        }}
        onMouseLeave={() => setHover(null)}
      >
        {items.map((i) => (
          <div
            key={i.date}
            title={`${i.date}: ${i.value}`}
            onMouseEnter={() => setHover(i)}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              alignSelf: "stretch",
              display: "flex",
              alignItems: "flex-end",
              cursor: "default",
            }}
          >
            <div
              style={{
                width: "100%",
                height:
                  i.value === 0 ? 0 : `${Math.max(6, (i.value / max) * 100)}%`,
                background:
                  hover?.date === i.date
                    ? "var(--p-color-bg-fill-brand-hover, #1a1a1a)"
                    : "var(--p-color-bg-fill-brand, #303030)",
                borderRadius: "2px 2px 0 0",
              }}
            />
          </div>
        ))}
      </div>
      <Text as="span" variant="bodyXs" tone="subdued">
        {hover
          ? `${hover.date}: ${hover.value} ${unitLabel}`
          : `${items[0]?.date} — ${items[items.length - 1]?.date} · ${total} ${unitLabel}`}
      </Text>
    </BlockStack>
  );
}

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const {
    conv,
    csvExport,
    windowDays,
    total,
    addedToCart,
    purchased,
    returned,
    widgetReturnRate,
    baselineReturnRate,
    avoidedReturns,
    revenue,
    perDay,
    sizeAgg,
    gender,
    body,
    topProducts,
    recentPurchases,
  } = data;

  const [isClient, setIsClient] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [sizeProduct, setSizeProduct] = useState("__all__");

  const sizeProductOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const a of sizeAgg)
      totals.set(a.product, (totals.get(a.product) ?? 0) + a.count);
    return [
      { label: t("analytics.sizes.allProducts"), value: "__all__" },
      ...[...totals.entries()]
        .sort((x, y) => y[1] - x[1])
        .map(([p]) => ({ label: p, value: p })),
    ];
  }, [sizeAgg, t]);

  const sizeDist = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of sizeAgg) {
      if (sizeProduct !== "__all__" && a.product !== sizeProduct) continue;
      m.set(a.size, (m.get(a.size) ?? 0) + a.count);
    }
    return [...m.entries()]
      .sort((a, b) => sizeCmp(a[0], b[0]))
      .map(([label, value]) => ({ label, value }));
  }, [sizeAgg, sizeProduct]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const downloadCsv = async () => {
    setDownloading(true);
    setCsvError(null);
    try {
      const api = (
        window as unknown as { shopify?: { idToken: () => Promise<string> } }
      ).shopify;
      const token = api ? await api.idToken() : null;
      const res = await fetch("/app/export?report=products", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `size-advisor-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setCsvError(t("analytics.csv.error"));
    } finally {
      setDownloading(false);
    }
  };

  const genderLabel = (k: string) =>
    k === "male"
      ? t("settings.gender.male")
      : k === "female"
        ? t("settings.gender.female")
        : t("analytics.gender.unknown");
  const bodyLabel = (k: string) =>
    ["slim", "standard", "athletic", "plus"].includes(k)
      ? t(`settings.body.${k}`)
      : t("analytics.body.other");

  const genderItems = gender
    .map((g) => ({ label: genderLabel(g.key), value: g.value }))
    .sort((a, b) => b.value - a.value);
  const bodyItems = body
    .map((b) => ({ label: bodyLabel(b.key), value: b.value }))
    .sort((a, b) => b.value - a.value);

  return (
    <Page
      title={t("analytics.title")}
      subtitle={t("analytics.subtitle")}
      primaryAction={
        csvExport
          ? {
              content: t("analytics.csv"),
              onAction: downloadCsv,
              loading: downloading,
            }
          : undefined
      }
    >
      <BlockStack gap="500">
        {csvError ? (
          <Banner tone="critical" onDismiss={() => setCsvError(null)}>
            {csvError}
          </Banner>
        ) : null}

        <Text as="p" variant="bodySm" tone="subdued">
          {windowDays
            ? t("analytics.range", { days: windowDays })
            : t("analytics.range.all")}
        </Text>

        {total === 0 ? (
          <Card>
            <Box padding="600">
              <Text as="p" alignment="center" tone="subdued">
                {t("analytics.empty")}
              </Text>
            </Box>
          </Card>
        ) : (
          <>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {t("analytics.funnel.title")}
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                  <Stat label={t("analytics.funnel.recs")} value={total} />
                  {conv ? (
                    <Stat
                      label={t("analytics.funnel.cart")}
                      value={addedToCart}
                      sub={t("analytics.rate.ofRecs", {
                        pct: pct(addedToCart, total),
                      })}
                    />
                  ) : (
                    <LockedFeature note={t("gate.locked_from", { plan: "Growth" })}>
                      <Stat label={t("analytics.funnel.cart")} value="—" />
                    </LockedFeature>
                  )}
                  {conv ? (
                    <Stat
                      label={t("analytics.funnel.bought")}
                      value={purchased}
                      sub={
                        t("analytics.rate.ofRecs", {
                          pct: pct(purchased, total),
                        }) +
                        " · " +
                        t("analytics.rate.ofCart", {
                          pct: pct(purchased, addedToCart),
                        })
                      }
                    />
                  ) : (
                    <LockedFeature>
                      <Stat label={t("analytics.funnel.bought")} value="—" />
                    </LockedFeature>
                  )}
                </InlineGrid>
                {conv ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("analytics.funnel.note")}
                  </Text>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("analytics.locked.body")}
                  </Text>
                )}
              </BlockStack>
            </Card>

            {conv ? (
              <InlineGrid
                columns={{ xs: 1, sm: 2, md: avoidedReturns != null ? 3 : 2 }}
                gap="400"
              >
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      {t("analytics.revenue.title")}
                    </Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {revenue.length > 0
                        ? revenue
                            .map((r) => {
                              try {
                                return new Intl.NumberFormat(undefined, {
                                  style: "currency",
                                  currency: r.currency || "USD",
                                  maximumFractionDigits: 0,
                                }).format(r.amount);
                              } catch {
                                return `${r.amount.toFixed(0)} ${r.currency}`;
                              }
                            })
                            .join(" · ")
                        : "—"}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {revenue.length > 0
                        ? t("analytics.revenue.body")
                        : t("analytics.revenue.empty")}
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      {t("analytics.returns.rate.title")}
                    </Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {widgetReturnRate != null
                        ? `${Math.round(widgetReturnRate * 100)}%`
                        : "—"}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("analytics.returns.rate.body", {
                        n: returned,
                        m: purchased,
                      })}
                      {avoidedReturns == null
                        ? t("analytics.returns.rate.hint")
                        : ""}
                    </Text>
                  </BlockStack>
                </Card>
                {avoidedReturns != null ? (
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd">
                        {t("analytics.returns.avoided.title")}
                      </Text>
                      <Text as="p" variant="heading2xl" fontWeight="bold">
                        {`~${avoidedReturns}`}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("analytics.returns.avoided.body", {
                          widget: Math.round((widgetReturnRate ?? 0) * 100),
                          base: Math.round((baselineReturnRate ?? 0) * 100),
                        })}
                      </Text>
                    </BlockStack>
                  </Card>
                ) : null}
              </InlineGrid>
            ) : null}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("analytics.time.title")}
                </Text>
                <DayChart
                  items={perDay}
                  unitLabel={t("index.resource.plural")}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("analytics.sizes.title")}
                </Text>
                {sizeProductOptions.length > 2 ? (
                  <Box maxWidth="320px">
                    <Select
                      label={t("index.queries.col.product")}
                      labelHidden
                      options={sizeProductOptions}
                      value={sizeProduct}
                      onChange={setSizeProduct}
                    />
                  </Box>
                ) : null}
                {sizeDist.length > 0 ? (
                  <Bars items={sizeDist} />
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("analytics.empty")}
                  </Text>
                )}
              </BlockStack>
            </Card>

            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("analytics.profile.gender")}
                  </Text>
                  <Bars items={genderItems} />
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("analytics.profile.body")}
                  </Text>
                  <Bars items={bodyItems} />
                </BlockStack>
              </Card>
            </InlineGrid>

            <Card padding="0">
              <Box padding="400">
                <Text as="h2" variant="headingMd">
                  {t("analytics.top.title")}
                </Text>
              </Box>
              <IndexTable
                resourceName={{
                  singular: t("products.resource.singular"),
                  plural: t("products.resource.plural"),
                }}
                itemCount={topProducts.length}
                selectable={false}
                headings={
                  conv
                    ? [
                        { title: t("index.queries.col.product") },
                        { title: t("analytics.top.col.recs"), alignment: "end" },
                        { title: t("analytics.top.col.cart"), alignment: "end" },
                        { title: t("analytics.top.col.bought"), alignment: "end" },
                      ]
                    : [
                        { title: t("index.queries.col.product") },
                        { title: t("analytics.top.col.recs"), alignment: "end" },
                      ]
                }
              >
                {topProducts.map((p, index) => (
                  <IndexTable.Row id={p.title} key={p.title} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {p.title}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <div style={{ textAlign: "right" }}>{p.n}</div>
                    </IndexTable.Cell>
                    {conv ? (
                      <IndexTable.Cell>
                        <div style={{ textAlign: "right" }}>{p.added}</div>
                      </IndexTable.Cell>
                    ) : null}
                    {conv ? (
                      <IndexTable.Cell>
                        <div style={{ textAlign: "right" }}>{p.purchased}</div>
                      </IndexTable.Cell>
                    ) : null}
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>

            {conv && recentPurchases.length > 0 ? (
              <Card padding="0">
                <Box padding="400">
                  <Text as="h2" variant="headingMd">
                    {t("analytics.purchases.title")}
                  </Text>
                </Box>
                <IndexTable
                  resourceName={{
                    singular: t("index.resource.singular"),
                    plural: t("index.resource.plural"),
                  }}
                  itemCount={recentPurchases.length}
                  selectable={false}
                  headings={[
                    { title: t("analytics.purchases.col.date") },
                    { title: t("index.queries.col.product") },
                    { title: t("analytics.purchases.col.size") },
                  ]}
                >
                  {recentPurchases.map((r, index) => (
                    <IndexTable.Row
                      id={`${r.date}-${index}`}
                      key={`${r.date}-${index}`}
                      position={index}
                    >
                      <IndexTable.Cell>
                        {isClient ? new Date(r.date).toLocaleDateString() : ""}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd">
                          {r.title}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone="success">{r.size}</Badge>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </Card>
            ) : null}
          </>
        )}
      </BlockStack>
    </Page>
  );
}
