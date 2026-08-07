-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Exercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceCategory" TEXT,
    "force" TEXT,
    "level" TEXT,
    "mechanic" TEXT,
    "equipment" TEXT NOT NULL DEFAULT 'other',
    "apparatus" TEXT,
    "loadFactor" INTEGER NOT NULL DEFAULT 1,
    "instructions" TEXT NOT NULL DEFAULT '[]',
    "images" TEXT NOT NULL DEFAULT '[]',
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT
);
INSERT INTO "new_Exercise" ("apparatus", "category", "createdById", "equipment", "force", "id", "images", "instructions", "isCustom", "level", "mechanic", "name", "sourceCategory") SELECT "apparatus", "category", "createdById", "equipment", "force", "id", "images", "instructions", "isCustom", "level", "mechanic", "name", "sourceCategory" FROM "Exercise";
DROP TABLE "Exercise";
ALTER TABLE "new_Exercise" RENAME TO "Exercise";
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
