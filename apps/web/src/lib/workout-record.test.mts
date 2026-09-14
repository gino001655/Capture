import assert from "node:assert/strict";
import test from "node:test";

import { emptyWorkoutPayload, elapsedWorkoutTimer, nextWorkoutSetIndex, validateWorkoutSaveRequest, type WorkoutSaveInput } from "./workout-record.ts";

const input: WorkoutSaveInput = {
  journalDate: "2026-09-08",
  expectedRevision: null,
  clientUpdatedAt: "2026-09-08T02:00:00.000Z",
  payload: {
    schemaVersion: 1,
    sessions: [{
      id: "11111111-1111-4111-8111-111111111111",
      name: "Push",
      note: "",
      startedAt: "2026-09-08T02:00:00.000Z",
      completedAt: null,
      restTimer: { startedAt: null, elapsedSeconds: 0, running: false },
      exercises: [{
        id: "22222222-2222-4222-8222-222222222222",
        kind: "strength",
        name: "Bench press",
        note: "stable",
        sets: [{
          id: "33333333-3333-4333-8333-333333333333",
          weightKg: 60,
          reps: 8,
          rpe: 8,
          rir: 2,
          type: "working",
          note: "",
          confirmed: true,
        }],
      }],
    }],
  },
};

test("a newly started rest timer never renders a negative second", () => {
  assert.equal(elapsedWorkoutTimer({ startedAt: "2026-09-14T03:00:00.050Z", elapsedSeconds: 0, running: true }, Date.parse("2026-09-14T03:00:00.000Z")), 0);
  assert.equal(elapsedWorkoutTimer({ startedAt: "2026-09-14T03:00:00.000Z", elapsedSeconds: 4, running: true }, Date.parse("2026-09-14T03:00:02.100Z")), 6);
});

test("accepts versioned strength and running workout payloads", () => {
  assert.equal(validateWorkoutSaveRequest(input).success, true);
  const running = structuredClone(input);
  running.payload.sessions[0].exercises = [{
    id: "44444444-4444-4444-8444-444444444444",
    kind: "running",
    name: "Intervals",
    note: "",
    distanceKm: 5,
    durationSeconds: 1_500,
    averageHeartRate: 155,
    maximumHeartRate: 178,
    temperatureC: 28,
    elevationGainM: 20,
    rpe: 8,
    segments: [{ id: "55555555-5555-4555-8555-555555555555", distanceKm: 1, durationSeconds: 280 }],
  }];
  assert.equal(validateWorkoutSaveRequest(running).success, true);
});

test("rejects malformed workout payloads without persisting empty placeholders", () => {
  assert.deepEqual(emptyWorkoutPayload(), { schemaVersion: 1, sessions: [] });
  const invalid = structuredClone(input) as unknown as Record<string, unknown>;
  ((invalid.payload as { sessions: Array<{ exercises: Array<{ sets: Array<{ rpe: number }> }> }> }).sessions[0].exercises[0].sets[0]).rpe = 12;
  assert.equal(validateWorkoutSaveRequest(invalid).success, false);
});

test("set confirmation advances only when another copied set exists", () => {
  assert.equal(nextWorkoutSetIndex(0, 3), 1);
  assert.equal(nextWorkoutSetIndex(1, 3), 2);
  assert.equal(nextWorkoutSetIndex(2, 3), null);
  assert.equal(nextWorkoutSetIndex(-1, 3), null);
});
