import { Real3DScene } from '../components/Real3DScene';

/**
 * Isolated proof-of-concept route, not linked from the navbar or any real
 * page — lets us judge visual quality and performance before touching
 * EventListPage or anything a real buyer sees.
 */
export function Lab3DPage() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 1,
          color: 'var(--paper, #ece2c6)',
          background: 'rgba(0,0,0,0.5)',
          padding: '0.75rem 1rem',
          borderRadius: 4,
          maxWidth: 420,
        }}
      >
        <h1 style={{ fontSize: '1.1rem', margin: 0 }}>3D 場景 POC（僅供內部測試，非正式頁面）</h1>
        <p className="hint" style={{ margin: '0.4rem 0 0' }}>
          滿版即時 3D 場景：地面反光、天際線量體、飄浮粒子、霓虹招牌皆為真實 3D 幾何，移動滑鼠看視差。
        </p>
      </div>
      <Real3DScene
        fallback={<p className="error">此裝置不支援 3D 場景，或場景載入失敗（已降級）</p>}
      />
    </div>
  );
}
