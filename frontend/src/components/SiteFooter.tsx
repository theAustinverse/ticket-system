import { Link } from 'react-router-dom';

/** Bottom of the home page: the legal pages every visitor should be able to find. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="法律條款">
        <Link to="/privacy">隱私政策</Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms">服務條款</Link>
        <span aria-hidden="true">·</span>
        <Link to="/contact">聯絡我們</Link>
      </nav>
      <small>© TS 年度盛會</small>
    </footer>
  );
}
