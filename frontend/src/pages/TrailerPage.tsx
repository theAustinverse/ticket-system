import { Link } from 'react-router-dom';

export function TrailerPage() {
  return (
    <div className="page trailer-page">
      <Link to="/events" className="trailer-back">
        ← 返回活動列表
      </Link>
      <h1>2026 TS年度盛會 預告片</h1>
      <video className="trailer-video" src="/videos/teaser.mp4" controls autoPlay playsInline />
    </div>
  );
}
