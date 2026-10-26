import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

export function ChoiceMenu({ label, value, options, disabled = false, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={label} />}>
      <span className="truncate">{options.find((option) => option.value === value)?.label ?? label}</span><ChevronDownIcon data-icon="inline-end" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-h-80 w-max min-w-(--anchor-width) max-w-(--available-width) overflow-x-auto overflow-y-auto whitespace-nowrap">
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        <DropdownMenuGroup><DropdownMenuLabel>{label}</DropdownMenuLabel>
          {options.map((option) => <DropdownMenuRadioItem value={option.value} key={option.value} closeOnClick>{option.label}</DropdownMenuRadioItem>)}
        </DropdownMenuGroup>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
