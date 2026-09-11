import { Fragment, useCallback } from "react";
import { BlockStack, Box, Button, Text, TextField } from "@shopify/polaris";
import { useI18n } from "../lib/i18n";

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
  const allowed = category ? DIMS_BY_CATEGORY[category] : null;
  const COLS = allowed ? ALL_COLS.filter((c) => allowed.includes(c.key)) : ALL_COLS;

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
      <Text as="span" variant="bodyMd" fontWeight="medium">
        {t("grid.title")}
      </Text>
      <Text as="p" variant="bodyXs" tone="subdued">
        {t("grid.help")}
      </Text>
      {rows.length > 0 ? (
        <Box overflowX="scroll" paddingBlockEnd="100">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `72px repeat(${COLS.length}, 74px) 28px`,
              gap: "6px",
              alignItems: "end",
              minWidth: `${100 + COLS.length * 80}px`,
            }}
          >
            <span />
            {COLS.map((c) => (
              <Text as="span" key={c.key} variant="bodyXs" tone="subdued">
                {t(c.labelKey)}
              </Text>
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
                    type="number"
                    value={row[c.key]}
                    onChange={(v) => setCell(i, c.key, v)}
                    autoComplete="off"
                    placeholder={c.ph}
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
      <Box>
        <Button onClick={addRow} size="slim">
          {t("grid.addRow")}
        </Button>
      </Box>
    </BlockStack>
  );
}
