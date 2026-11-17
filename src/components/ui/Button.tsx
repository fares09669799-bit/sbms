import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'gold';
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}) => {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176B55] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer';

  const variants = {
    primary: 'bg-[#176B55] text-white hover:bg-[#125644]',
    secondary: 'bg-[#142D35] text-white hover:bg-[#1C3D47]',
    gold: 'bg-[#D8AD65] text-[#142D35] hover:bg-[#c99b50]',
    outline: 'bg-white text-[#142D35] border border-[#E2E7E5] hover:bg-[#F5F7F6]',
    ghost: 'bg-transparent text-[#5A6B6E] hover:bg-[#E2E7E5]/40 hover:text-[#142D35]',
    danger: 'bg-[#B91C1C] text-white hover:bg-[#991B1B]',
  };

  const sizes = {
    sm: 'h-9 px-3.5 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-11 px-6 text-sm',
  };

  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
};
