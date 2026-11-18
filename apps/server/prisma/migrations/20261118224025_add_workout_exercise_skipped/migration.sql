-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkoutExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workoutId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "targetSets" INTEGER,
    "targetRepsLow" INTEGER,
    "targetRepsHigh" INTEGER,
    "targetWeightKg" REAL,
    "unit" TEXT,
    "restSec" INTEGER,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    CONSTRAINT "WorkoutExercise_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkoutExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WorkoutExercise" ("exerciseId", "id", "notes", "order", "restSec", "targetRepsHigh", "targetRepsLow", "targetSets", "targetWeightKg", "unit", "workoutId") SELECT "exerciseId", "id", "notes", "order", "restSec", "targetRepsHigh", "targetRepsLow", "targetSets", "targetWeightKg", "unit", "workoutId" FROM "WorkoutExercise";
DROP TABLE "WorkoutExercise";
ALTER TABLE "new_WorkoutExercise" RENAME TO "WorkoutExercise";
CREATE INDEX "WorkoutExercise_workoutId_idx" ON "WorkoutExercise"("workoutId");
CREATE INDEX "WorkoutExercise_exerciseId_idx" ON "WorkoutExercise"("exerciseId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
