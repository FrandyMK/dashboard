import { useState, type KeyboardEvent } from "react";
import {
  addBill,
  currentPeriod,
  markPaid,
  markUnpaid,
  type FinanceMonth,
  type MonthBill,
} from "./data";
import { formatEuros, parseEuros } from "./money";

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

type Props = {
  month: FinanceMonth;
  onChange: (month: FinanceMonth) => void;
};

export default function FinanceView({ month, onChange }: Props) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Every action works on the month that's on screen, not on "now".
  const period = month.period;
  const [year, monthNumber] = period.split("-").map(Number);

  // Every change goes to the server; its answer becomes the new month.
  // Returns whether it worked, so the add form knows when to clear itself.
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

  async function add() {
    const amountCents = parseEuros(amount);
    const day = Number(dueDay);
    if (!name.trim() || amountCents === null || !Number.isInteger(day) || day < 1 || day > 31) {
      setError("Fill in a name, an amount like 12,50 and a due day from 1 to 31.");
      return;
    }

    const saved = await run(() => addBill(period, { name: name.trim(), amountCents, dueDay: day }));
    if (saved) {
      setName("");
      setAmount("");
      setDueDay("");
    }
  }

  function billRow(bill: MonthBill) {
    const paid = bill.payment !== null;
    const classes = ["bill"];
    if (paid) classes.push("paid");
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
        </span>
        <span className="bill-amount">
          {formatEuros(bill.payment?.amountCents ?? bill.amountCents)}
        </span>
      </li>
    );
  }

  function submitOnEnter(e: KeyboardEvent) {
    if (e.key === "Enter") add();
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
      <div className="add-bill">
        <input
          className="add-bill-name"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={submitOnEnter}
        />
        <input
          placeholder="Amount (12,50)"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={submitOnEnter}
        />
        <input
          type="number"
          placeholder="Due day"
          inputMode="numeric"
          min={1}
          max={31}
          value={dueDay}
          onChange={(e) => setDueDay(e.target.value)}
          onKeyDown={submitOnEnter}
        />
        <button className="add-bill-button" onClick={add}>
          + Add bill
        </button>
      </div>
    </div>
  );
}
