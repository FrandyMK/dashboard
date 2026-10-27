// Money is integer cents everywhere. These two functions are the only
// places where it turns into text and back.

const euros = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

export function formatEuros(cents: number): string {
  return euros.format(cents / 100);
}

// Turns what someone typed ("12,50", "12.50", "€ 1.234,56", "12") into cents.
// Returns null for anything it can't read with certainty.
export function parseEuros(text: string): number | null {
  let s = text.replace(/[€\s]/g, "");
  // With a comma, the comma is the decimal separator and dots group thousands.
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return null;

  const [, whole, fraction = ""] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

// Cents as text for an input field to start from: 95000 becomes "950,00".
export function toEuroInput(cents: number): string {
  const fraction = String(cents % 100).padStart(2, "0");
  return `${Math.floor(cents / 100)},${fraction}`;
}
