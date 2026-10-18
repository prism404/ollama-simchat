export type AvatarCrop = { x: number; y: number; zoom: number };
export function Avatar({
  src,
  name,
  crop,
  className = "",
}: {
  src?: string | null;
  name: string;
  crop?: AvatarCrop;
  className?: string;
}) {
  const frame = crop ?? { x: 50, y: 50, zoom: 1 };
  return (
    <span className={`avatar-frame ${className}`}>
      {src ? (
        <img
          src={src}
          alt={`Avatar de ${name}`}
          style={{
            objectPosition: `${frame.x}% ${frame.y}%`,
            transform: `scale(${frame.zoom})`,
            transformOrigin: `${frame.x}% ${frame.y}%`,
          }}
        />
      ) : (
        <span className="avatar-fallback">
          {name.slice(0, 1).toLocaleUpperCase("fr")}
        </span>
      )}
    </span>
  );
}
