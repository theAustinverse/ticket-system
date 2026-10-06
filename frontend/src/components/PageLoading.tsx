import { Icon3D } from './Icon3D';

/** Loading state for pages: a swinging lantern instead of bare text. */
export function PageLoading({ narrow = false }: { narrow?: boolean }) {
  return (
    <div className={`page page-loading ${narrow ? 'page-narrow' : ''}`.trim()} role="status">
      <Icon3D name="lantern" motion="swing" size={72} />
      <p>載入中…</p>
    </div>
  );
}
