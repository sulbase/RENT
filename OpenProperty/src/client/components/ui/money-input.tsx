import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { getFormatPrefs } from "@/lib/format-prefs";
import { Input } from "./input";

const LEGACY_AMOUNT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function amountFormatter(currency?: string) {
  if (!currency) return LEGACY_AMOUNT;
  const locale = getFormatPrefs().language === "en" ? "en-US" : "es-MX";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function cleanAmount(raw: string): string {
  const digits = raw.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = digits.split(".");
  if (rest.length === 0) return whole;
  return `${whole}.${rest.join("").slice(0, 2)}`;
}

/** Dollar amount: the field keeps a plain number string, it only looks like `$1,250.00`. */
export function MoneyInput({
  id,
  value,
  onChange,
  className,
  disabled,
  currency,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  /** When set, the field shows `Intl` currency formatting (es-MX / org code). */
  currency?: string;
}) {
  const [editing, setEditing] = useState(false);
  const formatter = useMemo(() => amountFormatter(currency), [currency]);
  const amount = Number.parseFloat(value);
  const shown = editing || value === "" || Number.isNaN(amount) ? value : formatter.format(amount);
  const withSymbol = Boolean(currency);

  return (
    <div className={cn("relative", className)}>
      {!withSymbol ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[0.9375rem] text-muted-foreground">
          $
        </span>
      ) : null}
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        className={cn("tabular-nums", withSymbol ? "pl-3" : "pl-7")}
        value={shown}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(event) => onChange(cleanAmount(event.target.value))}
      />
    </div>
  );
}
