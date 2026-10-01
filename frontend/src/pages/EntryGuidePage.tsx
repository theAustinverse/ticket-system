import { Link } from 'react-router-dom';

/**
 * Static walkthrough of how to get in on the day: finding your QR code,
 * sharing seats as a group leader, and what happens at the door. The art
 * lives in public/guide (rendered offline, not generated at runtime); the
 * phone screens in it are labelled as samples.
 */
export function EntryGuidePage() {
  return (
    <div className="page page-narrow entry-guide">
      <h1>多比的入場小幫手</h1>
      <p className="muted">
        活動當天怎麼入場？個人票、團體票主揪、團員都看這裡。
      </p>
      <p>
        <a href="/guide/entry-guide.pdf" target="_blank" rel="noopener noreferrer">
          下載 PDF 版（可列印）
        </a>
      </p>
      <img
        src="/guide/entry-1.jpg"
        alt="入場教學第一部分：個人票、團體票主揪"
        loading="lazy"
      />
      <img
        src="/guide/entry-2.jpg"
        alt="入場教學第二部分：團員、活動當天、常見問題"
        loading="lazy"
      />
      <p>
        <Link to="/my-tickets">前往我的票卷</Link>
      </p>
    </div>
  );
}
