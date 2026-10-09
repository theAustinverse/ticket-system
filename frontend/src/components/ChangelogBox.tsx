import { recentEntries, CHANGELOG, RECENT_DAYS } from '../changelog';

/** "更新日誌" at the bottom of the home page: what was added in the last few days. */
export function ChangelogBox() {
  const entries = recentEntries(CHANGELOG);
  if (entries.length === 0) return null;
  return (
    <section className="changelog-box">
      <h2>更新日誌</h2>
      <p className="hint">最近 {RECENT_DAYS} 天新增的功能</p>
      <ul className="changelog-list">
        {entries.map((e) => (
          <li key={e.id}>
            <span className="changelog-date">{e.date.slice(5).replace('-', '/')}</span>
            <div>
              <strong>{e.title}</strong>
              <p>{e.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
