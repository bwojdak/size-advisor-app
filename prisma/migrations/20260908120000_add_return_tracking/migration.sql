-- AdvisorLog: śledzenie zwrotów (webhook refunds/create)
ALTER TABLE "AdvisorLog" ADD COLUMN "returned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdvisorLog" ADD COLUMN "returnedAt" TIMESTAMP(3);

-- ShopSettings: ogólny wskaźnik zwrotów sklepu podany przez merchanta
ALTER TABLE "ShopSettings" ADD COLUMN "baselineReturnRate" DOUBLE PRECISION;
