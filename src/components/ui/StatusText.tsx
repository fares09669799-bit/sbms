import React from 'react';
import { AlertCircle, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';

type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

interface StatusTextProps {
  tone: StatusTone;
  label: string;
  showIcon?: boolean;
  className?: string;
}

/**
 * Clean unboxed semantic status text paired with an explicit icon (zero pill enclosures).
 */
export const StatusText: React.FC<StatusTextProps> = ({
  tone,
  label,
  showIcon = true,
  className,
}) => {
  const styles: Record<StatusTone, string> = {
    success: 'text-[#176B55]',
    warning: 'text-[#9A6714]',
    danger: 'text-[#B91C1C]',
    neutral: 'text-[#5A6B6E]',
  };

  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'warning'
      ? AlertTriangle
      : tone === 'danger'
      ? AlertCircle
      : Clock;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', styles[tone], className)}>
      {showIcon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span>{label}</span>
    </span>
  );
};
