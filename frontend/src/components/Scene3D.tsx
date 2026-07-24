import { Component, Suspense, lazy, type ReactNode } from 'react';

const Spline = lazy(() => import('@splinetool/react-spline'));

/** True once, cached — WebGL support doesn't change within a session. */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * A 3D scene failing to load (bad URL, GPU driver crash, out-of-memory on a
 * low-end phone) must never take the surrounding page down with it — this
 * always renders the caller's 2D fallback instead of a blank crash.
 */
export class SceneErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

interface Scene3DProps {
  /** .splinecode scene URL exported from spline.design. */
  sceneUrl: string;
  /** Rendered instead when WebGL is unavailable or the scene fails to load. */
  fallback: ReactNode;
}

/** Renders an interactive Spline scene, transparently falling back to 2D content on any failure. */
export function Scene3D({ sceneUrl, fallback }: Scene3DProps) {
  if (!supportsWebGL()) return <>{fallback}</>;

  return (
    <SceneErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Spline scene={sceneUrl} />
      </Suspense>
    </SceneErrorBoundary>
  );
}
