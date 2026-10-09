import { OFFICIAL_LINE_URL } from '../constants';

/** One prominent "add us on LINE" link, shown above the list of contact people. */
export function OfficialLine() {
  return (
    <a
      className="official-line"
      href={OFFICIAL_LINE_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="official-line-badge">LINE</span>
      <span className="official-line-text">
        <strong>加入官方 LINE</strong>
        <small>點此加入，直接與我們聯絡</small>
      </span>
      <span className="official-line-go" aria-hidden="true">→</span>
    </a>
  );
}
