import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  addBill,
  currentPeriod,
  markPaid,
  markUnpaid,
  updateBill,
  type BillChanges,
  type FinanceMonth,
  type MonthBill,
  type NewBill,
} from "./data";
import { formatEuros, parseEuros, toEuroInput } from "./money";

// The one-line summary shown on the finance tile.
export function financePreview(month: FinanceMonth): string {
  const total = month.bills.length;
  if (total === 0) return "No bills yet";

  const unpaid = month.bills.filter((bill) => bill.payment === null);
  if (unpaid.length === 0) return `All ${total} paid this month`;

  const due = unpaid.reduce((sum, bill) => sum + bill.amountCents, 0);
  return `${total - unpaid.length} of ${total} paid · ${formatEuros(due)} still due`;
}

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

// A bill due on the 31st falls on the last day of shorter months.
function dueDate(period: string, dueDay: number): Date {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(dueDay, lastDay));
}

function isOverdue(bill: MonthBill, period: string): boolean {
  if (bill.payment !== null) return false;
  const now = currentPeriod();
  if (period < now) return true;
  if (period > now) return false;
  return new Date().getDate() > dueDate(period, bill.dueDay).getDate();
}

// The name/amount/due-day form, used both for adding a bill and for editing one.
// It keeps what you type in its own state, so background refreshes can't
// overwrite it, and only hands over a bill once everything is valid.
function BillForm({
  initial,
  submitLabel,
  onSubmit,
  onError,
  onCancel,
  children,
}: {
  initial?: NewBill;
  submitLabel: string;
  onSubmit: (bill: NewBill) => Promise<boolean>;
  onError: (message: string) => void;
  onCancel?: () => void;
  children?: ReactNode;
}) {
  const start = {
    name: initial?.name ?? "",
    amount: initial ? toEuroInput(initial.amountCents) : "",
    dueDay: initial ? String(initial.dueDay) : "",
  };
  const [name, setName] = useState(start.name);
  const [amount, setAmount] = useState(start.amount);
  const [dueDay, setDueDay] = useState(start.dueDay);

  async function submit() {
    const amountCents = parseEuros(amount);
    const day = Number(dueDay);
    if (!name.trim() || amountCents === null || !Number.isInteger(day) || day < 1 || day > 31) {
      onError("Fill in a name, an amount like 12,50 and a due day from 1 to 31.");
      return;
    }

    if (await onSubmit({ name: name.trim(), amountCents, dueDay: day })) {
      setName(start.name);
      setAmount(start.amount);
      setDueDay(start.dueDay);
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter") submit();
    if (e.key === "Escape" && onCancel) {
      // Stop the Escape here, so it doesn't also close the whole tile.
      e.stopPropagation();
      onCancel();
    }
  }

  return (
    <div className="bill-form">
      <input
        className="bill-form-name"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKey}
      />
      <input
        placeholder="Amount (12,50)"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={handleKey}
      />
      <input
        type="number"
        placeholder="Due day"
        inputMode="numeric"
        min={1}
        max={31}
        value={dueDay}
        onChange={(e) => setDueDay(e.target.value)}
        onKeyDown={handleKey}
      />
      <div className="bill-form-actions">
        <button onClick={submit}>{submitLabel}</button>
        {onCancel && <button onClick={onCancel}>Cancel</button>}
        {children}
      </div>
    </div>
  );
}

type Props = {
  month: FinanceMonth;
  onChange: (month: FinanceMonth) => void;
};

