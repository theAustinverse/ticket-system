import { Link } from 'react-router-dom';

/** Under the 所屬系統/團隊 dropdown: there is no catch-all option, so say where to go if the leader is missing. */
export function TeamMissingHint() {
  return (
    <small className="hint">
      如果領導人不在選項中請<Link to="/contact">聯絡我們</Link>
    </small>
  );
}
