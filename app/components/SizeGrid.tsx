import { Fragment, useCallback, useState } from "react";
import {
  ActionList,
  BlockStack,
  Box,
  Button,
  InlineStack,
  Popover,
  Text,
  TextField,
} from "@shopify/polaris";
import { useI18n } from "../lib/i18n";

const CM_PER_IN = 2.54;
const round1 = (n: number) => Math.round(n * 10) / 10;
// Siatka trzyma wartości ZAWSZE w cm (tak zapisujemy i tak liczy silnik).
// Jednostka to tylko wygoda przy wpisywaniu — przelicza przy wyświetlaniu i
// przy zapisie pojedynczej komórki, sama siatka (GridRow) tego nie widzi.
const cmToDisplay = (cm: string, unit: "cm" | "in") => {
  if (!cm) return "";
  const n = Number(cm);
  return Number.isFinite(n) ? String(unit === "in" ? round1(n / CM_PER_IN) : n) : cm;
};
const displayToCm = (val: string, unit: "cm" | "in") => {
  if (!val) return "";
  const n = Number(val);
  return Number.isFinite(n) ? String(unit === "in" ? round1(n * CM_PER_IN) : n) : val;
};

// Siatka wymiarów zweryfikowana przez sprzedawcę — wiersz na rozmiar. Puste
// pola = wymiar nie dotyczy tego produktu. Wartości trzymane jako string (pola
// kontrolowane); konwersja na liczby dzieje się przy zapisie (gridToPayload)
// i po stronie serwera (parseStructuredRows).
export type GridRow = {
  size: string;
  chest: string;
  waist: string;
  hip: string;
  length: string;
  inseam: string;
};

export const emptyGridRow = (): GridRow => ({
  size: "",
  chest: "",
  waist: "",
  hip: "",
  length: "",
  inseam: "",
});

type SourceRow = {
  size: string;
  chest?: number | null;
  waist?: number | null;
  hip?: number | null;
  length?: number | null;
  inseam?: number | null;
};

/** Wiersze z zapisanej siatki (structuredSizeData) albo, jako sugestia startowa,
 *  z ostatniej analizy AI (extractionJson.tabela) — do wypełnienia edytora. */
export function rowsToGrid(rows: SourceRow[]): GridRow[] {
  return rows.map((r) => ({
    size: r.size ?? "",
    chest: r.chest != null ? String(r.chest) : "",
    waist: r.waist != null ? String(r.waist) : "",
    hip: r.hip != null ? String(r.hip) : "",
    length: r.length != null ? String(r.length) : "",
    inseam: r.inseam != null ? String(r.inseam) : "",
  }));
}

/** GridRow[] -> JSON do zapisu na structuredSizeData. null = wyczyść (mniej niż
 *  2 sensowne wiersze — wraca do samej analizy AI). */
export function gridToPayload(rows: GridRow[]): string | null {
  const clean = rows
    .map((r) => ({ ...r, size: r.size.trim() }))
    .filter((r) => r.size && (r.chest || r.waist || r.hip || r.length || r.inseam));
  return clean.length >= 2 ? JSON.stringify(clean) : null;
}

// Zamknięta lista — to są jedyne punkty pomiarowe, które silnik faktycznie
// rozumie i używa do wyliczenia rozmiaru (obwód klatki/pasa/bioder do grading
// po obwodzie, długość/nogawka do grading po długości). Sprzedawca WYBIERA z
// tej listy, nie wpisuje własnej nazwy — inaczej dodana kolumna byłaby tylko
// martwymi danymi, które nic nie liczy.
const ALL_COLS: Array<{ key: keyof GridRow; labelKey: string; ph: string }> = [
  { key: "chest", labelKey: "grid.col.chest", ph: "110" },
  { key: "waist", labelKey: "grid.col.waist", ph: "96" },
  { key: "hip", labelKey: "grid.col.hip", ph: "112" },
  { key: "length", labelKey: "grid.col.length", ph: "68" },
  { key: "inseam", labelKey: "grid.col.inseam", ph: "80" },
];

