import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  parseStructuredRows,
  checkConsistency,
  emptyExtraction,
  CONSISTENCY_PROFILE_COUNT,
  type GarmentCategory,
  type ConsistencyIssue,
} from "../lib/size-advisor.server";

// Test spójności zweryfikowanej tabeli — czysta funkcja silnika (resolveSize
// na baterii ~230 sylwetek, bez AI), więc to osobny, tani resource route
// wołany na żądanie z panelu (po zapisie), a NIE liczony dla całej listy
// produktów przy każdym załadowaniu strony (patrz komentarz w loaderach).
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const form = (await request.json()) as {
    structuredSizeData?: string | null;
    category?: GarmentCategory | null;
  };

  const rows = parseStructuredRows(form.structuredSizeData ?? null);
  if (!rows) {
    return Response.json({ issues: [] as ConsistencyIssue[], tested: 0 });
  }

  const category: GarmentCategory =
    form.category === "top" || form.category === "bottom" || form.category === "dress"
      ? form.category
      : "top";
  const extraction = { ...emptyExtraction(), category, rows };

  const issues = checkConsistency(extraction);
  return Response.json({ issues, tested: CONSISTENCY_PROFILE_COUNT });
};
