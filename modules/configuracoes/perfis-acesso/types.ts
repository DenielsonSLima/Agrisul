export type AccessProfile = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
  updatedAt?: string | null;
};

export type AccessProfileInput = Pick<AccessProfile,'name'|'description'|'permissions'>;

export {permissionGroups} from '@/shared/access/permissionCatalog';
export type {PermissionOption,PermissionGroup,PermissionSubmodule} from '@/shared/access/permissionCatalog';
