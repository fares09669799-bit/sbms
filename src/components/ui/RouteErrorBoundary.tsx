import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './Button';

interface RouteErrorBoundaryProps {
  resetKey?: string;
  children: React.ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class RouteErrorBoundary extends React.Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: unknown): RouteErrorBoundaryState {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'تعذر تحميل الصفحة المطلوبة.';
    return {
      hasError: true,
      errorMessage: message,
    };
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white border border-[#E2E7E5] rounded-xl p-8 text-center max-w-lg mx-auto my-8 space-y-4">
          <div className="w-11 h-11 rounded-full bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-[#142D35]">
              تعذر تحميل الصفحة الحالية
            </h2>
            <p className="text-xs text-[#5A6B6E] leading-relaxed">
              حدث انقطاع مؤقت أثناء جلب وحدة الصفحة من الخادم. يمكنك إعادة المحاولة أو تحديث التطبيق.
            </p>
            {this.state.errorMessage && (
              <p className="text-[11px] font-mono text-[#5A6B6E] break-all pt-1" dir="ltr">
                {this.state.errorMessage}
              </p>
            )}
          </div>
          <div className="flex items-center justify-center gap-3 pt-1">
            <Button variant="primary" size="sm" onClick={this.handleRetry}>
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة المحاولة</span>
            </Button>
            <Button variant="outline" size="sm" onClick={this.handleReload}>
              تحديث الصفحة
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
