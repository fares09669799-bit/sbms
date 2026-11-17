import React from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className, id, ...props }) => {
  const inputId = id || React.useId();
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-[#142D35]">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          'h-10 w-full rounded-lg border border-[#E2E7E5] bg-white px-3 text-sm text-[#142D35] placeholder:text-[#8A9A9E] transition-colors focus:outline-none focus:border-[#176B55] focus:ring-2 focus:ring-[#176B55]/15 disabled:bg-[#F5F7F6]',
          error && 'border-[#B91C1C] focus:border-[#B91C1C] focus:ring-[#B91C1C]/15',
          className
        )}
        {...props}
      />
      {error && <span className="text-xs text-[#B91C1C]">{error}</span>}
    </div>
  );
};

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  error,
  className,
  id,
  children,
  ...props
}) => {
  const selectId = id || React.useId();
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={selectId} className="text-xs font-medium text-[#142D35]">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={cn(
          'h-10 w-full rounded-lg border border-[#E2E7E5] bg-white px-3 text-sm text-[#142D35] transition-colors focus:outline-none focus:border-[#176B55] focus:ring-2 focus:ring-[#176B55]/15',
          error && 'border-[#B91C1C]',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <span className="text-xs text-[#B91C1C]">{error}</span>}
    </div>
  );
};
