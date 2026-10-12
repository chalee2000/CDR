import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing it (e.g. switching tab) clears a previous error. */
  resetKey?: unknown;
  label?: string;
}

/** Keeps one failing view from blanking the whole app (and the loaded data). */
export class ErrorBoundary extends Component<Props, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('View failed to render', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="note warn" role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>
          <strong>แสดง{this.props.label ?? 'ส่วนนี้'}ไม่สำเร็จ</strong> — {error.message} (ข้อมูลที่นำเข้ายังอยู่ ลองเปลี่ยนแท็บหรือกดลองอีกครั้ง)
        </span>
        <button className="btn small" type="button" onClick={() => this.setState({ error: undefined })}>
          ลองอีกครั้ง
        </button>
      </div>
    );
  }
}
