import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RENT_DUE_DAY_OPTIONS } from "../../shared/rent-due-day";

export function RentDueDaySelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Elige el día" />
        </SelectTrigger>
        <SelectContent>
          {RENT_DUE_DAY_OPTIONS.map((day) => (
            <SelectItem key={day} value={String(day)}>
              {day}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}