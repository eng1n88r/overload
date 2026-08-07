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
    "distanceUnitPreference" TEXT NOT NULL DEFAULT 'km',
    "equipment" TEXT NOT NULL DEFAULT '[]',
    "trainingMode" TEXT NOT NULL DEFAULT 'hypertrophy',
    "avatar" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("avatar", "createdAt", "email", "equipment", "id", "name", "passwordHash", "role", "trainingMode", "unitPreference") SELECT "avatar", "createdAt", "email", "equipment", "id", "name", "passwordHash", "role", "trainingMode", "unitPreference" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
