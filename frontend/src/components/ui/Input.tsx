// Canonical form-control classes. Previously each form file declared its own
// copy of these strings; importing from here keeps hover/focus treatments in
// lockstep everywhere.

import { forwardRef, type InputHTMLAttributes } from "react";

export const inputClass =
  "h-8 w-full rounded-md border border-hairline bg-white px-2.5 text-sm text-ink " +
  "placeholder:text-ink-faint outline-none transition " +
  "hover:border-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft";

export const textareaClass =
  "w-full rounded-md border border-hairline bg-white px-2.5 py-2 text-sm text-ink " +
  "placeholder:text-ink-faint outline-none transition " +
  "hover:border-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft";

export const selectClass =
  "h-8 cursor-pointer rounded-md border border-hairline bg-white px-2 text-sm " +
  "font-medium text-ink-dim outline-none transition " +
  "hover:border-ink-faint hover:text-ink focus:border-accent focus:ring-2 focus:ring-accent-soft";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={className ? `${inputClass} ${className}` : inputClass}
        {...rest}
      />
    );
  },
);
