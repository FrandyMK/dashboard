export type Exercise = {
  id: string;
  name: string;
  weight: number;
  sets: number;
  reps: number;
  active: boolean;
};

export type WorkoutDay = {
  id: string;
  name: string;
  exercises: Exercise[];
};

export type GymPlan = {
  days: WorkoutDay[];
  nextDayIndex: number;
};

export type ExerciseChanges = Partial<Omit<Exercise, "id">>;

const API_URL = import.meta.env.VITE_API_URL ?? "";

async function request(path: string, options: RequestInit = {}): Promise<GymPlan> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const enc = encodeURIComponent;

export function getGymPlan(): Promise<GymPlan> {
  return request("/gym/plan");
}

export function updateExercise(
  dayId: string,
  exerciseId: string,
  changes: ExerciseChanges
): Promise<GymPlan> {
  return request(`/gym/days/${enc(dayId)}/exercises/${enc(exerciseId)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function addExercise(dayId: string, name: string): Promise<GymPlan> {
  return request(`/gym/days/${enc(dayId)}/exercises`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function reorderExercises(dayId: string, exerciseIds: string[]): Promise<GymPlan> {
  return request(`/gym/days/${enc(dayId)}/order`, {
    method: "PUT",
    body: JSON.stringify({ exerciseIds }),
  });
}

export function completeWorkout(): Promise<GymPlan> {
  return request("/gym/complete", { method: "POST" });
}
