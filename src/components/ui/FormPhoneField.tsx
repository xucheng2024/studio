"use client";

import { useState } from "react";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";

type Props = {
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export function FormPhoneField({
  name,
  defaultValue = "",
  required = false,
  disabled = false,
  placeholder = "9123 4567",
}: Props) {
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <PhoneNumberInput
        value={value}
        onChange={setValue}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
      />
    </>
  );
}
