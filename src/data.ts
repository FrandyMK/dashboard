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

// Changes are sent one at a time: each waits until the previous change has its
// answer. So answers to changes arrive in the order the changes were made, and
// an answer built before a later change can never land on top of it.
let previousChange: Promise<unknown> = Promise.resolve();

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!options.method || options.method === "GET") {
    return send<T>(path, options);
  }
  const result = previousChange.then(() => send<T>(path, options));
  // A failed change shouldn't block the ones after it.
  previousChange = result.catch(() => {});
  return result;
}

async function send<T>(path: string, options: RequestInit): Promise<T> {
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
  return request<GymPlan>("/gym/plan");
}

export function updateExercise(
  dayId: string,
  exerciseId: string,
  changes: ExerciseChanges
): Promise<GymPlan> {
  return request<GymPlan>(`/gym/days/${enc(dayId)}/exercises/${enc(exerciseId)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function addExercise(dayId: string, name: string): Promise<GymPlan> {
  return request<GymPlan>(`/gym/days/${enc(dayId)}/exercises`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteExercise(dayId: string, exerciseId: string): Promise<GymPlan> {
  return request<GymPlan>(`/gym/days/${enc(dayId)}/exercises/${enc(exerciseId)}`, {
    method: "DELETE",
  });
}

export function reorderExercises(dayId: string, exerciseIds: string[]): Promise<GymPlan> {
  return request<GymPlan>(`/gym/days/${enc(dayId)}/order`, {
    method: "PUT",
    body: JSON.stringify({ exerciseIds }),
  });
}

export function completeWorkout(): Promise<GymPlan> {
  return request<GymPlan>("/gym/complete", { method: "POST" });
}

// --- Finance ---

export type Payment = {
  amountCents: number;
  paidAt: string;
};

export type MonthBill = {
  id: string;
  name: string;
  amountCents: number;
  dueDay: number;
  active: boolean;
  payment: Payment | null;
};

export type Bill = {
  id: string;
  name: string;
  amountCents: number;
  dueDay: number;
};

export type FinanceMonth = {
  period: string;
  bills: MonthBill[];
  inactive: Bill[];
};

export type NewBill = {
  name: string;
  amountCents: number;
  dueDay: number;
};

export type BillChanges = Partial<Omit<MonthBill, "id" | "payment">>;

// The month this device is in right now, as "2026-11", in local time.
export function currentPeriod(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

export function getFinanceMonth(period: string): Promise<FinanceMonth> {
  return request<FinanceMonth>(`/finance/months/${enc(period)}`);
}

export function addBill(period: string, bill: NewBill): Promise<FinanceMonth> {
  return request<FinanceMonth>(`/finance/bills?period=${enc(period)}`, {
    method: "POST",
    body: JSON.stringify(bill),
  });
}

export function updateBill(
  period: string,
  billId: string,
  changes: BillChanges
): Promise<FinanceMonth> {
  return request<FinanceMonth>(`/finance/bills/${enc(billId)}?period=${enc(period)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function markPaid(period: string, billId: string): Promise<FinanceMonth> {
  return request<FinanceMonth>(`/finance/months/${enc(period)}/payments/${enc(billId)}`, {
    method: "PUT",
  });
}

export function markUnpaid(period: string, billId: string): Promise<FinanceMonth> {
  return request<FinanceMonth>(`/finance/months/${enc(period)}/payments/${enc(billId)}`, {
    method: "DELETE",
  });
}

// The finance tile's loader. It asks for the month the device is in at the
// moment of each refresh, so on the 1st the tile moves to the new month by itself.
export function loadCurrentMonth(): Promise<FinanceMonth> {
  return getFinanceMonth(currentPeriod());
}
