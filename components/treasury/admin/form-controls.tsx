import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const TREASURY_SELECT_CLASS =
  "border-border bg-background w-full rounded-md border px-3 py-2 text-sm";

export function FieldHelp({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-destructive text-xs">
      {children}
    </p>
  );
}

export function FormField({
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const helpId = help ? `${htmlFor}-help` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {help ? (
        <p id={helpId} className="text-muted-foreground text-xs">
          {help}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

export function CanonicalSelect({
  id,
  name,
  value,
  onChange,
  options,
  blankLabel,
  disabled,
  testId,
  required,
}: {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  blankLabel: string;
  disabled?: boolean;
  testId?: string;
  required?: boolean;
}) {
  return (
    <select
      id={id}
      name={name}
      data-testid={testId}
      className={cn(TREASURY_SELECT_CLASS, disabled && "cursor-not-allowed opacity-50")}
      value={value}
      disabled={disabled}
      required={required}
      onChange={(event) => onChange(event.target.value)}
    >
      {required ? null : <option value="">{blankLabel}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
