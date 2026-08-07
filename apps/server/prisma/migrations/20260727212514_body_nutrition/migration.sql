-- CreateTable
CREATE TABLE "BodyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg'
);

-- CreateTable
CREATE TABLE "NutritionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "calories" INTEGER,
    "proteinG" REAL,
    "carbsG" REAL,
    "fatG" REAL,
    "note" TEXT
);

-- CreateIndex
CREATE INDEX "BodyMetric_userId_type_date_idx" ON "BodyMetric"("userId", "type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BodyMetric_userId_date_type_key" ON "BodyMetric"("userId", "date", "type");

-- CreateIndex
CREATE INDEX "NutritionLog_userId_date_idx" ON "NutritionLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionLog_userId_date_key" ON "NutritionLog"("userId", "date");
