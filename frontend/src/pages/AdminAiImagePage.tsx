import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];

export function AdminAiImagePage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ mimeType: string; base64: string } | null>(null);

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
    }
  }, [token, navigate]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const image = await api.adminGenerateAiImage(token, prompt.trim(), aspectRatio);
      setResult(image);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '生成失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  const dataUrl = result ? `data:${result.mimeType};base64,${result.base64}` : null;
  const extension = result?.mimeType.split('/')[1] ?? 'png';

  return (
    <div className="page">
      <h1>AI 產圖工具</h1>
      <p className="hint">輸入描述文字，用 AI 產生素材圖片（背景、招牌、氛圍圖等），可直接下載使用。</p>
      <form onSubmit={handleGenerate} className="form">
        <label>
          描述文字（英文效果較穩定）
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：cinematic 3D rendered retro Hong Kong neon rooftop cityscape at night..."
            required
          />
        </label>
        <label>
          長寬比
          <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
            {ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? '生成中…' : '生成圖片'}
        </button>
      </form>
      {dataUrl && (
        <div className="ai-image-result">
          <img src={dataUrl} alt="AI 生成結果" style={{ maxWidth: '100%', borderRadius: 4 }} />
          <div className="button-row">
            <a href={dataUrl} download={`ai-image.${extension}`}>
              <button type="button">下載圖片</button>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
