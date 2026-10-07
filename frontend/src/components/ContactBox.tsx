import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Contact } from '../api/types';
import { ContactList } from './ContactList';

/** "有問題請聯絡誰" under the event list. Renders nothing until at least one contact exists. */
export function ContactBox() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  useEffect(() => {
    api.getContacts().then(setContacts).catch(() => setContacts(null));
  }, []);

  if (!contacts || contacts.length === 0) return null;

  return (
    <section className="contact-box">
      <h2>聯絡窗口</h2>
      <p className="hint">票券、報名或活動有任何問題，請聯絡以下窗口。</p>
      <ContactList contacts={contacts} />
      <p>
        <Link to="/contact">在「聯絡我們」頁查看</Link>
      </p>
    </section>
  );
}
