-- Zdjęcie rozmiarówki dla systemu rozmiarów (jak przy pojedynczym produkcie) —
-- pozwala AI odczytać oficjalną kartę wymiarów zamiast wpisywania jej ręcznie.
ALTER TABLE "SizingSystem" ADD COLUMN "sizeChartImage" TEXT;
