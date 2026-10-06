import lantern from '../assets/icons3d/lantern.webp';
import mahjong from '../assets/icons3d/mahjong.webp';
import ingot from '../assets/icons3d/ingot.webp';
import ticket from '../assets/icons3d/ticket.webp';

const SRC = { lantern, mahjong, ingot, ticket };

export type Icon3DName = keyof typeof SRC;
/**
 * swing: hangs from the top and sways (loading). float: bobs and turns in 3D
 * (waiting). pop: springs in with a bounce (success). flip: turns over like a
 * tile (selection). none: static.
 */
export type Icon3DMotion = 'swing' | 'float' | 'pop' | 'flip' | 'none';

/**
 * Higgsfield-rendered 3D keepsakes with real transparency. The depth comes
 * from the artwork itself (lighting, bevels); the motion classes live in
 * styles.css and switch off for prefers-reduced-motion.
 */
export function Icon3D({
  name,
  motion = 'none',
  size = 56,
  className = '',
}: {
  name: Icon3DName;
  motion?: Icon3DMotion;
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={`icon3d icon3d-${motion} ${className}`.trim()}
      src={SRC[name]}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
    />
  );
}
