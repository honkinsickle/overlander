import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Freeform text input with a pin icon on the left. Uses the shared
 * `.form-field` primitive (46h, radius 4, 3px focus ring).
 * Geocoding / autocomplete deferred; raw string for now.
 */
export function LocationInput({
  name,
  placeholder,
  defaultValue,
  required,
  id,
  className,
}: {
  name: string;
  placeholder: string;
  defaultValue?: string;
  required?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <MapPin
        aria-hidden
        className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted"
      />
      <input
        id={id}
        name={name}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="form-field w-full pl-10"
      />
    </div>
  );
}
