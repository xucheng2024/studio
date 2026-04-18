"use client";

import { useFormStatus } from "react-dom";

type Props = {
  className: string;
  children: React.ReactNode;
  pendingText?: string;
  disabled?: boolean;
};

export function SubmitButton({ className, children, pendingText = "Loading...", disabled = false }: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || pending}>
      {pending ? pendingText : children}
    </button>
  );
}
