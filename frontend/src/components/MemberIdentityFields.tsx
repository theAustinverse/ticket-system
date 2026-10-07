export type MemberKind = '' | 'PARTNER' | 'RELATIVE';

/** What the two member forms keep per member to record "夥伴, or whose 親友". */
export interface IdentityDraft {
  name: string;
  kind: MemberKind;
  /** The partner's seat as a string ('0' is the leader), '' until chosen. */
  relativeOf: string;
}

export interface PartnerChoice {
  seat: number;
  label: string;
}

/**
 * Who a relative can belong to: the leader (seat 0) and every other named
 * member marked as a partner. Never the member itself, and never another
 * relative, so a ticket can always say "<partner>的親友".
 */
export function partnerChoices(
  leaderName: string,
  drafts: IdentityDraft[],
  selfIndex: number,
): PartnerChoice[] {
  const choices: PartnerChoice[] = [
    { seat: 0, label: `${leaderName.trim() || '主揪'}（主揪）` },
  ];
  drafts.forEach((draft, i) => {
    if (i !== selfIndex && draft.name.trim() && draft.kind === 'PARTNER') {
      choices.push({ seat: i + 1, label: draft.name.trim() });
    }
  });
  return choices;
}

/** The first thing wrong with the members' identities, in words for the form, or null. */
export function identityError(leaderName: string, drafts: IdentityDraft[]): string | null {
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i]!;
    const name = draft.name.trim();
    if (!name) continue;
    if (draft.kind !== 'PARTNER' && draft.kind !== 'RELATIVE') {
      return `請選擇「${name}」是夥伴還是親友`;
    }
    if (draft.kind === 'RELATIVE') {
      const valid = partnerChoices(leaderName, drafts, i).some(
        (c) => String(c.seat) === draft.relativeOf,
      );
      if (!valid) return `請選擇「${name}」是哪一位夥伴的親友`;
    }
  }
  return null;
}

/** The two fields that go to the API for one member; nothing for a blank seat. */
export function identityPayload(
  draft: IdentityDraft,
): { kind?: 'PARTNER' | 'RELATIVE'; relativeOfSeat?: number } {
  if (!draft.name.trim() || (draft.kind !== 'PARTNER' && draft.kind !== 'RELATIVE')) return {};
  return draft.kind === 'PARTNER'
    ? { kind: 'PARTNER' }
    : { kind: 'RELATIVE', relativeOfSeat: Number(draft.relativeOf) };
}

/** The 身分 (and, for a 親友, "是哪位夥伴的親友") selects inside one member's block. */
export function MemberIdentityFields({
  draft,
  choices,
  onChange,
}: {
  draft: IdentityDraft;
  choices: PartnerChoice[];
  onChange: (patch: Partial<IdentityDraft>) => void;
}) {
  return (
    <>
      <label>
        身分
        <select
          value={draft.kind}
          onChange={(e) => onChange({ kind: e.target.value as MemberKind, relativeOf: '' })}
        >
          <option value="">請選擇</option>
          <option value="PARTNER">夥伴</option>
          <option value="RELATIVE">夥伴的親友</option>
        </select>
      </label>
      {draft.kind === 'RELATIVE' && (
        <label>
          是哪一位夥伴的親友
          <select
            value={draft.relativeOf}
            onChange={(e) => onChange({ relativeOf: e.target.value })}
          >
            <option value="">請選擇</option>
            {choices.map((c) => (
              <option key={c.seat} value={String(c.seat)}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
