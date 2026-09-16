import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/client';
import {defaultWatermark, type WatermarkSettings} from '../types';
export type WatermarkRow = {owner_id:string;orientation:'portrait'|'landscape';opacity:number;size:number;image_key:string|null;image_name:string;updated_at:string};
export function getWatermarkBucket(): R2Bucket {
  const bucket = (env as unknown as {BUCKET?:R2Bucket}).BUCKET;
  if (!bucket) throw new Error('Watermark storage unavailable');
  return bucket;
}
export async function readWatermark(owner: string) {
  return getDatabase().prepare('SELECT owner_id,orientation,opacity,size,image_key,image_name,updated_at FROM watermarks WHERE owner_id=?').bind(owner).first<WatermarkRow>();
}
export function presentWatermark(row: WatermarkRow | null): WatermarkSettings {
  if (!row) return {...defaultWatermark};
  const imageUrl=row.image_key?'/api/watermark/image?v='+encodeURIComponent(row.updated_at):null;
  return {
    ...defaultWatermark,
    orientation:row.orientation,
    opacity:row.opacity,
    size:row.size,
    ...(row.orientation==='portrait'
      ?{portraitImageKey:row.image_key,portraitImageName:row.image_name,portraitImageUrl:imageUrl}
      :{landscapeImageKey:row.image_key,landscapeImageName:row.image_name,landscapeImageUrl:imageUrl}),
  };
}
export async function writeWatermark(owner:string, data:Pick<WatermarkSettings,'orientation'|'opacity'|'size'>, imageKey:string|null, imageName:string) {
  const now = new Date().toISOString();
  await getDatabase().prepare('INSERT INTO watermarks(owner_id,orientation,opacity,size,image_key,image_name,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET orientation=excluded.orientation,opacity=excluded.opacity,size=excluded.size,image_key=excluded.image_key,image_name=excluded.image_name,updated_at=excluded.updated_at').bind(owner,data.orientation,data.opacity,data.size,imageKey,imageName,now).run();
  return presentWatermark({owner_id:owner,...data,image_key:imageKey,image_name:imageName,updated_at:now});
}
