import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Contact } from '../api/types';
import { ContactList } from '../components/ContactList';
import { OfficialLine } from '../components/OfficialLine';

export function ContactPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.getContacts().then(setContacts).catch(() => setFailed(true));
  }, []);

  return (
    <div className="page page-narrow">
      <h1>聯絡我們</h1>
      <p className="muted">票券、報名或活動有任何問題，請聯絡以下窗口。</p>
      <OfficialLine />
      {failed && <p className="error">窗口名單載入失敗，請稍後再試</p>}
      {!failed && !contacts && <p>載入中…</p>}
      {contacts && contacts.length > 0 && <ContactList contacts={contacts} />}
    </div>
  );
}
