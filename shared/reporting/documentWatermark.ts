import {defaultWatermark, type WatermarkSettings} from '@/modules/configuracoes/marca-dagua/types';
import type {ReportOrientation, ReportWatermarkBrand} from './types';

// A document uses its own page orientation, regardless of the settings tab
// last opened by the operator (portrait / landscape).
export function documentWatermark(settings: WatermarkSettings = defaultWatermark, orientation: ReportOrientation = 'portrait'): ReportWatermarkBrand {
  return {imageUrl: orientation === 'portrait' ? settings.portraitImageUrl : settings.landscapeImageUrl, opacity: settings.opacity, size: settings.size};
}
