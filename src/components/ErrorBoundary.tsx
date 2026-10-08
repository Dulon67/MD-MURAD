import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'একটি অপ্রত্যাশিত ত্রুটি ঘটেছে।',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let parsedError: Record<string, unknown> | null = null;
      try {
        parsedError = JSON.parse(this.state.errorMessage);
      } catch {
        parsedError = null;
      }

      const isQuotaExceeded =
        this.state.errorMessage.includes('Quota exceeded') ||
        this.state.errorMessage.includes('Free daily read units');

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-900">
          <div className="max-w-xl w-full bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-semibold">সিস্টেম ত্রুটি সনাক্ত হয়েছে</h1>
            </div>

            {isQuotaExceeded ? (
              <p className="text-sm text-slate-700 leading-relaxed">
                আপনার প্রজেক্টের ফ্রি Firestore কোটা অতিক্রম করেছে। আগামীকাল কোটা পুনরায় রিসেট হবে। বিস্তারিত জানতে{' '}
                <a
                  href="https://firebase.google.com/pricing#cloud-firestore"
                  target="_blank"
                  rel="noreferrer"
                  className="text-red-700 underline font-medium"
                >
                  Firebase Spark Plan Quota
                </a>{' '}
                পৃষ্ঠাটি দেখুন।
              </p>
            ) : parsedError ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-700">
                  ডাটাবেজ অপারেশন ({String(parsedError.operationType || 'unknown')}) সম্পন্ন করার সময় অনুমতি বা সংযোগ সংক্রান্ত ত্রুটি ঘটেছে।
                </p>
                <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded overflow-x-auto">
                  {JSON.stringify(parsedError, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-slate-700 break-words font-mono bg-slate-100 p-3 rounded">
                {this.state.errorMessage}
              </p>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>পুনরায় লোড করুন</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
