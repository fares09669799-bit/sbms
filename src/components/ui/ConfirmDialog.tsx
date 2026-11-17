import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'primary';
  loading?: boolean;
  children?: React.ReactNode;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'تأكيد التنفيذ',
  cancelLabel = 'إلغاء',
  tone = 'warning',
  loading = false,
  children,
}) => {
  const iconColor =
    tone === 'danger'
      ? 'text-[#B91C1C] bg-[#FEE2E2]'
      : tone === 'warning'
      ? 'text-[#9A6714] bg-[#F7EFE0]'
      : 'text-[#176B55] bg-[#E6F4EF]';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <p className="text-sm text-[#142D35] leading-relaxed pt-1">{message}</p>
        </div>

        {children}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E7E5]">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'جاري التنفيذ...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
