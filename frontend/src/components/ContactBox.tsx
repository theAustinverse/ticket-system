import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Contact } from '../api/types';
import { ContactList } from './ContactList';
import { OfficialLine } from './OfficialLine';

/** "有問題請聯絡誰" under the event list: the official LINE link first, then any contact people the admins have added. */
export function ContactBox() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  useEffect(() => {
    api.getContacts().then(setContacts).catch(() => setContacts(null));
  }, []);

  const people = contacts ?? [];

  return (
    <section className="contact-box">
      <h2>聯絡窗口</h2>
      <p className="hint">票券、報名或活動有任何問題，請聯絡以下窗口。</p>
      <OfficialLine />
      {people.length > 0 && <ContactList contacts={people} />}
      <p>
        <Link to="/contact">在「聯絡我們」頁查看</Link>
      </p>
    </section>
  );
}