export default function FinanceView({ month, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  // The id of the bill being edited, if any. Only one at a time.
  const [editing, setEditing] = useState<string | null>(null);

  // Every action works on the month that's on screen, not on "now".
  const period = month.period;
  const [year, monthNumber] = period.split("-").map(Number);

  // Every change goes to the server; its answer becomes the new month.
  // Returns whether it worked, so forms know when to clear or close.
  async function run(action: () => Promise<FinanceMonth>): Promise<boolean> {
    try {
      onChange(await action());
      setError(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }

  function togglePaid(bill: MonthBill) {
    run(() =>
      bill.payment === null ? markPaid(period, bill.id) : markUnpaid(period, bill.id)
    );
  }

  // Only send the fields that actually changed.
  async function saveEdit(bill: MonthBill, values: NewBill): Promise<boolean> {
    const changes: BillChanges = {};
    if (values.name !== bill.name) changes.name = values.name;
    if (values.amountCents !== bill.amountCents) changes.amountCents = values.amountCents;
    if (values.dueDay !== bill.dueDay) changes.dueDay = values.dueDay;

    if (Object.keys(changes).length === 0) {
      setEditing(null);
      return true;
    }

    const saved = await run(() => updateBill(period, bill.id, changes));
    if (saved) setEditing(null);
    return saved;
  }

  function setActive(billId: string, active: boolean) {
    setEditing(null);
    run(() => updateBill(period, billId, { active }));
  }

  function billRow(bill: MonthBill) {
    if (editing === bill.id) {
      return (
        <li key={bill.id} className="bill editing">
          <BillForm
            initial={bill}
            submitLabel="Save"
            onSubmit={(values) => saveEdit(bill, values)}
            onError={setError}
            onCancel={() => setEditing(null)}
          >
            <button className="deactivate" onClick={() => setActive(bill.id, false)}>
              Deactivate
            </button>
          </BillForm>
        </li>
      );
    }

    const paid = bill.payment !== null;
    const classes = ["bill"];
    if (paid) classes.push("paid");
    if (!bill.active) classes.push("inactive");
    if (isOverdue(bill, period)) classes.push("overdue");

    return (
      <li key={bill.id} className={classes.join(" ")}>
        <label className="bill-main">
          <input type="checkbox" checked={paid} onChange={() => togglePaid(bill)} />
          <span className="bill-name">{bill.name}</span>
        </label>
        <span className="bill-due">
          {bill.payment
            ? `Paid ${shortDate.format(new Date(bill.payment.paidAt))}`
            : `Due ${shortDate.format(dueDate(period, bill.dueDay))}`}
          {!bill.active && " · inactive"}
        </span>
        <span className="bill-amount">
          {formatEuros(bill.payment?.amountCents ?? bill.amountCents)}
        </span>
        {bill.active ? (
          <button className="move bill-action" title="Edit bill" onClick={() => setEditing(bill.id)}>
            ✎
          </button>
        ) : (
          <span className="bill-action" />
        )}
      </li>
    );
  }

  return (
    <div className="finance">
      <h2>{monthTitle.format(new Date(year, monthNumber - 1, 1))}</h2>
      <p className="bill-summary">{financePreview(month)}</p>
      {error && <p className="error">{error}</p>}

      {month.bills.length === 0 ? (
        <p className="empty">No bills yet. Add your first one below.</p>
      ) : (
        <ul className="bill-list">{month.bills.map(billRow)}</ul>
      )}

      <h3 className="section-title">New bill</h3>
      <BillForm
        submitLabel="+ Add bill"
        onSubmit={(bill) => run(() => addBill(period, bill))}
        onError={setError}
      />

      {month.inactive.length > 0 && (
        <details className="inactive-bills">
          <summary className="section-title">Inactive bills ({month.inactive.length})</summary>
          <ul className="bill-list">
            {month.inactive.map((bill) => (
              <li key={bill.id} className="bill inactive">
                <span className="bill-main">
                  <span className="bill-name">{bill.name}</span>
                </span>
                <span className="bill-due">Day {bill.dueDay}</span>
                <span className="bill-amount">{formatEuros(bill.amountCents)}</span>
                <button
                  className="move bill-action"
                  title="Reactivate bill"
                  onClick={() => setActive(bill.id, true)}
                >
                  ↺
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
