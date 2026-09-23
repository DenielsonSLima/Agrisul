import type {Material} from '../types';

/**
 * Every registered material can be quoted. References enrich the product
 * snapshot, but their absence must not hide the material from the picker.
 */
export function quoteMaterialOptions(materials: readonly Material[]): Material[] {
  return [...materials];
}
