"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { EmailFirstCheckout, type EmailFirstCheckoutPayload } from "@/components/EmailFirstCheckout";
import {
  ShippingAddressFields,
  type ShippingAddressDefaults,
  type ShippingAddressPayload,
} from "@/components/ShippingAddressFields";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type Props = {
  productId: string;
  disabled?: boolean;
  outOfStock?: boolean;
  shippingDefaults?: ShippingAddressDefaults | null;
};

type GiftPayload = {
  is_gift: true;
  gift_recipient_name: string | null;
  gift_recipient_email: string;
  gift_message: string | null;
};

function readShippingFromRoot(root: HTMLElement | null): ShippingAddressPayload | null {
  if (!root) return null;
  const val = (name: string) =>
    String((root.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? "").trim();
  const shipping_name = val("shipping_name");
  const shipping_phone = val("shipping_phone");
  const shipping_address_line1 = val("shipping_address_line1");
  const shipping_address_line2 = val("shipping_address_line2") || null;
  const shipping_city = val("shipping_city");
  const shipping_postal_code = val("shipping_postal_code");
  const shipping_country = val("shipping_country") || "SG";
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

function readGiftFromRoot(root: HTMLElement | null): Omit<GiftPayload, "is_gift"> | null {
  if (!root) return null;
  const val = (name: string) =>
    String((root.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? "").trim();
  const gift_recipient_email = val("gift_recipient_email").toLowerCase();
  if (!gift_recipient_email) return null;
  const gift_recipient_name = val("gift_recipient_name") || null;
  const gift_message = val("gift_message") || null;
  return {
    gift_recipient_name,
    gift_recipient_email,
    gift_message,
  };
}

export function BuyShopProductPanel({ productId, disabled = false, outOfStock = false, shippingDefaults }: Props) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveToProfile, setSaveToProfile] = useState(true);
  const [isGift, setIsGift] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => {
        setIsLoggedIn(!!data.session?.user);
        setUserEmail(data.session?.user?.email ?? null);
      });
  }, []);

  const submit = async (payload: EmailFirstCheckoutPayload = {}) => {
    // Re-check auth so OTP sign-ins that happened inside EmailFirstCheckout are reflected.
    const { data: sessionData } = await createBrowserSupabase().auth.getSession();
    const currentlyLoggedIn = !!sessionData.session?.user;
    const currentUserEmail = sessionData.session?.user?.email ?? null;

    const buyerEmail = (payload.guest_email ?? currentUserEmail ?? "").trim().toLowerCase();
    const giftFields = isGift ? readGiftFromRoot(rootRef.current) : null;
    if (isGift) {
      if (!giftFields?.gift_recipient_email) {
        const message = "Please enter the recipient email.";
        setMsg(message);
        return { ok: false as const, message };
      }
      if (buyerEmail && giftFields.gift_recipient_email === buyerEmail) {
        const message = "You cannot send a gift to yourself.";
        setMsg(message);
        return { ok: false as const, message };
      }
    }
    const shipping = readShippingFromRoot(rootRef.current);
    if (!shipping) {
      const message = "Please complete the shipping address.";
      setMsg(message);
      return { ok: false as const, message };
    }
    try {
      setBusy(true);
      setMsg(null);
      const res = await fetch("/api/shop/purchase/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          guest_name: currentlyLoggedIn ? undefined : payload.guest_name,
          guest_email: currentlyLoggedIn ? undefined : payload.guest_email,
          guest_phone: currentlyLoggedIn ? undefined : payload.guest_phone,
          is_gift: isGift || undefined,
          gift_recipient_name: isGift ? giftFields?.gift_recipient_name ?? undefined : undefined,
          gift_recipient_email: isGift ? giftFields?.gift_recipient_email ?? undefined : undefined,
          gift_message: isGift ? giftFields?.gift_message ?? undefined : undefined,
          save_shipping_to_profile: currentlyLoggedIn ? saveToProfile : false,
          ...shipping,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = paymentErrorMessage(String(body.error ?? ""), body.error_detail);
        setMsg(message);
        return { ok: false as const, message };
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
        return { ok: true as const };
      }
      setMsg("Payment created");
      return { ok: true as const };
    } catch {
      const message = "Network error. Check your connection and try again.";
      setMsg(message);
      return { ok: false as const, message };
    } finally {
      setBusy(false);
    }
  };

  const shippingBlock = (
    <ShippingAddressFields defaults={shippingDefaults} />
  );

  const giftBlock = (
    <>
      <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
        <input
          type="checkbox"
          checked={isGift}
          onChange={(e) => setIsGift(e.target.checked)}
        />
        Send as a gift
      </label>
      {isGift ? (
        <div className="grid gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Recipient name (optional)</span>
            <input name="gift_recipient_name" className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Recipient email</span>
            <input name="gift_recipient_email" type="email" required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Gift message (optional)</span>
            <textarea
              name="gift_message"
              rows={3}
              maxLength={500}
              className={`${ui.input} min-h-[80px]`}
            />
          </label>
        </div>
      ) : null}
    </>
  );

  if (isLoggedIn === false) {
    return (
      <div ref={rootRef} className="flex w-full max-w-md flex-col gap-3">
        <EmailFirstCheckout
          submitLabel={outOfStock ? "Out of stock" : "Buy now"}
          busyLabel="Creating..."
          disabled={disabled}
          onSubmit={submit}
          extraFields={() => (
            <>
              {giftBlock}
              {shippingBlock}
            </>
          )}
        />
      </div>
    );
  }

  if (isLoggedIn === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <Loader2 className="size-4 animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {giftBlock}
      {shippingBlock}
      <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
        <input
          type="checkbox"
          checked={saveToProfile}
          onChange={(e) => setSaveToProfile(e.target.checked)}
        />
        Save shipping address to my profile
      </label>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void submit({ guest_email: userEmail ?? undefined })}
        className={ui.btnPrimary}
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Creating...
          </span>
        ) : outOfStock ? (
          "Out of stock"
        ) : (
          "Buy now"
        )}
      </button>
      {msg ? <p className={`text-sm ${ui.error}`}>{msg}</p> : null}
    </div>
  );
}
