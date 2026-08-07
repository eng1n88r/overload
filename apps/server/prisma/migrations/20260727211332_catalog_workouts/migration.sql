-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceCategory" TEXT,
    "force" TEXT,
    "level" TEXT,
    "mechanic" TEXT,
    "equipment" TEXT NOT NULL DEFAULT 'other',
    "instructions" TEXT NOT NULL DEFAULT '[]',
    "images" TEXT NOT NULL DEFAULT '[]',
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT
);

-- CreateTable
CREATE TABLE "ExerciseMuscle" (
    "exerciseId" TEXT NOT NULL,
    "muscle" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    PRIMARY KEY ("exerciseId", "muscle", "role"),
    CONSTRAINT "ExerciseMuscle_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExerciseAlias" (
    "alias" TEXT NOT NULL PRIMARY KEY,
    "exerciseId" TEXT NOT NULL,
    CONSTRAINT "ExerciseAlias_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "notes" TEXT,
    "durationSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workoutId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "targetSets" INTEGER,
    "targetRepsLow" INTEGER,
    "targetRepsHigh" INTEGER,
    "targetWeightKg" REAL,
    "notes" TEXT,
    CONSTRAINT "WorkoutExercise_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkoutExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workoutExerciseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "reps" INTEGER,
    "weightKg" REAL,
    "durationSec" REAL,
    "distanceM" REAL,
    "incline" REAL,
    "resistance" REAL,
    "isWarmup" BOOLEAN NOT NULL DEFAULT false,
    "multiplier" REAL NOT NULL DEFAULT 1,
    "rpe" REAL,
    "note" TEXT,
    "completedAt" DATETIME,
    CONSTRAINT "SetEntry_workoutExerciseId_fkey" FOREIGN KEY ("workoutExerciseId") REFERENCES "WorkoutExercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");

-- CreateIndex
CREATE INDEX "ExerciseMuscle_muscle_idx" ON "ExerciseMuscle"("muscle");

-- CreateIndex
CREATE INDEX "Workout_userId_date_idx" ON "Workout"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Workout_userId_externalId_key" ON "Workout"("userId", "externalId");

-- CreateIndex
CREATE INDEX "WorkoutExercise_workoutId_idx" ON "WorkoutExercise"("workoutId");

-- CreateIndex
CREATE INDEX "WorkoutExercise_exerciseId_idx" ON "WorkoutExercise"("exerciseId");

-- CreateIndex
CREATE INDEX "SetEntry_workoutExerciseId_idx" ON "SetEntry"("workoutExerciseId");
