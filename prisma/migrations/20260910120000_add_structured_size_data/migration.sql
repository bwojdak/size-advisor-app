-- Zweryfikowana przez sprzedawcę siatka wymiarów (JSON). Gdy ustawiona, to ona
-- jest źródłem wierszy tabeli — AI robi tylko klasyfikację kroju/materiału.
ALTER TABLE "ProductRule" ADD COLUMN "structuredSizeData" TEXT;
ALTER TABLE "SizingSystem" ADD COLUMN "structuredSizeData" TEXT;
