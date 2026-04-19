"use client";

/**
 * Styled toggle switch that works as a native form control.
 * Drop-in replacement for <input type="checkbox"> — same props, same FormData value.
 */
export function Toggle({
  id,
  name,
  defaultChecked,
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  id?: string;
  name?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <label
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        type="checkbox"
        id={id}
        name={name}
        defaultChecked={defaultChecked}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="peer sr-only"
      />
      {/* Track */}
      <span className="absolute inset-0 rounded-full bg-stone-200 transition-colors peer-checked:bg-teal-500 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-500 peer-focus-visible:ring-offset-2 dark:bg-stone-700 dark:peer-checked:bg-teal-500" />
      {/* Thumb */}
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform peer-checked:translate-x-5" />
    </label>
  );
}
