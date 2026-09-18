import type {DocumentLayout} from './types';
import {defaultServiceRequestLayout, legacyServiceRequestLayout} from './defaultLayout';

export const DOCUMENT_BODY_TOP = 47;
export const DOCUMENT_BODY_BOTTOM = 285;

function fitLegacyHeader(layout: DocumentLayout): DocumentLayout {
  const body = layout.blocks.filter(block => !(
    block.id === 'brand' && block.type === 'text' && block.text === 'CONTROLE DE FATURAMENTO'
    || block.id === 'title' && block.type === 'text' && block.text === 'SOLICITAÇÃO DE SERVIÇO'
    || block.id === 'top-rule' && block.type === 'line' && block.y === 39
  ));
  const blocks = body.length ? body : layout.blocks;
  if (!blocks.length) return layout;
  const top = Math.min(...blocks.map(block => block.y));
  const bottom = Math.max(...blocks.map(block => block.y + block.height));
  if (top >= 55 && bottom <= 283) return {...layout, blocks};
  const ratio = Math.min(1, (283 - 55) / Math.max(1, bottom - top));
  return {...layout, blocks: blocks.map(block => ({...block, y: 55 + (block.y - top) * ratio, height: block.height * ratio}))};
}

const legacyWithHeader = fitLegacyHeader(legacyServiceRequestLayout);

/** Compare the complete block definitions: IDs alone cannot distinguish a
 * stock form from a customized, already signed document. */
function sameLayout(left: DocumentLayout, right: DocumentLayout) {
  if (left.page.width !== right.page.width || left.page.height !== right.page.height || left.blocks.length !== right.blocks.length) return false;
  return left.blocks.every((block, index) => {
    const other = right.blocks[index];
    const keys = new Set([...Object.keys(block), ...Object.keys(other)]);
    return [...keys].every(key => {
      const value = block[key as keyof typeof block], comparison = other[key as keyof typeof other];
      return typeof value === 'number' && typeof comparison === 'number' ? Math.abs(value - comparison) < 0.000001 : value === comparison;
    });
  });
}

export function isStandardServiceRequestLayout(layout: DocumentLayout) {
  return sameLayout(layout, defaultServiceRequestLayout);
}

/** Presentation only. Modernize the two exact initial layouts. A customized
 * legacy form retains the previous header fitting behavior; layouts already
 * designed below the company header keep their coordinates unchanged. */
export function layoutWithReportHeader(layout: DocumentLayout): DocumentLayout {
  if (sameLayout(layout, legacyServiceRequestLayout) || sameLayout(layout, legacyWithHeader)) return structuredClone(defaultServiceRequestLayout);
  const legacyBrand = layout.blocks.some(block => block.id === 'brand' && block.type === 'text' && block.text === 'CONTROLE DE FATURAMENTO' && block.x === 16 && block.y === 14);
  const legacyRule = layout.blocks.some(block => block.id === 'top-rule' && block.type === 'line' && block.x === 16 && block.y === 39);
  if (legacyBrand && legacyRule) return fitLegacyHeader(layout);
  return layout;
}
