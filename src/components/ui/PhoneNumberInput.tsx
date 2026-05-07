"use client";

import { PhoneInput } from "react-international-phone";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  defaultCountry?: "sg" | "my" | "id" | "th" | "ph" | "vn" | "us" | "gb" | "au";
};

export function PhoneNumberInput({
  value,
  onChange,
  disabled = false,
  required = false,
  placeholder = "Enter phone number",
  defaultCountry = "sg",
}: Props) {
  return (
    <PhoneInput
      value={value}
      onChange={(phone) => onChange(phone)}
      defaultCountry={defaultCountry}
      preferredCountries={["sg", "my", "id", "th", "ph", "vn", "au", "gb", "us"]}
      forceDialCode
      disabled={disabled}
      required={required}
      placeholder={placeholder}
      className="intl-phone-field"
      inputClassName="intl-phone-field__input"
      countrySelectorStyleProps={{
        className: "intl-phone-field__selector",
        buttonClassName: "intl-phone-field__selector-button",
        dropdownStyleProps: {
          className: "intl-phone-field__dropdown",
        },
      }}
      inputProps={{
        autoComplete: "tel",
        inputMode: "tel",
      }}
    />
  );
}
