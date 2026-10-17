/** The three fixed choices on the page; "自訂金額" is the fourth. */
export const SPONSOR_PRESETS = [50, 100, 500];
export const SPONSOR_MIN_AMOUNT = 10;
export const SPONSOR_MAX_AMOUNT = 50000;
/** Unpaid pledges one account may have open at once, so the list can't be flooded. */
export const MAX_PENDING_PER_USER = 5;

/**
 * Optional crypto channel. The address lives here, in code, on purpose: a
 * change has to go through a commit and a deploy, so it can't be swapped by
 * someone who only has an editor login (a swapped address would send every
 * sponsorship to a stranger and be hard to notice). Leave `address` null to
 * keep the option hidden. Only stablecoins (USDT / USDC) on BNB Smart Chain
 * (BEP-20) are accepted, so a sponsor never has to guess a price: the
 * same 0x address exists on other EVM chains, and coins sent on the wrong
 * network are usually unrecoverable. Set `memo` only if the exchange's
 * deposit page asks for one for this network.
 */
export const SPONSOR_CRYPTO: {
  coins: string[];
  network: string;
  address: string | null;
  memo: string | null;
} = {
  coins: ['USDT', 'USDC'],
  network: 'BNB Smart Chain (BEP-20)',
  address: '0x49ce275971cda31c60b1cf70dd8730fd6ab7aa07',
  memo: null,
};

export const BSC_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const BSC_TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
