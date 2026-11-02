import {profileAccessSummary} from '@/shared/access/permissionCatalog';

export function AccessProfilePermissions({permissions}: {permissions: string[]}) {
  const summary = profileAccessSummary(permissions);
  return <details className="mt-3 text-sm">
    <summary className="min-h-11 cursor-pointer py-3">Ver módulos e submódulos permitidos</summary>
    <ul className="grid gap-2 pl-4 list-disc">{summary.map(label => <li key={label}>{label}</li>)}</ul>
  </details>;
}
