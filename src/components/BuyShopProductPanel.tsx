"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { GiftRecipientFields, type GiftPayload } from "@/components/GiftRecipientFields";
import {
  ShippingAddressFields,
  type ShippingAddressDefaults,
  type ShippingAddressPayload,
} from "@/components/ShippingAddressFields";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { getBrowserSession } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type Props = {
  productId: string;
  studioSlug: string;
  disabled?: boolean;
  outOfStock?: boolean;
  shippingDefaults?: ShippingAddressDefaults | null;
  actionLabel?: string;
};

type GuestCheckoutPayload = {
  guest_email?: string;
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

export function BuyShopProductPanel({
  productId,
  studioSlug,
  disabled = false,
  outOfStock = false,
  shippingDefaults,
  actionLabel = "Buy now",
}: Props) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [guestEmail, setGuestEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveToProfile, setSaveToProfile] = useState(true);
  const [gift, setGift] = useState<GiftPayload | null>(null);
  const rootRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    getBrowserSession()
      .then((session) => {
        setIsLoggedIn(!!session?.user);
        setUserEmail(session?.user?.email ?? null);
      })
      .catch(() => {
        setIsLoggedIn(false);
        setUserEmail(null);
      });
  }, []);

  const submit = async (payload: GuestCheckoutPayload = {}) => {
    const session = await getBrowserSession().catch(() => null);
    const currentlyLoggedIn = !!session?.user;
    const currentUserEmail = session?.user?.email ?? null;

    const buyerEmail = (payload.guest_email ?? currentUserEmail ?? "").trim().toLowerCase();

    if (gift?.is_gift) {
      if (!gift.gift_recipient_email) {
        const message = "Please enter the recipient email.";
        setMsg(message);
        return { ok: false as const, message };
      }
      if (buyerEmail && gift.gift_recipient_email === buyerEmail) {
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
    if (!currentlyLoggedIn && !buyerEmail) {
      const message = "Please enter your email.";
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
          slug: studioSlug,
          guest_name: currentlyLoggedIn ? undefined : shipping.shipping_name,
          guest_email: currentlyLoggedIn ? undefined : buyerEmail,
          guest_phone: currentlyLoggedIn ? undefined : shipping.shipping_phone,
          ...(gift ?? {}),
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
    <ShippingAddressFields
      defaults={{
        shipping_city: "Singapore",
        shipping_country: "SG",
        ...(shippingDefaults ?? {}),
      }}
      cityMode="hidden_singapore"
      countryMode="hidden_sg"
    />
  );

  if (isLoggedIn === false) {
    return (
      <form
        ref={rootRef}
        className="flex w-full max-w-md flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ guest_email: guestEmail });
        }}
      >
        <label className="grid gap-1.5">
          <span className={ui.label}>Email</span>
          <input
            type="email"
            name="guest_email"
            className={ui.input}
            value={guestEmail}
            onChange={(event) => setGuestEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
          <span className={`text-xs ${ui.muted}`}>Order updates and receipt will be sent here.</span>
        </label>
        <GiftRecipientFields value={gift} onChange={setGift} buyerEmail={guestEmail} />
        {shippingBlock}
        <button
          type="submit"
          disabled={disabled || busy || !guestEmail.trim() || (gift?.is_gift === true && !gift.gift_recipient_email.trim())}
          className={`${ui.btnPrimary} w-full justify-center`}
        >
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Creating...
            </>
          ) : outOfStock ? (
            "Out of stock"
          ) : (
            actionLabel
          )}
        </button>
        {msg ? <p className={`text-sm ${ui.error}`}>{msg}</p> : null}
      </form>
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
    <form
      ref={rootRef}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ guest_email: userEmail ?? undefined });
      }}
    >
      <GiftRecipientFields value={gift} onChange={setGift} buyerEmail={userEmail} />
      {shippingBlock}
      <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-600 transition hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-400 dark:hover:bg-stone-800/50">
        <input
          type="checkbox"
          checked={saveToProfile}
          onChange={(e) => setSaveToProfile(e.target.checked)}
          className="accent-teal-600"
        />
        Save shipping address to my profile
      </label>
      <button
        type="submit"
        disabled={disabled || busy || (gift?.is_gift === true && !gift.gift_recipient_email.trim())}
        className={`${ui.btnPrimary} w-full justify-center`}
      >
        {busy ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            Creating...
          </>
        ) : outOfStock ? (
          "Out of stock"
        ) : (
          actionLabel
        )}
      </button>
      {msg ? <p className={`text-sm ${ui.error}`}>{msg}</p> : null}
    </form>
  );
}
