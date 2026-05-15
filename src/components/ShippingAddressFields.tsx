"use client";

import { FormPhoneField } from "@/components/ui/FormPhoneField";
import { ui } from "@/lib/ui";

export type ShippingAddressPayload = {
  shipping_name: string;
  shipping_phone: string;
  shipping_address_line1: string;
  shipping_address_line2?: string | null;
  shipping_city: string;
  shipping_postal_code: string;
  shipping_country: string;
};

export type ShippingAddressDefaults = Partial<ShippingAddressPayload>;

type Props = {
  defaults?: ShippingAddressDefaults | null;
  namePrefix?: string;
};

function fieldName(prefix: string | undefined, key: string) {
  return prefix ? `${prefix}_${key}` : key;
}

export function ShippingAddressFields({ defaults, namePrefix }: Props) {
  const d = defaults ?? {};
  return (
    <fieldset className="grid gap-3 rounded-xl border border-stone-200 p-4 dark:border-stone-700">
      <legend className="px-1 text-sm font-semibold text-stone-900 dark:text-stone-100">Shipping address</legend>
      <label className="grid gap-1.5">
        <span className={ui.label}>Recipient name</span>
        <input
          name={fieldName(namePrefix, "shipping_name")}
          required
          className={ui.input}
          defaultValue={d.shipping_name ?? ""}
          autoComplete="name"
        />
      </label>
      <label className="grid gap-1.5">
        <span className={ui.label}>Phone</span>
        <FormPhoneField name={fieldName(namePrefix, "shipping_phone")} defaultValue={d.shipping_phone ?? ""} required />
      </label>
      <label className="grid gap-1.5">
        <span className={ui.label}>Address line 1</span>
        <input
          name={fieldName(namePrefix, "shipping_address_line1")}
          required
          className={ui.input}
          defaultValue={d.shipping_address_line1 ?? ""}
          autoComplete="address-line1"
        />
      </label>
      <label className="grid gap-1.5">
        <span className={ui.label}>Address line 2 (optional)</span>
        <input
          name={fieldName(namePrefix, "shipping_address_line2")}
          className={ui.input}
          defaultValue={d.shipping_address_line2 ?? ""}
          autoComplete="address-line2"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={ui.label}>City</span>
          <input
            name={fieldName(namePrefix, "shipping_city")}
            required
            className={ui.input}
            defaultValue={d.shipping_city ?? ""}
            autoComplete="address-level2"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={ui.label}>Postal code</span>
          <input
            name={fieldName(namePrefix, "shipping_postal_code")}
            required
            className={ui.input}
            defaultValue={d.shipping_postal_code ?? ""}
            autoComplete="postal-code"
          />
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className={ui.label}>Country</span>
        <input
          name={fieldName(namePrefix, "shipping_country")}
          required
          className={ui.input}
          defaultValue={d.shipping_country ?? "SG"}
          autoComplete="country"
        />
      </label>
    </fieldset>
  );
}

export function readShippingFromFormData(formData: FormData, prefix?: string): ShippingAddressPayload | null {
  const shipping_name = String(formData.get(fieldName(prefix, "shipping_name")) ?? "").trim();
  const shipping_phone = String(formData.get(fieldName(prefix, "shipping_phone")) ?? "").trim();
  const shipping_address_line1 = String(formData.get(fieldName(prefix, "shipping_address_line1")) ?? "").trim();
  const shipping_address_line2 = String(formData.get(fieldName(prefix, "shipping_address_line2")) ?? "").trim() || null;
  const shipping_city = String(formData.get(fieldName(prefix, "shipping_city")) ?? "").trim();
  const shipping_postal_code = String(formData.get(fieldName(prefix, "shipping_postal_code")) ?? "").trim();
  const shipping_country = String(formData.get(fieldName(prefix, "shipping_country")) ?? "SG").trim() || "SG";
  if (!shipping_name || !shipping_phone || !shipping_address_line1 || !shipping_city || !shipping_postal_code) {
    return null;
  }
  return {
    shipping_name,
    shipping_phone,
    shipping_address_line1,
    shipping_address_line2,
    shipping_city,
    shipping_postal_code,
    shipping_country,
  };
}
