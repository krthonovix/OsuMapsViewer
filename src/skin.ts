export interface SkinSprites {
  hitcircle: HTMLImageElement;
  hitcircleoverlay: HTMLImageElement;
  sliderstartcircle: HTMLImageElement;
  sliderball: HTMLImageElement;
  approachcircle: HTMLImageElement;
  cursor: HTMLImageElement;
  cursortrail: HTMLImageElement;
  sliderfollowcircle: HTMLImageElement;
  hit100: HTMLImageElement;
  hit50: HTMLImageElement;
  hit0: HTMLImageElement;
  hit300: HTMLImageElement;
  digits: HTMLImageElement[];
}

const base = '/skins/rafis-hddt/';
let pending: Promise<SkinSprites> | null = null;

function load(name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`No se pudo cargar el sprite ${name}.`));
    image.src = base + name;
  });
}

export function loadRafisSkin(): Promise<SkinSprites> {
  if (!pending) {
    pending = Promise.all([
      load('hitcircle.png'),
      load('hitcircleoverlay.png'),
      load('sliderstartcircle.png'),
      load('sliderb.png'),
      load('approachcircle.png'),
      load('cursor.png'),
      load('cursortrail.png'),
      load('sliderfollowcircle.png'),
      load('hit100.png'), load('hit50.png'), load('hit0.png'), load('hit300.png'),
      ...Array.from({ length: 10 }, (_, i) => load(`default-${i}.png`)),
    ]).then(([hitcircle, hitcircleoverlay, sliderstartcircle, sliderball, approachcircle, cursor, cursortrail, sliderfollowcircle,
      hit100, hit50, hit0, hit300, ...digits]) =>
      ({ hitcircle, hitcircleoverlay, sliderstartcircle, sliderball, approachcircle, cursor, cursortrail,
        sliderfollowcircle, hit100, hit50, hit0, hit300, digits })
    );
  }
  return pending;
}
