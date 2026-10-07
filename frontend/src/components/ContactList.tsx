import type { Contact } from '../api/types';

/**
 * Only an https:// value becomes a link. The server refuses other schemes
 * too, but this is the last line before an href, so it checks again rather
 * than trusting what was stored.
 */
function lineHref(lineId: string): string | null {
  return /^https:\/\//i.test(lineId) ? lineId : null;
}

/** One card per contact person: name, LINE ID, Email. Shared by the home box and the 聯絡我們 page. */
export function ContactList({ contacts }: { contacts: Contact[] }) {
  return (
    <ul className="contact-list">
      {contacts.map((c) => {
        const href = c.lineId ? lineHref(c.lineId) : null;
        return (
          <li key={c.id} className="contact-card">
            <h3>{c.name}</h3>
            {c.lineId && (
              <p>
                <span className="contact-label">LINE ID</span>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    開啟 LINE 連結
                  </a>
                ) : (
                  <span className="contact-value">{c.lineId}</span>
                )}
              </p>
            )}
            {c.email && (
              <p>
                <span className="contact-label">Email</span>
                <a href={`mailto:${c.email}`}>{c.email}</a>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
