-- AlterTable
ALTER TABLE "PlanDay" ADD COLUMN "weekday" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weeks" INTEGER NOT NULL DEFAULT 8,
    "daysPerWeek" INTEGER NOT NULL DEFAULT 4,
    "deloadWeeks" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Plan" ("createdAt", "createdBy", "daysPerWeek", "id", "name", "notes", "startDate", "status", "userId", "weeks") SELECT "createdAt", "createdBy", "daysPerWeek", "id", "name", "notes", "startDate", "status", "userId", "weeks" FROM "Plan";
DROP TABLE "Plan";
ALTER TABLE "new_Plan" RENAME TO "Plan";
CREATE INDEX "Plan_userId_status_idx" ON "Plan"("userId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
