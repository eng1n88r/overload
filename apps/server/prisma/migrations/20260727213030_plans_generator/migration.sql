-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weeks" INTEGER NOT NULL DEFAULT 8,
    "daysPerWeek" INTEGER NOT NULL DEFAULT 4,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "targetMuscles" TEXT NOT NULL DEFAULT '[]',
    "template" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "PlanDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "unitPreference" TEXT NOT NULL DEFAULT 'kg',
    "equipment" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "passwordHash", "role", "unitPreference") SELECT "createdAt", "email", "id", "name", "passwordHash", "role", "unitPreference" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Plan_userId_status_idx" ON "Plan"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanDay_planId_dayIndex_key" ON "PlanDay"("planId", "dayIndex");
