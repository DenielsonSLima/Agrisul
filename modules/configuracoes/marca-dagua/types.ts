export type WatermarkOrientation = 'portrait' | 'landscape';
export type WatermarkSettings = {
  orientation: WatermarkOrientation;
  opacity: number;
  size: number;
  portraitImageName: string;
  portraitImageUrl: string | null;
  portraitImageKey: string | null;
  landscapeImageName: string;
  landscapeImageUrl: string | null;
  landscapeImageKey: string | null;
  imageName?: string;
  imageUrl?: string | null;
  imageKey?: string | null;
};
export const defaultWatermark: WatermarkSettings = {
  orientation: 'portrait', opacity: 15, size: 60,
  portraitImageName: '', portraitImageUrl: null, portraitImageKey: null,
  landscapeImageName: '', landscapeImageUrl: null, landscapeImageKey: null,
};
export function activeWatermarkImage(settings:WatermarkSettings){
 return settings.orientation==='portrait'
  ?{key:settings.portraitImageKey,name:settings.portraitImageName,url:settings.portraitImageUrl}
  :{key:settings.landscapeImageKey,name:settings.landscapeImageName,url:settings.landscapeImageUrl};
}