export type GarmentCategory = "top" | "bottom" | "dress";

// Które kolumny mają sens dla danej kategorii — koszulka nie potrzebuje pasa/
// bioder/nogawki. Nieznana kategoria (nowy produkt, przed pierwszą analizą) =
// pokaż wszystko, żeby niczego przedwcześnie nie ukryć.
const DIMS_BY_CATEGORY: Record<GarmentCategory, Array<keyof GridRow>> = {
  top: ["chest", "length"],
  bottom: ["waist", "hip", "inseam", "length"],
  dress: ["chest", "waist", "length"],
};

export function SizeGrid({
  rows,
  onChange,
  category,
}: {
  rows: GridRow[];
  onChange: (rows: GridRow[]) => void;
  /** Kategoria z ostatniej analizy AI — zawęża widoczne kolumny. null/undefined
   *  (jeszcze nieznana) pokazuje wszystkie 5, żeby nic nie zniknęło przedwcześnie. */
  category?: GarmentCategory | null;
}) {
  const { t } = useI18n();
  const [unit, setUnit] = useState<"cm" | "in">("cm");
  const [addColOpen, setAddColOpen] = useState(false);
  // Domyślne kolumny z kategorii (raz, przy otwarciu edytora) — dalej
  // sprzedawca dowolnie dodaje/usuwa z zamkniętej listy ALL_COLS.
  const [visibleDims, setVisibleDims] = useState<Array<keyof GridRow>>(() => {
    const allowed = category ? DIMS_BY_CATEGORY[category] : null;
    return allowed
      ? ALL_COLS.map((c) => c.key).filter((k) => allowed.includes(k))
      : ALL_COLS.map((c) => c.key);
  });
  const COLS = ALL_COLS.filter((c) => visibleDims.includes(c.key));
  const hiddenCols = ALL_COLS.filter((c) => !visibleDims.includes(c.key));
  // Miękkie ostrzeżenie, nie blokada — ufamy, że sprzedawca wie, co wpisuje,
  // ale kolumna spoza typowego zestawu dla tej kategorii (np. nogawka na
  // koszulce) zwykle jest pomyłką przy klikaniu „+ Dodaj wymiar".
  const unusualCols = category
    ? COLS.filter((c) => !DIMS_BY_CATEGORY[category].includes(c.key))
    : [];
  // Miękkie ostrzeżenie #2: kolumna jest widoczna (bo pasuje do kategorii albo
  // sprzedawca ją dodał), ale przynajmniej jeden rozmiar nie ma dla niej
  // wartości — zwykle po prostu zapomniane pole, nie celowy brak.
  const rowsWithSize = rows.filter((r) => r.size.trim());
  const incompleteCols = COLS.filter(
    (c) =>
      rowsWithSize.length > 0 &&
      rowsWithSize.some((r) => !r[c.key].trim()),
  );
  const missingSizesFor = useCallback(
    (key: keyof GridRow) =>
      rowsWithSize.filter((r) => !r[key].trim()).map((r) => r.size),
    [rowsWithSize],
  );
  const removeCol = useCallback(
    (key: keyof GridRow) => setVisibleDims((v) => v.filter((k) => k !== key)),
    [],
  );
  const addCol = useCallback((key: string) => {
    if (!key) return;
    setVisibleDims((v) => (v.includes(key as keyof GridRow) ? v : [...v, key as keyof GridRow]));
  }, []);

  const setCell = useCallback(
    (i: number, key: keyof GridRow, value: string) => {
      const next = rows.slice();
      next[i] = { ...next[i], [key]: value };
      onChange(next);
    },
    [rows, onChange],
  );
  const removeRow = useCallback(
    (i: number) => onChange(rows.filter((_, idx) => idx !== i)),
    [rows, onChange],
  );
  const addRow = useCallback(() => onChange([...rows, emptyGridRow()]), [
    rows,
    onChange,
  ]);

  return (
    <BlockStack gap="150">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="span" variant="bodyMd" fontWeight="medium">
          {t("grid.title")}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          {hiddenCols.length ? (
            <Popover
              active={addColOpen}
              onClose={() => setAddColOpen(false)}
              activator={
                <Button
                  size="micro"
                  disclosure={addColOpen ? "up" : "down"}
                  onClick={() => setAddColOpen((v) => !v)}
                >
                  {t("grid.addMeasurement")}
                </Button>
              }
            >
              <ActionList
                items={hiddenCols.map((c) => ({
                  content: t(c.labelKey),
                  onAction: () => {
                    addCol(c.key);
                    setAddColOpen(false);
                  },
                }))}
              />
            </Popover>
          ) : null}
          <InlineStack gap="0">
            {(["cm", "in"] as const).map((u) => (
              <Button
                key={u}
                size="micro"
                pressed={unit === u}
                onClick={() => setUnit(u)}
              >
                {u}
              </Button>
            ))}
          </InlineStack>
        </InlineStack>
      </InlineStack>
      <Text as="p" variant="bodyXs" tone="subdued">
        {t("grid.help")}
      </Text>
      {unusualCols.length && category ? (
        <Text as="p" variant="bodyXs" tone="caution">
          {t("grid.unusualCols", {
            names: unusualCols.map((c) => t(c.labelKey)).join(", "),
            category: t(`products.extraction.cat.${category}`),
          })}
        </Text>
      ) : null}
      {incompleteCols.length ? (
        <Text as="p" variant="bodyXs" tone="caution">
          {t("grid.incompleteCols", {
            details: incompleteCols
              .map((c) => `${t(c.labelKey)} (${missingSizesFor(c.key).join(", ")})`)
              .join("; "),
          })}
        </Text>
      ) : null}
      {rows.length > 0 ? (
        <Box overflowX="scroll" paddingBlockEnd="100">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `72px repeat(${COLS.length}, 84px) 28px`,
              gap: "6px",
              alignItems: "end",
              minWidth: `${100 + COLS.length * 90}px`,
            }}
          >
            <span />
            {COLS.map((c) => (
              <div
                key={c.key}
                style={{ display: "flex", alignItems: "center", gap: "3px" }}
              >
                <Text
                  as="span"
                  variant="bodyXs"
                  tone={
                    unusualCols.includes(c) || incompleteCols.includes(c)
                      ? "caution"
                      : "subdued"
                  }
                >
                  {t(c.labelKey)}
                </Text>
                <button
                  type="button"
                  onClick={() => removeCol(c.key)}
                  aria-label={t("grid.removeCol", { name: t(c.labelKey) })}
                  style={{
                    border: 0,
                    background: "none",
                    padding: 0,
                    margin: 0,
                    color: "var(--p-color-text-secondary, #6b7280)",
                    cursor: "pointer",
                    fontSize: "11px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <span />
            {rows.map((row, i) => (
              <Fragment key={i}>
                <TextField
                  label={t("grid.col.size")}
                  labelHidden
                  value={row.size}
                  onChange={(v) => setCell(i, "size", v)}
                  autoComplete="off"
                  placeholder="M"
                  size="slim"
                />
                {COLS.map((c) => (
                  <TextField
                    key={c.key}
                    label={t(c.labelKey)}
                    labelHidden
                    type="text"
                    inputMode="decimal"
                    value={cmToDisplay(row[c.key], unit)}
                    onChange={(v) => setCell(i, c.key, displayToCm(v, unit))}
                    autoComplete="off"
                    placeholder={cmToDisplay(c.ph, unit)}
                    size="slim"
                  />
                ))}
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={() => removeRow(i)}
                  accessibilityLabel={t("grid.removeRow")}
                >
                  ×
                </Button>
              </Fragment>
            ))}
          </div>
        </Box>
      ) : null}
      <InlineStack gap="200" blockAlign="center">
        <Button onClick={addRow} size="slim">
          {t("grid.addRow")}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
