import db from "../db.server";

/**
 * Maksymalna retencja wpisów AdvisorLog (zawierają m.in. wzrost/wagę kupującego).
 * Po tym czasie kasujemy je automatycznie. ~13 miesięcy.
 */
export const ADVISOR_LOG_RETENTION_DAYS = 400;

const DEFAULTS = {
  plan: "free",
  isEnabled: true,
  brandStyle: "auto",
  language: "auto",
  accentColor: "inherit",
  monthlyLimit: 150,
  requestsUsed: 0,
};

/** Bieżący okres rozliczeniowy licznika jako "YYYY-MM" (UTC). */
export function currentUsageMonth(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Zwraca wiersz ShopSettings, tworząc go z domyślnymi wartościami jeśli nie
 * istnieje, i leniwie zerując `requestsUsed` gdy zmienił się miesiąc. Zapis do
 * bazy następuje tylko przy realnym resecie.
 */
export async function loadShopSettings(shop: string) {
  let settings = await db.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop, ...DEFAULTS },
  });

  const month = currentUsageMonth();
  if (settings.usageMonth !== month) {
    settings = await db.shopSettings.update({
      where: { id: settings.id },
      data: { requestsUsed: 0, usageMonth: month },
    });

    // Retencja — przy przełomie miesiąca (max raz/mies./sklep) kasujemy stare
    // wpisy z danymi kupującego.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ADVISOR_LOG_RETENTION_DAYS);
    await db.advisorLog.deleteMany({
      where: { shopId: settings.id, createdAt: { lt: cutoff } },
    });
  }

  return settings;
}
